'use strict';

const express = require('express');
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const { helmetMiddleware, apiLimiter } = require('./middleware/security');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const SessionManager = require('./services/sessionManager');
const { startCleanupJob } = require('./services/cleanupService');
const createApiRouter = require('./routes/index');

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const sessionManager = new SessionManager({
  tempRoot: config.tempRoot,
  ttlMinutes: config.sessionTtlMinutes,
});
startCleanupJob(sessionManager, config.cleanupIntervalMinutes);

app.use(helmetMiddleware);
app.use(compression());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use('/api', apiLimiter, createApiRouter(sessionManager));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

app.use('/api', notFoundHandler);
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  logger.info(`Demonic FLAC Studio listening on http://${config.host}:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Temp root: ${config.tempRoot} (TTL ${config.sessionTtlMinutes}m)`);
});

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

module.exports = app;
