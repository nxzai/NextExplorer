const pino = require('pino');
const loggingConfig = require('../config/logging');

const logger = pino({
  level: loggingConfig.level,
  base: { service: 'nextExplorer-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: loggingConfig.isDebug
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          levelFirst: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

logger.debug({ level: loggingConfig.level }, 'Logger initialized');

// Alias used by some parts of the codebase (and for readability).
logger.warning = logger.warn.bind(logger);

module.exports = logger;
