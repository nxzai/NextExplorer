import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

/**
 * One folder per tab, and one clipboard for all of them.
 *
 * This is the whole of what tabs change in the store, and the line it draws:
 * what belongs to a *place* is the tab's — the folder it is on, what it holds,
 * what is selected in it, the rename it is in the middle of — and what belongs to
 * the *person* is the window's. Copying in one tab and pasting in another is the
 * reason to have tabs at all, so the clipboard is deliberately on the other side
 * of that line.
 *
 * Before this, a second tab would have shown the first one's selection and the
 * first one's listing, because there was one of each in the store.
 */

const browse = vi.fn();
const renameApi = vi.fn();

vi.mock('@/api', () => ({
  browse: (...a) => browse(...a),
  browseShare: vi.fn(),
  normalizePath: (p = '') => String(p).replace(/^\/+|\/+$/g, ''),
  deleteItemsStream: vi.fn(),
  copyItems: vi.fn(),
  moveItems: vi.fn(),
  createFolder: vi.fn(),
  createFile: vi.fn(),
  createOfficeDocument: vi.fn(),
  renameItem: (...a) => renameApi(...a),
  fetchThumbnail: vi.fn(),
  extractZip: vi.fn(),
  compressToZip: vi.fn(),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    sortBy: { by: 'name', order: 'asc' },
    restoreFolderPreferences: vi.fn(),
  }),
}));
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ thumbnailsEnabledForSession: false }),
}));
vi.mock('@/stores/favorites', () => ({ useFavoritesStore: () => ({ loadFavorites: vi.fn() }) }));
vi.mock('@/stores/volumeUsage', () => ({
  useVolumeUsageStore: () => ({ scheduleRefresh: vi.fn() }),
}));
vi.mock('@/stores/folderSize', () => ({
  useFolderSizeStore: () => ({ scheduleRefresh: vi.fn(), sizeFor: () => null }),
}));
vi.mock('@/stores/features', () => ({
  useFeaturesStore: () => ({ onlyofficeEnabled: false, ensureLoaded: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));
vi.mock('@/stores/operationTasks', () => ({
  useOperationTasksStore: () => ({
    startOperation: vi.fn(() => 'op-1'),
    updateOperation: vi.fn(),
    finishOperation: vi.fn(),
  }),
}));
vi.mock('@vueuse/core', () => ({ useStorage: (_k, initial) => ref(initial) }));

import { useFileStore } from './fileStore';
import { useTabsStore } from './tabs';

const item = (name, path = 'Docs') => ({ name, path, kind: 'txt' });

/** A tab on `path`, holding `listing`, left in front. */
const openFolder = async (path, listing) => {
  const tabs = useTabsStore();
  // As `useTabRouteSync` tells it once the settings have arrived.
  tabs.setEnabled(true);
  const store = useFileStore();
  browse.mockResolvedValue({ items: listing, path });
  await store.fetchPathItems(path);
  return { tabs, store };
};

beforeEach(() => {
  setActivePinia(createPinia());
  browse.mockReset();
  renameApi.mockReset();
});

describe('a folder belongs to the tab it is in', () => {
  it('keeps a listing and a path each, and shows the one in front', async () => {
    const { tabs, store } = await openFolder('Docs', [item('notes.txt')]);
    const first = tabs.activeId;

    tabs.open('/browse/Media');
    browse.mockResolvedValue({ items: [item('clip.mp4', 'Media')], path: 'Media' });
    await store.fetchPathItems('Media');

    expect(store.currentPath).toBe('Media');
    expect(store.currentPathItems.map((entry) => entry.name)).toEqual(['clip.mp4']);

    tabs.activate(first);

    expect(store.currentPath).toBe('Docs');
    expect(store.currentPathItems.map((entry) => entry.name)).toEqual(['notes.txt']);
  });

  it('selects in one without selecting in the other', async () => {
    const { tabs, store } = await openFolder('Docs', [item('notes.txt'), item('plan.txt')]);
    const first = tabs.activeId;
    store.selectedItems = [item('notes.txt')];
    expect(store.hasSelection).toBe(true);

    const second = tabs.open('/browse/Media');
    browse.mockResolvedValue({ items: [item('clip.mp4', 'Media')], path: 'Media' });
    await store.fetchPathItems('Media');

    // The tab in front has its own, and it is empty.
    expect(store.hasSelection).toBe(false);
    expect(store.selectedItems).toEqual([]);

    tabs.activate(first);
    expect(store.selectedItems.map((entry) => entry.name)).toEqual(['notes.txt']);
    tabs.activate(second.id);
    expect(store.selectedItems).toEqual([]);
  });

  it('is renaming in one without renaming in the other', async () => {
    const { tabs, store } = await openFolder('Docs', [item('notes.txt')]);
    const first = tabs.activeId;
    store.beginRename(item('notes.txt'));
    expect(store.renameState).toMatchObject({ originalName: 'notes.txt' });

    tabs.open('/browse/Media');
    expect(store.renameState).toBeNull();

    tabs.activate(first);
    expect(store.renameState).toMatchObject({ originalName: 'notes.txt' });
  });

  it('lets go of what a closed tab was holding', async () => {
    const { tabs, store } = await openFolder('Docs', [item('notes.txt')]);
    const first = tabs.activeId;
    const second = tabs.open('/browse/Media');
    browse.mockResolvedValue({ items: [item('clip.mp4', 'Media')], path: 'Media' });
    await store.fetchPathItems('Media');

    tabs.close(second.id);
    expect(tabs.activeId).toBe(first);
    expect(store.currentPathItems.map((entry) => entry.name)).toEqual(['notes.txt']);

    // A tab opened now is a new one: it inherits nothing from the one that went.
    tabs.open('/browse/Media');
    expect(store.currentPathItems).toEqual([]);
    expect(store.currentPath).toBe('');
  });
});

describe('the clipboard belongs to the person', () => {
  it('is the same one in every tab, which is the point of tabs', async () => {
    const { tabs, store } = await openFolder('Docs', [item('notes.txt')]);
    store.selectedItems = [item('notes.txt')];
    store.copy();
    expect(store.hasClipboardItems).toBe(true);

    tabs.open('/browse/Media');

    // Nothing is selected in the new tab, and the clipboard is still full: this
    // is copy here, paste there.
    expect(store.hasSelection).toBe(false);
    expect(store.hasClipboardItems).toBe(true);
    expect(store.copiedItems.map((entry) => entry.name)).toEqual(['notes.txt']);
  });
});
