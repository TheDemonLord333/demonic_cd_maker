'use strict';

const path = require('path');
require('dotenv').config();

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: intFromEnv('PORT', 3008),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'production',

  // Uploads
  maxFileSizeMb: intFromEnv('MAX_FILE_SIZE_MB', 150),
  maxCoverSizeMb: intFromEnv('MAX_COVER_SIZE_MB', 15),
  maxFilesPerUpload: intFromEnv('MAX_FILES_PER_UPLOAD', 30),

  // Sessions / temp cleanup
  tempRoot: process.env.TEMP_DIR ? path.resolve(process.env.TEMP_DIR) : path.join(__dirname, '..', 'temp'),
  sessionTtlMinutes: intFromEnv('SESSION_TTL_MINUTES', 60),
  cleanupIntervalMinutes: intFromEnv('CLEANUP_INTERVAL_MINUTES', 5),

  // Rate limiting
  rateLimitWindowMinutes: intFromEnv('RATE_LIMIT_WINDOW_MINUTES', 15),
  rateLimitMaxRequests: intFromEnv('RATE_LIMIT_MAX_REQUESTS', 300),
  uploadRateLimitMax: intFromEnv('UPLOAD_RATE_LIMIT_MAX', 60),

  trustProxy: process.env.TRUST_PROXY === 'true',
};

module.exports = config;
