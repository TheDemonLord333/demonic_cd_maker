'use strict';

/**
 * Tiny structured logger. Keeps stack traces / internal paths out of any
 * response body while still logging enough detail server-side (PM2 will
 * capture stdout/stderr into its own log files).
 */

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info(...args) {
    console.log(`[${timestamp()}] [INFO]`, ...args);
  },
  warn(...args) {
    console.warn(`[${timestamp()}] [WARN]`, ...args);
  },
  error(...args) {
    console.error(`[${timestamp()}] [ERROR]`, ...args);
  },
};

module.exports = logger;
