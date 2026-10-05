const { normalizeBoolean, readSecret } = require('../utils/env');

/**
 * Single source of truth for ALL environment variables.
 * Easy to see what env vars the app uses and their defaults.
 */
module.exports = {
  // Server
  ADDRESS: process.env.ADDRESS || '0.0.0.0',
  PORT: Number(process.env.PORT) || 3000,
  // Node.js HTTP server request timeout (ms). Set to 0 to disable.
  // Node defaults to 300000ms (5 minutes) on modern versions, which can abort large uploads.
  HTTP_TIMEOUT: process.env.HTTP_TIMEOUT != null ? Number(process.env.HTTP_TIMEOUT) : 0,
  UPLOAD_INACTIVITY_TIMEOUT:
    process.env.UPLOAD_INACTIVITY_TIMEOUT != null
      ? Number(process.env.UPLOAD_INACTIVITY_TIMEOUT)
      : 120000,
  // rsync preserves permissions when copying, which means a chmod on the
  // destination. Where that is always refused — a ZFS dataset with
  // aclmode=restricted, where new files must inherit the directory's ACL — set
  // this to false and skip straight to a copy that does not try, rather than
  // paying for the failed attempt and its retry on every single copy.
  COPY_PRESERVE_PERMISSIONS: normalizeBoolean(process.env.COPY_PRESERVE_PERMISSIONS) ?? true,
  UPLOAD_CHUNKED_ENABLED: normalizeBoolean(process.env.UPLOAD_CHUNKED_ENABLED) ?? false,
  // When direct (XHR) upload is used, automatically fall back to chunked uploads
  // if a request fails because a reverse proxy rejects the body size.
  UPLOAD_CHUNKED_AUTO_FALLBACK: normalizeBoolean(process.env.UPLOAD_CHUNKED_AUTO_FALLBACK) ?? false,
  UPLOAD_CHUNK_SIZE: process.env.UPLOAD_CHUNK_SIZE?.trim() || null,
  // Upper bound (MiB) an admin may set for the chunk size; caps the settings
  // slider/input and clamps saved values. Hard ceiling of 512 MiB still applies.
  MAX_CHUNK_SIZE_MIB: process.env.MAX_CHUNK_SIZE_MIB?.trim() || null,
  UPLOAD_STORAGE_RESERVE: process.env.UPLOAD_STORAGE_RESERVE?.trim() || '64M',
  TUS_UPLOAD_DIR: process.env.TUS_UPLOAD_DIR?.trim() || null,
  TUS_INCOMPLETE_UPLOAD_TTL_MS:
    process.env.TUS_INCOMPLETE_UPLOAD_TTL_MS != null
      ? Number(process.env.TUS_INCOMPLETE_UPLOAD_TTL_MS)
      : 60 * 60 * 1000,
  TUS_CLEANUP_INTERVAL_MS:
    process.env.TUS_CLEANUP_INTERVAL_MS != null
      ? Number(process.env.TUS_CLEANUP_INTERVAL_MS)
      : 10 * 60 * 1000,

  // Paths
  VOLUME_ROOT: process.env.VOLUME_ROOT || '/mnt',
  CONFIG_DIR: process.env.CONFIG_DIR || '/config',
  CACHE_DIR: process.env.CACHE_DIR || '/cache',
  USER_ROOT: process.env.USER_ROOT || '',
  USER_FOLDER_NAME_ORDER: process.env.USER_FOLDER_NAME_ORDER?.trim() || null,
  HIDDEN_FILE_PATTERNS: process.env.HIDDEN_FILE_PATTERNS,

  // Public URL & Network
  PUBLIC_URL: process.env.PUBLIC_URL?.trim() || null,
  // Additional origin(s) the app can legitimately be reached from (e.g. a LAN IP
  // used for fast local uploads). Comma-separated. These are treated as valid
  // (no public-URL mismatch warning) and accepted by CORS, while PUBLIC_URL stays
  // the canonical URL used to build share links, OIDC callbacks, etc.
  INTERNAL_URL: process.env.INTERNAL_URL?.trim() || null,
  TRUST_PROXY: process.env.TRUST_PROXY?.trim().toLowerCase(),

  // CORS
  CORS_ORIGINS:
    process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL?.trim().toLowerCase() || null,
  DEBUG: normalizeBoolean(process.env.DEBUG),
  ENABLE_HTTP_LOGGING: normalizeBoolean(process.env.ENABLE_HTTP_LOGGING) || false,
  // Lightweight process/cgroup diagnostics, off by default. When enabled the
  // sampler logs only anomalous intervals unless explicitly told otherwise.
  PERFORMANCE_DIAGNOSTICS_ENABLED:
    normalizeBoolean(process.env.PERFORMANCE_DIAGNOSTICS_ENABLED) ?? false,
  PERFORMANCE_DIAGNOSTICS_INTERVAL_MS:
    process.env.PERFORMANCE_DIAGNOSTICS_INTERVAL_MS != null
      ? Number(process.env.PERFORMANCE_DIAGNOSTICS_INTERVAL_MS)
      : 15000,
  PERFORMANCE_DIAGNOSTICS_LOG_EVERY_INTERVAL:
    normalizeBoolean(process.env.PERFORMANCE_DIAGNOSTICS_LOG_EVERY_INTERVAL) ?? false,
  PERFORMANCE_DIAGNOSTICS_CPU_THRESHOLD:
    process.env.PERFORMANCE_DIAGNOSTICS_CPU_THRESHOLD != null
      ? Number(process.env.PERFORMANCE_DIAGNOSTICS_CPU_THRESHOLD)
      : 75,
  PERFORMANCE_DIAGNOSTICS_RSS_THRESHOLD_MB:
    process.env.PERFORMANCE_DIAGNOSTICS_RSS_THRESHOLD_MB != null
      ? Number(process.env.PERFORMANCE_DIAGNOSTICS_RSS_THRESHOLD_MB)
      : 768,
  PERFORMANCE_DIAGNOSTICS_EVENT_LOOP_DELAY_MS:
    process.env.PERFORMANCE_DIAGNOSTICS_EVENT_LOOP_DELAY_MS != null
      ? Number(process.env.PERFORMANCE_DIAGNOSTICS_EVENT_LOOP_DELAY_MS)
      : 250,

  // Auth
  AUTH_ENABLED: normalizeBoolean(process.env.AUTH_ENABLED),
  AUTH_MODE: process.env.AUTH_MODE?.trim().toLowerCase() || null,
  SESSION_SECRET: readSecret('SESSION_SECRET', 'AUTH_SESSION_SECRET'),
  SESSION_MAX_AGE_DAYS: Number(process.env.SESSION_MAX_AGE_DAYS) || 30,
  AUTH_MAX_FAILED: Number(process.env.AUTH_MAX_FAILED) || 5,
  AUTH_LOCK_MINUTES: Number(process.env.AUTH_LOCK_MINUTES) || 15,
  AUTH_ADMIN_EMAIL: process.env.AUTH_ADMIN_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || null,
  AUTH_ADMIN_PASSWORD: readSecret('AUTH_ADMIN_PASSWORD', 'ADMIN_PASSWORD'),

  // Demo mode. Also read by the entrypoint, which seeds the sample files; the
  // two agree on what counts as true. Anything unrecognised normalises to null
  // and is treated as off, so the default here is closed.
  DEMO_MODE: normalizeBoolean(process.env.DEMO_MODE) ?? false,
  // Credentials pre-filled on the sign-in form, for a public demo where the
  // login is published anyway and asking visitors to retype it is friction for
  // nothing. Serving a password is never acceptable outside that case, so it
  // takes both DEMO_MODE and these two variables — deliberately separate from
  // the admin ones above, so no flag can ever publish a real password by
  // reaching for credentials that were set for another purpose.
  DEMO_LOGIN_EMAIL: process.env.DEMO_LOGIN_EMAIL?.trim() || null,
  // Not trimmed — a password is whatever it is.
  DEMO_LOGIN_PASSWORD: process.env.DEMO_LOGIN_PASSWORD || null,

  // OIDC
  OIDC_ENABLED: normalizeBoolean(process.env.OIDC_ENABLED),
  OIDC_ISSUER: process.env.OIDC_ISSUER || process.env.OIDC_ISSUER_URL || null,
  OIDC_AUTHORIZATION_URL: process.env.OIDC_AUTHORIZATION_URL || null,
  OIDC_TOKEN_URL: process.env.OIDC_TOKEN_URL || null,
  OIDC_USERINFO_URL: process.env.OIDC_USERINFO_URL || null,
  OIDC_LOGOUT_URL: process.env.OIDC_LOGOUT_URL || null,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || null,
  OIDC_CLIENT_SECRET: readSecret('OIDC_CLIENT_SECRET'),
  OIDC_CALLBACK_URL: process.env.OIDC_CALLBACK_URL || process.env.OIDC_REDIRECT_URI || null,
  // Allowlisted native app redirect URIs for the mobile OIDC bridge (iOS/Android).
  OIDC_MOBILE_REDIRECT_URIS: process.env.OIDC_MOBILE_REDIRECT_URIS || null,
  OIDC_SCOPES: process.env.OIDC_SCOPES || process.env.OIDC_SCOPE || null,
  OIDC_ADMIN_GROUPS: process.env.OIDC_ADMIN_GROUPS || process.env.OIDC_ADMIN_GROUP || null,
  OIDC_REQUIRE_EMAIL_VERIFIED: normalizeBoolean(process.env.OIDC_REQUIRE_EMAIL_VERIFIED) || false,
  // When false, OIDC login is only allowed for users that already exist in the DB (local or OIDC-linked).
  OIDC_AUTO_CREATE_USERS: normalizeBoolean(process.env.OIDC_AUTO_CREATE_USERS) ?? true,

  // Search
  SEARCH_DEEP: normalizeBoolean(process.env.SEARCH_DEEP),
  SEARCH_RIPGREP: normalizeBoolean(process.env.SEARCH_RIPGREP),
  SEARCH_MAX_FILESIZE: process.env.SEARCH_MAX_FILESIZE?.trim() || null,
  SEARCH_TIMEOUT_MS: Number(process.env.SEARCH_TIMEOUT_MS) || null,
  SEARCH_INDEX: normalizeBoolean(process.env.SEARCH_INDEX) ?? false,
  // Whether the environment decided, as against falling to the default. When
  // it did, the switch in Settings shows the variable and cannot be moved;
  // when it did not, Settings decides. A value that is not a boolean decided
  // nothing, the same way a blank one does.
  SEARCH_INDEX_SET: normalizeBoolean(process.env.SEARCH_INDEX) !== null,
  SEARCH_INDEX_BATCH: Number(process.env.SEARCH_INDEX_BATCH) || null,
  SEARCH_INDEX_CPU_PERCENT: Number(process.env.SEARCH_INDEX_CPU_PERCENT) || null,
  SEARCH_INDEX_MEMORY_MB: Number(process.env.SEARCH_INDEX_MEMORY_MB) || null,
  SEARCH_INDEX_EXCLUDE: process.env.SEARCH_INDEX_EXCLUDE?.trim() || null,
  PREVIEW_MAX_RENDER_SIZE: process.env.PREVIEW_MAX_RENDER_SIZE?.trim() || null,
  SEARCH_INDEX_REBUILD: normalizeBoolean(process.env.SEARCH_INDEX_REBUILD) ?? false,
  SEARCH_INDEX_RECONCILE_MS: Number(process.env.SEARCH_INDEX_RECONCILE_MS) || null,

  // OnlyOffice
  ONLYOFFICE_URL: process.env.ONLYOFFICE_URL?.trim() || null,
  ONLYOFFICE_SECRET: readSecret('ONLYOFFICE_SECRET'),
  ONLYOFFICE_DOWNLOAD_ORIGINS: process.env.ONLYOFFICE_DOWNLOAD_ORIGINS || '',
  ONLYOFFICE_LANG: process.env.ONLYOFFICE_LANG?.trim() || 'en',
  ONLYOFFICE_FORCE_SAVE: normalizeBoolean(process.env.ONLYOFFICE_FORCE_SAVE) || false,
  ONLYOFFICE_FORCE_SAVE_TIMEOUT_MS: Number(process.env.ONLYOFFICE_FORCE_SAVE_TIMEOUT_MS) || 10000,
  // 0 disables proactive writes to the external storage. A bounded interval
  // keeps Document Server's internal autosave from becoming a full document
  // conversion on every edit.
  ONLYOFFICE_AUTO_SAVE_INTERVAL_MS: (() => {
    const value = Number(process.env.ONLYOFFICE_AUTO_SAVE_INTERVAL_MS);
    return Number.isFinite(value) && value >= 0 ? value : 30000;
  })(),
  ONLYOFFICE_FILE_EXTENSIONS: process.env.ONLYOFFICE_FILE_EXTENSIONS || '',

  // Collabora (WOPI)
  COLLABORA_URL: process.env.COLLABORA_URL?.trim() || null,
  COLLABORA_DISCOVERY_URL: process.env.COLLABORA_DISCOVERY_URL?.trim() || null,
  COLLABORA_SECRET: readSecret('COLLABORA_SECRET'),
  COLLABORA_LANG: process.env.COLLABORA_LANG?.trim() || 'en',
  COLLABORA_FILE_EXTENSIONS: process.env.COLLABORA_FILE_EXTENSIONS || '',

  // Features
  SHOW_VOLUME_USAGE: normalizeBoolean(process.env.SHOW_VOLUME_USAGE) || false,

  // Trash: a deletion is a rename into a reserved space at the root of each
  // volume. These are the defaults; an administrator changes them in Settings.
  TRASH_ENABLED: normalizeBoolean(process.env.TRASH_ENABLED) ?? true,
  TRASH_RETENTION_DAYS: process.env.TRASH_RETENTION_DAYS?.trim() || '30',
  TRASH_MAX_PERCENT: process.env.TRASH_MAX_PERCENT?.trim() || '10',
  TRASH_MAX_SIZE: process.env.TRASH_MAX_SIZE?.trim() || null,

  // File versions: the content a save replaces is kept in the same reserved
  // space as the trash, within the same budget. Defaults again; an
  // administrator changes them in Settings.
  VERSIONS_ENABLED: normalizeBoolean(process.env.VERSIONS_ENABLED) ?? true,
  VERSIONS_KEEP_ALL_HOURS: process.env.VERSIONS_KEEP_ALL_HOURS?.trim() || '24',
  VERSIONS_HOURLY_DAYS: process.env.VERSIONS_HOURLY_DAYS?.trim() || '7',
  VERSIONS_DAILY_DAYS: process.env.VERSIONS_DAILY_DAYS?.trim() || '30',
  VERSIONS_MAX_PER_FILE: process.env.VERSIONS_MAX_PER_FILE?.trim() || '50',
  VERSIONS_SESSION_CHECKPOINT_MINUTES:
    process.env.VERSIONS_SESSION_CHECKPOINT_MINUTES?.trim() || '10',

  // Passkeys. The name a passkey is bound to is the domain it was made on, so
  // an installation reached through more than one hostname pins it here rather
  // than letting each name hold its own passkeys. Empty means "the name this
  // request arrived on", which is what a single-hostname installation wants.
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID?.trim() || null,
  WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME?.trim() || null,

  // Activity log: off unless somebody asks for it. It is a record of who did
  // what, which is worth having when several people share an installation and
  // is only weight when nobody is going to read it.
  ACTIVITY_ENABLED: normalizeBoolean(process.env.ACTIVITY_ENABLED) ?? false,
  ACTIVITY_RETENTION_DAYS: process.env.ACTIVITY_RETENTION_DAYS?.trim() || '90',

  // Folder size index
  // Mode: 'off' (default, feature disabled), 'shallow' (size of a folder's
  // direct entries only) or 'full' (recursive size of the whole subtree).
  FOLDER_SIZE_MODE: process.env.FOLDER_SIZE_MODE?.trim().toLowerCase() || 'off',
  // As SEARCH_INDEX_SET: only one of the three modes counts as a decision.
  FOLDER_SIZE_MODE_SET: ['off', 'shallow', 'full'].includes(
    process.env.FOLDER_SIZE_MODE?.trim().toLowerCase()
  ),
  // Comma or newline separated paths, relative to VOLUME_ROOT, that must never
  // be traversed by the folder-size indexer.
  FOLDER_SIZE_EXCLUDE_PATHS: process.env.FOLDER_SIZE_EXCLUDE_PATHS || '',
  // Concurrency of the baseline walk on local vs network-detected mounts.
  FOLDER_SIZE_CONCURRENCY: Number(process.env.FOLDER_SIZE_CONCURRENCY) || 6,
  FOLDER_SIZE_NETWORK_CONCURRENCY: Number(process.env.FOLDER_SIZE_NETWORK_CONCURRENCY) || 2,
  // How often (ms) accumulated dirty directories (on-view refresh, hooks,
  // optional watcher) are flushed to the index in one transaction.
  FOLDER_SIZE_FLUSH_MS: Number(process.env.FOLDER_SIZE_FLUSH_MS) || 3000,
  // mtime-based reconciliation cadence. When 0 (default) the interval is
  // adaptive: it accelerates to *MIN when a pass finds external changes and
  // backs off (doubling) up to *MAX when idle. Set a non-zero value to force a
  // fixed interval instead.
  FOLDER_SIZE_RECONCILE_MS: Number(process.env.FOLDER_SIZE_RECONCILE_MS) || 0,
  FOLDER_SIZE_RECONCILE_MIN_MS: Number(process.env.FOLDER_SIZE_RECONCILE_MIN_MS) || 900000,
  FOLDER_SIZE_RECONCILE_MAX_MS: Number(process.env.FOLDER_SIZE_RECONCILE_MAX_MS) || 43200000,
  // Reconciliation is paced so it never spikes CPU/IO on huge volumes: it stat()s
  // folders in pages of *_BATCH and sleeps *_PAUSE_MS between pages, scanning as a
  // gentle background trickle instead of one burst.
  FOLDER_SIZE_RECONCILE_BATCH: Number(process.env.FOLDER_SIZE_RECONCILE_BATCH) || 100,
  FOLDER_SIZE_RECONCILE_PAUSE_MS:
    process.env.FOLDER_SIZE_RECONCILE_PAUSE_MS !== undefined
      ? Number(process.env.FOLDER_SIZE_RECONCILE_PAUSE_MS)
      : 200,
  // Hard upper bound for one scheduled reconciliation slice. Zero keeps the
  // historical full-volume sweep behavior; the default keeps idle work small.
  FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES:
    process.env.FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES !== undefined
      ? Number(process.env.FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES)
      : 200,
  // Targeted scans repair one incomplete subtree detected after an external
  // change. They are serialized to keep ancestor deltas deterministic; file
  // stats are processed in small batches and optionally paced. When batch/pause
  // are unset they inherit the reconciliation settings.
  FOLDER_SIZE_SUBTREE_BATCH:
    process.env.FOLDER_SIZE_SUBTREE_BATCH !== undefined
      ? Number(process.env.FOLDER_SIZE_SUBTREE_BATCH)
      : null,
  FOLDER_SIZE_SUBTREE_PAUSE_MS:
    process.env.FOLDER_SIZE_SUBTREE_PAUSE_MS !== undefined
      ? Number(process.env.FOLDER_SIZE_SUBTREE_PAUSE_MS)
      : null,
  FOLDER_SIZE_SUBTREE_SLOW_LOG_MS:
    process.env.FOLDER_SIZE_SUBTREE_SLOW_LOG_MS !== undefined
      ? Number(process.env.FOLDER_SIZE_SUBTREE_SLOW_LOG_MS)
      : 5000,
  // A filesystem operation that never settles must not block every queued
  // targeted refresh forever. Zero disables the deadline for unusual filesystems
  // where operators explicitly prefer waiting indefinitely.
  FOLDER_SIZE_IO_TIMEOUT_MS:
    process.env.FOLDER_SIZE_IO_TIMEOUT_MS !== undefined
      ? Number(process.env.FOLDER_SIZE_IO_TIMEOUT_MS)
      : 30000,
  // Timed-out Node fs calls cannot be force-cancelled. Keep at most this many
  // unresolved calls before pausing further folder-size I/O to preserve libuv
  // worker capacity for the rest of the application.
  FOLDER_SIZE_MAX_STALLED_IO:
    process.env.FOLDER_SIZE_MAX_STALLED_IO !== undefined
      ? Number(process.env.FOLDER_SIZE_MAX_STALLED_IO)
      : 2,
  // Force a fresh baseline walk even if the volume is already indexed.
  FOLDER_SIZE_REBUILD: normalizeBoolean(process.env.FOLDER_SIZE_REBUILD) || false,
  USER_DIR_ENABLED: normalizeBoolean(process.env.USER_DIR_ENABLED) || false,
  USER_VOLUMES: normalizeBoolean(process.env.USER_VOLUMES) || false,
  SKIP_HOME: normalizeBoolean(process.env.SKIP_HOME) || false,
  TERMINAL_ENABLED: normalizeBoolean(process.env.TERMINAL_ENABLED) ?? true,
  TERMINAL_FILE_EXTENSIONS: process.env.TERMINAL_FILE_EXTENSIONS || 'sh',
  // Extensions this installation will also compare side by side, on top of the ones
  // that are always comparable. A list rather than a switch because what counts as
  // text is a local question: somebody's `.ino`, somebody else's `.tf`.
  COMPARE_FILE_EXTENSIONS: process.env.COMPARE_FILE_EXTENSIONS || '',

  // Uploads (direct, non-chunked)
  MAX_DIRECT_UPLOAD_SIZE: process.env.MAX_DIRECT_UPLOAD_SIZE?.trim() || null,
  MAX_JSON_BODY_SIZE: process.env.MAX_JSON_BODY_SIZE?.trim() || null,
  BULK_DELETE_CONCURRENCY: Number(process.env.BULK_DELETE_CONCURRENCY) || 0,
  MAX_FILES_PER_UPLOAD: Number(process.env.MAX_FILES_PER_UPLOAD) || 50,

  // Archives
  MAX_EXTRACTED_ARCHIVE_SIZE: process.env.MAX_EXTRACTED_ARCHIVE_SIZE?.trim() || null,
  MAX_ARCHIVE_ENTRIES: Number(process.env.MAX_ARCHIVE_ENTRIES) || 100000,
  MAX_BROWSABLE_ARCHIVE_SIZE: process.env.MAX_BROWSABLE_ARCHIVE_SIZE?.trim() || null,
  ARCHIVE_CACHE_MAX_SIZE: process.env.ARCHIVE_CACHE_MAX_SIZE?.trim() || null,

  // Editor
  EDITOR_EXTENSIONS: process.env.EDITOR_EXTENSIONS || '',
  EDITOR_MAX_FILESIZE: process.env.EDITOR_MAX_FILESIZE?.trim() || null,

  // Archive extraction (comma-separated; leading '+' extends the defaults
  // instead of replacing them)
  ARCHIVE_EXTENSIONS: process.env.ARCHIVE_EXTENSIONS || '',

  // FFmpeg
  FFMPEG_PATH: process.env.FFMPEG_PATH || null,
  FFPROBE_PATH: process.env.FFPROBE_PATH || null,
  FFMPEG_HWACCEL: process.env.FFMPEG_HWACCEL?.trim() || null,
  FFMPEG_HWACCEL_DEVICE: process.env.FFMPEG_HWACCEL_DEVICE?.trim() || null,
  FFMPEG_HWACCEL_OUTPUT_FORMAT: process.env.FFMPEG_HWACCEL_OUTPUT_FORMAT?.trim() || null,
  THUMBNAILS_ENABLED: normalizeBoolean(process.env.THUMBNAILS_ENABLED) ?? true,
  THUMBNAIL_CACHE_MAX_FILES:
    process.env.THUMBNAIL_CACHE_MAX_FILES != null
      ? Number(process.env.THUMBNAIL_CACHE_MAX_FILES)
      : 3000,
  THUMBNAIL_CACHE_CLEANUP_INTERVAL_MS:
    process.env.THUMBNAIL_CACHE_CLEANUP_INTERVAL_MS != null
      ? Number(process.env.THUMBNAIL_CACHE_CLEANUP_INTERVAL_MS)
      : 60 * 60 * 1000,
  THUMBNAIL_CACHE_CLEANUP_BATCH_SIZE:
    process.env.THUMBNAIL_CACHE_CLEANUP_BATCH_SIZE != null
      ? Number(process.env.THUMBNAIL_CACHE_CLEANUP_BATCH_SIZE)
      : 500,
  THUMBNAIL_CACHE_TTL_DAYS:
    process.env.THUMBNAIL_CACHE_TTL_DAYS != null
      ? Number(process.env.THUMBNAIL_CACHE_TTL_DAYS)
      : 30,
  // ExifTool from the machine rather than the one in the archive: 23 MB of
  // Perl somebody who already has it would rather not carry twice (#9).
  // Empty means the bundled copy, which is the default and needs nothing.
  EXIFTOOL_PATH: process.env.EXIFTOOL_PATH || '',
  // Embedded RAW previews are full-size JPEGs, far larger than a thumbnail, and
  // a new one is extracted whenever a RAW file changes.
  RAW_PREVIEW_CACHE_MAX_FILES:
    process.env.RAW_PREVIEW_CACHE_MAX_FILES != null
      ? Number(process.env.RAW_PREVIEW_CACHE_MAX_FILES)
      : 500,
  THUMBNAIL_SHARP_CACHE_MEMORY_MB:
    process.env.THUMBNAIL_SHARP_CACHE_MEMORY_MB != null
      ? Number(process.env.THUMBNAIL_SHARP_CACHE_MEMORY_MB)
      : 0,
  THUMBNAIL_VIDEO_CONCURRENCY:
    process.env.THUMBNAIL_VIDEO_CONCURRENCY != null
      ? Number(process.env.THUMBNAIL_VIDEO_CONCURRENCY)
      : 3,
  THUMBNAIL_VIDEO_SEEK_SECONDS:
    process.env.THUMBNAIL_VIDEO_SEEK_SECONDS != null
      ? Number(process.env.THUMBNAIL_VIDEO_SEEK_SECONDS)
      : 5,
  THUMBNAIL_VIDEO_SEEK_PERCENT:
    process.env.THUMBNAIL_VIDEO_SEEK_PERCENT != null &&
    process.env.THUMBNAIL_VIDEO_SEEK_PERCENT.trim() !== ''
      ? Number(process.env.THUMBNAIL_VIDEO_SEEK_PERCENT)
      : null,
  THUMBNAIL_VIDEO_THREADS:
    process.env.THUMBNAIL_VIDEO_THREADS != null ? Number(process.env.THUMBNAIL_VIDEO_THREADS) : 2,
  THUMBNAIL_VIDEO_SCALE_FLAGS: process.env.THUMBNAIL_VIDEO_SCALE_FLAGS?.trim() || 'fast_bilinear',
  THUMBNAIL_BACKGROUND_QUEUE_LIMIT:
    process.env.THUMBNAIL_BACKGROUND_QUEUE_LIMIT != null
      ? Number(process.env.THUMBNAIL_BACKGROUND_QUEUE_LIMIT)
      : 16,
  THUMBNAIL_DIAGNOSTICS_ENABLED:
    normalizeBoolean(process.env.THUMBNAIL_DIAGNOSTICS_ENABLED) ?? false,
  THUMBNAIL_DIAGNOSTICS_INTERVAL_MS:
    process.env.THUMBNAIL_DIAGNOSTICS_INTERVAL_MS != null
      ? Number(process.env.THUMBNAIL_DIAGNOSTICS_INTERVAL_MS)
      : 30000,
  THUMBNAIL_SLOW_JOB_MS:
    process.env.THUMBNAIL_SLOW_JOB_MS != null ? Number(process.env.THUMBNAIL_SLOW_JOB_MS) : 10000,
  // How long one ffmpeg may take over a single thumbnail before it is killed.
  // Not a deadline anything waits on — the queue has given up long before —
  // but the only thing that ends a process that has stopped making progress.
  THUMBNAIL_FFMPEG_TIMEOUT_MS:
    process.env.THUMBNAIL_FFMPEG_TIMEOUT_MS != null
      ? Number(process.env.THUMBNAIL_FFMPEG_TIMEOUT_MS)
      : 5 * 60 * 1000,
  // Niceness applied to child ffmpeg/convert processes (0 = disabled, 1-19 lowers
  // their CPU priority so the Node event loop stays responsive during generation).
  THUMBNAIL_PROCESS_NICE:
    process.env.THUMBNAIL_PROCESS_NICE != null ? Number(process.env.THUMBNAIL_PROCESS_NICE) : 10,

  // Favorites
  FAVORITES_DEFAULT_ICON: process.env.FAVORITES_DEFAULT_ICON || 'outline:StarIcon',

  // Shares
  SHARES_ENABLED: normalizeBoolean(process.env.SHARES_ENABLED) ?? true,
  SHARES_TOKEN_LENGTH: Number(process.env.SHARES_TOKEN_LENGTH) || 10,
  SHARES_MAX_PER_USER: Number(process.env.SHARES_MAX_PER_USER) || 100,
  SHARES_DEFAULT_EXPIRY_DAYS: Number(process.env.SHARES_DEFAULT_EXPIRY_DAYS) || 30,
  SHARES_GUEST_SESSION_HOURS: Number(process.env.SHARES_GUEST_SESSION_HOURS) || 24,
  SHARES_ALLOW_PASSWORD: normalizeBoolean(process.env.SHARES_ALLOW_PASSWORD) ?? true,
  SHARES_ALLOW_ANONYMOUS: normalizeBoolean(process.env.SHARES_ALLOW_ANONYMOUS) ?? true,
};
