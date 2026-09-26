const multer = require('multer');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { sanitizeLogUrl } = require('../utils/logSanitizer');
const { directories } = require('../config/index');

/**
 * Strip server-side absolute paths out of a message shown to a client.
 *
 * Errors bubbling up from fs, spawned tools or archive libraries often quote
 * the full path they failed on. Callers only ever address files by relative
 * path, so the host layout is of no use to them — and it tells an anonymous
 * share visitor how the server is organized. The full message is still logged.
 */
const REDACTED_ROOTS = [
  directories?.volume,
  directories?.userRoot,
  directories?.config,
  directories?.cache,
]
  .filter((value) => typeof value === 'string' && value.length > 1)
  // Longest first, so nested roots are replaced by the most specific one.
  .sort((a, b) => b.length - a.length);

const sanitizeClientMessage = (message) => {
  if (typeof message !== 'string' || !message) return message;
  return REDACTED_ROOTS.reduce((text, root) => text.split(root).join('…'), message).replace(
    // Any remaining absolute path (a temporary directory, say) keeps only its name.
    /(^|[\s'"(])\/(?:[\w.@ -]+\/)+([\w.@ -]+)/g,
    '$1…/$2'
  );
};

/**
 * What an upload that met one of multer's limits is told.
 *
 * These are refusals of what the client sent, not failures of the server: a
 * file over the size ceiling, more files than one request may carry. Without
 * this they reached the client as a 500.
 */
const MULTIPART_REFUSALS = {
  LIMIT_FILE_SIZE: [413, 'The file is larger than this server accepts.'],
  LIMIT_FILE_COUNT: [413, 'The request carries more files than this server accepts at once.'],
  LIMIT_PART_COUNT: [413, 'The request carries more parts than this server accepts at once.'],
  LIMIT_FIELD_COUNT: [400, 'The request carries more form fields than this server reads.'],
  LIMIT_FIELD_KEY: [400, 'A form field name is longer than this server reads.'],
  LIMIT_FIELD_VALUE: [400, 'A form field is longer than this server reads.'],
  LIMIT_UNEXPECTED_FILE: [400, 'A file was sent in a field this request does not take.'],
};

const multipartRefusal = (err) =>
  err instanceof multer.MulterError ? MULTIPART_REFUSALS[err.code] || [400, err.message] : null;

/**
 * A write the storage itself refused: the mount is read-only, or the folder
 * belongs to somebody the server does not run as.
 *
 * Both surfaced as a 500 carrying the system's own words — `EROFS: read-only
 * file system, mkdir`, `EACCES: permission denied, mkdir` — for what is
 * neither a fault of the server nor something a retry would change, and with
 * an absolute path from inside the container in the message. The listing now
 * says beforehand that such a folder cannot be written in; this is the answer
 * for whatever still tries.
 */
const STORAGE_REFUSALS = {
  EROFS: 'This storage is read-only: nothing can be written here.',
  EACCES: 'The server is not allowed to write in this folder.',
  EPERM: 'The server is not allowed to write in this folder.',
};

const storageRefusal = (err) => {
  const sentence = STORAGE_REFUSALS[err?.code];
  return sentence ? [403, sentence] : null;
};

/**
 * The addresses a browser is sent to, rather than fetches, on the way through
 * an identity provider: where a sign-in starts, and where it comes back.
 *
 * A failure at either is a page the person is looking at, so it has to land
 * back on the sign-in screen. `/login` is the provider's own route, mounted
 * only when there is a provider to mount; `/api/auth/oidc/login` answers
 * whether or not there is, which is how the screen learns which of the two
 * happened.
 */
const OIDC_DOCUMENT_PATHS = new Set(['/callback', '/login', '/api/auth/oidc/login']);

const isOidcDocumentRequest = (req) => {
  const path = req?.path || '';
  if (!OIDC_DOCUMENT_PATHS.has(path)) return false;
  const accept = typeof req.headers?.accept === 'string' ? req.headers.accept : '';
  const secFetchDest =
    typeof req.headers?.['sec-fetch-dest'] === 'string' ? req.headers['sec-fetch-dest'] : '';
  const secFetchMode =
    typeof req.headers?.['sec-fetch-mode'] === 'string' ? req.headers['sec-fetch-mode'] : '';
  return accept.includes('text/html') || secFetchDest === 'document' || secFetchMode === 'navigate';
};

const clearOidcSessionCookies = (req, res) => {
  const cookieNames = new Set([req.nextExplorerOidcSessionCookieName, 'appSession']);
  for (const cookieName of cookieNames) {
    if (!cookieName) continue;
    try {
      if (cookieName in req) req[cookieName] = undefined;
      const cookieOptions = { path: '/', sameSite: 'Lax', httpOnly: true };
      res.clearCookie(cookieName, { ...cookieOptions, secure: true });
      res.clearCookie(cookieName, { ...cookieOptions, secure: false });
    } catch (_) {
      /* ignore */
    }
  }
};

/**
 * Centralized error handling middleware
 * Must be registered AFTER all routes in app.js
 *
 * Handles both operational errors (AppError instances) and unexpected errors
 */
// Express only recognizes error middleware when it has 4 args: (err, req, res, next)
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // Generate unique request ID for tracking
  const requestId = uuidv4();

  // Determine if this is an operational error (expected) or programmer error (unexpected)
  const refusal = multipartRefusal(err) || storageRefusal(err);
  const isOperational = Boolean(refusal) || err.isOperational || false;
  const statusCode = refusal ? refusal[0] : err.statusCode || err.status || 500;
  const message = refusal ? refusal[1] : err.message || 'An unexpected error occurred';

  // For OIDC callback navigations, redirect back into the SPA so the login screen can show the error.
  // Otherwise, the browser will render the JSON payload as a standalone error page.
  if (!res.headersSent && isOidcDocumentRequest(req)) {
    clearOidcSessionCookies(req, res);
    // Same redaction as the JSON body: this one lands in the address bar, browser
    // history and every proxy log along the way, so a raw server path here travels
    // further than it would in a response body.
    const query = new URLSearchParams({ error: sanitizeClientMessage(message) });
    // The code travels beside the sentence, never instead of it. The screen says
    // what the codes it knows mean in the reader's own language — which is how "the
    // provider could not be reached" stops reading as "OIDC is not configured" —
    // and falls back to the sentence for the ones it does not.
    if (err.code) query.set('error_code', String(err.code));
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, `/auth/login?${query.toString()}`);
    return;
  }

  // Build error context for logging
  const errorContext = {
    requestId,
    method: req.method,
    // The address as the log may keep it: a token in the query string is not.
    url: sanitizeLogUrl(req.originalUrl),
    statusCode,
    isOperational,
    err,
  };

  // Add user info if available
  if (req.oidc?.user?.email) {
    errorContext.user = req.oidc.user.email;
  } else if (req.session?.user?.username) {
    errorContext.user = req.session.user.username;
  }

  // Log based on severity
  if (statusCode >= 500) {
    // Server errors - always log as error
    logger.error(errorContext, `Server error: ${message}`);
  } else if (statusCode >= 400) {
    // Client errors - log as warning
    logger.warn(errorContext, `Client error: ${message}`);
  } else {
    // Other status codes
    logger.info(errorContext, `Request error: ${message}`);
  }

  // Build response object
  const errorResponse = {
    success: false,
    error: {
      message: sanitizeClientMessage(message),
      statusCode: statusCode,
      requestId: requestId,
      timestamp: new Date().toISOString(),
    },
  };

  // Add additional error details for operational errors
  if (isOperational && err.toJSON) {
    const errorJson = err.toJSON();
    // Merge any additional properties (like details, retryAfter, etc.)
    Object.keys(errorJson).forEach((key) => {
      if (key !== 'message' && key !== 'statusCode' && key !== 'timestamp') {
        errorResponse.error[key] = errorJson[key];
      }
    });
  }

  // In development, include stack trace for debugging
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
    errorResponse.error.stack = err.stack;
  }

  // Send response
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 handler for unmatched routes
 * Should be registered BEFORE the error handler but AFTER all valid routes
 */
const notFoundHandler = (req, res, next) => {
  const NotFoundError = require('../errors/AppError').NotFoundError;
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};

module.exports = {
  errorHandler,
  notFoundHandler,
  // Used by the routes that stream their progress: an NDJSON stream has already
  // answered 200 by the time something fails, so it says why in a line of its
  // own rather than through the error handler — and says it the same way.
  sanitizeClientMessage,
};
