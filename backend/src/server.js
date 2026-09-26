/**
 * Server entry point - handles HTTP server lifecycle and process management.
 * This file is responsible for starting the server and should NOT be imported in tests.
 * Tests should import the app directly from ./app.js
 */
const { createApp } = require('./app');
const { port, http, features, address } = require('./config/index');
const logger = require('./utils/logger');
const { printStartupBanner } = require('./utils/startupBanner');
const terminalService = require('./services/terminalService');
const searchIndexManager = require('./services/searchIndexManager');
const folderSizeManager = require('./services/folderSizeManager');
const { sweepInterrupted } = require('./services/inFlightFiles');
const trashMaintenance = require('./services/trash/maintenance');
const tusUploads = require('./services/tusUploadService');
const { cleanupExpiredShares } = require('./services/sharesService');
const { cleanupExpiredSessions } = require('./services/guestSessionService');
const { purgeExpiredDocumentKeys } = require('./services/onlyofficeDocumentKeyService');
const editorSessions = require('./services/onlyofficeEditorSessionService');
const { sweepActivity } = require('./services/activityLog');
const capabilities = require('./services/capabilities');
const { installProcessFailureHandlers } = require('./utils/processFailures');

let server = null;

const startServer = async () => {
  logger.debug('Server initialization started');

  // Before anything writes: what operations a stop interrupted left behind.
  sweepInterrupted();

  const app = await createApp();

  server = app.listen(port, address, () => {
    const addr = server?.address?.();
    printStartupBanner({
      listenHost: typeof addr === 'object' && addr ? addr.address : address,
      listenPort: typeof addr === 'object' && addr ? addr.port : port,
    });
    logger.info({ port }, 'Server is running');
    logger.debug('HTTP server listen callback executed');
  });

  if (server && typeof server.requestTimeout === 'number') {
    server.requestTimeout = http?.requestTimeoutMs ?? server.requestTimeout;
    logger.info(
      { requestTimeoutMs: server.requestTimeout },
      'HTTP server request timeout configured'
    );
  }

  // Initialize terminal only when enabled and dependencies are available.
  const terminalReady = terminalService.initialize({
    enabled: Boolean(features?.terminal),
  });
  if (terminalReady) {
    terminalService.createWebSocketServer(server);
    logger.debug('Terminal WebSocket server initialized');
  } else {
    logger.warn('Terminal disabled at runtime');
  }

  // Deliberately not awaited: a server does not wait for its index to be
  // ready, it answers from the live search until it is.
  folderSizeManager.start();
  searchIndexManager.start();
  // Which optional tools are here and which are not, said once. Not awaited: a
  // server does not wait on `--version` to answer its first request.
  capabilities.report();
  // Finishes what a crash interrupted before anything else touches a zone,
  // then keeps each zone within its retention and budget.
  trashMaintenance.start();
  // Chunked uploads abandoned, or finished and never moved into place, leave
  // the upload cache once past TUS_INCOMPLETE_UPLOAD_TTL_MS.
  tusUploads.startCacheSweep();

  // Rows that expire and were never swept. The ONLYOFFICE key of a document
  // whose browser was closed is one: only a terminal callback released a key,
  // so a crash or a restart left the row for good, one for every document ever
  // opened. The same sweep takes the two that were already here and had no
  // caller at all — `cleanupExpiredShares` and `cleanupExpiredSessions` — so an
  // expired share no longer sits on disk indefinitely.
  const EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
  const sweepExpiredRecords = async () => {
    try {
      const [shares, sessions, documentKeys, activity] = await Promise.all([
        cleanupExpiredShares(),
        cleanupExpiredSessions(),
        purgeExpiredDocumentKeys(),
        editorSessions.purgeExpired(),
        // Whether or not the log is on: switching it off should let the disk go
        // back rather than freeze yesterday's rows for ever.
        sweepActivity(),
      ]);
      if (shares || sessions || documentKeys || activity) {
        logger.info(
          { shares, sessions, documentKeys, activity },
          'Purged expired shares, guest sessions, ONLYOFFICE document keys and activity'
        );
      }
    } catch (error) {
      logger.warn({ err: error }, 'Expiry sweep failed');
    }
  };
  const expirySweep = setInterval(sweepExpiredRecords, EXPIRY_SWEEP_INTERVAL_MS);
  // Never keep the process alive just for the sweep.
  expirySweep.unref?.();
  void sweepExpiredRecords();

  // Cleanup on process termination
  const cleanup = () => {
    logger.info('Shutting down server...');
    terminalService.cleanup();
    clearInterval(expirySweep);
    tusUploads.stopCacheSweep();
    folderSizeManager.stop();
    trashMaintenance.stop();
    searchIndexManager.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // Installed last, so the shutdown it may need already exists.
  installProcessFailureHandlers({ onFatal: cleanup });

  return server;
};

startServer().catch((error) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});

module.exports = {
  get server() {
    return server;
  },
};
