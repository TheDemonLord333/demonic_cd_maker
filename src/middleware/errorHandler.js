'use strict';

const multer = require('multer');
const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isAppError = true;
  }
}

/** Wraps async route handlers so rejected promises reach the error handler. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'File is too large',
      LIMIT_FILE_COUNT: 'Too many files in one upload',
      LIMIT_UNEXPECTED_FILE: err.message || 'Unexpected or unsupported file',
    };
    return res.status(400).json({ error: messages[err.code] || 'Upload failed' });
  }

  if (err && err.isAppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Never leak internal paths, stack traces, or raw driver errors to the client.
  logger.error('Unhandled error:', err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Internal server error' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { AppError, asyncHandler, errorHandler, notFoundHandler };
