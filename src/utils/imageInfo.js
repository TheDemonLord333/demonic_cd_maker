'use strict';

/**
 * Minimal, dependency-free image sniffing: verifies magic bytes and
 * extracts pixel dimensions for JPEG and PNG. Used to validate uploaded
 * cover art and to populate the FLAC PICTURE block's width/height fields.
 */

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function getPngSize(buffer) {
  try {
    if (buffer.length < 24) return { width: 0, height: 0 };
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function getJpegSize(buffer) {
  try {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break; // EOI or start of scan
      const segLen = buffer.readUInt16BE(offset + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + segLen;
    }
  } catch {
    // fall through
  }
  return { width: 0, height: 0 };
}

/**
 * Validates that `buffer` is really a JPEG or PNG (checked by magic bytes,
 * never by trusting the client-supplied MIME type or file extension) and
 * returns { mime, width, height } or null if it isn't recognized.
 */
function inspectImage(buffer) {
  const mime = detectImageType(buffer);
  if (!mime) return null;
  const { width, height } = mime === 'image/png' ? getPngSize(buffer) : getJpegSize(buffer);
  return { mime, width, height };
}

module.exports = { inspectImage, detectImageType };
