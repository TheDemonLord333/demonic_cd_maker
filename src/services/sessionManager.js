'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * In-memory session store. No database by design (see spec §22): every
 * session is a short-lived working area for one editing pass over a batch
 * of FLAC files. Original audio bytes live only on disk (temp/<sessionId>/
 * originals/<trackId>.flac); everything else (tags, cover bytes, track
 * order) lives in RAM and disappears with the session.
 *
 * IMPORTANT: because state is in-process memory, this app must run as a
 * single PM2 instance (no cluster mode) — see ecosystem.config.js.
 */
class SessionManager {
  constructor({ tempRoot, ttlMinutes }) {
    this.tempRoot = tempRoot;
    this.ttlMinutes = ttlMinutes;
    /** @type {Map<string, object>} */
    this.sessions = new Map();
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  createSession() {
    const id = crypto.randomUUID();
    const dir = path.join(this.tempRoot, id);
    const originalsDir = path.join(dir, 'originals');
    fs.mkdirSync(originalsDir, { recursive: true });

    const session = {
      id,
      dir,
      originalsDir,
      tracks: new Map(),
      order: [],
      createdAt: Date.now(),
      lastAccess: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  /** Resolve a session path safely, guarding against path traversal via a crafted id. */
  resolveSessionDir(id) {
    const dir = path.join(this.tempRoot, id);
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(this.tempRoot) + path.sep)) {
      return null;
    }
    return resolved;
  }

  getSession(id, { touch = true } = {}) {
    if (!id || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (touch) session.lastAccess = Date.now();
    return session;
  }

  getOrCreateSession(id) {
    if (id) {
      const existing = this.getSession(id);
      if (existing) return existing;
    }
    return this.createSession();
  }

  addTrack(sessionId, trackData) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.tracks.set(trackData.id, trackData);
    session.order.push(trackData.id);
    return trackData;
  }

  getTrack(sessionId, trackId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    return session.tracks.get(trackId) || null;
  }

  updateTrack(sessionId, trackId, mutator) {
    const track = this.getTrack(sessionId, trackId);
    if (!track) return null;
    mutator(track);
    track.updatedAt = Date.now();
    return track;
  }

  removeTrack(sessionId, trackId) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    const track = session.tracks.get(trackId);
    if (!track) return false;
    session.tracks.delete(trackId);
    session.order = session.order.filter((id) => id !== trackId);
    try {
      if (track.storedPath && fs.existsSync(track.storedPath)) {
        fs.unlinkSync(track.storedPath);
      }
    } catch (err) {
      logger.warn('Failed to remove track file', err.message);
    }
    return true;
  }

  getOrderedTracks(sessionId) {
    const session = this.getSession(sessionId, { touch: false });
    if (!session) return [];
    return session.order.map((id) => session.tracks.get(id)).filter(Boolean);
  }

  setOrder(sessionId, orderedIds) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    const validIds = orderedIds.filter((id) => session.tracks.has(id));
    // Any tracks missing from the supplied order (shouldn't normally happen)
    // are appended at the end so nothing is silently dropped.
    for (const id of session.order) {
      if (!validIds.includes(id)) validIds.push(id);
    }
    session.order = validIds;
    return true;
  }

  destroySession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      fs.rmSync(session.dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`Failed to remove temp dir for session ${id}:`, err.message);
    }
  }

  /** Deletes every session whose lastAccess is older than the configured TTL. */
  cleanupExpired() {
    const cutoff = Date.now() - this.ttlMinutes * 60 * 1000;
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.lastAccess < cutoff) {
        this.destroySession(id);
        count += 1;
      }
    }
    return count;
  }

  stats() {
    let trackCount = 0;
    for (const s of this.sessions.values()) trackCount += s.tracks.size;
    return { sessionCount: this.sessions.size, trackCount };
  }
}

module.exports = SessionManager;
