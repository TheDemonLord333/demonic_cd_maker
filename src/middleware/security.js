'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * All UI JS/CSS lives in external files (no inline <script>/<style>), so we
 * can run a strict CSP with no 'unsafe-inline'. Cover images are served as
 * data: URIs to the browser, hence img-src 'self' data:.
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMinutes * 60 * 1000,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const uploadLimiter = rateLimit({
  windowMs: config.rateLimitWindowMinutes * 60 * 1000,
  max: config.uploadRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please slow down.' },
});

module.exports = { helmetMiddleware, apiLimiter, uploadLimiter };
