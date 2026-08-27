'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { flacUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/security');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const flacMetadata = require('../services/flacMetadata');
const { serializeTrack } = require('../utils/serialize');
const logger = require('../utils/logger');

module.exports = function createUploadRouter(sessionManager) {
  const router = express.Router();

  /** Resolves (or creates) the target session before multer picks a destination dir. */
  function attachSession(req, res, next) {
    const requestedId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    req.uploadSession = sessionManager.getOrCreateSession(requestedId);
    next();
  }

  router.post(
    '/upload',
    uploadLimiter,
    attachSession,
    (req, res, next) => {
      req.query.sessionId = req.uploadSession.id;
      flacUpload.array('files')(req, res, next);
    },
    asyncHandler(async (req, res) => {
      const session = req.uploadSession;
      const files = req.files || [];
      if (files.length === 0) {
        throw new AppError('No files were uploaded', 400);
      }

      const addedTracks = [];
      const errors = [];

      for (const file of files) {
        try {
          const buffer = fs.readFileSync(file.path);

          if (!flacMetadata.isFlacFile(buffer)) {
            fs.unlinkSync(file.path);
            errors.push({ filename: file.originalname, error: 'Invalid FLAC file' });
            continue;
          }

          let parsed;
          try {
            parsed = flacMetadata.parseFlac(buffer);
          } catch (err) {
            fs.unlinkSync(file.path);
            errors.push({ filename: file.originalname, error: 'Unable to read metadata' });
            continue;
          }

          const { tags, extraTags } = flacMetadata.toDisplayTags(parsed.vorbisComment);
          const baseName = path.basename(file.originalname, path.extname(file.originalname));

          const track = {
            id: file.generatedId,
            originalFilename: file.originalname,
            originalBaseName: baseName,
            storedPath: file.path,
            size: file.size,
            tags,
            extraTags,
            picture: parsed.picture
              ? {
                  mime: parsed.picture.mime,
                  width: parsed.picture.width,
                  height: parsed.picture.height,
                  depth: parsed.picture.depth,
                  description: parsed.picture.description,
                  data: parsed.picture.data,
                }
              : null,
            audioInfo: {
              sampleRate: parsed.streamInfo.sampleRate,
              channels: parsed.streamInfo.channels,
              bitsPerSample: parsed.streamInfo.bitsPerSample,
              durationSeconds: parsed.streamInfo.durationSeconds,
            },
            parsedMeta: {
              streamInfoRaw: parsed.streamInfoRaw,
              passthroughBlocks: parsed.passthroughBlocks,
              audioStart: parsed.audioStart,
            },
            vendor: parsed.vorbisComment.vendor,
            createdAt: Date.now(),
          };

          sessionManager.addTrack(session.id, track);
          addedTracks.push(track);
        } catch (err) {
          logger.error('Failed processing upload', file.originalname, err.message);
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch {
            /* ignore */
          }
          errors.push({ filename: file.originalname, error: 'Unable to read metadata' });
        }
      }

      const orderedTracks = sessionManager.getOrderedTracks(session.id);
      const indexOf = new Map(orderedTracks.map((t, i) => [t.id, i]));

      res.status(201).json({
        sessionId: session.id,
        addedTracks: addedTracks.map((t) => serializeTrack(t, indexOf.get(t.id))),
        totalTracks: orderedTracks.length,
        errors,
      });
    })
  );

  return router;
};
