'use strict';

/**
 * Pure Node.js FLAC metadata reader / writer.
 *
 * Why not shell out to `metaflac`? A hand-rolled parser lets us:
 *   - never spawn a process or touch a shell with user-controlled input,
 *   - guarantee byte-for-byte preservation of the audio frames (we only
 *     ever rebuild the metadata blocks that precede them),
 *   - run identically on any Debian box with nothing but Node.js installed.
 *
 * The FLAC format (https://xiph.org/flac/format.html) starts with the
 * 4-byte marker "fLaC", followed by one or more METADATA_BLOCKs, followed
 * by the audio frames. Every block starts with a 4-byte header:
 *   bit 0 (MSB)   : last-metadata-block flag
 *   bits 1-7      : block type (0 STREAMINFO, 1 PADDING, 2 APPLICATION,
 *                   3 SEEKTABLE, 4 VORBIS_COMMENT, 5 CUESHEET, 6 PICTURE)
 *   bits 8-31     : block length in bytes (big-endian, not counting header)
 *
 * We only ever regenerate the VORBIS_COMMENT and PICTURE blocks. Every
 * other block (STREAMINFO, SEEKTABLE, CUESHEET, APPLICATION) is copied
 * through unmodified, and the audio frame data is copied byte-for-byte,
 * so no re-encoding of any kind ever occurs.
 */

const FLAC_MARKER = Buffer.from('fLaC', 'ascii');

const BLOCK_TYPE = {
  STREAMINFO: 0,
  PADDING: 1,
  APPLICATION: 2,
  SEEKTABLE: 3,
  VORBIS_COMMENT: 4,
  CUESHEET: 5,
  PICTURE: 6,
};

const DEFAULT_VENDOR = 'reference libFLAC (Demonic FLAC Studio)';

/** Known, canonical Vorbis comment field names surfaced in the UI. */
const KNOWN_FIELDS = [
  'TITLE',
  'ARTIST',
  'ALBUM',
  'ALBUMARTIST',
  'TRACKNUMBER',
  'TRACKTOTAL',
  'DISCNUMBER',
  'DISCTOTAL',
  'GENRE',
  'DATE',
  'COMMENT',
  'COMPOSER',
  'COPYRIGHT',
  'PUBLISHER',
  'ISRC',
  'BPM',
];

/** Alternate/legacy spellings seen in the wild, mapped to our canonical key. */
const FIELD_ALIASES = {
  ALBUM_ARTIST: 'ALBUMARTIST',
  'ALBUM ARTIST': 'ALBUMARTIST',
  TOTALTRACKS: 'TRACKTOTAL',
  TRACKC: 'TRACKTOTAL',
  TOTALDISCS: 'DISCTOTAL',
  DISCC: 'DISCTOTAL',
  ORGANIZATION: 'PUBLISHER',
  LABEL: 'PUBLISHER',
  YEAR: 'DATE',
};

class FlacParseError extends Error {}

function isFlacFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(FLAC_MARKER);
}

/**
 * Parse a FLAC buffer and return structured metadata plus enough
 * bookkeeping to reconstruct the file later.
 */
function parseFlac(buffer) {
  if (!isFlacFile(buffer)) {
    throw new FlacParseError('Not a valid FLAC file (missing fLaC marker)');
  }

  let offset = 4;
  let streamInfoRaw = null;
  const passthroughBlocks = []; // { type, data } for APPLICATION / SEEKTABLE / CUESHEET
  let vorbisComment = null; // { vendor, tags: Map<string,string[]> }
  let picture = null; // first PICTURE block found
  let sawLast = false;

  while (!sawLast) {
    if (offset + 4 > buffer.length) {
      throw new FlacParseError('Truncated FLAC metadata (unexpected end of file)');
    }
    const headerByte = buffer[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) {
      throw new FlacParseError('Truncated FLAC metadata block');
    }
    const data = buffer.subarray(dataStart, dataEnd);

    switch (blockType) {
      case BLOCK_TYPE.STREAMINFO:
        streamInfoRaw = Buffer.from(data);
        break;
      case BLOCK_TYPE.VORBIS_COMMENT:
        if (!vorbisComment) vorbisComment = parseVorbisComment(data);
        break;
      case BLOCK_TYPE.PICTURE:
        if (!picture) {
          try {
            picture = parsePicture(data);
          } catch (e) {
            // Corrupt/odd picture block: ignore rather than fail the whole file.
            picture = null;
          }
        }
        break;
      case BLOCK_TYPE.PADDING:
        // Dropped; we regenerate our own padding block on write.
        break;
      case BLOCK_TYPE.APPLICATION:
      case BLOCK_TYPE.SEEKTABLE:
      case BLOCK_TYPE.CUESHEET:
        passthroughBlocks.push({ type: blockType, data: Buffer.from(data) });
        break;
      default:
        // Unknown/reserved block type: preserve it verbatim to avoid data loss.
        passthroughBlocks.push({ type: blockType, data: Buffer.from(data) });
        break;
    }

    offset = dataEnd;
    sawLast = isLast;
  }

  if (!streamInfoRaw) {
    throw new FlacParseError('Missing STREAMINFO block');
  }

  const audioStart = offset;
  const streamInfo = parseStreamInfo(streamInfoRaw);

  if (!vorbisComment) {
    vorbisComment = { vendor: DEFAULT_VENDOR, tags: new Map() };
  }

  return {
    streamInfoRaw,
    streamInfo,
    passthroughBlocks,
    vorbisComment,
    picture,
    audioStart,
  };
}

function parseStreamInfo(data) {
  if (data.length < 34) {
    return { sampleRate: 0, channels: 0, bitsPerSample: 0, totalSamples: 0, durationSeconds: 0 };
  }
  const packed = data.readBigUInt64BE(10);
  const sampleRate = Number((packed >> 44n) & 0xfffffn);
  const channels = Number((packed >> 41n) & 0x7n) + 1;
  const bitsPerSample = Number((packed >> 36n) & 0x1fn) + 1;
  const totalSamples = Number(packed & 0xfffffffffn);
  const durationSeconds = sampleRate > 0 ? totalSamples / sampleRate : 0;
  return { sampleRate, channels, bitsPerSample, totalSamples, durationSeconds };
}

function normalizeFieldName(key) {
  const upper = key.toUpperCase();
  return FIELD_ALIASES[upper] || upper;
}

function parseVorbisComment(data) {
  let pos = 0;
  const readU32 = () => {
    const v = data.readUInt32LE(pos);
    pos += 4;
    return v;
  };
  const vendorLen = readU32();
  const vendor = data.subarray(pos, pos + vendorLen).toString('utf8');
  pos += vendorLen;
  const count = readU32();
  const tags = new Map(); // normalizedKey -> [{ key(original casing), value }]
  for (let i = 0; i < count; i++) {
    if (pos + 4 > data.length) break;
    const len = readU32();
    const raw = data.subarray(pos, pos + len).toString('utf8');
    pos += len;
    const eq = raw.indexOf('=');
    if (eq === -1) continue;
    const originalKey = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    const normalized = normalizeFieldName(originalKey);
    if (!tags.has(normalized)) tags.set(normalized, []);
    tags.get(normalized).push({ key: originalKey, value });
  }
  return { vendor, tags };
}

function parsePicture(data) {
  let pos = 0;
  const readU32 = () => {
    const v = data.readUInt32BE(pos);
    pos += 4;
    return v;
  };
  const pictureType = readU32();
  const mimeLen = readU32();
  const mime = data.subarray(pos, pos + mimeLen).toString('ascii');
  pos += mimeLen;
  const descLen = readU32();
  const description = data.subarray(pos, pos + descLen).toString('utf8');
  pos += descLen;
  const width = readU32();
  const height = readU32();
  const depth = readU32();
  const colors = readU32();
  const dataLen = readU32();
  const imageData = Buffer.from(data.subarray(pos, pos + dataLen));
  return { pictureType, mime, description, width, height, depth, colors, data: imageData };
}

/**
 * Build a Vorbis comment map (normalized-key -> string value) plus a list
 * of extra/unrecognized tags from a parsed vorbisComment structure.
 * Multiple values for the same key are joined with "; " for display.
 */
function toDisplayTags(vorbisComment) {
  const known = {};
  const extra = [];
  for (const field of KNOWN_FIELDS) known[field] = '';

  for (const [normalizedKey, entries] of vorbisComment.tags.entries()) {
    const joined = entries.map((e) => e.value).join('; ');
    if (KNOWN_FIELDS.includes(normalizedKey)) {
      known[normalizedKey] = joined;
    } else {
      extra.push({ key: entries[0].key || normalizedKey, value: joined });
    }
  }
  return { tags: known, extraTags: extra };
}

// ---- Writing --------------------------------------------------------

function encodeBlockHeader(type, length, isLast) {
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0x00) | (type & 0x7f);
  header.writeUIntBE(length & 0xffffff, 1, 3);
  return header;
}

function buildVorbisCommentBlock(vendor, tagList) {
  const vendorBuf = Buffer.from(vendor || DEFAULT_VENDOR, 'utf8');
  const parts = [];
  const vendorLenBuf = Buffer.alloc(4);
  vendorLenBuf.writeUInt32LE(vendorBuf.length, 0);
  parts.push(vendorLenBuf, vendorBuf);

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(tagList.length, 0);
  parts.push(countBuf);

  for (const { key, value } of tagList) {
    const entry = Buffer.from(`${key}=${value}`, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(entry.length, 0);
    parts.push(lenBuf, entry);
  }

  const data = Buffer.concat(parts);
  return Buffer.concat([encodeBlockHeader(BLOCK_TYPE.VORBIS_COMMENT, data.length, false), data]);
}

function buildPictureBlock(picture) {
  const mimeBuf = Buffer.from(picture.mime || 'image/jpeg', 'ascii');
  const descBuf = Buffer.from(picture.description || '', 'utf8');
  const header = Buffer.alloc(4 * 8);
  let o = 0;
  header.writeUInt32BE(picture.pictureType != null ? picture.pictureType : 3, o); o += 4;
  header.writeUInt32BE(mimeBuf.length, o); o += 4;
  // mime string spliced in below; write placeholder length for description after mime
  const parts = [header.subarray(0, 8), mimeBuf];
  const descLenBuf = Buffer.alloc(4);
  descLenBuf.writeUInt32BE(descBuf.length, 0);
  parts.push(descLenBuf, descBuf);

  const rest = Buffer.alloc(4 * 5);
  let r = 0;
  rest.writeUInt32BE(picture.width || 0, r); r += 4;
  rest.writeUInt32BE(picture.height || 0, r); r += 4;
  rest.writeUInt32BE(picture.depth || 24, r); r += 4;
  rest.writeUInt32BE(picture.colors || 0, r); r += 4;
  rest.writeUInt32BE(picture.data.length, r); r += 4;
  parts.push(rest, picture.data);

  const data = Buffer.concat(parts);
  return Buffer.concat([encodeBlockHeader(BLOCK_TYPE.PICTURE, data.length, false), data]);
}

function buildPaddingBlock(length) {
  const data = Buffer.alloc(length);
  return Buffer.concat([encodeBlockHeader(BLOCK_TYPE.PADDING, length, true), data]);
}

/**
 * Rebuild a complete FLAC buffer from parsed structure + new tags/picture.
 * `tagList` is an ordered array of { key, value } strings that become the
 * VORBIS_COMMENT block. Audio frame bytes are copied through untouched.
 */
function writeFlac(originalBuffer, parsed, { vendor, tagList, picture }) {
  const blocks = [];

  // STREAMINFO must be first, and copied through byte-for-byte.
  blocks.push(Buffer.concat([
    encodeBlockHeader(BLOCK_TYPE.STREAMINFO, parsed.streamInfoRaw.length, false),
    parsed.streamInfoRaw,
  ]));

  for (const block of parsed.passthroughBlocks) {
    blocks.push(Buffer.concat([encodeBlockHeader(block.type, block.data.length, false), block.data]));
  }

  blocks.push(buildVorbisCommentBlock(vendor, tagList));

  if (picture) {
    blocks.push(buildPictureBlock(picture));
  }

  // Small padding block for future edits by other tools; also lets us
  // mark the true last block cleanly.
  const PADDING_SIZE = 1024;
  const metadataSoFar = Buffer.concat(blocks);
  const lastBlock = buildPaddingBlock(PADDING_SIZE);

  const audioData = originalBuffer.subarray(parsed.audioStart);

  return Buffer.concat([FLAC_MARKER, metadataSoFar, lastBlock, audioData]);
}

/**
 * High-level helper: given the original file buffer and a "track" model
 * ({ tags: {KNOWN_FIELD: value}, extraTags: [{key,value}], picture }),
 * produce the exported FLAC buffer with updated metadata and unmodified
 * audio.
 */
function exportFlac(originalBuffer, parsed, trackState) {
  const tagList = [];
  for (const field of KNOWN_FIELDS) {
    const value = trackState.tags[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      tagList.push({ key: field, value: String(value) });
    }
  }
  for (const extra of trackState.extraTags || []) {
    if (extra.key && extra.value !== undefined && extra.value !== null && String(extra.value).trim() !== '') {
      tagList.push({ key: extra.key, value: String(extra.value) });
    }
  }

  let picture = null;
  if (trackState.picture) {
    picture = {
      pictureType: 3,
      mime: trackState.picture.mime,
      description: trackState.picture.description || 'Cover',
      width: trackState.picture.width || 0,
      height: trackState.picture.height || 0,
      depth: trackState.picture.depth || 24,
      colors: 0,
      data: trackState.picture.data,
    };
  }

  return writeFlac(originalBuffer, parsed, {
    vendor: trackState.vendor || DEFAULT_VENDOR,
    tagList,
    picture,
  });
}

module.exports = {
  FlacParseError,
  isFlacFile,
  parseFlac,
  toDisplayTags,
  exportFlac,
  KNOWN_FIELDS,
  DEFAULT_VENDOR,
};
