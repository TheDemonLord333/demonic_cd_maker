'use strict';

/** Filename schemes offered in the UI, keyed by id. */
const SCHEMES = {
  'num-title': { label: '01 - Titel.flac', example: '01 - Titel.flac' },
  'num-artist-title': { label: '01 - Künstler - Titel.flac', example: '01 - Künstler - Titel.flac' },
  'artist-title': { label: 'Künstler - Titel.flac', example: 'Künstler - Titel.flac' },
  'tracknum-title': { label: 'Tracknummer - Titel.flac', example: 'Tracknummer - Titel.flac' },
};

const DEFAULT_SCHEME = 'num-title';

/**
 * Strip characters that are illegal (or awkward) in Windows/Linux/macOS
 * filenames, collapse whitespace, and cap the length. Never trust this
 * output as a filesystem path segment on its own (it is only ever used
 * inside a Content-Disposition header or an in-memory zip entry name) —
 * actual on-disk file names are always server-generated UUIDs.
 */
function sanitizeFilenamePart(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function pad2(n) {
  const s = String(parseInt(n, 10) || 0);
  return s.padStart(2, '0');
}

function buildTrackFilename(track, scheme, fallbackIndex) {
  const title = sanitizeFilenamePart(track.tags.TITLE) || sanitizeFilenamePart(track.originalBaseName) || 'Untitled';
  const artist = sanitizeFilenamePart(track.tags.ARTIST) || 'Unknown Artist';
  const rawNum = track.tags.TRACKNUMBER ? String(parseInt(track.tags.TRACKNUMBER, 10) || track.tags.TRACKNUMBER) : String(fallbackIndex + 1);
  const paddedNum = pad2(track.tags.TRACKNUMBER || fallbackIndex + 1);

  let base;
  switch (scheme) {
    case 'num-artist-title':
      base = `${paddedNum} - ${artist} - ${title}`;
      break;
    case 'artist-title':
      base = `${artist} - ${title}`;
      break;
    case 'tracknum-title':
      base = `${rawNum} - ${title}`;
      break;
    case 'num-title':
    default:
      base = `${paddedNum} - ${title}`;
      break;
  }
  const safe = sanitizeFilenamePart(base) || 'track';
  return `${safe}.flac`;
}

/** Ensures uniqueness within a batch (e.g. two tracks resolving to the same name). */
function buildUniqueFilenames(tracks, scheme) {
  const used = new Map();
  return tracks.map((track, index) => {
    let name = buildTrackFilename(track, scheme, index);
    if (used.has(name)) {
      const count = used.get(name) + 1;
      used.set(name, count);
      name = name.replace(/\.flac$/i, ` (${count}).flac`);
    } else {
      used.set(name, 0);
    }
    return name;
  });
}

module.exports = {
  SCHEMES,
  DEFAULT_SCHEME,
  sanitizeFilenamePart,
  buildTrackFilename,
  buildUniqueFilenames,
};
