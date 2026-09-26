const session = require('express-session');

const { auth: envAuthConfig } = require('../config/index');
const { localStore } = require('../utils/sessionStore');
const logger = require('../utils/logger');

const configureSession = (app) => {
  // One source: the configuration resolved it, from SESSION_SECRET or from the
  // copy kept in CONFIG_DIR. A second fallback drawing its own random secret
  // here would have signed everyone out whenever it was the one that applied.
  const sessionSecret = envAuthConfig.sessionSecret;

  logger.debug({ hasSessionSecret: Boolean(sessionSecret) }, 'Session secret resolved');

  app.locals.sessionStore = localStore;

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: localStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        maxAge: (envAuthConfig && envAuthConfig.sessionMaxAgeMs) || 30 * 24 * 60 * 60 * 1000, // Default: 30 days
      },
    })
  );

  logger.debug('Express session middleware configured with shared SQLite store');
};

module.exports = { configureSession };
