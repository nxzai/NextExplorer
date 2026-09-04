const path = require('path');
const crypto = require('crypto');
const env = require('./env');
const constants = require('./constants');
const loggingConfig = require('./logging');
const { parseByteSize } = require('../utils/env');

const parseCommaOrSpaceList = (raw) => {
  if (!raw) return [];
  const parts = String(raw).includes(',') ? String(raw).split(',') : String(raw).split(/\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
};

const DEFAULT_HIDDEN_FILE_PATTERNS = ['.'];

const parseRegexPattern = (token) => {
  if (token.startsWith('regex:')) {
    return { source: token.slice('regex:'.length), flags: '' };
  }

  if (token.startsWith('/')) {
    const lastSlash = token.lastIndexOf('/');
    if (lastSlash > 0) {
      return {
        source: token.slice(1, lastSlash),
        flags: token.slice(lastSlash + 1),
      };
    }
  }

  return null;
};

const escapeRipgrepGlob = (value) => String(value).replace(/[\\*?\[\]{}]/g, '\\$&');

const parseHiddenFilePatterns = (raw) => {
  const tokens = raw == null ? DEFAULT_HIDDEN_FILE_PATTERNS : parseCommaOrSpaceList(raw);
  const prefixes = [];
  const regexes = [];

  for (const token of tokens) {
    const regexPattern = parseRegexPattern(token);
    if (!regexPattern) {
      prefixes.push(token);
      continue;
    }

    try {
      regexes.push(new RegExp(regexPattern.source, regexPattern.flags));
    } catch (err) {
      console.warn(`[Config] Invalid hidden file regex "${token}": ${err.message}`);
    }
  }

  const isHiddenName = (name) => {
    if (!name) return false;
    const baseName = String(name);
    if (prefixes.some((prefix) => prefix && baseName.startsWith(prefix))) return true;

    return regexes.some((regex) => {
      regex.lastIndex = 0;
      return regex.test(baseName);
    });
  };

  const isHiddenPath = (value) =>
    String(value || '')
      .split(/[\\/]+/)
      .filter(Boolean)
      .some(isHiddenName);

  return {
    patterns: tokens,
    prefixes,
    regexes,
    isHiddenName,
    isHiddenPath,
    ripgrepGlobExcludes: prefixes
      .filter((prefix) => prefix && !/[\\/]/.test(prefix))
      .map((prefix) => `!${escapeRipgrepGlob(prefix)}*`),
  };
};

const parseExtensionList = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => (s.startsWith('.') ? s.slice(1) : s))
    .filter(Boolean);

// Helper: Parse comma/space-separated scopes
const parseScopes = (raw) => {
  const list = parseCommaOrSpaceList(raw);
  return list.length ? list : null;
};

// Native app redirect URIs for the mobile OIDC bridge. Case preserving (schemes
// are case sensitive) and restricted to custom scheme URIs so the bridge can
// never be pointed at an http(s) open redirect. Falls back to a shared default.
const DEFAULT_MOBILE_REDIRECT_URIS = ['nextexplorer://oidc-callback'];
const parseMobileRedirectUris = (raw) => {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((uri) => /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !/^https?:\/\//i.test(uri));
  return list.length ? list : DEFAULT_MOBILE_REDIRECT_URIS;
};

// --- Personal folder naming ---
const DEFAULT_USER_FOLDER_NAME_ORDER = ['id', 'username', 'email_local'];
const VALID_USER_FOLDER_NAME_TOKENS = new Set([
  'id',
  'username',
  'email',
  'email_local',
  'displayname',
]);

const parseUserFolderNameOrder = (raw) => {
  const requested = parseCommaOrSpaceList(raw).map((token) => token.toLowerCase());
  const order = [];

  for (const token of requested) {
    if (!VALID_USER_FOLDER_NAME_TOKENS.has(token)) continue;
    if (!order.includes(token)) order.push(token);
  }

  return order.length ? order : DEFAULT_USER_FOLDER_NAME_ORDER;
};

// --- Paths ---
const volumeDir = path.resolve(env.VOLUME_ROOT);
const configDir = path.resolve(env.CONFIG_DIR);
const cacheDir = path.resolve(env.CACHE_DIR);
const userRootDir = env.USER_ROOT ? path.resolve(env.USER_ROOT) : path.join(volumeDir, '_users');

const directories = {
  volume: volumeDir,
  volumeWithSep: volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`,
  config: configDir,
  cache: cacheDir,
  thumbnails: path.join(cacheDir, 'thumbnails'),
  extensions: path.join(configDir, 'extensions'),
  userRoot: userRootDir,
  userRootWithSep: userRootDir.endsWith(path.sep) ? userRootDir : `${userRootDir}${path.sep}`,
};

// --- Public URL ---
let publicUrl = null;
let publicOrigin = null;
if (env.PUBLIC_URL) {
  try {
    const url = new URL(env.PUBLIC_URL);
    publicUrl = url.href.replace(/\/$/, '');
    publicOrigin = url.origin;
  } catch (err) {
    console.warn(`[Config] Invalid PUBLIC_URL: ${env.PUBLIC_URL}`);
  }
}

// --- Additional (internal) origins ---
// Extra origins the app can be reached from (e.g. a LAN IP), comma-separated.
// They are considered valid so accessing the app that way doesn't raise the
// public-URL mismatch warning, and they're accepted by CORS. PUBLIC_URL remains
// the canonical URL used to build absolute links (shares, OIDC callbacks, WOPI).
const parseOriginList = (value) =>
  (typeof value === 'string' ? value.split(',') : [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch (err) {
        console.warn(`[Config] Invalid INTERNAL_URL entry: ${entry}`);
        return null;
      }
    })
    .filter(Boolean);

const internalOrigins = parseOriginList(env.INTERNAL_URL);
// All origins the frontend should treat as valid (publicOrigin first, deduped).
const knownOrigins = [...new Set([publicOrigin, ...internalOrigins].filter(Boolean))];

// --- CORS ---
const buildCorsConfig = () => {
  if (env.CORS_ORIGINS) {
    if (env.CORS_ORIGINS === '*') return { allowAll: true, origins: [] };
    return {
      allowAll: false,
      origins: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    };
  }
  if (knownOrigins.length) return { allowAll: false, origins: [...knownOrigins] };
  return { allowAll: true, origins: [] }; // Backwards compatibility
};

const corsConfig = buildCorsConfig();
const corsOptions = {
  origin: (origin, callback) => {
    if (corsConfig.allowAll || !origin || corsConfig.origins.includes(origin)) {
      callback(null, true);
    } else {
      // Important: do not throw here.
      // - Same-origin requests may still send an Origin header; if PUBLIC_URL is misconfigured,
      //   throwing breaks the whole app for users who access the instance via a different URL.
      // - Returning `false` disables CORS headers for this request (browser will block cross-origin),
      //   while still allowing non-CORS/same-origin clients to function.
      callback(null, false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

// --- HTTP server timeouts ---
const requestTimeoutMs = (() => {
  const value = env.HTTP_TIMEOUT;
  return Number.isFinite(value) && value >= 0 ? value : 0;
})();

// --- Auth ---
// Determine auth mode: 'local', 'oidc', 'both', or 'disabled'
// If AUTH_MODE is not set, fall back to legacy behavior based on OIDC_ENABLED
const determineAuthMode = () => {
  if (env.AUTH_MODE) {
    const validModes = ['local', 'oidc', 'both', 'disabled'];
    if (!validModes.includes(env.AUTH_MODE)) {
      console.warn(`[Config] Invalid AUTH_MODE="${env.AUTH_MODE}". Using "both" as default.`);
      return 'both';
    }
    return env.AUTH_MODE;
  }
  return 'both';
};

const authMode = determineAuthMode();

const auth = {
  enabled: authMode === 'disabled' ? false : env.AUTH_ENABLED !== false,
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionMaxAgeMs: env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // Convert days to milliseconds
  mode: authMode,
  oidc: {
    enabled: env.OIDC_ENABLED ?? null,
    issuer: env.OIDC_ISSUER,
    authorizationURL: env.OIDC_AUTHORIZATION_URL,
    tokenURL: env.OIDC_TOKEN_URL,
    userInfoURL: env.OIDC_USERINFO_URL,
    logoutURL: env.OIDC_LOGOUT_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    callbackUrl: env.OIDC_CALLBACK_URL || (publicUrl ? `${publicUrl}/callback` : null),
    scopes: parseScopes(env.OIDC_SCOPES) || null,
    adminGroups: parseScopes(env.OIDC_ADMIN_GROUPS) || null,
    requireEmailVerified: env.OIDC_REQUIRE_EMAIL_VERIFIED,
    autoCreateUsers: env.OIDC_AUTO_CREATE_USERS,
    mobileRedirectUris: parseMobileRedirectUris(env.OIDC_MOBILE_REDIRECT_URIS),
  },
};

// --- Search ---
const searchMaxFileSizeBytes = (() => {
  const parsed = parseByteSize(env.SEARCH_MAX_FILESIZE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

// --- OnlyOffice ---
const onlyoffice = {
  serverUrl: env.ONLYOFFICE_URL?.replace(/\/$/, '') || null,
  secret: env.ONLYOFFICE_SECRET || env.SESSION_SECRET || auth.sessionSecret,
  lang: env.ONLYOFFICE_LANG,
  forceSave: env.ONLYOFFICE_FORCE_SAVE,
  extensions: env.ONLYOFFICE_FILE_EXTENSIONS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

// --- Collabora (WOPI) ---
const collaboraBaseUrl = env.COLLABORA_URL?.replace(/\/$/, '') || null;
const collaboraDiscoveryUrl =
  env.COLLABORA_DISCOVERY_URL?.replace(/\/$/, '') ||
  (collaboraBaseUrl ? `${collaboraBaseUrl}/hosting/discovery` : null);

const collabora = {
  url: collaboraBaseUrl,
  discoveryUrl: collaboraDiscoveryUrl,
  secret: env.COLLABORA_SECRET || null,
  lang: env.COLLABORA_LANG,
  extensions: env.COLLABORA_FILE_EXTENSIONS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

// --- Editor ---
const editorMaxFileSizeBytes = (() => {
  const parsed = parseByteSize(env.EDITOR_MAX_FILESIZE);
  // Default: 2 MiB if not configured or invalid
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2 * 1024 * 1024;
})();

const editor = {
  extensions: parseExtensionList(env.EDITOR_EXTENSIONS),
  maxFileSizeBytes: editorMaxFileSizeBytes,
};

// --- Terminal ---
const terminal = {
  extensions: parseExtensionList(env.TERMINAL_FILE_EXTENSIONS),
};

// --- Favorites ---
const favorites = {
  defaultIcon: env.FAVORITES_DEFAULT_ICON,
};

// --- Personal folders ---
const personal = {
  userFolderNameOrder: parseUserFolderNameOrder(env.USER_FOLDER_NAME_ORDER),
};

// --- Hidden file patterns ---
const hiddenFiles = parseHiddenFilePatterns(env.HIDDEN_FILE_PATTERNS);

// --- Shares ---
const shares = {
  enabled: env.SHARES_ENABLED,
  tokenLength: env.SHARES_TOKEN_LENGTH,
  maxSharesPerUser: env.SHARES_MAX_PER_USER,
  defaultExpiryDays: env.SHARES_DEFAULT_EXPIRY_DAYS,
  guestSessionHours: env.SHARES_GUEST_SESSION_HOURS,
  allowPasswordProtection: env.SHARES_ALLOW_PASSWORD,
  allowAnonymous: env.SHARES_ALLOW_ANONYMOUS,
};

// --- Main Export ---
module.exports = {
  port: env.PORT,
  address: env.ADDRESS,
  http: {
    requestTimeoutMs,
  },
  directories,

  files: {
    passwordConfig: path.join(configDir, 'app-config.json'),
  },

  public: { url: publicUrl, origin: publicOrigin, origins: knownOrigins },

  extensions: {
    images: constants.IMAGE_EXTENSIONS,
    rawImages: constants.RAW_IMAGE_EXTENSIONS,
    videos: constants.VIDEO_EXTENSIONS,
    audios: constants.AUDIO_EXTENSIONS,
    documents: constants.DOCUMENT_EXTENSIONS,
    previewable: constants.PREVIEWABLE_EXTENSIONS,
  },

  excludedFiles: constants.EXCLUDED_FILES,
  mimeTypes: constants.MIME_TYPES,
  corsOptions,

  auth,

  search: {
    deep: env.SEARCH_DEEP ?? true,
    ripgrep: env.SEARCH_RIPGREP ?? true,
    maxFileSize: env.SEARCH_MAX_FILESIZE,
    maxFileSizeBytes: searchMaxFileSizeBytes,
  },

  thumbnails: { size: 200, quality: 70 },
  onlyoffice,
  collabora,
  editor,
  terminal,
  favorites,
  shares,
  hiddenFiles,

  features: {
    volumeUsage: env.SHOW_VOLUME_USAGE,
    personalFolders: env.USER_DIR_ENABLED,
    userVolumes: env.USER_VOLUMES,
    shares: env.SHARES_ENABLED,
    skipHome: env.SKIP_HOME,
    terminal: env.TERMINAL_ENABLED,
  },

  logging: {
    level: loggingConfig.level,
    isDebug: loggingConfig.isDebug,
    enableHttpLogging: loggingConfig.enableHttpLogging,
  },

  personal,
};
