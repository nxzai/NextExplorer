const crypto = require('crypto');

const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch (_) {
    return null;
  }
};

const uniqueOrigins = (origins) => [...new Set(origins.map(normalizeOrigin).filter(Boolean))];

/**
 * Only relative, same-site paths may be stored in the OIDC transaction state.
 * This protects the post-login redirect from becoming an open redirect.
 */
const sanitizeReturnTo = (candidate, fallback = '/browse/') => {
  if (typeof candidate !== 'string') return fallback;
  const value = candidate.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
};

const isTrustedProxyRequest = (req) => {
  const trustProxy = req.app?.get?.('trust proxy fn');
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress;

  return Boolean(
    typeof trustProxy === 'function' && remoteAddress && trustProxy(remoteAddress, 0) === true
  );
};

const readForwardedHost = (req) => {
  if (!isTrustedProxyRequest(req)) return null;

  const forwarded = req.headers?.['x-forwarded-host'];
  if (typeof forwarded !== 'string') return null;
  return forwarded.split(',')[0]?.trim() || null;
};

/**
 * Resolve the browser-facing origin, but only when it exactly matches an
 * operator-configured public or internal origin. A forwarded host is useful
 * behind a trusted proxy; the allow-list prevents it from becoming a redirect
 * target controlled by a request header.
 */
const getConfiguredRequestOrigin = (req, allowedOrigins) => {
  const host = readForwardedHost(req) || req.get?.('host') || req.headers?.host;
  if (!host) return null;

  try {
    const origin = new URL(`${req.protocol || 'http'}://${host}`).origin;
    return allowedOrigins.includes(origin) ? origin : null;
  } catch (_) {
    return null;
  }
};

const absoluteReturnTo = (origin, candidate) =>
  new URL(sanitizeReturnTo(candidate, '/auth/login'), origin).toString();

const callbackUrlForOrigin = (origin) => new URL('/callback', origin).toString();

const oidcCookieNamesForOrigin = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    throw new Error('Cannot create OIDC cookie names for an invalid origin.');
  }

  // Cookies are scoped by host and path, not port. Separate names prevent a
  // session or transaction from one configured origin being used by another.
  const suffix = crypto.createHash('sha256').update(normalizedOrigin).digest('hex').slice(0, 16);
  return {
    session: `appSession.${suffix}`,
    transaction: `auth_verification.${suffix}`,
  };
};

const sanitizeOidcPrompt = (candidate) => {
  const allowedPrompts = new Set(['login', 'select_account']);
  return typeof candidate === 'string' && allowedPrompts.has(candidate) ? candidate : null;
};

/**
 * Mark a request as a hand-off to the identity provider, and read the mark.
 *
 * express-openid-connect reports a failure to start one to the `next` it
 * captured when it built the request context, not to the route's own — so
 * neither the route nor a try/catch around `login()` ever sees it. The mark is
 * what lets the error handling tell "the provider did not answer" from any
 * other error on any other route.
 */
const markProviderSignIn = (req) => {
  if (req) req.nextExplorerOidcSignIn = true;
};

const isProviderSignIn = (req) => Boolean(req && req.nextExplorerOidcSignIn);

module.exports = {
  markProviderSignIn,
  isProviderSignIn,
  uniqueOrigins,
  sanitizeReturnTo,
  getConfiguredRequestOrigin,
  absoluteReturnTo,
  callbackUrlForOrigin,
  oidcCookieNamesForOrigin,
  sanitizeOidcPrompt,
};
