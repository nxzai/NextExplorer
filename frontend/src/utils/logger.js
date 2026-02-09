const passthrough =
  (fn) =>
  (...args) => {
    fn(...args);
  };

const logger = {
  debug: passthrough(console.debug.bind(console)),
  info: passthrough(console.info.bind(console)),
  warning: passthrough(console.warn.bind(console)),
  error: passthrough(console.error.bind(console)),
};

// Common alias.
logger.warn = logger.warning;

export default logger;
