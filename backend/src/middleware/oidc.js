const crypto = require('crypto');
const { auth: eocAuth } = require('express-openid-connect');

const { auth: envAuthConfig, public: publicConfig } = require('../config/index');
const {
  getOrCreateOidcUser,
  deriveRolesFromClaims,
  rolesFromClaimsAreAuthoritative,
} = require('../services/users');
const { fetchUserInfoClaims } = require('../services/oidcService');
const { oidcStore } = require('../utils/sessionStore');
const { readIdTokenClaims } = require('../utils/idToken');
const {
  recordOidcNotConfigured,
  recordOidcReady,
  recordOidcUnavailable,
} = require('../utils/oidcAvailability');
const { UnauthorizedError, ServiceUnavailableError } = require('../errors/AppError');
const { ErrorCodes } = require('../errors/errorCodes');
const {
  uniqueOrigins,
  sanitizeReturnTo,
  getConfiguredRequestOrigin,
  absoluteReturnTo,
  callbackUrlForOrigin,
  oidcCookieNamesForOrigin,
  sanitizeOidcPrompt,
  markProviderSignIn,
  isProviderSignIn,
} = require('../utils/oidcRedirect');
const logger = require('../utils/logger');

/**
 * Derives baseURL from callbackUrl or PUBLIC_URL
 */
const deriveBaseUrl = (oidc) => {
  try {
    if (oidc.callbackUrl && /^https?:\/\//i.test(oidc.callbackUrl)) {
      const u = new URL(oidc.callbackUrl);
      logger.debug({ baseURL: u.origin, source: 'callbackUrl' }, 'Derived baseURL');
      return u.origin;
    } else if (publicConfig?.url) {
      const u = new URL(publicConfig.url);
      logger.debug({ baseURL: u.origin, source: 'PUBLIC_URL' }, 'Derived baseURL');
      return u.origin;
    }
  } catch (_) {
    logger.debug('Failed to derive baseURL');
  }
  return null;
};

/**
 * Determines if OIDC cookies should be secure based on an origin.
 */
const shouldOidcCookieBeSecure = (baseURL) => {
  try {
    if (baseURL) {
      const u = new URL(baseURL);
      return u.protocol === 'https:';
    }
  } catch (_) {
    // Ignore URL parsing errors
  }
  return false;
};

/**
 * Validates and parses a URL string
 * @returns {URL|null} Parsed URL or null if invalid
 */
const parseUrl = (urlString) => {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch (_) {
    return null;
  }
};

/**
 * Creates a custom logout handler for IdP logout
 * @param {object} options - Configuration options
 * @param {string} options.logoutURL - The IdP logout URL
 * @param {Function} options.getReturnTo - Resolves the validated browser return URL
 * @returns {Function} Express route handler
 */
const clearOidcCookie = (res, name) => {
  const cookieOptions = { path: '/', sameSite: 'Lax', httpOnly: true };
  res.clearCookie(name, { ...cookieOptions, secure: true });
  res.clearCookie(name, { ...cookieOptions, secure: false });
};

const createLogoutHandler = ({ logoutURL, getReturnTo, getSessionCookieName }) => {
  // Pre-validate the logout URL at configuration time
  const parsedLogoutUrl = parseUrl(logoutURL);
  if (!parsedLogoutUrl) {
    logger.warn({ logoutURL }, 'Invalid OIDC_LOGOUT_URL, custom logout handler not configured');
    return null;
  }

  return async (req, res) => {
    const returnTo = getReturnTo(req);
    const idTokenHint = req.oidc?.idToken;
    const sessionCookieName = getSessionCookieName(req);

    try {
      // Clear local session (promisified for proper sequencing)
      if (req.session) {
        await new Promise((resolve) => {
          req.session.destroy((err) => {
            if (err) logger.debug({ err }, 'Session destroy error (non-fatal)');
            resolve();
          });
        });
      }

      // Clear the server-side EOC session while the browser still provides its
      // session cookie. The client-side cookie is cleared below as well.
      if (sessionCookieName in req) {
        req[sessionCookieName] = undefined;
      }

      // Clear both the active origin-scoped cookie and the legacy name from
      // versions that used a shared cookie across origins.
      clearOidcCookie(res, sessionCookieName);
      if (sessionCookieName !== 'appSession') clearOidcCookie(res, 'appSession');

      // Build logout URL with redirect parameter
      // Use post_logout_redirect_uri (OIDC standard) as primary, but also support returnTo for Auth0
      const idpLogoutUrl = new URL(parsedLogoutUrl.toString());
      idpLogoutUrl.searchParams.set('post_logout_redirect_uri', returnTo);
      if (idTokenHint) {
        idpLogoutUrl.searchParams.set('id_token_hint', idTokenHint);
      }

      logger.debug(
        { logoutOrigin: idpLogoutUrl.origin, hasIdTokenHint: Boolean(idTokenHint) },
        'Redirecting to IdP logout URL'
      );
      res.redirect(idpLogoutUrl.toString());
    } catch (e) {
      logger.warn({ err: e }, 'Error during custom logout');
      res.redirect(returnTo);
    }
  };
};

/**
 * Resolves OIDC scopes, ensuring 'openid' is always included
 */
const resolveOidcScopes = (oidc) => {
  const scopes =
    Array.isArray(oidc.scopes) && oidc.scopes.length ? oidc.scopes : ['openid', 'profile', 'email'];

  const scopeParam = Array.from(new Set(['openid', ...scopes])).join(' ');
  logger.debug({ scopes, scopeParam }, 'OIDC scopes resolved');

  return scopeParam;
};

/**
 * Creates the afterCallback handler for user synchronization
 */
const createAfterCallbackHandler = (oidc, envAuthConfig) => {
  return async (req, res, session) => {
    logger.debug('afterCallback: start');

    try {
      const persistIssuer = oidc.issuer;
      const accessToken = session?.access_token;

      const hasOidc = Boolean(req?.oidc);
      logger.debug(
        {
          hasOidc,
          accessTokenPresent: Boolean(accessToken),
          persistIssuer,
        },
        'OIDC user login state'
      );

      // Who this sign-in is, as the provider's id token says — verified by the
      // library by the time this runs. `req.oidc.user` is not it: during the
      // callback it is still the user of the session the browser arrived with,
      // if it had one, which made a second person in the same browser a
      // "mismatch" and let a brand-new sign-in skip the subject check entirely.
      const idTokenClaims =
        readIdTokenClaims(session?.id_token) || session?.id_token_claims || session?.claims || null;
      let claims = idTokenClaims || {};

      // Fetch from userinfo endpoint if access token is available
      if (accessToken && persistIssuer) {
        logger.debug('afterCallback: fetching userinfo via direct HTTP');
        const directClaims = await fetchUserInfoClaims({
          issuer: persistIssuer,
          accessToken,
          userInfoURL: oidc.userInfoURL,
        });

        if (directClaims && directClaims.sub) {
          // OpenID Connect Core 5.3.2: the userinfo response describes the
          // subject of the id token, or it must not be used at all.
          if (idTokenClaims?.sub && directClaims.sub !== idTokenClaims.sub) {
            throw new UnauthorizedError(
              'OIDC userinfo subject does not match the authenticated user.'
            );
          }
          claims = directClaims;
          logger.debug('afterCallback: direct userinfo fetch succeeded');
        } else if (idTokenClaims?.sub) {
          // A provider whose userinfo is briefly unavailable: the id token
          // already names the person, so the sign-in goes ahead on it.
          logger.debug('afterCallback: userinfo unavailable, using the id token claims');
        }
      }

      const sub = typeof claims?.sub === 'string' && claims.sub.trim() ? claims.sub : null;
      if (!sub) {
        throw new UnauthorizedError('OIDC identity is missing a subject claim.');
      }

      // Derive user information from claims
      const email = claims.email || null;
      const emailVerified = claims.email_verified === true;
      const preferredUsername = claims.preferred_username || claims.username || email || sub;
      const displayName = claims.name || preferredUsername || null;
      const adminGroups = envAuthConfig?.oidc?.adminGroups;
      const roles = deriveRolesFromClaims(claims, adminGroups);
      // The provider only gets to decide who is an administrator here where an
      // admin group was configured and the provider actually said something
      // about groups. Otherwise the roles already stored are left alone.
      const rolesAreAuthoritative = rolesFromClaimsAreAuthoritative(claims, adminGroups);

      logger.debug(
        { emailVerified, roleCount: roles.length },
        'afterCallback: OIDC claims validated'
      );

      // Persist user to database
      await getOrCreateOidcUser({
        issuer: persistIssuer,
        sub,
        username: preferredUsername,
        displayName,
        email,
        emailVerified,
        roles,
        rolesAreAuthoritative,
        requireEmailVerified: envAuthConfig?.oidc?.requireEmailVerified || false,
        autoCreateUsers: envAuthConfig?.oidc?.autoCreateUsers ?? true,
      });

      logger.debug('afterCallback: user persisted/synced');
    } catch (e) {
      // If user sync fails, block login only for operational/expected errors
      // (e.g., auto-provision disabled and profile missing).
      if (e && e.isOperational) {
        throw e;
      }
      logger.warn({ err: e }, 'afterCallback user sync failed');
    }

    logger.debug('afterCallback: complete');
    return session;
  };
};

/**
 * Configures Express OpenID Connect (OIDC) authentication
 */
const configureOidc = async (app) => {
  // Whether the settings for a sign-in were all there. Read again in the catch
  // below, where what is worth saying depends on how far this got.
  let settingsArePresent = false;

  try {
    logger.debug('Configuring Express OpenID Connect');

    const oidc = (envAuthConfig && envAuthConfig.oidc) || {};

    // Resolve configuration
    const scopeParam = resolveOidcScopes(oidc);
    const baseURL = deriveBaseUrl(oidc);
    const sessionSecret =
      (envAuthConfig && envAuthConfig.sessionSecret) || crypto.randomBytes(32).toString('hex');

    // Check if OIDC should be enabled.
    //
    // The client secret counts: the hand-off below asks for the authorization
    // code flow, which has no other way to prove which application is asking.
    // Left out, the library threw while being configured and the instance
    // reported a provider that could not be started — sending an administrator
    // to look at a provider that was perfectly well, while the one setting
    // they had missed was named in the log and nowhere else.
    const eocEnabled = Boolean(
      oidc.enabled && oidc.issuer && oidc.clientId && oidc.clientSecret && sessionSecret && baseURL
    );
    settingsArePresent = eocEnabled;

    logger.debug(
      {
        enabled: eocEnabled,
        issuer: !!oidc.issuer,
        clientId: !!oidc.clientId,
        clientSecret: !!oidc.clientSecret,
        baseURL: !!baseURL,
      },
      'EOC enablement check'
    );

    if (!eocEnabled) {
      // Named one by one, and recorded: a sign-in refused later says it is the
      // configuration that is missing, and this is where an administrator finds
      // which part of it.
      const missing = [
        !oidc.enabled && 'OIDC_ENABLED',
        !oidc.issuer && 'OIDC_ISSUER',
        !oidc.clientId && 'OIDC_CLIENT_ID',
        !oidc.clientSecret && 'OIDC_CLIENT_SECRET',
        !sessionSecret && 'SESSION_SECRET',
        !baseURL && 'PUBLIC_URL or OIDC_CALLBACK_URL',
      ].filter(Boolean);
      recordOidcNotConfigured(missing.join(', ') || null);
      logger.info(
        { missing },
        'Express OpenID Connect not configured (missing issuer/client/baseURL/secret or disabled)'
      );
      logger.debug(
        {
          enabled: Boolean(oidc.enabled),
          hasIssuer: Boolean(oidc.issuer),
          hasClientId: Boolean(oidc.clientId),
          hasSecret: Boolean(sessionSecret),
          hasBaseURL: Boolean(baseURL),
        },
        'EOC configuration details'
      );
      return;
    }

    // PUBLIC_URL remains canonical for links and integrations. OIDC is the
    // exception: every explicitly configured INTERNAL_URL needs its own
    // callback URL so a login can return to the origin where it began.
    const oidcOrigins = uniqueOrigins([baseURL, ...(publicConfig?.origins || [])]);
    const oidcMiddlewares = new Map();
    const oidcCookieNames = new Map();

    for (const origin of oidcOrigins) {
      const cookieSecure = shouldOidcCookieBeSecure(origin);
      const cookieNames = oidcCookieNamesForOrigin(origin);
      oidcCookieNames.set(origin, cookieNames);
      oidcMiddlewares.set(
        origin,
        eocAuth({
          authRequired: false,
          auth0Logout: false,
          idpLogout: false,
          issuerBaseURL: oidc.issuer,
          baseURL: origin,
          clientID: oidc.clientId,
          clientSecret: oidc.clientSecret || undefined,
          secret: sessionSecret,
          authorizationParams: {
            response_type: 'code',
            scope: scopeParam,
          },
          session: {
            store: oidcStore,
            name: cookieNames.session,
            rolling: true,
            // Convert milliseconds to seconds for absoluteDuration
            absoluteDuration: Math.floor(
              ((envAuthConfig && envAuthConfig.sessionMaxAgeMs) || 30 * 24 * 60 * 60 * 1000) / 1000
            ), // Default: 30 days in seconds
            cookie: {
              sameSite: 'Lax',
              secure: cookieSecure,
              httpOnly: true,
            },
          },
          transactionCookie: {
            name: cookieNames.transaction,
            sameSite: 'Lax',
          },
          afterCallback: createAfterCallbackHandler(oidc, envAuthConfig),
          // The native routes always use one baseURL. Register them ourselves
          // after dispatching the request to its matching origin middleware.
          routes: {
            login: false,
            callback: false,
            logout: false,
          },
        })
      );
    }

    const resolveOrigin = (req) => getConfiguredRequestOrigin(req, oidcOrigins) || baseURL;

    // Attach an EOC request/response context selected by the actual, approved
    // browser origin. Unknown hosts deliberately fall back to PUBLIC_URL.
    app.use((req, res, next) => {
      const origin = resolveOrigin(req);
      req.nextExplorerOidcSessionCookieName = oidcCookieNames.get(origin).session;
      oidcMiddlewares.get(origin)(req, res, next);
    });

    const returnToForRequest = (req) =>
      absoluteReturnTo(resolveOrigin(req), req.query?.returnTo || '/auth/login');

    app.get('/login', (req, res, next) => {
      if (!res.oidc || typeof res.oidc.login !== 'function') {
        next(new Error('OIDC is not configured.'));
        return;
      }
      const prompt = sanitizeOidcPrompt(req.query?.prompt);
      markProviderSignIn(req);
      res.oidc.login({
        returnTo: sanitizeReturnTo(req.query?.returnTo),
        authorizationParams: {
          redirect_uri: callbackUrlForOrigin(resolveOrigin(req)),
          ...(prompt ? { prompt } : {}),
        },
      });
    });

    const callbackHandler = (req, res, next) => {
      if (!res.oidc || typeof res.oidc.callback !== 'function') {
        next(new Error('OIDC is not configured.'));
        return;
      }
      res.oidc.callback({ redirectUri: callbackUrlForOrigin(resolveOrigin(req)) });
    };
    app.get('/callback', callbackHandler);
    app.post('/callback', callbackHandler);

    if (oidc.logoutURL) {
      const logoutHandler = createLogoutHandler({
        logoutURL: oidc.logoutURL,
        getReturnTo: returnToForRequest,
        getSessionCookieName: (req) => req.nextExplorerOidcSessionCookieName,
      });
      if (logoutHandler) {
        app.get('/logout', logoutHandler);
        logger.debug('Custom OIDC logout handler configured');
      }
    } else {
      app.get('/logout', (req, res, next) => {
        if (!res.oidc || typeof res.oidc.logout !== 'function') {
          next(new Error('OIDC is not configured.'));
          return;
        }
        res.oidc.logout({ returnTo: returnToForRequest(req) });
      });
    }

    // A hand-off that fails reports it to the `next` express-openid-connect
    // captured when it built the request context, not to the route's own — so
    // neither the route nor a try/catch around `login()` ever sees it, and the
    // raw failure reached the browser as a 500 quoting the provider's internal
    // host. Registered after the routes it covers, and a no-op for every other
    // error, which is what the mark is for.
    app.use((err, req, res, next) => {
      if (!isProviderSignIn(req) || res.headersSent) {
        next(err);
        return;
      }
      logger.error(
        { err, issuer: oidc.issuer },
        'Could not start a sign-in at the identity provider'
      );
      next(
        new ServiceUnavailableError(
          'The identity provider could not be reached.',
          ErrorCodes.AUTH_OIDC_PROVIDER_UNAVAILABLE
        )
      );
    });

    recordOidcReady();
    logger.info({ origins: oidcOrigins }, 'Express OpenID Connect is configured');
    logger.debug({ origins: oidcOrigins }, 'Origin-aware EOC middleware mounted');
  } catch (e) {
    // The settings were there and could not be made to work — a bad issuer URL,
    // a secret the library refuses. Saying "not configured" for this is what
    // sends an administrator to change a configuration that is already right.
    if (settingsArePresent) recordOidcUnavailable(e?.message || null);
    else recordOidcNotConfigured(e?.message || null);
    logger.error({ err: e }, 'Failed to configure Express OpenID Connect');
  }
};

module.exports = {
  configureOidc,
  // Exported for the tests. This module decides who someone is, and until now
  // nothing exercised any of it; these are the decisions worth pinning, and
  // reaching them through a real provider is not something a test can do.
  deriveBaseUrl,
  shouldOidcCookieBeSecure,
  resolveOidcScopes,
  createAfterCallbackHandler,
  createLogoutHandler,
};
