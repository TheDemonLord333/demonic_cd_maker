'use strict';

const express = require('express');
const { coverUpload } = require('../middleware/upload');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { sanitizeTagsInput, sanitizeExtraTags, ALLOWED_SORT_KEYS } = require('../utils/validators');
const { inspectImage } = require('../utils/imageInfo');
const { serializeTrack, serializeSession } = require('../utils/serialize');
const { makeSessionGuards } = require('../utils/sessionGuards');

module.exports = function createTracksRouter(sessionManager) {
  const router = express.Router();
  const { requireSession, requireTrack } = makeSessionGuards(sessionManager);

  router.use('/session/:sid', asyncHandler(async (req, res, next) => requireSession(req, res, next)));

  router.get(
    '/session/:sid',
    asyncHandler(async (req, res) => {
      res.json(serializeSession(sessionManager, req.session_));
    })
  );

  router.patch(
    '/session/:sid/tracks/:tid',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    asyncHandler(async (req, res) => {
      const tagUpdates = sanitizeTagsInput(req.body.tags);
      Object.assign(req.track.tags, tagUpdates);
      if (Array.isArray(req.body.extraTags)) {
        req.track.extraTags = sanitizeExtraTags(req.body.extraTags);
      }
      req.track.updatedAt = Date.now();
      const ordered = sessionManager.getOrderedTracks(req.session_.id);
      const index = ordered.findIndex((t) => t.id === req.track.id);
      res.json({ track: serializeTrack(req.track, index) });
    })
  );

  router.delete(
    '/session/:sid/tracks/:tid',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    asyncHandler(async (req, res) => {
      sessionManager.removeTrack(req.session_.id, req.track.id);
      res.json({ ok: true });
    })
  );

  router.post(
    '/session/:sid/tracks/:tid/cover',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    (req, res, next) => coverUpload.single('cover')(req, res, next),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new AppError('No cover image was uploaded', 400);
      }
      const info = inspectImage(req.file.buffer);
      if (!info) {
        throw new AppError('Unsupported cover format', 400);
      }
      req.track.picture = {
        mime: info.mime,
        width: info.width,
        height: info.height,
        depth: 24,
        description: 'Cover',
        data: req.file.buffer,
      };
      req.track.updatedAt = Date.now();
      const ordered = sessionManager.getOrderedTracks(req.session_.id);
      const index = ordered.findIndex((t) => t.id === req.track.id);
      res.json({ track: serializeTrack(req.track, index) });
    })
  );

  router.delete(
    '/session/:sid/tracks/:tid/cover',
    asyncHandler(async (req, res, next) => requireTrack(req, res, next)),
    asyncHandler(async (req, res) => {
      req.track.picture = null;
      req.track.updatedAt = Date.now();
      const ordered = sessionManager.getOrderedTracks(req.session_.id);
      const index = ordered.findIndex((t) => t.id === req.track.id);
      res.json({ track: serializeTrack(req.track, index) });
    })
  );

  // ---- Batch editing (arbitrary selection) ----

  router.post(
    '/session/:sid/batch/tags',
    asyncHandler(async (req, res) => {
      const { trackIds, tags, extraTags } = req.body;
      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        throw new AppError('No tracks selected', 400);
      }
      const tagUpdates = sanitizeTagsInput(tags);
      const extraUpdates = Array.isArray(extraTags) ? sanitizeExtraTags(extraTags) : null;
      let applied = 0;
      for (const id of trackIds) {
        const track = req.session_.tracks.get(id);
        if (!track) continue;
        Object.assign(track.tags, tagUpdates);
        if (extraUpdates) {
          // Merge by key rather than replace, so batch extra-tag edits don't
          // wipe out unrelated per-track custom tags.
          for (const { key, value } of extraUpdates) {
            const existing = track.extraTags.find((e) => e.key === key);
            if (existing) existing.value = value;
            else track.extraTags.push({ key, value });
          }
        }
        track.updatedAt = Date.now();
        applied += 1;
      }
      res.json({ applied, ...serializeSession(sessionManager, req.session_) });
    })
  );

  router.post(
    '/session/:sid/batch/cover',
    (req, res, next) => coverUpload.single('cover')(req, res, next),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new AppError('No cover image was uploaded', 400);
      }
      const info = inspectImage(req.file.buffer);
      if (!info) {
        throw new AppError('Unsupported cover format', 400);
      }
      let trackIds = [];
      try {
        trackIds = JSON.parse(req.body.trackIds || '[]');
      } catch {
        throw new AppError('Invalid track selection', 400);
      }
      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        throw new AppError('No tracks selected', 400);
      }
      let applied = 0;
      for (const id of trackIds) {
        const track = req.session_.tracks.get(id);
        if (!track) continue;
        track.picture = {
          mime: info.mime,
          width: info.width,
          height: info.height,
          depth: 24,
          description: 'Cover',
          data: req.file.buffer,
        };
        track.updatedAt = Date.now();
        applied += 1;
      }
      res.json({ applied, ...serializeSession(sessionManager, req.session_) });
    })
  );

  // ---- Album mode (applies to every track in the session) ----

  router.post(
    '/session/:sid/album',
    asyncHandler(async (req, res) => {
      const { tags, extraTags, autoTotalTracks } = req.body;
      const tagUpdates = sanitizeTagsInput(tags);
      const tracks = sessionManager.getOrderedTracks(req.session_.id);
      if (autoTotalTracks) {
        tagUpdates.TRACKTOTAL = String(tracks.length);
      }
      const extraUpdates = Array.isArray(extraTags) ? sanitizeExtraTags(extraTags) : null;
      for (const track of tracks) {
        Object.assign(track.tags, tagUpdates);
        if (extraUpdates) {
          for (const { key, value } of extraUpdates) {
            const existing = track.extraTags.find((e) => e.key === key);
            if (existing) existing.value = value;
            else track.extraTags.push({ key, value });
          }
        }
        track.updatedAt = Date.now();
      }
      res.json(serializeSession(sessionManager, req.session_));
    })
  );

  // ---- Ordering / sorting / renumbering ----

  router.put(
    '/session/:sid/order',
    asyncHandler(async (req, res) => {
      const { order, renumber, startAt } = req.body;
      if (!Array.isArray(order)) {
        throw new AppError('Invalid order payload', 400);
      }
      sessionManager.setOrder(req.session_.id, order);
      if (renumber) {
        applyRenumber(sessionManager, req.session_.id, startAt);
      }
      res.json(serializeSession(sessionManager, req.session_));
    })
  );

  router.post(
    '/session/:sid/renumber',
    asyncHandler(async (req, res) => {
      applyRenumber(sessionManager, req.session_.id, req.body.startAt);
      res.json(serializeSession(sessionManager, req.session_));
    })
  );

  router.post(
    '/session/:sid/sort',
    asyncHandler(async (req, res) => {
      const { by } = req.body;
      if (!ALLOWED_SORT_KEYS.has(by)) {
        throw new AppError('Invalid sort key', 400);
      }
      const tracks = sessionManager.getOrderedTracks(req.session_.id);
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const sorted = [...tracks].sort((a, b) => {
        switch (by) {
          case 'trackNumber': {
            const na = parseInt(a.tags.TRACKNUMBER, 10);
            const nb = parseInt(b.tags.TRACKNUMBER, 10);
            const va = Number.isFinite(na) ? na : Infinity;
            const vb = Number.isFinite(nb) ? nb : Infinity;
            return va - vb;
          }
          case 'filename':
            return collator.compare(a.originalFilename, b.originalFilename);
          case 'title':
            return collator.compare(a.tags.TITLE || a.originalBaseName, b.tags.TITLE || b.originalBaseName);
          case 'artist':
            return collator.compare(a.tags.ARTIST || '', b.tags.ARTIST || '');
          default:
            return 0;
        }
      });
      sessionManager.setOrder(req.session_.id, sorted.map((t) => t.id));
      res.json(serializeSession(sessionManager, req.session_));
    })
  );

  return router;
};

function applyRenumber(sessionManager, sessionId, startAt) {
  const start = Number.isFinite(parseInt(startAt, 10)) ? parseInt(startAt, 10) : 1;
  const tracks = sessionManager.getOrderedTracks(sessionId);
  tracks.forEach((track, i) => {
    track.tags.TRACKNUMBER = String(start + i);
    track.updatedAt = Date.now();
  });
}
