/**
 * Server entry point - handles HTTP server lifecycle and process management.
 * This file is responsible for starting the server and should NOT be imported in tests.
 * Tests should import the app directly from ./app.js
 */
const { createApp } = require('./app');
const { port, http } = require('./config/index');
const logger = require('./utils/logger');
const terminalService = require('./services/terminalService');

let server = null;

const startServer = async () => {
  logger.debug('Server initialization started');

  const app = await createApp();

  server = app.listen(port, '0.0.0.0', () => {
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

  // Initialize WebSocket server for terminal
  terminalService.createWebSocketServer(server);
  logger.debug('Terminal WebSocket server initialized');

  // Cleanup on process termination
  const cleanup = () => {
    logger.info('Shutting down server...');
    terminalService.cleanup();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

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
