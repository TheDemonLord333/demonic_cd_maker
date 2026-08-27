'use strict';

const express = require('express');
const fs = require('fs');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { makeSessionGuards } = require('../utils/sessionGuards');
const flacMetadata = require('../services/flacMetadata');
const filenameService = require('../services/filenameService');
const { ALLOWED_SCHEMES } = require('../utils/validators');
const { streamZip } = require('../services/zipService');
const logger = require('../utils/logger');

module.exports = function createExportRouter(sessionManager) {
  const router = express.Router();
  const { requireSession, requireTrack } = makeSessionGuards(sessionManager);

  router.use('/session/:sid', asyncHandler(async (req, res, next) => requireSession(req, res, next)));

  function resolveScheme(req) {
    const scheme = req.query.scheme;
    return ALLOWED_SCHEMES.has(scheme) ? scheme : filenameService.DEFAULT_SCHEME;
  }

  function buildExportBuffer(track) {
    let originalBuffer;
    try {
      originalBuffer = fs.readFileSync(track.storedPath);
    } catch (err) {
      logger.error('Failed reading original FLAC for export:', err.message);
      throw new AppError('Export failed', 500);
    }
    try {
      return flacMetadata.exportFlac(originalBuffer, track.parsedMeta, {
        tags: track.tags,
        extraTags: track.extraTags,
        picture: track.picture,
        vendor: track.vendor,
      });
    } catch (err) {
      logger.error('Failed writing FLAC metadata for export:', err.message);
      throw new AppError('Unable to write metadata', 500);
    }
  }

  router.get(
    '/session/:sid/tracks/:tid/download',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    asyncHandler(async (req, res) => {
      const scheme = resolveScheme(req);
      const ordered = sessionManager.getOrderedTracks(req.session_.id);
      const index = ordered.findIndex((t) => t.id === req.track.id);
      const filename = filenameService.buildTrackFilename(req.track, scheme, index === -1 ? 0 : index);
      const buffer = buildExportBuffer(req.track);

      res.setHeader('Content-Type', 'audio/flac');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    })
  );

  router.get(
    '/session/:sid/download-all',
    asyncHandler(async (req, res) => {
      const scheme = resolveScheme(req);
      const tracks = sessionManager.getOrderedTracks(req.session_.id);
      if (tracks.length === 0) {
        throw new AppError('No tracks to export', 400);
      }
      const filenames = filenameService.buildUniqueFilenames(tracks, scheme);
      const entries = tracks.map((track, i) => ({
        name: filenames[i],
        buffer: buildExportBuffer(track),
      }));

      const albumTag = tracks.find((t) => t.tags.ALBUM)?.tags.ALBUM;
      const zipBase = filenameService.sanitizeFilenamePart(albumTag) || 'Demonic Collection';
      const zipName = `${zipBase}.zip`;

      await streamZip(res, zipName, entries);
    })
  );

  /** Streams the untouched original audio bytes, with Range support for the in-browser preview player. */
  router.get(
    '/session/:sid/tracks/:tid/audio',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    asyncHandler(async (req, res) => {
      const filePath = req.track.storedPath;
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        throw new AppError('Audio file not found', 404);
      }

      res.setHeader('Content-Type', 'audio/flac');
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      if (!range) {
        res.setHeader('Content-Length', stat.size);
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    })
  );

  return router;
};
