'use strict';

const logger = require('../utils/logger');

/**
 * Periodically sweeps expired sessions (see spec §21). Runs entirely
 * in-process via setInterval — no external cron dependency required,
 * though the same effect could be achieved with a system cron job calling
 * a cleanup script if this process is ever split up.
 */
function startCleanupJob(sessionManager, intervalMinutes) {
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const timer = setInterval(() => {
    try {
      const removed = sessionManager.cleanupExpired();
      if (removed > 0) {
        logger.info(`Cleanup: removed ${removed} expired session(s).`);
      }
    } catch (err) {
      logger.error('Cleanup job failed:', err.message);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { startCleanupJob };
