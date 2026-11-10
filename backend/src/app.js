/**
 * Express application factory.
 * This file defines routes and middleware and exports a createApp function.
 * It does NOT start the server - that's handled by server.js
 *
 * This separation allows tests to import the app without starting a real server.
 */
const express = require('express');
const cookieParser = require('cookie-parser');

const { configureTrustProxy } = require('./middleware/trustProxy');
const { forwardedAddressWarning } = require('./utils/clientAddress');
const { configureSecurityHeaders } = require('./middleware/securityHeaders');
const { requestContextMiddleware } = require('./utils/requestContext');
const { uploads } = require('./config/index');
const { configureHttpLogging } = require('./middleware/logging');
const { configureCors } = require('./middleware/cors');
const { configureOidc } = require('./middleware/oidc');
const { configureHttpsWarning } = require('./middleware/httpsWarning');
const authMiddleware = require('./middleware/authMiddleware');
const { heldRequestLogger } = require('./middleware/heldRequests');
const registerRoutes = require('./routes');
const { configureStaticFiles } = require('./utils/staticServer');
const { bootstrap } = require('./utils/bootstrap');
const { configureSession } = require('./middleware/session');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * Creates and configures the Express application.
 * @param {Object} options - Configuration options for testing
 * @param {boolean} options.skipBootstrap - Skip bootstrap for unit tests
 * @param {boolean} options.skipOidc - Skip OIDC configuration for unit tests
 * @param {boolean} options.skipSession - Skip session configuration for unit tests
 * @param {boolean} options.skipStaticFiles - Skip static file serving for unit tests
 * @returns {Promise<express.Application>} Configured Express app
 */
const createApp = async (options = {}) => {
  const {
    skipBootstrap = false,
    skipOidc = false,
    skipSession = false,
    skipStaticFiles = false,
  } = options;

  logger.debug('Application initialization started');

  const app = express();

  configureTrustProxy(app);
  // Says once, on the first request that shows it, when a proxy is announcing
  // a client this server was not told to believe: without it every recorded
  // address is the proxy's and nothing anywhere says why.
  app.use(forwardedAddressWarning);
  // Opens the per-request scratch space early, so everything downstream can
  // memoize work that must not be reused by the next request.
  app.use(requestContextMiddleware);
  configureSecurityHeaders(app);
  configureHttpLogging(app);

  configureCors(app);

  // Before everything that could hold a request, so that what it reports is
  // the whole of the chain below it.
  app.use(heldRequestLogger);

  // Liveness, before anything that could hold a request.
  //
  // These were mounted with the rest of the routes, which put them behind the
  // session store, the OpenID Connect middleware and the authorization layer.
  // A probe that travels through all of that does not answer "is this
  // container alive" — it answers "is the identity provider reachable, and is
  // the session store responding", and a container was reported unhealthy for
  // ten minutes while the application it runs was serving pages perfectly.
  //
  // Nothing here reads a cookie, a database or the network, so there is no
  // state it could wait on.
  app.use('/', require('./routes/health'));

  // A selection of a few thousand files is a normal request here, and its list
  // of paths outgrows the 100 kB Express allows by default.
  // inflate: false protects against GHSA-27r3-jxmh-p828 uncaught exception DoS
  app.use(express.json({ limit: uploads.maxJsonBodyBytes, inflate: false }));
  app.use(express.urlencoded({ extended: true, limit: uploads.maxJsonBodyBytes, inflate: false }));

  // Express 5 leaves `req.body` undefined when no parser above matched the
  // request's content type, where Express 4 left an empty object. Every route
  // in this application was written against the empty object — and the ones
  // asking `'field' in req.body` do not fail politely, they throw a TypeError
  // and answer 500 to a request whose only fault is a missing header.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });
  app.use(cookieParser());
  logger.debug('Mounted cookie parser middleware');

  if (!skipBootstrap) {
    await bootstrap();
  }

  if (!skipSession) {
    configureSession(app);
  }

  if (!skipOidc) {
    await configureOidc(app);
  }

  configureHttpsWarning(app);

  app.use(authMiddleware);
  logger.debug('Mounted auth middleware');

  registerRoutes(app);
  logger.debug('Registered application routes');

  if (!skipStaticFiles) {
    configureStaticFiles(app);
  }

  // Error handling middleware (must be after all routes)
  app.use(notFoundHandler);
  app.use(errorHandler);
  logger.debug('Mounted error handling middleware');

  return app;
};

module.exports = {
  createApp,
};
