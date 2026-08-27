'use strict';

const { KNOWN_FIELDS } = require('../services/flacMetadata');

const MAX_TAG_VALUE_LENGTH = 2000;

/**
 * Whitelist-filters and length-caps a partial tags object coming from the
 * client. Unknown keys are dropped (extra/custom tags go through the
 * separate `extraTags` path with their own validation).
 */
function sanitizeTagsInput(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const field of KNOWN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      let value = input[field];
      if (value === null || value === undefined) value = '';
      value = String(value).replace(/[\r\n]+/g, ' ').slice(0, MAX_TAG_VALUE_LENGTH);
      out[field] = value;
    }
  }
  return out;
}

function sanitizeExtraTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || '').trim().replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 64).toUpperCase();
    if (!key) continue;
    const value = String(item.value ?? '').replace(/[\r\n]+/g, ' ').slice(0, MAX_TAG_VALUE_LENGTH);
    out.push({ key, value });
  }
  return out;
}

const ALLOWED_SORT_KEYS = new Set(['trackNumber', 'filename', 'title', 'artist']);
const ALLOWED_SCHEMES = new Set(['num-title', 'num-artist-title', 'artist-title', 'tracknum-title']);

module.exports = {
  sanitizeTagsInput,
  sanitizeExtraTags,
  ALLOWED_SORT_KEYS,
  ALLOWED_SCHEMES,
};
