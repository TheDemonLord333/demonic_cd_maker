'use strict';

/**
 * Converts an internal track record into the JSON-safe shape sent to the
 * browser. Internal-only fields (on-disk paths, cached parse buffers) are
 * deliberately never included.
 */
function serializeTrack(track, index) {
  let cover = null;
  if (track.picture) {
    cover = {
      dataUrl: `data:${track.picture.mime};base64,${track.picture.data.toString('base64')}`,
      width: track.picture.width,
      height: track.picture.height,
      mime: track.picture.mime,
    };
  }
  return {
    id: track.id,
    index,
    originalFilename: track.originalFilename,
    size: track.size,
    tags: track.tags,
    extraTags: track.extraTags,
    cover,
    audioInfo: track.audioInfo,
    updatedAt: track.updatedAt || track.createdAt,
  };
}

function serializeSession(sessionManager, session) {
  const tracks = sessionManager.getOrderedTracks(session.id).map((t, i) => serializeTrack(t, i));
  return {
    sessionId: session.id,
    tracks,
    expiresInMinutes: sessionManager.ttlMinutes,
  };
}

module.exports = { serializeTrack, serializeSession };
