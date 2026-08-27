# 🔥 Demonic FLAC Studio

A dark, production-ready web application for editing FLAC metadata (Vorbis
comments) and embedded cover art — without ever re-encoding the audio.
Built for self-hosting on a Debian 12 server behind Nginx + HTTPS.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-informational)
![Express](https://img.shields.io/badge/Express-4.x-informational)
![No frameworks](https://img.shields.io/badge/frontend-vanilla%20JS-red)

---

## Table of contents

1. [What it does](#what-it-does)
2. [How FLAC metadata is edited safely](#how-flac-metadata-is-edited-safely)
3. [Project structure](#project-structure)
4. [Requirements](#requirements)
5. [Installation on Debian 12](#installation-on-debian-12)
6. [Configuration (`.env`)](#configuration-env)
7. [Running with PM2](#running-with-pm2)
8. [PM2 autostart on boot](#pm2-autostart-on-boot)
9. [Nginx reverse proxy](#nginx-reverse-proxy)
10. [HTTPS with Let's Encrypt / Certbot](#https-with-lets-encrypt--certbot)
11. [Using the app](#using-the-app)
12. [API overview](#api-overview)
13. [Security](#security)
14. [Temporary files & privacy](#temporary-files--privacy)
15. [Known limitations](#known-limitations)
16. [Troubleshooting](#troubleshooting)

---

## What it does

- Upload up to 30 FLAC files at once (drag & drop or file picker).
- Automatically reads existing Vorbis comment tags and embedded cover art.
- Edit standard tags (title, artist, album, album artist, track/disc
  numbers & totals, genre, date, comment) plus extended tags (composer,
  copyright, publisher, ISRC, BPM) and any other custom Vorbis comment
  field found in the file.
- View, replace, or remove embedded cover art (JPG/PNG).
- Reorder an album's tracklist by drag & drop, with automatic
  `TRACKNUMBER` renumbering; sort by track number, filename, title, or
  artist; renumber on demand.
- Batch-edit shared fields (album, album artist, genre, year, disc
  number/total, copyright, publisher, cover) across a multi-selection.
- **Album Mode**: set album-wide metadata once and apply it to every
  loaded track, with automatic `TRACKTOTAL` calculation.
- In-browser audio preview (the original, unmodified file — no
  transcoding) with play/pause, seek, and volume.
- Download a single forged FLAC, or the whole album as a
  `<Album Name>.zip`, with configurable filename schemes.
- Everything lives in a short-lived, in-memory session tied to a per-batch
  temp directory that is automatically wiped after 60 minutes (configurable).

## How FLAC metadata is edited safely

The app does **not** shell out to `metaflac`/`ffmpeg` and does **not**
decode or re-encode audio in any way. Instead, `src/services/flacMetadata.js`
implements a small, dependency-free FLAC container parser/writer:

- FLAC files are a `fLaC` marker, then a sequence of metadata blocks
  (`STREAMINFO`, `VORBIS_COMMENT`, `PICTURE`, `SEEKTABLE`, …), then the raw
  audio frames.
- On upload, the app parses the metadata blocks only, extracting tags,
  cover art, and stream info (sample rate/channels/bit depth/duration).
- On save/export, `STREAMINFO` and any `SEEKTABLE`/`CUESHEET`/`APPLICATION`
  blocks are copied through **byte-for-byte**, unmodified. Only the
  `VORBIS_COMMENT` and `PICTURE` blocks are regenerated from the current
  in-memory tag/cover state. The audio frame bytes after the metadata
  header are copied through **byte-for-byte**, unmodified.
- The result: edited files are bit-identical to the original in every way
  that affects audio quality — only the metadata header changes size/content.

This was chosen over shelling out to `metaflac` for three reasons: it
removes an entire class of command-injection risk (no process spawning
with user-influenced arguments at all), it removes a system-package
dependency for deployment, and it gives full, auditable control over
byte-for-byte audio preservation. If you would prefer to swap in
`metaflac` (`apt install flac`) for some reason, the parser/writer in
`src/services/flacMetadata.js` is the only file you'd need to replace —
the routes and session logic are agnostic to how metadata is produced.

## Project structure

```text
demonic-flac-studio/
├── src/
│   ├── server.js              # Express app bootstrap
│   ├── config.js              # Env-driven configuration
│   ├── routes/
│   │   ├── index.js           # Mounts all /api routes
│   │   ├── upload.js          # POST /api/upload
│   │   ├── tracks.js          # tag/cover/order/batch/album endpoints
│   │   └── export.js          # download / zip / audio-preview endpoints
│   ├── services/
│   │   ├── flacMetadata.js    # Pure-JS FLAC metadata parser/writer
│   │   ├── sessionManager.js  # In-memory session + temp-dir bookkeeping
│   │   ├── cleanupService.js  # Periodic expired-session sweep
│   │   ├── zipService.js      # Streaming ZIP export (archiver)
│   │   └── filenameService.js # Filename schemes + sanitization
│   ├── middleware/
│   │   ├── upload.js          # multer config (disk for FLAC, memory for covers)
│   │   ├── security.js        # helmet + rate limiting
│   │   └── errorHandler.js    # Central error handling, no leaked internals
│   └── utils/
│       ├── imageInfo.js       # JPEG/PNG magic-byte + dimension sniffing
│       ├── validators.js      # Input whitelisting/sanitization
│       ├── serialize.js       # Server → client track JSON shape
│       ├── sessionGuards.js   # Shared session/track lookup middleware
│       └── logger.js
├── public/
│   ├── index.html
│   ├── css/style.css          # Demonic dark theme
│   └── js/app.js              # Entire frontend (vanilla JS, no build step)
├── temp/                      # Per-session working directories (gitignored)
├── nginx/demonic-flac-studio.conf
├── ecosystem.config.js        # PM2 process config
├── package.json
├── .env.example
└── .gitignore
```

## Requirements

- Debian 12 ("bookworm") server (or compatible).
- Node.js ≥ 18 (Node 20/22 LTS recommended).
- npm.
- PM2 (installed globally via npm).
- Nginx.
- A domain/subdomain pointed at the server for HTTPS via Let's Encrypt.

No native/system FLAC tooling is required at runtime — metadata handling
is pure Node.js.

## Installation on Debian 12

```bash
# 1. System packages
sudo apt update
sudo apt install -y curl git build-essential

# 2. Node.js 20 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # verify >= 18

# 3. PM2 (process manager)
sudo npm install -g pm2

# 4. Nginx
sudo apt install -y nginx

# 5. Get the app onto the server
sudo mkdir -p /opt/demonic-flac-studio
sudo chown "$USER":"$USER" /opt/demonic-flac-studio
git clone <your-repo-url> /opt/demonic-flac-studio
cd /opt/demonic-flac-studio

# 6. Install dependencies
npm install --omit=dev

# 7. Configure environment
cp .env.example .env
nano .env   # adjust as needed (domain-specific values aren't needed here —
            # Nginx handles the domain; see below)

# 8. Create the runtime directories (git keeps them empty via .gitkeep)
mkdir -p temp logs
```

## Configuration (`.env`)

All options and their defaults are documented inline in
[`.env.example`](./.env.example). Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3008` | Port Node listens on (bind stays on 127.0.0.1) |
| `HOST` | `127.0.0.1` | Node never listens on a public interface directly |
| `MAX_FILE_SIZE_MB` | `150` | Max size per uploaded FLAC file |
| `MAX_COVER_SIZE_MB` | `15` | Max size per uploaded cover image |
| `MAX_FILES_PER_UPLOAD` | `30` | Max number of FLAC files per upload request |
| `SESSION_TTL_MINUTES` | `60` | How long an idle session's temp files survive |
| `CLEANUP_INTERVAL_MINUTES` | `5` | How often the expiry sweep runs |
| `TRUST_PROXY` | `true` in production behind Nginx | Needed for correct rate-limiting behind a reverse proxy |

## Running with PM2

```bash
cd /opt/demonic-flac-studio
pm2 start ecosystem.config.js
pm2 status
pm2 logs demonic-flac-studio
```

> **Why only 1 instance?** Session state (uploaded tracks, tag edits, in
> -progress cover art) lives in the Node process's memory by design — see
> [Temporary files & privacy](#temporary-files--privacy). Running this app
> in PM2 cluster mode or with more than one instance would split sessions
> across workers unpredictably. `ecosystem.config.js` is pinned to
> `instances: 1, exec_mode: 'fork'` — leave it that way.

Common commands:

```bash
pm2 restart demonic-flac-studio
pm2 stop demonic-flac-studio
pm2 delete demonic-flac-studio
pm2 monit
```

## PM2 autostart on boot

```bash
pm2 startup systemd
# PM2 prints a `sudo env PATH=... pm2 startup systemd -u <user> --hp <home>`
# command — copy/paste and run exactly that line.

pm2 save
```

From now on, `demonic-flac-studio` restarts automatically on server reboot
and after crashes (`autorestart: true` in `ecosystem.config.js`).

## Nginx reverse proxy

An example config is provided at
[`nginx/demonic-flac-studio.conf`](./nginx/demonic-flac-studio.conf).

```bash
sudo cp nginx/demonic-flac-studio.conf /etc/nginx/sites-available/demonic-flac-studio.conf
sudo nano /etc/nginx/sites-available/demonic-flac-studio.conf
# Replace YOUR_DOMAIN with your real subdomain, e.g. flac.example.com

sudo ln -s /etc/nginx/sites-available/demonic-flac-studio.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

At this point the app should be reachable at `http://YOUR_DOMAIN` (Node
itself stays bound to `127.0.0.1:3008` and is never exposed directly —
open only ports 80/443 on the server's firewall).

Notes baked into the example config:

- `client_max_body_size 4G;` — accommodates large multi-file FLAC album uploads.
- Generous `proxy_read_timeout`/`proxy_send_timeout` for big uploads and
  ZIP-album downloads on slower connections.
- No WebSocket functionality is used by this app; the `Upgrade`/`Connection`
  proxy headers are included only as harmless future-proofing.

## HTTPS with Let's Encrypt / Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d YOUR_DOMAIN
# Follow the prompts (email address, ToS agreement, and whether to
# redirect HTTP -> HTTPS — choose "redirect", option 2).
```

Certbot edits the Nginx server block in place to add the `listen 443 ssl;`
directive, certificate paths, and (if you chose redirect) an HTTP→HTTPS
redirect for port 80. Verify:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://YOUR_DOMAIN
```

Certbot installs a systemd timer for automatic renewal; verify it with:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

Node.js **never** needs its own TLS certificate — Nginx terminates HTTPS
and proxies plain HTTP to `127.0.0.1:3008`.

## Using the app

1. Open the site, drag 1–30 `.flac` files onto the glowing drop zone (or
   click **DATEIEN AUSWÄHLEN**).
2. Click a track in the left **Trackliste** to open its editor.
3. Edit fields on the right, add custom tags under "Weitere Tags" if
   needed, then click **SAVE METADATA** to forge the changes into memory.
4. Add/replace/remove cover art in the middle panel.
5. Drag tracks in the list to reorder them — track numbers renumber
   automatically. Use the sort dropdown for automatic ordering, and
   **TRACKNUMMERN NEU VERGEBEN** to renumber on demand (e.g. after
   sorting, which does not renumber by itself).
6. Select multiple tracks with the checkboxes and click
   **MASSENBEARBEITUNG** to apply shared fields/cover to just that
   selection, or use **ALBUM MODE** to apply album-wide fields (and an
   auto-computed `TOTALTRACKS`) to every loaded track at once.
7. Download a single track with **DOWNLOAD FLAC**, or the whole batch as
   a ZIP with **DOWNLOAD ALBUM**. Pick a filename scheme from the header
   dropdown first if you want something other than `01 - Titel.flac`.

Nothing is written to your account permanently — reloading the page after
the server restarts (or after the session's 60-minute TTL) starts fresh.

## API overview

All endpoints are namespaced under `/api`. Sessions are addressed by an
opaque UUID returned from the initial upload and stored in the browser's
`sessionStorage`.

| Method & path | Purpose |
|---|---|
| `POST /api/upload?sessionId=` | Upload one or more FLAC files (creates a session if none given) |
| `GET /api/session/:sid` | Full current state of a session |
| `PATCH /api/session/:sid/tracks/:tid` | Update a track's tags/extra tags |
| `DELETE /api/session/:sid/tracks/:tid` | Remove a track from the session |
| `POST /api/session/:sid/tracks/:tid/cover` | Upload/replace a track's cover |
| `DELETE /api/session/:sid/tracks/:tid/cover` | Remove a track's cover |
| `POST /api/session/:sid/batch/tags` | Apply tags to a selection of tracks |
| `POST /api/session/:sid/batch/cover` | Apply a cover to a selection of tracks |
| `POST /api/session/:sid/album` | Apply album-wide tags (+ auto `TRACKTOTAL`) to all tracks |
| `PUT /api/session/:sid/order` | Set track order (optionally renumbering) |
| `POST /api/session/:sid/renumber` | Renumber tracks by current order |
| `POST /api/session/:sid/sort` | Sort tracks by track number/filename/title/artist |
| `GET /api/session/:sid/tracks/:tid/download` | Download one forged FLAC |
| `GET /api/session/:sid/download-all` | Download the whole session as a ZIP |
| `GET /api/session/:sid/tracks/:tid/audio` | Stream the original audio (Range-enabled, for preview) |
| `GET /api/schemes` | Available filename schemes |
| `GET /api/health` | Liveness/stat probe |

## Security

- **Helmet** with a strict CSP (no inline scripts/styles — everything lives
  in external `.js`/`.css` files).
- **Rate limiting** (`express-rate-limit`) globally on `/api`, with a
  tighter limit specifically on `/api/upload`.
- **Extension + MIME + magic-byte validation**: uploads are checked by
  extension at the multer layer, and the actual bytes are always sniffed
  server-side afterwards (`fLaC` marker for audio; JPEG/PNG magic bytes
  for covers) — the client-declared MIME type is never trusted alone.
- **File size & count limits** enforced by multer (`MAX_FILE_SIZE_MB`,
  `MAX_COVER_SIZE_MB`, `MAX_FILES_PER_UPLOAD`).
- **No path traversal**: uploaded files are always stored on disk under a
  server-generated random UUID filename inside a server-generated session
  directory; the user-supplied original filename is only ever used inside
  response headers (`Content-Disposition`) or ZIP entry names, run through
  a character whitelist/sanitizer first.
- **No code execution of uploaded content, ever** — files are only read as
  byte buffers by our own parser; nothing is passed to a shell, `exec`,
  `spawn`, or any interpreter.
- **Central error handling** that never leaks stack traces or filesystem
  paths to the client; all internals are logged server-side only (captured
  by PM2's log files).
- **Single-process, in-memory sessions** with no database, minimizing the
  amount of persistent attack surface.

## Temporary files & privacy

- Each upload batch gets its own directory: `temp/<random-uuid>/originals/`.
- Only the original, unmodified FLAC bytes are ever written to disk.
  Tags, extra tags, and cover art bytes live in server memory as part of
  the session object; a forged/export copy of a FLAC is only ever built
  transiently in memory when you click download (single or ZIP) and is
  never itself persisted to disk.
- A background sweep (`CLEANUP_INTERVAL_MINUTES`, default every 5 minutes)
  deletes any session whose last activity is older than
  `SESSION_TTL_MINUTES` (default 60 minutes) — its temp directory and all
  in-memory state (tags, extra tags, cover bytes) are removed completely.
- Restarting the Node process also clears all in-memory session state
  immediately (temp directories from still-active sessions are cleaned up
  by the next scheduled sweep after restart, or you can `rm -rf temp/*`
  manually).

## Known limitations

- If a source FLAC contains more than one `PICTURE` block, only the first
  is surfaced/edited; on save, the file ends up with at most one embedded
  picture (the current front cover). This matches the single-cover
  workflow described in the spec and avoids the complexity of a
  multi-picture editor.
- Session state is in-process memory — see the PM2 section above for why
  this must stay a single instance, and don't expect sessions to survive
  a server/process restart.
- `TRACKTOTAL`/`DISCTOTAL` are written using those canonical field names;
  legacy aliases (`TOTALTRACKS`, `TOTALDISCS`, `ALBUM ARTIST`, `YEAR`,
  `ORGANIZATION`) are recognized on read and normalized on write.

## Troubleshooting

- **App won't start / port already in use**: `sudo lsof -i :3008` to find
  the conflicting process, or change `PORT` in `.env`.
- **502 Bad Gateway from Nginx**: confirm the app is running
  (`pm2 status`) and listening on `127.0.0.1:3008` (`curl http://127.0.0.1:3008/api/health`).
- **Uploads fail with 413**: raise `client_max_body_size` in the Nginx
  config and/or `MAX_FILE_SIZE_MB` in `.env`, then reload Nginx and
  restart the app.
- **"Session not found or expired"**: the session's 60-minute TTL (or a
  server restart) has passed — start a new upload.
- **Certbot renewal fails**: ensure port 80 is reachable from the internet
  (HTTP-01 challenge) and that no other server block intercepts
  `/.well-known/acme-challenge/`.
