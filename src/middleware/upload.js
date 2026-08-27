'use strict';

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Extension allow-lists. The client-declared MIME type is never trusted on
 * its own (browsers/OSes are inconsistent about it for FLAC in particular);
 * real content validation happens via magic-byte sniffing in the route
 * handlers once the bytes are available (flacMetadata.isFlacFile /
 * imageInfo.inspectImage).
 */
const FLAC_EXTENSIONS = new Set(['.flac']);
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function flacFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!FLAC_EXTENSIONS.has(ext)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only .flac files are accepted'));
  }
  cb(null, true);
}

function coverFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!COVER_EXTENSIONS.has(ext)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only JPG or PNG images are accepted'));
  }
  cb(null, true);
}

/**
 * FLAC uploads go straight to disk inside the (already-created) session's
 * "originals" directory, named by a fresh random id — never the
 * user-supplied filename — which rules out path traversal or collisions.
 */
const flacStorage = multer.diskStorage({
  destination(req, file, cb) {
    if (!req.uploadSession) {
      return cb(new Error('No active session for upload'));
    }
    cb(null, req.uploadSession.originalsDir);
  },
  filename(req, file, cb) {
    const id = crypto.randomUUID();
    file.generatedId = id;
    cb(null, `${id}.flac`);
  },
});

const flacUpload = multer({
  storage: flacStorage,
  fileFilter: flacFileFilter,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
    files: config.maxFilesPerUpload,
  },
});

/** Cover images are small and only ever needed as an in-memory Buffer. */
const coverUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: coverFileFilter,
  limits: {
    fileSize: config.maxCoverSizeMb * 1024 * 1024,
    files: 1,
  },
});

module.exports = { flacUpload, coverUpload };
