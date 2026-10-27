const express = require('express');
const {
  onlyoffice,
  collabora,
  editor,
  preview,
  search,
  terminal,
  features,
  hiddenFiles,
  public: publicConfig,
  demoLogin,
} = require('../config/index');
const terminalService = require('../services/terminalService');
const {
  MAX_UPLOAD_CHUNK_SIZE_BYTES,
  getSystemSettings,
  DEFAULT_TAB_LIMIT,
} = require('../services/settingsService');
const { getSupportedArchiveExtensions } = require('../services/archiveService');
const featureSwitches = require('../services/featureSwitches');
const { getTrashSettings } = require('../services/trash/settings');
const { getVersionSettings } = require('../services/versions/settings');
const packageJson = require('../../package.json');

const router = express.Router();

// GET /api/features -> returns enabled/disabled feature flags derived from env
router.get('/features', async (_req, res) => {
  // Probed once at startup, then cached — this await is effectively free.
  const archiveExtensions = await getSupportedArchiveExtensions().catch(() => ['zip']);
  const switches = featureSwitches.snapshot();
  // How many tabs a row may hold: an administrator's choice, read the same way
  // the trash and the versions read theirs, and with the same fallback if the
  // settings cannot be reached at all.
  const tabs = await getSystemSettings().then(
    (settings) => settings.tabs,
    () => ({ maxOpen: DEFAULT_TAB_LIMIT })
  );
  const payload = {
    public: {
      url: publicConfig?.url || null,
      origin: publicConfig?.origin || null,
      // All origins the app may legitimately be reached from (public + internal).
      origins: Array.isArray(publicConfig?.origins) ? publicConfig.origins : [],
    },
    // Null unless demo mode is on and demo credentials were set for it. The
    // config layer is the single place that decides; there is no second rule
    // here to drift from it.
    demoLogin: demoLogin ? { email: demoLogin.email, password: demoLogin.password } : null,
    onlyoffice: {
      enabled: Boolean(onlyoffice && onlyoffice.serverUrl),
      extensions: Array.isArray(onlyoffice?.extensions) ? onlyoffice.extensions : [],
    },
    collabora: {
      enabled: Boolean(collabora && collabora.url && collabora.secret),
      extensions: Array.isArray(collabora?.extensions) ? collabora.extensions : [],
    },
    editor: {
      extensions: Array.isArray(editor?.extensions) ? editor.extensions : [],
      // What the editor will open. The preview has a limit of its own, and a
      // refusal that names both is the difference between an explanation and
      // a dead end.
      maxFileSizeBytes: editor?.maxFileSizeBytes ?? null,
    },
    preview: {
      maxRenderBytes: preview?.maxRenderBytes ?? null,
    },
    search: {
      // Whether the full-text index is on, and whether Settings may change
      // that — `lockedBy` names the variable when the environment decided.
      index: {
        enabled: search?.index?.enabled === true,
        lockedBy: switches.searchIndex.lockedBy,
      },
    },
    hiddenFiles: {
      patterns: Array.isArray(hiddenFiles?.patterns) ? hiddenFiles.patterns : [],
    },
    uploads: {
      // Admin-configurable upper bound for the chunk size (env MAX_CHUNK_SIZE_MIB).
      maxChunkSizeBytes: MAX_UPLOAD_CHUNK_SIZE_BYTES,
    },
    archives: {
      // Extraction formats the server-side 7-Zip build actually supports.
      extensions: archiveExtensions,
    },
    volumeUsage: {
      enabled: Boolean(features?.volumeUsage),
    },
    // Whether deleting goes to the trash, and for how long it keeps things:
    // what the delete dialog tells people before they confirm. Nothing here
    // says what is in anyone's trash.
    trash: await getTrashSettings().then(
      (settings) => ({ enabled: settings.enabled, retentionDays: settings.retentionDays }),
      () => ({ enabled: false, retentionDays: null })
    ),
    // Whether a save keeps what it replaces. Nothing here says what any file's
    // history holds.
    versions: await getVersionSettings().then(
      (settings) => ({ enabled: settings.enabled }),
      () => ({ enabled: false })
    ),
    folderSize: {
      mode: features?.folderSizeMode || 'off',
      enabled: (features?.folderSizeMode || 'off') !== 'off',
      lockedBy: switches.folderSize.lockedBy,
    },
    personal: {
      enabled: Boolean(features?.personalFolders),
    },
    userVolumes: {
      enabled: Boolean(features?.userVolumes),
    },
    navigation: {
      skipHome: Boolean(features?.skipHome),
    },
    // How many tabs a row may hold before it refuses another. The strip never
    // scrolls, so the number is what keeps a tab wide enough to read.
    tabs: {
      maxOpen: tabs.maxOpen,
    },
    // What this installation adds to what is always comparable, which is whatever
    // the text editor can open — the client already has that list, and a second copy
    // of it here would be a second list to keep in step.
    terminal: {
      enabled: Boolean(features?.terminal) && terminalService.isAvailable(),
      extensions: Array.isArray(terminal?.extensions) ? terminal.extensions : [],
    },
    version: {
      app: packageJson.version || '1.0.0',
      gitCommit: process.env.GIT_COMMIT || '',
      gitBranch: process.env.GIT_BRANCH || '',
      repoUrl: process.env.REPO_URL || '',
    },
  };

  res.json(payload);
});

module.exports = router;
