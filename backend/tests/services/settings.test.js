import { describe, it, expect } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const SETTINGS_MODULES = ['src/services/settingsService', 'src/services/db'];

const createSettingsContext = async () => {
  const envContext = await setupTestEnv({
    tag: 'settings-test-',
    modules: SETTINGS_MODULES,
  });
  const settingsService = envContext.requireFresh('src/services/settingsService');
  const dbService = envContext.requireFresh('src/services/db');
  return { envContext, settingsService, dbService };
};

describe('Settings Service', () => {
  describe('getSettings', () => {
    it('should return defaults when no config exists', async () => {
      const { envContext, settingsService } = await createSettingsContext();
      try {
        const settings = await settingsService.getSettings();

        expect(settings.access.rules).toEqual([]);
        expect(settings.thumbnails.enabled).toBe(true);
        expect(settings.thumbnails.size).toBe(200);
        expect(settings.thumbnails.quality).toBe(70);
        expect(settings.thumbnails.concurrency).toBe(10);
        expect(settings.uploads.chunkedEnabled).toBe(false);
        expect(settings.uploads.chunkSizeBytes).toBe(8 * 1024 * 1024);
      } finally {
        await envContext.cleanup();
      }
    });

    it('stores administrator FFmpeg executable overrides', async () => {
      const { envContext, settingsService } = await createSettingsContext();
      try {
        await settingsService.setSettings({
          ffmpeg: { ffmpegPath: ' /opt/tools/ffmpeg ', ffprobePath: '/opt/tools/ffprobe' },
        });

        expect((await settingsService.getSystemSettings()).ffmpeg).toEqual({
          ffmpegPath: '/opt/tools/ffmpeg',
          ffprobePath: '/opt/tools/ffprobe',
        });
      } finally {
        await envContext.cleanup();
      }
    });
  });

  describe('setSettings', () => {
    it('should sanitize thumbnails and uploads, and tidy a rule path', async () => {
      const { envContext, settingsService } = await createSettingsContext();
      try {
        const payload = {
          thumbnails: { size: 5000, quality: 150, concurrency: -2 },
          access: {
            rules: [{ path: '/Projects', permissions: 'ro', recursive: true }],
          },
          uploads: { chunkedEnabled: true, chunkSizeBytes: 512 },
        };

        const updated = await settingsService.setSettings(payload);

        expect(updated.thumbnails.size).toBe(1024);
        expect(updated.thumbnails.quality).toBe(100);
        expect(updated.thumbnails.concurrency).toBe(1);
        expect(updated.thumbnails.enabled).toBe(true);
        expect(updated.access.rules.length).toBe(1);
        expect(updated.access.rules[0].path).toBe('Projects');
        expect(updated.uploads.chunkedEnabled).toBe(true);
        expect(updated.uploads.chunkSizeBytes).toBe(1024 * 1024);
      } finally {
        await envContext.cleanup();
      }
    });

    /**
     * A number out of its bounds is brought within them, because every value in
     * the range means the same kind of thing. A rule is not like that: there is
     * no nearest valid folder for `../bad`, and the nearest valid permissions
     * for a misspelt `readonly` used to be `rw` — the opposite of what was
     * meant. Both are answered instead, and nothing is stored.
     */
    it('should refuse an access rule it cannot store rather than repair it', async () => {
      const { envContext, settingsService } = await createSettingsContext();
      try {
        await settingsService.setSettings({
          access: { rules: [{ path: 'Projects', permissions: 'ro', recursive: true }] },
        });

        await expect(
          settingsService.setSettings({
            access: { rules: [{ path: 'uploads', permissions: 'invalid', recursive: false }] },
          })
        ).rejects.toThrow(/is not one of the permissions/);
        await expect(
          settingsService.setSettings({
            access: { rules: [{ path: '../bad', permissions: 'hidden' }] },
          })
        ).rejects.toThrow(/Traversal outside the volume root/);

        const { access } = await settingsService.getSystemSettings();
        expect(access.rules).toEqual([expect.objectContaining({ path: 'Projects' })]);
      } finally {
        await envContext.cleanup();
      }
    });
  });

  describe('user sidebar settings', () => {
    it('should persist sidebar visibility preferences as booleans', async () => {
      const { envContext, settingsService, dbService } = await createSettingsContext();
      try {
        const db = await dbService.getDb();
        const now = new Date().toISOString();
        db.prepare(
          `
          INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run('user-1', 'user-1@example.com', 1, 'user-1', 'User 1', '["user"]', now, now);

        await settingsService.setUserSetting('user-1', 'showSidebarFavorites', false);
        await settingsService.setUserSetting('user-1', 'showSidebarShares', true);
        // Whether a .md file opens in the editor rather than the preview (#347)
        // is a per-user choice, and a boolean like the others.
        await settingsService.setUserSetting('user-1', 'markdownOpensInEditor', true);
        // Folders first when sorting is the same kind of per-user boolean (#495);
        // turning it off is what lets one list mix files and folders.
        await settingsService.setUserSetting('user-1', 'foldersFirst', false);

        // Anything that is not a boolean is not an answer, and is not stored:
        // `Boolean('yes')` used to store true and `Boolean(0)` false, in place
        // of what the person had chosen.
        expect(
          await settingsService.setUserSetting('user-1', 'showSidebarShares', 0)
        ).toBeUndefined();
        expect(
          await settingsService.setUserSetting('user-1', 'showSidebarTools', 'yes')
        ).toBeUndefined();

        const settings = await settingsService.getUserSettings('user-1');

        expect(settings.showSidebarFavorites).toBe(false);
        expect(settings.showSidebarShares).toBe(true);
        // Never stored, so the client's own default is what applies.
        expect(settings.showSidebarTools).toBeUndefined();
        expect(settings.markdownOpensInEditor).toBe(true);
        expect(settings.foldersFirst).toBe(false);
      } finally {
        await envContext.cleanup();
      }
    });
  });

  describe('folder sorts', () => {
    it('keeps every folder a user has set a preference on', async () => {
      // The cap existed because these lived in one JSON blob, rewritten whole
      // on every change: past a hundred folders the oldest was silently
      // forgotten. As rows there is nothing to cap, and nothing to forget.
      const { envContext, settingsService, dbService } = await createSettingsContext();
      try {
        const db = await dbService.getDb();
        const now = new Date().toISOString();
        db.prepare(
          `
          INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run('user-1', 'user-1@example.com', 1, 'user-1', 'User 1', '["user"]', now, now);

        for (let index = 0; index < 150; index += 1) {
          await settingsService.setUserFolderSort('user-1', `Projects/folder-${index}`, {
            by: 'customColumn',
            order: 'desc',
          });
        }

        const settings = await settingsService.getUserSettings('user-1');

        expect(Object.keys(settings.folderSorts)).toHaveLength(150);
        expect(settings.folderSorts['Projects/folder-0']).toMatchObject({
          by: 'customColumn',
          order: 'desc',
        });
      } finally {
        await envContext.cleanup();
      }
    });

    it('keeps a folder sort and its view side by side', async () => {
      // One row carries both, so setting one must not wipe the other.
      const { envContext, settingsService, dbService } = await createSettingsContext();
      try {
        const db = await dbService.getDb();
        const now = new Date().toISOString();
        db.prepare(
          `
          INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run('user-1', 'user-1@example.com', 1, 'user-1', 'User 1', '["user"]', now, now);

        await settingsService.setUserFolderSort('user-1', 'Photos', { by: 'name', order: 'asc' });
        await settingsService.setUserFolderView('user-1', 'Photos', { mode: 'photos' });

        const settings = await settingsService.getUserSettings('user-1');

        expect(settings.folderSorts.Photos).toMatchObject({ by: 'name', order: 'asc' });
        expect(settings.folderViews.Photos).toMatchObject({ mode: 'photos' });
      } finally {
        await envContext.cleanup();
      }
    });
  });
});

/**
 * A path written into the compose file has to reach the page that shows it.
 *
 * It did not: the server sent it and the browser dropped it, because the
 * settings store copies system settings field by field and nobody added the
 * new one. Both halves are covered now — this end, and the store's own test.
 */
describe('exclusions that come from the environment', () => {
  it('reports the search index exclusions the environment set', async () => {
    const envContext = await setupTestEnv({
      tag: 'settings-search-index-',
      modules: [...SETTINGS_MODULES, 'src/services/searchIndexExclusions'],
      env: { SEARCH_INDEX: 'true', SEARCH_INDEX_EXCLUDE: 'Stacks/docker, Sauvegardes/2024' },
    });
    try {
      const settingsService = envContext.requireFresh('src/services/settingsService');
      const settings = await settingsService.getSettings();

      expect(settings.searchIndex.environmentExcludedPaths).toEqual([
        'Sauvegardes/2024',
        'Stacks/docker',
      ]);
      // The environment's list is not the administrator's, and neither is
      // shown in place of the other.
      expect(settings.searchIndex.excludedPaths).toEqual([]);
    } finally {
      await envContext.cleanup();
    }
  });

  it('keeps the two lists apart when an administrator adds one', async () => {
    const envContext = await setupTestEnv({
      tag: 'settings-search-index-',
      modules: [...SETTINGS_MODULES, 'src/services/searchIndexExclusions'],
      env: { SEARCH_INDEX: 'true', SEARCH_INDEX_EXCLUDE: 'Stacks/docker' },
    });
    try {
      const settingsService = envContext.requireFresh('src/services/settingsService');
      await settingsService.setSystemSetting('system', 'searchIndex', {
        excludedPaths: ['Photos/RAW'],
      });

      const settings = await settingsService.getSettings();
      expect(settings.searchIndex.excludedPaths).toEqual(['Photos/RAW']);
      expect(settings.searchIndex.environmentExcludedPaths).toEqual(['Stacks/docker']);
    } finally {
      await envContext.cleanup();
    }
  });
});
