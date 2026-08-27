'use strict';

const express = require('express');
const createUploadRouter = require('./upload');
const createTracksRouter = require('./tracks');
const createExportRouter = require('./export');
const filenameService = require('../services/filenameService');

module.exports = function createApiRouter(sessionManager) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', ...sessionManager.stats() });
  });

  router.get('/schemes', (req, res) => {
    res.json({ schemes: filenameService.SCHEMES, default: filenameService.DEFAULT_SCHEME });
  });

  router.use(createUploadRouter(sessionManager));
  router.use(createTracksRouter(sessionManager));
  router.use(createExportRouter(sessionManager));

  return router;
};
