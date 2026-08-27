'use strict';

const { AppError } = require('../middleware/errorHandler');

/** Express middleware factories shared by the tracks and export routers. */
function makeSessionGuards(sessionManager) {
  function requireSession(req, res, next) {
    const session = sessionManager.getSession(req.params.sid);
    if (!session) {
      throw new AppError('Session not found or expired', 404);
    }
    req.session_ = session;
    next();
  }

  function requireTrack(req, res, next) {
    const track = req.session_.tracks.get(req.params.tid);
    if (!track) {
      throw new AppError('Track not found', 404);
    }
    req.track = track;
    next();
  }

  return { requireSession, requireTrack };
}

module.exports = { makeSessionGuards };
