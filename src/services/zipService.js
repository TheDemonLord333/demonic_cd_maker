'use strict';

const archiver = require('archiver');

/**
 * Streams a ZIP archive of { name, buffer } entries directly to an HTTP
 * response. Nothing is written to disk for the archive itself.
 */
function streamZip(res, zipFilename, entries) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    // Headers are likely already sent; destroy the connection rather than
    // trying to send a JSON error body mid-stream.
    res.destroy(err);
  });
  archive.pipe(res);

  for (const entry of entries) {
    archive.append(entry.buffer, { name: entry.name });
  }

  return archive.finalize();
}

module.exports = { streamZip };
