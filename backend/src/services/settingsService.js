const { getDb, prepared } = require('./db');
const { cachedForRequest } = require('../utils/requestContext');
const { normalizeRelativePath } = require('../utils/pathUtils');
const { parseByteSize } = require('../utils/env');
const env = require('../config/env');
const folderSizeExclusions = require('./folderSizeExclusions');
const searchIndexExclusions = require('./searchIndexExclusions');
const { generateId } = require('../utils/ids');
const { ValidationError } = require('../errors/AppError');
const { ruleAppliesToAdmins } = require('../utils/accessRules');

const MIN_UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024;
const HARD_MAX_UPLOAD_CHUNK_SIZE_MIB = 512;
const DEFAULT_UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

// Per-folder preferences are kept per user, and bounded: one entry per folder
// ever visited would otherwise grow without limit.
const MAX_FOLDER_PREFERENCES = 100;
const MAX_FOLDER_PATH_LENGTH = 1024;
const MAX_SORT_FIELD_LENGTH = 128;

// Admin-configurable upper bound (env MAX_CHUNK_SIZE_MIB), capped at the hard
// ceiling. Used to clamp both the default and any saved chunk size.
const resolveMaxChunkSizeBytes = () => {
  const raw = Number(env.MAX_CHUNK_SIZE_MIB);
  const mib =
    Number.isFinite(raw) && raw >= 1
      ? Math.min(Math.floor(raw), HARD_MAX_UPLOAD_CHUNK_SIZE_MIB)
      : HARD_MAX_UPLOAD_CHUNK_SIZE_MIB;
  return Math.max(MIN_UPLOAD_CHUNK_SIZE_BYTES, mib * 1024 * 1024);
};
const MAX_UPLOAD_CHUNK_SIZE_BYTES = resolveMaxChunkSizeBytes();

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

const defaultUploadSettings = () => {
  const configuredChunkSize = parseByteSize(env.UPLOAD_CHUNK_SIZE);
  const chunkSizeBytes =
    Number.isFinite(configuredChunkSize) && configuredChunkSize > 0
      ? configuredChunkSize
      : DEFAULT_UPLOAD_CHUNK_SIZE_BYTES;

  const chunkedAutoFallback = env.UPLOAD_CHUNKED_AUTO_FALLBACK ?? false;
  return {
    // Auto-fallback and forced chunked uploads are mutually exclusive — auto is a
    // direct-with-fallback mode, so it turns forced chunking off.
    chunkedEnabled: chunkedAutoFallback ? false : (env.UPLOAD_CHUNKED_ENABLED ?? false),
    chunkedAutoFallback,
    chunkSizeBytes: clampNumber(
      Math.floor(chunkSizeBytes),
      MIN_UPLOAD_CHUNK_SIZE_BYTES,
      MAX_UPLOAD_CHUNK_SIZE_BYTES
    ),
  };
};

const isValidFolderPath = (folderPath) =>
  typeof folderPath === 'string' &&
  folderPath.length > 0 &&
  folderPath.length <= MAX_FOLDER_PATH_LENGTH;

const sanitizeFolderSort = (sort) => {
  if (
    !sort ||
    typeof sort !== 'object' ||
    typeof sort.by !== 'string' ||
    sort.by.trim().length === 0 ||
    sort.by.length > MAX_SORT_FIELD_LENGTH ||
    (sort.order !== 'asc' && sort.order !== 'desc')
  ) {
    return null;
  }

  return {
    by: sort.by.trim(),
    order: sort.order,
    updatedAt: Number.isFinite(sort.updatedAt) ? Math.floor(sort.updatedAt) : 0,
  };
};

const VIEW_MODES = ['grid', 'list', 'tab', 'photos'];

/** A remembered view mode for one folder, or null when it is not one we have. */
const sanitizeFolderView = (view) => {
  const mode = typeof view === 'string' ? view : view?.mode;
  if (!VIEW_MODES.includes(mode)) return null;

  return {
    mode,
    updatedAt: Number.isFinite(view?.updatedAt) ? Math.floor(view.updatedAt) : 0,
  };
};

/**
 * A map of folder path to preference, keeping only what is valid and only the
 * most recently used — one entry per folder ever visited would grow forever.
 */
const sanitizeFolderPreferences = (preferences, sanitizeEntry) => {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(preferences)
      .map(([folderPath, entry]) => {
        const sanitized = sanitizeEntry(entry);
        return isValidFolderPath(folderPath) && sanitized ? [folderPath, sanitized] : null;
      })
      .filter(Boolean)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FOLDER_PREFERENCES)
  );
};

const sanitizeFolderSorts = (folderSorts) =>
  sanitizeFolderPreferences(folderSorts, sanitizeFolderSort);

const sanitizeFolderViews = (folderViews) =>
  sanitizeFolderPreferences(folderViews, sanitizeFolderView);

/**
 * The bounds thumbnail settings are held to, and their defaults. The settings
 * page refuses a value outside them before sending it, with the same numbers
 * (`SettingsFilesThumbnails.vue`).
 */
const THUMBNAIL_BOUNDS = {
  size: { min: 64, max: 1024, fallback: 200 },
  quality: { min: 1, max: 100, fallback: 70 },
  concurrency: { min: 1, max: 50, fallback: 10 },
};

/**
 * Sanitize thumbnail settings
 */
const sanitizeThumbnails = (thumbnails = {}) => {
  const integer = (key) => {
    const { min, max, fallback } = THUMBNAIL_BOUNDS[key];
    return Number.isFinite(thumbnails[key])
      ? clampNumber(Math.floor(thumbnails[key]), min, max)
      : fallback;
  };
  return {
    enabled: typeof thumbnails.enabled === 'boolean' ? thumbnails.enabled : true,
    size: integer('size'),
    quality: integer('quality'),
    concurrency: integer('concurrency'),
  };
};

const sanitizeFfmpeg = (ffmpeg = {}) => ({
  ffmpegPath:
    typeof ffmpeg.ffmpegPath === 'string' && ffmpeg.ffmpegPath.trim()
      ? ffmpeg.ffmpegPath.trim()
      : null,
  ffprobePath:
    typeof ffmpeg.ffprobePath === 'string' && ffmpeg.ffprobePath.trim()
      ? ffmpeg.ffprobePath.trim()
      : null,
});

const FOLDER_SIZE_MODES = ['off', 'shallow', 'full'];

/**
 * What an administrator chose for the two background workers. Only a choice:
 * when the environment set the same thing, the environment is what runs, and
 * this is kept for the day the variable is taken away.
 */
const sanitizeFolderSize = (folderSize = {}) => ({
  excludedPaths: folderSizeExclusions.sanitizePaths(folderSize.excludedPaths || []),
  mode: FOLDER_SIZE_MODES.includes(folderSize.mode) ? folderSize.mode : 'off',
});

const sanitizeSearchIndex = (searchIndex = {}) => ({
  excludedPaths: searchIndexExclusions.sanitizePaths(searchIndex.excludedPaths || []),
  enabled: searchIndex.enabled === true,
});

const ACCESS_PERMISSIONS = ['rw', 'ro', 'hidden'];

/**
 * Sanitize access control rules.
 *
 * Read back (`strict: false`), a rule that cannot stand is dropped. Anything
 * else would make one bad row — left by an older version, or edited into
 * app.db by hand — unreadable settings, and unreadable settings are every
 * hidden folder visible to everybody.
 *
 * Saved (`strict: true`), the same rule is refused with its reason and nothing
 * is written. Dropping it silently answered 200 with a list the page then
 * adopted: the row for `../Secret` disappeared the moment it was saved, and an
 * administrator was left believing a folder was hidden that never was. The
 * permissions were worse — anything not one of the three became `rw`, so a
 * mistyped `readonly` opened a folder for writing instead of refusing the word.
 */
const sanitizeAccessRules = (rules = [], { strict = false } = {}) => {
  if (!Array.isArray(rules)) {
    if (strict) throw new ValidationError('The access rules have to be sent as a list.');
    return [];
  }

  return rules
    .map((rule, index) => {
      // Numbered as the page numbers them, so the reason names the row.
      const refuse = (reason) => {
        if (!strict) return null;
        throw new ValidationError(`Access rule ${index + 1}: ${reason}`);
      };

      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return refuse('this is not a rule.');
      }

      // A path of nothing but spaces normalises to itself: the rule was stored
      // as it came and matched no folder — written by an administrator, listed
      // on the page, and doing nothing. Refused now, and only when it is blank
      // all through: a folder may legitimately be called "My Documents", or
      // even " x ", so nothing here trims what somebody wrote.
      if (!String(rule.path ?? '').trim()) return refuse('a rule needs the path of a folder.');

      // Validate path
      let normalizedPath;
      try {
        normalizedPath = normalizeRelativePath(rule.path || '');
      } catch (error) {
        return refuse(`"${rule.path}" is not a folder path. ${error.message}`);
      }

      if (!normalizedPath) return refuse('a rule needs the path of a folder.');

      // Validate permissions
      if (rule.permissions !== undefined && !ACCESS_PERMISSIONS.includes(rule.permissions)) {
        return refuse(
          `"${rule.permissions}" is not one of the permissions a rule gives: rw, ro or hidden.`
        );
      }
      const permissions = ACCESS_PERMISSIONS.includes(rule.permissions) ? rule.permissions : 'rw';

      if (rule.recursive !== undefined && typeof rule.recursive !== 'boolean') {
        return refuse(`"${rule.recursive}" does not say whether the rule covers what is inside.`);
      }

      if (rule.appliesToAdmins !== undefined && typeof rule.appliesToAdmins !== 'boolean') {
        return refuse(
          `"${rule.appliesToAdmins}" does not say whether the rule holds administrators too.`
        );
      }

      return {
        id: rule.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        path: normalizedPath,
        recursive: Boolean(rule.recursive),
        permissions,
        // Stored as a plain yes or no, so the page shows a definite box and
        // nothing has to guess again. What a rule written before this switch
        // existed means is decided in one place, utils/accessRules.
        appliesToAdmins: ruleAppliesToAdmins({ ...rule, permissions }),
      };
    })
    .filter(Boolean);
};

/**
 * The access section: the rules, and whether every one of them also holds
 * administrators. The setting is the blunt one — on, no rule lets an
 * administrator through; off, each rule says for itself.
 */
const sanitizeAccess = (access = {}, { strict = false } = {}) => {
  const source = access && typeof access === 'object' && !Array.isArray(access) ? access : {};
  if (source.applyToAdmins !== undefined && typeof source.applyToAdmins !== 'boolean' && strict) {
    throw new ValidationError(
      'Whether the rules hold administrators too has to be sent as true or false.'
    );
  }
  return {
    rules: sanitizeAccessRules(source.rules || [], { strict }),
    applyToAdmins: source.applyToAdmins === true,
  };
};

/**
 * Sanitize branding settings
 */
const sanitizeBranding = (branding = {}) => {
  // A name of nothing but spaces was stored as it came, and the header and the
  // sign-in page showed no name at all. One stored that way reads as the
  // default, so an installation that saved one needs nothing done.
  const appName = typeof branding.appName === 'string' ? branding.appName.trim().slice(0, 100) : '';
  return {
    appName: appName || 'Explorer',
    appLogoUrl:
      typeof branding.appLogoUrl === 'string'
        ? branding.appLogoUrl.trim().slice(0, 500)
        : '/logo.svg',
    showPoweredBy: typeof branding.showPoweredBy === 'boolean' ? branding.showPoweredBy : false,
  };
};

/**
 * Sanitize upload settings
 */
const sanitizeUploads = (uploads = {}) => {
  const defaults = defaultUploadSettings();
  const rawChunkSize =
    typeof uploads.chunkSizeBytes === 'string'
      ? parseByteSize(uploads.chunkSizeBytes)
      : uploads.chunkSizeBytes;

  const chunkedAutoFallback =
    typeof uploads.chunkedAutoFallback === 'boolean'
      ? uploads.chunkedAutoFallback
      : defaults.chunkedAutoFallback;
  const chunkedEnabled = chunkedAutoFallback
    ? false // mutually exclusive with auto-fallback (auto wins)
    : typeof uploads.chunkedEnabled === 'boolean'
      ? uploads.chunkedEnabled
      : defaults.chunkedEnabled;

  return {
    chunkedEnabled,
    chunkedAutoFallback,
    chunkSizeBytes: Number.isFinite(rawChunkSize)
      ? clampNumber(
          Math.floor(rawChunkSize),
          MIN_UPLOAD_CHUNK_SIZE_BYTES,
          MAX_UPLOAD_CHUNK_SIZE_BYTES
        )
      : defaults.chunkSizeBytes,
  };
};

/**
 * The trash settings in force: on or off, how many days an item is kept, and
 * how much of a volume the trash may hold — a share of it, capped by a size
 * when one is set. An explicit `maxBytes: null` removes the cap; a field left
 * out keeps the default the environment gave.
 */
const sanitizeTrash = (trash = {}) => {
  const { trash: defaults } = require('../config/index');
  const source = trash && typeof trash === 'object' ? trash : {};
  const integerIn = (value, min, max, fallback) =>
    Number.isFinite(value) ? clampNumber(Math.round(value), min, max) : fallback;
  const rawMaxBytes =
    typeof source.maxBytes === 'string' ? parseByteSize(source.maxBytes) : source.maxBytes;

  let maxBytes = defaults.maxBytes;
  if (source.maxBytes === null) maxBytes = null;
  else if (Number.isFinite(rawMaxBytes) && rawMaxBytes > 0) maxBytes = Math.floor(rawMaxBytes);

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    retentionDays: integerIn(source.retentionDays, 1, 3650, defaults.retentionDays),
    maxPercent: integerIn(source.maxPercent, 1, 90, defaults.maxPercent),
    maxBytes,
  };
};

/**
 * The activity log settings in force: on or off, and how long a line is kept.
 *
 * Off is the default and stays the default: a log nobody asked for is a record
 * of somebody's day that nobody reads.
 */
const sanitizeActivity = (activity = {}) => {
  const { activity: defaults } = require('../config/index');
  const source = activity && typeof activity === 'object' ? activity : {};
  const retentionDays = Number(source.retentionDays);
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    retentionDays: Number.isFinite(retentionDays)
      ? clampNumber(Math.round(retentionDays), 1, 3650)
      : defaults.retentionDays,
  };
};

/**
 * The file version settings in force: on or off, how long everything is kept
 * before thinning starts, how long one an hour and one a day are kept, how many
 * versions a file keeps at most, and how often an editing session leaves a
 * checkpoint. The space they may take is the trash's: one budget per volume.
 *
 * The tiers are kept in order — a week of hourly versions cannot end before the
 * day of keeping everything does.
 */
const sanitizeVersions = (versions = {}) => {
  const { versions: defaults, VERSION_BOUNDS } = require('../config/index');
  const source = versions && typeof versions === 'object' ? versions : {};
  const integer = (key) => {
    const [min, max] = VERSION_BOUNDS[key];
    return Number.isFinite(source[key])
      ? clampNumber(Math.round(source[key]), min, max)
      : defaults[key];
  };
  const keepAllHours = integer('keepAllHours');
  const hourlyDays = Math.max(integer('hourlyDays'), Math.ceil(keepAllHours / 24));
  const dailyDays = Math.max(integer('dailyDays'), hourlyDays);
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    keepAllHours,
    hourlyDays,
    dailyDays,
    maxPerFile: integer('maxPerFile'),
    sessionCheckpointMinutes: integer('sessionCheckpointMinutes'),
  };
};

/**
 * How many tabs a row may hold.
 *
 * A row of tabs that never scrolls has to stop somewhere: past a certain number
 * they are too narrow to read, and a strip that scrolls hides the very tabs
 * somebody opened. Four numbers is all anybody has asked for — nobody browses
 * twenty folders at once and can still tell them apart — so the choice is a
 * handful rather than a free number, and anything else falls back to the default
 * rather than being refused.
 */
const TAB_LIMIT_CHOICES = [5, 10, 15, 20];
const DEFAULT_TAB_LIMIT = 10;

const sanitizeTabs = (tabs = {}) => {
  const source = tabs && typeof tabs === 'object' ? tabs : {};
  const asked = Number(source.maxOpen);
  return {
    maxOpen: TAB_LIMIT_CHOICES.includes(asked) ? asked : DEFAULT_TAB_LIMIT,
  };
};

/**
 * Get public settings (branding only, no auth required)
 */
const getPublicSettings = async () => {
  const db = await getDb();
  const brandingRow = db
    .prepare('SELECT value FROM system_settings WHERE category = ? AND key = ?')
    .get('branding', 'branding');

  let branding = {};
  if (brandingRow) {
    try {
      branding = JSON.parse(brandingRow.value);
    } catch {
      // An unreadable value is the default branding, not a failure to sign in.
    }
  }
  return { branding: sanitizeBranding(branding) };
};

/**
 * Get user-specific settings
 */
const getUserSettings = async (userId) => {
  if (!userId) return {};

  try {
    const db = await getDb();
    const rows = prepared(db, 'SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);

    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch (_) {
        // Skip invalid JSON
      }
    }

    // Per-folder preferences are rows of their own now, but the client still
    // receives them among the user's settings.
    Object.assign(settings, await getUserFolderPreferences(userId));

    return settings;
  } catch (_) {
    return {};
  }
};

// Through `prepared` rather than db.prepare: these run on every preference
// change, and recompiling the same three statements each time is waste the
// rest of this file already avoids.
const upsertUserSetting = (db, userId, key, value) => {
  const now = new Date().toISOString();
  const valueJson = JSON.stringify(value);
  const existing = prepared(db, 'SELECT id FROM user_settings WHERE user_id = ? AND key = ?').get(
    userId,
    key
  );

  if (existing) {
    prepared(
      db,
      'UPDATE user_settings SET value = ?, updated_at = ? WHERE user_id = ? AND key = ?'
    ).run(valueJson, now, userId, key);
  } else {
    prepared(
      db,
      'INSERT INTO user_settings (id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(generateId(), userId, key, valueJson, now);
  }
};

/**
 * Get system settings (admin only)
 */
/**
 * System settings, read from app.db and nowhere else.
 *
 * They used to fall back to app-config.json whenever the read failed. That file
 * stopped following the settings long ago — the screens save to app.db alone —
 * so a read that failed ran with whatever the file last held, often no access
 * rules at all: a folder hidden by a rule opened for everyone for as long as the
 * database could not be read. A read that fails now fails the request.
 */
const getSystemSettings = async () => {
  const db = await getDb();
  const rows = db
    .prepare('SELECT key, value FROM system_settings WHERE category = ?')
    .all('system');

  const thumbnails = { enabled: true, size: 200, quality: 70, concurrency: 10 };
  const access = { rules: [] };
  let uploads = defaultUploadSettings();
  const folderSize = { excludedPaths: [] };
  const searchIndex = { excludedPaths: [] };
  const trash = {};
  const versions = {};
  const activity = {};
  const ffmpeg = {};
  const tabs = {};

  for (const row of rows) {
    try {
      if (row.key === 'thumbnails') {
        Object.assign(thumbnails, JSON.parse(row.value));
      } else if (row.key === 'access') {
        Object.assign(access, JSON.parse(row.value));
      } else if (row.key === 'uploads') {
        uploads = { ...uploads, ...JSON.parse(row.value) };
      } else if (row.key === 'folderSize') {
        Object.assign(folderSize, JSON.parse(row.value));
      } else if (row.key === 'searchIndex') {
        Object.assign(searchIndex, JSON.parse(row.value));
      } else if (row.key === 'trash') {
        Object.assign(trash, JSON.parse(row.value));
      } else if (row.key === 'versions') {
        Object.assign(versions, JSON.parse(row.value));
      } else if (row.key === 'activity') {
        Object.assign(activity, JSON.parse(row.value));
      } else if (row.key === 'ffmpeg') {
        Object.assign(ffmpeg, JSON.parse(row.value));
      } else if (row.key === 'tabs') {
        Object.assign(tabs, JSON.parse(row.value));
      }
    } catch (_) {
      // Skip invalid JSON
    }
  }

  return {
    thumbnails: sanitizeThumbnails(thumbnails),
    access: sanitizeAccess(access),
    uploads: sanitizeUploads(uploads),
    trash: sanitizeTrash(trash),
    versions: sanitizeVersions(versions),
    activity: sanitizeActivity(activity),
    ffmpeg: sanitizeFfmpeg(ffmpeg),
    tabs: sanitizeTabs(tabs),
    folderSize: {
      ...sanitizeFolderSize(folderSize),
      environmentExcludedPaths: folderSizeExclusions.snapshot().environmentExcludedPaths,
    },
    searchIndex: {
      ...sanitizeSearchIndex(searchIndex),
      environmentExcludedPaths: searchIndexExclusions.snapshot().environmentExcludedPaths,
    },
  };
};

/**
 * Get settings for a user based on their role
 * - Public: branding only
 * - Regular user: branding + user settings
 * - Admin: branding + user settings + system settings
 */
const getSettingsForUser = async (user) => {
  const publicSettings = await getPublicSettings();
  const result = {
    branding: publicSettings.branding,
  };

  if (user && user.id) {
    const userSettings = await getUserSettings(user.id);
    result.user = userSettings;
    const systemSettings = await getSystemSettings();
    result.uploads = systemSettings.uploads;

    const isAdmin = Array.isArray(user.roles) && user.roles.includes('admin');
    if (isAdmin) {
      result.thumbnails = systemSettings.thumbnails;
      result.access = systemSettings.access;
      result.folderSize = systemSettings.folderSize;
      result.searchIndex = systemSettings.searchIndex;
      result.trash = systemSettings.trash;
      result.versions = systemSettings.versions;
      result.activity = systemSettings.activity;
      result.ffmpeg = systemSettings.ffmpeg;
    }
  }

  return result;
};

/**
 * Anything that is not a boolean is not an answer, and answers undefined, so
 * the stored value stays.
 *
 * It used to be `Boolean(value)`, which has an opinion about everything:
 * `'false'` — what a form field, a query string or a shell client sends — was
 * true, and `0` was false. Either way the switch was set to something nobody
 * had chosen, and the answer said it had been saved.
 */
const asBoolean = (value) => (typeof value === 'boolean' ? value : undefined);

// null means "no answer of my own": for skipHome, defer to the environment.
const asNullableBoolean = (value) => {
  if (value === null || value === undefined) return null;
  return typeof value === 'boolean' ? value : undefined;
};

/**
 * A default share expiry: null for none, or a whole number of at least one
 * with its unit.
 *
 * Anything else is not an expiry, and answers undefined, so the stored one
 * stays. It used to answer null, which is a value here: a default of minus
 * three weeks, or of three years, silently removed the default the person had.
 */
const asShareExpiration = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return undefined;
  const validUnits = ['days', 'weeks', 'months'];
  const amount = Number.isFinite(value.value) ? Math.floor(value.value) : 0;
  if (amount < 1 || !validUnits.includes(value.unit)) return undefined;
  return { value: amount, unit: value.unit };
};

/**
 * The view a folder gets when it has none of its own (#360).
 *
 * null is a value here, and means "use the built-in default". A mode we do not
 * have is not: it used to become null too, so one unknown word put every
 * folder back to the built-in view instead of being refused.
 */
const asViewMode = (value) => {
  if (value === null || value === undefined) return null;
  return VIEW_MODES.includes(value) ? value : undefined;
};

/**
 * A language tag, or null to follow the browser.
 *
 * Checked for its shape and not against a list of the languages that exist:
 * the translations are the interface's, and a second list here would be a
 * second truth to keep — one locale added there and forgotten here would be
 * refused for no reason anybody could see. A tag naming a translation nobody
 * ships is stored and then falls back to the browser, which is what a reader
 * whose language is gone should get anyway.
 *
 * Anything that is not a tag at all is refused rather than turned into null,
 * as a view mode is: a typo would otherwise read as "follow the browser" and
 * the choice would put itself back where it was.
 */
/**
 * How a selection of several things leaves (#487).
 *
 * `zip` gathers everything into one archive, which is what every version until
 * now did. `separate` takes the loose files one by one, as the browser's own
 * multi-file download, and keeps the archive for the folders — a folder taken
 * apart is a folder lost.
 *
 * An unknown word is refused rather than turned into the default, as a view
 * mode is: a typo would otherwise put the choice back where it was, quietly.
 */
const DOWNLOAD_MODES = ['zip', 'separate'];
const asDownloadMode = (value) => (DOWNLOAD_MODES.includes(value) ? value : undefined);

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const asLocale = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const tag = value.trim();
  return LANGUAGE_TAG.test(tag) ? tag : undefined;
};

/**
 * Every preference a user may set, each with the coercion that belongs to it.
 *
 * One line per preference, in one place, because this used to be spread over
 * three: a list of allowed keys in the settings route, a chain of if/else
 * sanitising here, and the defaults in the client store. A key present in one
 * and missing from another was accepted by the API, silently dropped, and
 * answered with its previous value — which the client then applied, so the
 * switch flicked itself back off. `markdownOpensInEditor` did exactly that.
 *
 * Adding a preference is now adding a line here. Its name and its validation
 * cannot come apart, because they are the same line.
 */
const USER_SETTINGS = {
  showHiddenFiles: asBoolean,
  showThumbnails: asBoolean,
  showSidebarFavorites: asBoolean,
  showSidebarShares: asBoolean,
  showSidebarTools: asBoolean,
  markdownOpensInEditor: asBoolean,
  documentsOpenInNewTab: asBoolean,
  showVersionMarks: asBoolean,
  defaultShareExpiration: asShareExpiration,
  skipHome: asNullableBoolean,
  defaultView: asViewMode,
  locale: asLocale,
  downloadMode: asDownloadMode,
  browseInTabs: asBoolean,
  closeTabsOnDoubleClick: asBoolean,
  reopenTabs: asBoolean,
  preloadBackgroundTabs: asBoolean,
};

/**
 * Written by the application, never straight from a request: a folder
 * preference is saved one folder at a time, so that two tabs on different
 * folders do not overwrite each other with whole maps.
 */
const INTERNAL_USER_SETTINGS = {
  folderSorts: sanitizeFolderSorts,
  folderViews: sanitizeFolderViews,
};

/** What PATCH /api/settings accepts under `user`. */
const WRITABLE_USER_SETTINGS = new Set(Object.keys(USER_SETTINGS));

/**
 * Set a user setting
 */
const setUserSetting = async (userId, key, value) => {
  if (!userId) {
    throw new Error('User ID is required');
  }
  const db = await getDb();

  // An unknown key is stored as it came: callers are the application itself,
  // and the route only ever passes what WRITABLE_USER_SETTINGS allows.
  const sanitize = USER_SETTINGS[key] || INTERNAL_USER_SETTINGS[key];
  const sanitizedValue = sanitize ? sanitize(value) : value;

  // What a preference cannot take is left out rather than stored as its
  // default, as a section field of the wrong shape is: the stored value stays.
  if (sanitizedValue === undefined) return undefined;

  upsertUserSetting(db, userId, key, sanitizedValue);

  return sanitizedValue;
};

/**
 * Remember one folder's preference, and return the whole map back.
 *
 * Written one folder at a time rather than by sending the map: two tabs open
 * on different folders would otherwise overwrite each other with whichever
 * copy was saved last. The stored map is re-read here so the entry joins what
 * is already there.
 */
/** Every folder preference this user has, as the client expects them. */
const getUserFolderPreferences = async (userId) => {
  if (!userId) return { folderSorts: {}, folderViews: {} };

  const db = await getDb();
  const rows = prepared(
    db,
    'SELECT path, sort_by, sort_order, view_mode, updated_at FROM folder_preferences WHERE user_id = ?'
  ).all(userId);

  const folderSorts = {};
  const folderViews = {};
  for (const row of rows) {
    const updatedAt = Date.parse(row.updated_at) || 0;
    if (row.sort_by) {
      folderSorts[row.path] = {
        by: row.sort_by,
        order: row.sort_order === 'desc' ? 'desc' : 'asc',
        updatedAt,
      };
    }
    if (row.view_mode) {
      folderViews[row.path] = { mode: row.view_mode, updatedAt };
    }
  }

  return { folderSorts, folderViews };
};

/**
 * Remember one folder's sort or view.
 *
 * One row per folder, so a change touches only that folder: two tabs on
 * different folders no longer overwrite each other, and there is no ceiling on
 * how many folders can be remembered. The row carries both preferences, so
 * setting one must not erase the other.
 */
const setUserFolderPreference = async (userId, folderPath, { sort, view }) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const normalizedPath = normalizeRelativePath(folderPath);
  const sanitizedSort = sort === undefined ? undefined : sanitizeFolderSort(sort);
  const sanitizedView = view === undefined ? undefined : sanitizeFolderView(view);

  if (!isValidFolderPath(normalizedPath) || (!sanitizedSort && !sanitizedView)) {
    return null;
  }

  const db = await getDb();
  const now = new Date().toISOString();

  prepared(
    db,
    `INSERT INTO folder_preferences (user_id, path, sort_by, sort_order, view_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, path) DO UPDATE SET
       sort_by    = COALESCE(excluded.sort_by, folder_preferences.sort_by),
       sort_order = COALESCE(excluded.sort_order, folder_preferences.sort_order),
       view_mode  = COALESCE(excluded.view_mode, folder_preferences.view_mode),
       updated_at = excluded.updated_at`
  ).run(
    userId,
    normalizedPath,
    sanitizedSort?.by ?? null,
    sanitizedSort?.order ?? null,
    sanitizedView?.mode ?? null,
    now
  );

  return getUserFolderPreferences(userId);
};

const setUserFolderSort = async (userId, folderPath, sort) => {
  const preferences = await setUserFolderPreference(userId, folderPath, { sort });
  return preferences?.folderSorts ?? null;
};

const setUserFolderView = async (userId, folderPath, view) => {
  const preferences = await setUserFolderPreference(userId, folderPath, { view });
  return preferences?.folderViews ?? null;
};

const assertSystemCategory = (category) => {
  if (category !== 'branding' && category !== 'system') {
    throw new Error('Invalid category. Must be "branding" or "system"');
  }
};

/**
 * What a section is held to before it is stored, by key.
 *
 * The same shaping a read applies, so a section merged over the row itself
 * comes out as it would have come out of the settings: a field nobody sent
 * takes the sanitiser's default, which is the one a read would have given it.
 */
const sanitizeSystemSetting = (key, value) => {
  if (key === 'thumbnails') return sanitizeThumbnails(value);
  // Strict: what is being stored was just written by somebody, and a rule that
  // cannot be stored as they wrote it is answered rather than dropped.
  if (key === 'access') return sanitizeAccess(value, { strict: true });
  if (key === 'uploads') return sanitizeUploads(value);
  if (key === 'branding') return sanitizeBranding(value);
  if (key === 'folderSize') return sanitizeFolderSize(value);
  // The search index had no case here, so what was stored for it was the
  // merge as it came: paths with spaces around them, empty entries, the same
  // folder twice. The worker was handed a sanitised copy and behaved, so only
  // the stored value was wrong — and it is the one the next merge starts from.
  if (key === 'searchIndex') return sanitizeSearchIndex(value);
  if (key === 'trash') return sanitizeTrash(value);
  if (key === 'activity') return sanitizeActivity(value);
  if (key === 'tabs') return sanitizeTabs(value);
  if (key === 'versions') return sanitizeVersions(value);
  if (key === 'ffmpeg') return sanitizeFfmpeg(value);
  return value;
};

/**
 * What a section would be stored as, without storing it.
 *
 * The route checks every section of a save before writing any of them, so a
 * section that refuses what it was sent refuses before another has been
 * stored.
 */
const checkSystemSection = (key, value) => sanitizeSystemSetting(key, value);

/**
 * Set a system setting (admin only)
 */
const setSystemSetting = async (category, key, value) => {
  assertSystemCategory(category);

  const db = await getDb();
  const sanitizedValue = sanitizeSystemSetting(key, value);

  writeSystemSetting(db, category, key, sanitizedValue);

  return sanitizedValue;
};

/** One section as it is stored, before any default is put around it. */
const readStoredSection = (db, category, key) => {
  const row = db
    .prepare('SELECT value FROM system_settings WHERE category = ? AND key = ?')
    .get(category, key);
  if (!row) return {};

  try {
    const stored = JSON.parse(row.value);
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    // An unreadable value is the section's defaults, exactly as a read treats it.
    return {};
  }
};

/**
 * Merge an update over one stored section and write it back, and answer the
 * whole section as it now stands.
 *
 * Read and written without yielding in between — the database answers
 * synchronously — so two saves of one section at once cannot both start from
 * the same stored value. The route used to merge over the settings read at the
 * start of the request, with two awaits between that read and the write: a
 * retention of ninety days saved in one tab disappeared when the other tab
 * saved a size cap a moment later, and the person who set it was told it was
 * saved. Branding was taken out of this path for the same reason, where losing
 * a save also left a logo file behind with nothing to serve or remove it.
 */
const mergeSystemSection = async (category, key, update) => {
  assertSystemCategory(category);

  const db = await getDb();
  const merged = sanitizeSystemSetting(key, {
    ...readStoredSection(db, category, key),
    ...update,
  });
  writeSystemSetting(db, category, key, merged);
  return merged;
};

/** Store one system setting as it is, in a single synchronous step. */
const writeSystemSetting = (db, category, key, value, now = new Date().toISOString()) => {
  const valueJson = JSON.stringify(value);

  // Check if setting exists
  const existing = db
    .prepare('SELECT id FROM system_settings WHERE category = ? AND key = ?')
    .get(category, key);

  if (existing) {
    prepared(
      db,
      'UPDATE system_settings SET value = ?, updated_at = ? WHERE category = ? AND key = ?'
    ).run(valueJson, now, category, key);
  } else {
    prepared(
      db,
      'INSERT INTO system_settings (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(generateId(), category, key, valueJson, now);
  }
};

/**
 * Change the branding, and answer what it was and what it is now.
 *
 * Read and written without yielding in between — the database answers
 * synchronously — so two saves at once cannot both start from the same
 * branding: the logo a save replaced is the one it was the last to see, and
 * removing it cannot take away the logo another save has just put in place.
 *
 * @returns {Promise<{previous: object, current: object}>}
 */
const replaceBranding = async (update) => {
  const db = await getDb();
  const row = db
    .prepare('SELECT value FROM system_settings WHERE category = ? AND key = ?')
    .get('branding', 'branding');

  let stored = {};
  if (row) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      // An unreadable value is the default branding.
    }
  }

  const previous = sanitizeBranding(stored);
  const current = sanitizeBranding({ ...previous, ...update });
  writeSystemSetting(db, 'branding', 'branding', current);
  return { previous, current };
};

/**
 * Legacy method: Get all settings (for backward compatibility)
 * Returns system settings + branding
 */
/**
 * Settings, read once per request.
 *
 * The access rules are consulted for every path, so a bulk operation asked for
 * these thousands of times over — each one several queries and a JSON parse,
 * to re-read values that cannot change while a single request is running. The
 * promise is memoized, not the value, so concurrent callers share one read.
 */
const getSettings = async () =>
  cachedForRequest('settings', 'all', async () => {
    const systemSettings = await getSystemSettings();
    const publicSettings = await getPublicSettings();

    return {
      ...systemSettings,
      branding: publicSettings.branding,
    };
  });

/**
 * Legacy method: Set settings (for backward compatibility)
 * Updates system settings and branding
 */
const setSettings = async (partial) => {
  const current = await getSettings();

  // Deep merge
  const merged = {
    thumbnails: { ...current.thumbnails, ...(partial.thumbnails || {}) },
    // Each half of the section stands on its own: saving the rules alone must
    // not quietly switch off whether they hold administrators, and vice versa.
    access: {
      rules: partial.access?.rules !== undefined ? partial.access.rules : current.access.rules,
      applyToAdmins:
        partial.access?.applyToAdmins !== undefined
          ? partial.access.applyToAdmins
          : current.access.applyToAdmins,
    },
    uploads: { ...current.uploads, ...(partial.uploads || {}) },
    trash: { ...current.trash, ...(partial.trash || {}) },
    versions: { ...current.versions, ...(partial.versions || {}) },
    activity: { ...current.activity, ...(partial.activity || {}) },
    ffmpeg: { ...current.ffmpeg, ...(partial.ffmpeg || {}) },
    folderSize: {
      excludedPaths:
        partial.folderSize?.excludedPaths !== undefined
          ? partial.folderSize.excludedPaths
          : current.folderSize.excludedPaths,
    },
    branding: { ...current.branding, ...(partial.branding || {}) },
  };

  // Save to DB
  if (partial.thumbnails) {
    merged.thumbnails = await setSystemSetting('system', 'thumbnails', merged.thumbnails);
  }
  if (partial.access) {
    merged.access = await setSystemSetting('system', 'access', merged.access);
  }
  if (partial.folderSize) {
    merged.folderSize = await setSystemSetting('system', 'folderSize', merged.folderSize);
  }
  if (partial.branding) {
    merged.branding = await setSystemSetting('branding', 'branding', merged.branding);
  }
  if (partial.uploads) {
    merged.uploads = await setSystemSetting('system', 'uploads', merged.uploads);
  }
  if (partial.trash) {
    merged.trash = await setSystemSetting('system', 'trash', merged.trash);
  }
  if (partial.versions) {
    merged.versions = await setSystemSetting('system', 'versions', merged.versions);
  }
  if (partial.activity) {
    merged.activity = await setSystemSetting('system', 'activity', merged.activity);
  }
  if (partial.ffmpeg) {
    merged.ffmpeg = await setSystemSetting('system', 'ffmpeg', merged.ffmpeg);
  }

  return merged;
};

module.exports = {
  checkSystemSection,
  getPublicSettings,
  getUserSettings,
  getSystemSettings,
  sanitizeTrash,
  sanitizeVersions,
  sanitizeActivity,
  sanitizeFfmpeg,
  sanitizeTabs,
  TAB_LIMIT_CHOICES,
  DEFAULT_TAB_LIMIT,
  getSettingsForUser,
  setUserSetting,
  WRITABLE_USER_SETTINGS,
  setUserFolderSort,
  setUserFolderView,
  setSystemSetting,
  mergeSystemSection,
  replaceBranding,
  MAX_UPLOAD_CHUNK_SIZE_BYTES,
  // Legacy methods for backward compatibility
  getSettings,
  setSettings,
};
