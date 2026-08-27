'use strict';

/* ==========================================================================
   Demonic FLAC Studio — frontend application (vanilla JS, no build step)
   ========================================================================== */

const KNOWN_FIELDS = [
  'TITLE', 'ARTIST', 'ALBUM', 'ALBUMARTIST', 'TRACKNUMBER', 'TRACKTOTAL',
  'DISCNUMBER', 'DISCTOTAL', 'GENRE', 'DATE', 'COMMENT', 'COMPOSER',
  'COPYRIGHT', 'PUBLISHER', 'ISRC', 'BPM',
];

const BATCH_FIELDS = [
  { field: 'ALBUM', label: 'Album' },
  { field: 'ALBUMARTIST', label: 'Album-Künstler' },
  { field: 'GENRE', label: 'Genre' },
  { field: 'DATE', label: 'Jahr / Datum' },
  { field: 'DISCNUMBER', label: 'Discnummer' },
  { field: 'DISCTOTAL', label: 'Anzahl Discs' },
  { field: 'COPYRIGHT', label: 'Copyright' },
  { field: 'PUBLISHER', label: 'Publisher' },
];

const ALBUM_FIELDS = [
  { field: 'ALBUM', label: 'Album' },
  { field: 'ALBUMARTIST', label: 'Album-Künstler' },
  { field: 'DATE', label: 'Jahr / Datum' },
  { field: 'GENRE', label: 'Genre' },
  { field: 'DISCNUMBER', label: 'Discnummer' },
];

const state = {
  sessionId: sessionStorage.getItem('demonic_session_id') || null,
  tracks: [],
  activeTrackId: null,
  selected: new Set(),
  scheme: 'num-title',
  batchCoverFile: null,
  albumCoverFile: null,
  seeking: false,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const heroDropzone = $('hero-dropzone');
const heroDropzoneInner = $('hero-dropzone-inner');
const studioGrid = $('studio-grid');
const trackListEl = $('track-list');
const fileInput = $('file-input');
const coverInput = $('cover-input');
const batchCoverInput = $('batch-cover-input');
const toastContainer = $('toast-container');
const progressOverlay = $('progress-overlay');
const progressLabel = $('progress-label');
const progressFill = $('progress-fill');
const progressPercent = $('progress-percent');
const tracklistPanel = document.querySelector('.tracklist-panel');

const audioEl = $('audio-el');

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function apiJson(path, method, payload) {
  return api(path, { method, body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function toast(message, type = 'info', timeout = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

// ---------------------------------------------------------------------------
// Progress overlay
// ---------------------------------------------------------------------------

function showProgress(label) {
  progressLabel.textContent = label;
  progressFill.style.width = '0%';
  progressPercent.textContent = '';
  progressOverlay.classList.remove('hidden');
}

function updateProgress(percent) {
  progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
}

function hideProgress() {
  progressOverlay.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes;
  let i = -1;
  do {
    val /= 1024;
    i += 1;
  } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Session / track state helpers
// ---------------------------------------------------------------------------

function persistSessionId(id) {
  state.sessionId = id;
  sessionStorage.setItem('demonic_session_id', id);
}

function getTrack(id) {
  return state.tracks.find((t) => t.id === id) || null;
}

function replaceTracksFromSession(payload) {
  state.tracks = payload.tracks;
  if (state.activeTrackId && !getTrack(state.activeTrackId)) {
    state.activeTrackId = state.tracks.length ? state.tracks[0].id : null;
  }
  if (!state.activeTrackId && state.tracks.length) {
    state.activeTrackId = state.tracks[0].id;
  }
  // Drop selections for tracks that no longer exist.
  for (const id of [...state.selected]) {
    if (!getTrack(id)) state.selected.delete(id);
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Upload / drag & drop
// ---------------------------------------------------------------------------

function isFlacFile(file) {
  return /\.flac$/i.test(file.name);
}

function uploadFiles(fileList) {
  const files = Array.from(fileList).filter(isFlacFile);
  const rejected = fileList.length - files.length;
  if (rejected > 0) {
    toast(`${rejected} Datei(en) übersprungen — nur .flac wird akzeptiert`, 'error');
  }
  if (files.length === 0) return;

  const form = new FormData();
  for (const f of files) form.append('files', f);

  showProgress('Uploading...');

  const xhr = new XMLHttpRequest();
  const query = state.sessionId ? `?sessionId=${encodeURIComponent(state.sessionId)}` : '';
  xhr.open('POST', `/api/upload${query}`);

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) updateProgress((e.loaded / e.total) * 100);
  });

  xhr.onload = () => {
    hideProgress();
    let body;
    try {
      body = JSON.parse(xhr.responseText);
    } catch {
      toast('Upload failed', 'error');
      return;
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      toast(body.error || 'Upload failed', 'error');
      return;
    }
    persistSessionId(body.sessionId);
    if (body.errors && body.errors.length) {
      for (const e of body.errors) {
        toast(`${e.filename}: ${e.error}`, 'error');
      }
    }
    if (body.addedTracks.length) {
      toast(`${body.addedTracks.length} Track(s) erfolgreich hinzugefügt`, 'success');
    }
    refreshSession();
  };

  xhr.onerror = () => {
    hideProgress();
    toast('Upload failed — network error', 'error');
  };

  xhr.send(form);
}

function wireDropzone(el, options = {}) {
  let dragCounter = 0;
  el.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter += 1;
    el.classList.add('drag-active');
  });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter -= 1;
    if (dragCounter <= 0) {
      dragCounter = 0;
      el.classList.remove('drag-active');
    }
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    el.classList.remove('drag-active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });
  if (options.click) {
    el.addEventListener('click', (e) => {
      if (options.excludeSelector && e.target.closest(options.excludeSelector)) return;
      fileInput.click();
    });
  }
}

wireDropzone(heroDropzone);
wireDropzone(tracklistPanel);

$('btn-select-files').addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
$('btn-add-more').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFiles(fileInput.files);
  fileInput.value = '';
});

async function refreshSession() {
  if (!state.sessionId) return;
  try {
    const payload = await api(`/session/${state.sessionId}`);
    replaceTracksFromSession(payload);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll() {
  const hasTracks = state.tracks.length > 0;
  heroDropzone.classList.toggle('hidden', hasTracks);
  studioGrid.classList.toggle('hidden', !hasTracks);
  $('btn-download-all').disabled = !hasTracks;

  renderTrackList();
  renderEditorFor(state.activeTrackId ? getTrack(state.activeTrackId) : null);
}

function renderTrackList() {
  trackListEl.innerHTML = '';
  state.tracks.forEach((track, index) => {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.draggable = true;
    li.dataset.id = track.id;
    if (track.id === state.activeTrackId) li.classList.add('active');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(track.id);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(track.id);
      else state.selected.delete(track.id);
      updateSelectionUI();
    });

    const num = document.createElement('span');
    num.className = 'track-num';
    num.textContent = track.tags.TRACKNUMBER ? String(parseInt(track.tags.TRACKNUMBER, 10) || track.tags.TRACKNUMBER).padStart(2, '0') : String(index + 1).padStart(2, '0');

    const info = document.createElement('div');
    info.className = 'track-info';
    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = track.tags.TITLE || track.originalFilename;
    const artist = document.createElement('div');
    artist.className = 'track-artist';
    artist.textContent = track.tags.ARTIST || '';
    info.append(title, artist);

    const del = document.createElement('button');
    del.className = 'track-delete';
    del.type = 'button';
    del.innerHTML = '&times;';
    del.title = 'Track entfernen';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTrack(track.id);
    });

    li.append(checkbox, num, info, del);
    li.addEventListener('click', () => selectTrack(track.id));

    wireDragSort(li);

    trackListEl.appendChild(li);
  });
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selected.size;
  $('selection-count').textContent = count > 0 ? `${count} ausgewählt` : '';
  $('btn-batch-edit').disabled = count === 0;
  $('select-all').checked = count > 0 && count === state.tracks.length;
}

$('select-all').addEventListener('change', () => {
  if ($('select-all').checked) {
    state.tracks.forEach((t) => state.selected.add(t.id));
  } else {
    state.selected.clear();
  }
  renderTrackList();
});

function selectTrack(id) {
  state.activeTrackId = id;
  document.querySelectorAll('.track-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  renderEditorFor(getTrack(id));
}

function deleteTrack(id) {
  if (!confirm('Diesen Track aus der Sitzung entfernen?')) return;
  api(`/session/${state.sessionId}/tracks/${id}`, { method: 'DELETE' })
    .then(() => {
      state.selected.delete(id);
      refreshSession();
    })
    .catch((err) => toast(err.message, 'error'));
}

// ---------------------------------------------------------------------------
// Drag & drop reordering
// ---------------------------------------------------------------------------

let draggedId = null;

function wireDragSort(li) {
  li.addEventListener('dragstart', (e) => {
    draggedId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.track-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  });

  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedId || draggedId === li.dataset.id) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    document.querySelectorAll('.track-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    li.classList.add(before ? 'drop-before' : 'drop-after');
  });

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetId = li.dataset.id;
    document.querySelectorAll('.track-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    if (!draggedId || draggedId === targetId) return;

    const rect = li.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;

    const ids = state.tracks.map((t) => t.id);
    const fromIndex = ids.indexOf(draggedId);
    ids.splice(fromIndex, 1);
    let toIndex = ids.indexOf(targetId);
    if (!before) toIndex += 1;
    ids.splice(toIndex, 0, draggedId);

    applyOrder(ids, true);
    draggedId = null;
  });
}

async function applyOrder(orderedIds, renumber) {
  try {
    const payload = await apiJson(`/session/${state.sessionId}/order`, 'PUT', { order: orderedIds, renumber });
    replaceTracksFromSession(payload);
    if (renumber) toast('Reihenfolge & Tracknummern aktualisiert', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Sort dropdown
$('sort-select').addEventListener('change', async (e) => {
  const by = e.target.value;
  if (by === 'manual') return;
  try {
    const payload = await apiJson(`/session/${state.sessionId}/sort`, 'POST', { by });
    replaceTracksFromSession(payload);
    toast('Trackliste sortiert', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-renumber').addEventListener('click', async () => {
  try {
    const payload = await apiJson(`/session/${state.sessionId}/renumber`, 'POST', {});
    replaceTracksFromSession(payload);
    toast('Tracknummern neu vergeben', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editorForm = $('editor-form');
const coverImage = $('cover-image');
const coverPlaceholder = $('cover-placeholder');
const coverFrame = $('cover-frame');

function renderEditorFor(track) {
  const enabled = Boolean(track);
  editorForm.querySelectorAll('input, textarea').forEach((el) => {
    el.disabled = !enabled;
  });
  $('btn-save').disabled = !enabled;
  $('btn-download-track').disabled = !enabled;
  $('btn-add-cover').disabled = !enabled;
  $('btn-remove-cover').disabled = !enabled || !(track && track.cover);
  $('btn-add-extra').disabled = !enabled;

  if (!track) {
    $('now-editing-title').textContent = 'Kein Track ausgewählt';
    KNOWN_FIELDS.forEach((f) => setFieldValue(f, ''));
    $('extra-tags-list').innerHTML = '';
    coverImage.classList.add('hidden');
    coverPlaceholder.classList.remove('hidden');
    resetAudioInfo();
    audioEl.removeAttribute('src');
    return;
  }

  $('now-editing-title').textContent = `${track.tags.TITLE || track.originalFilename}${track.tags.ARTIST ? ' — ' + track.tags.ARTIST : ''}`;

  KNOWN_FIELDS.forEach((f) => setFieldValue(f, track.tags[f] || ''));
  renderExtraTags(track.extraTags || []);

  if (track.cover) {
    coverImage.src = track.cover.dataUrl;
    coverImage.classList.remove('hidden');
    coverPlaceholder.classList.add('hidden');
  } else {
    coverImage.classList.add('hidden');
    coverPlaceholder.classList.remove('hidden');
  }

  renderAudioInfo(track);
  audioEl.src = `/api/session/${state.sessionId}/tracks/${track.id}/audio`;
  resetPlayerUI();
}

function setFieldValue(field, value) {
  const el = editorForm.querySelector(`[data-field="${field}"]`);
  if (el) el.value = value;
}

function getFieldValue(field) {
  const el = editorForm.querySelector(`[data-field="${field}"]`);
  return el ? el.value : '';
}

function renderExtraTags(extraTags) {
  const list = $('extra-tags-list');
  list.innerHTML = '';
  extraTags.forEach((tag) => addExtraTagRow(tag.key, tag.value));
}

function addExtraTagRow(key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'extra-tag-row';
  const keyInput = document.createElement('input');
  keyInput.placeholder = 'FELDNAME';
  keyInput.value = key;
  const valInput = document.createElement('input');
  valInput.placeholder = 'Wert';
  valInput.value = value;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-extra';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => row.remove());
  row.append(keyInput, valInput, removeBtn);
  $('extra-tags-list').appendChild(row);
}

$('btn-add-extra').addEventListener('click', () => addExtraTagRow());

function collectExtraTags() {
  return Array.from($('extra-tags-list').querySelectorAll('.extra-tag-row'))
    .map((row) => {
      const inputs = row.querySelectorAll('input');
      return { key: inputs[0].value.trim(), value: inputs[1].value };
    })
    .filter((t) => t.key);
}

editorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.activeTrackId) return;
  const tags = {};
  KNOWN_FIELDS.forEach((f) => { tags[f] = getFieldValue(f); });
  const extraTags = collectExtraTags();

  try {
    const res = await apiJson(`/session/${state.sessionId}/tracks/${state.activeTrackId}`, 'PATCH', { tags, extraTags });
    updateTrackInState(res.track);
    flashForge();
    toast('Metadata Forged Successfully', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

function updateTrackInState(updatedTrack) {
  const idx = state.tracks.findIndex((t) => t.id === updatedTrack.id);
  if (idx !== -1) state.tracks[idx] = updatedTrack;
  renderTrackList();
  if (state.activeTrackId === updatedTrack.id) {
    // Keep form values as the user left them; only sync cover/info areas.
    if (updatedTrack.cover) {
      coverImage.src = updatedTrack.cover.dataUrl;
      coverImage.classList.remove('hidden');
      coverPlaceholder.classList.add('hidden');
    } else {
      coverImage.classList.add('hidden');
      coverPlaceholder.classList.remove('hidden');
    }
    $('btn-remove-cover').disabled = !updatedTrack.cover;
  }
}

function flashForge() {
  $('btn-save').classList.remove('saved');
  // Force reflow so the animation can restart if triggered twice quickly.
  void $('btn-save').offsetWidth;
  $('btn-save').classList.add('saved');

  const editorPanel = document.querySelector('.editor-panel');
  editorPanel.classList.remove('forging');
  void editorPanel.offsetWidth;
  editorPanel.classList.add('forging');
}

// ---------------------------------------------------------------------------
// Audio info + player
// ---------------------------------------------------------------------------

function resetAudioInfo() {
  $('info-samplerate').textContent = '–';
  $('info-channels').textContent = '–';
  $('info-bitdepth').textContent = '–';
  $('info-duration').textContent = '–';
  $('info-size').textContent = '–';
}

function renderAudioInfo(track) {
  const info = track.audioInfo || {};
  $('info-samplerate').textContent = info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '–';
  $('info-channels').textContent = info.channels || '–';
  $('info-bitdepth').textContent = info.bitsPerSample ? `${info.bitsPerSample}-bit` : '–';
  $('info-duration').textContent = info.durationSeconds ? formatTime(info.durationSeconds) : '–';
  $('info-size').textContent = formatBytes(track.size);
}

function resetPlayerUI() {
  $('btn-play').disabled = false;
  $('seek-bar').disabled = false;
  $('seek-bar').value = 0;
  $('time-current').textContent = '0:00';
  $('time-total').textContent = getTrack(state.activeTrackId)?.audioInfo?.durationSeconds
    ? formatTime(getTrack(state.activeTrackId).audioInfo.durationSeconds)
    : '0:00';
  $('icon-play').classList.remove('hidden');
  $('icon-pause').classList.add('hidden');
}

$('btn-play').addEventListener('click', () => {
  if (audioEl.paused) {
    audioEl.play().catch(() => toast('Wiedergabe fehlgeschlagen', 'error'));
  } else {
    audioEl.pause();
  }
});

audioEl.addEventListener('play', () => {
  $('icon-play').classList.add('hidden');
  $('icon-pause').classList.remove('hidden');
});
audioEl.addEventListener('pause', () => {
  $('icon-play').classList.remove('hidden');
  $('icon-pause').classList.add('hidden');
});
audioEl.addEventListener('loadedmetadata', () => {
  $('time-total').textContent = formatTime(audioEl.duration);
});
audioEl.addEventListener('timeupdate', () => {
  if (state.seeking) return;
  $('time-current').textContent = formatTime(audioEl.currentTime);
  if (audioEl.duration) {
    $('seek-bar').value = (audioEl.currentTime / audioEl.duration) * 100;
  }
});
audioEl.addEventListener('ended', () => {
  $('icon-play').classList.remove('hidden');
  $('icon-pause').classList.add('hidden');
});

const seekBar = $('seek-bar');
seekBar.addEventListener('pointerdown', () => { state.seeking = true; });
seekBar.addEventListener('input', () => {
  $('time-current').textContent = formatTime((seekBar.value / 100) * (audioEl.duration || 0));
});
seekBar.addEventListener('change', () => {
  if (audioEl.duration) {
    audioEl.currentTime = (seekBar.value / 100) * audioEl.duration;
  }
  state.seeking = false;
});

$('volume-bar').addEventListener('input', (e) => {
  audioEl.volume = e.target.value / 100;
});
audioEl.volume = 0.8;

// ---------------------------------------------------------------------------
// Cover art
// ---------------------------------------------------------------------------

$('btn-add-cover').addEventListener('click', () => coverInput.click());

coverInput.addEventListener('change', async () => {
  const file = coverInput.files[0];
  coverInput.value = '';
  if (!file || !state.activeTrackId) return;
  const form = new FormData();
  form.append('cover', file);
  try {
    const res = await api(`/session/${state.sessionId}/tracks/${state.activeTrackId}/cover`, { method: 'POST', body: form });
    updateTrackInState(res.track);
    flashCover();
    toast('Cover aktualisiert', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-remove-cover').addEventListener('click', async () => {
  if (!state.activeTrackId) return;
  try {
    const res = await api(`/session/${state.sessionId}/tracks/${state.activeTrackId}/cover`, { method: 'DELETE' });
    updateTrackInState(res.track);
    toast('Cover entfernt', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

function flashCover() {
  coverFrame.classList.remove('flash');
  void coverFrame.offsetWidth;
  coverFrame.classList.add('flash');
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function loadSchemes() {
  try {
    const { schemes, default: def } = await api('/schemes');
    const select = $('scheme-select');
    select.innerHTML = '';
    Object.entries(schemes).forEach(([id, meta]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = meta.label;
      select.appendChild(opt);
    });
    select.value = def;
    state.scheme = def;
  } catch (err) {
    toast('Konnte Dateinamen-Schemas nicht laden', 'error');
  }
}

$('scheme-select').addEventListener('change', (e) => { state.scheme = e.target.value; });

$('btn-download-track').addEventListener('click', () => {
  if (!state.activeTrackId) return;
  const url = `/api/session/${state.sessionId}/tracks/${state.activeTrackId}/download?scheme=${encodeURIComponent(state.scheme)}`;
  window.location.href = url;
});

$('btn-download-all').addEventListener('click', () => {
  if (!state.sessionId || state.tracks.length === 0) return;
  toast('Forging Album Archive...', 'info', 2500);
  const url = `/api/session/${state.sessionId}/download-all?scheme=${encodeURIComponent(state.scheme)}`;
  window.location.href = url;
});

// ---------------------------------------------------------------------------
// Batch edit modal
// ---------------------------------------------------------------------------

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });
});

function renderFieldRows(container, fields, idPrefix) {
  container.innerHTML = '';
  fields.forEach(({ field, label }) => {
    const row = document.createElement('div');
    row.className = 'batch-field-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${idPrefix}-chk-${field}`;
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.setAttribute('for', checkbox.id);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `${idPrefix}-val-${field}`;
    input.disabled = true;
    checkbox.addEventListener('change', () => { input.disabled = !checkbox.checked; });
    row.append(checkbox, lbl, input);
    container.appendChild(row);
  });
}

$('btn-batch-edit').addEventListener('click', () => {
  $('batch-count').textContent = String(state.selected.size);
  renderFieldRows($('batch-fields'), BATCH_FIELDS, 'batch');
  state.batchCoverFile = null;
  $('batch-cover-filename').textContent = '';
  openModal('batch-modal');
});

$('batch-cover-btn').addEventListener('click', () => batchCoverInput.click());
batchCoverInput.addEventListener('change', () => {
  const file = batchCoverInput.files[0];
  if (file) {
    state.batchCoverFile = file;
    $('batch-cover-filename').textContent = file.name;
  }
});

$('btn-apply-batch').addEventListener('click', async () => {
  const trackIds = [...state.selected];
  if (trackIds.length === 0) { closeModal('batch-modal'); return; }

  const tags = {};
  BATCH_FIELDS.forEach(({ field }) => {
    const chk = $(`batch-chk-${field}`);
    if (chk && chk.checked) tags[field] = $(`batch-val-${field}`).value;
  });

  closeModal('batch-modal');
  showProgress('Forging Metadata...');
  try {
    if (Object.keys(tags).length > 0) {
      await apiJson(`/session/${state.sessionId}/batch/tags`, 'POST', { trackIds, tags });
    }
    if (state.batchCoverFile) {
      const form = new FormData();
      form.append('cover', state.batchCoverFile);
      form.append('trackIds', JSON.stringify(trackIds));
      await api(`/session/${state.sessionId}/batch/cover`, { method: 'POST', body: form });
    }
    hideProgress();
    toast(`Metadata Forged Successfully — ${trackIds.length} Track(s)`, 'success');
    refreshSession();
  } catch (err) {
    hideProgress();
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Album mode modal
// ---------------------------------------------------------------------------

$('btn-album-mode').addEventListener('click', () => {
  if (state.tracks.length === 0) {
    toast('Lade zuerst Tracks hoch', 'error');
    return;
  }
  renderFieldRows($('album-fields'), ALBUM_FIELDS, 'album');
  state.albumCoverFile = null;
  $('album-cover-filename').textContent = '';
  openModal('album-modal');
});

$('album-cover-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.jpg,.jpeg,.png,image/jpeg,image/png';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) {
      state.albumCoverFile = file;
      $('album-cover-filename').textContent = file.name;
    }
  });
  input.click();
});

$('btn-apply-album').addEventListener('click', async () => {
  const tags = {};
  ALBUM_FIELDS.forEach(({ field }) => {
    const chk = $(`album-chk-${field}`);
    if (chk && chk.checked) tags[field] = $(`album-val-${field}`).value;
  });
  const autoTotalTracks = $('album-auto-total').checked;
  const trackIds = state.tracks.map((t) => t.id);

  closeModal('album-modal');
  showProgress('Forging Album...');
  try {
    if (Object.keys(tags).length > 0 || autoTotalTracks) {
      await apiJson(`/session/${state.sessionId}/album`, 'POST', { tags, autoTotalTracks });
    }
    if (state.albumCoverFile) {
      const form = new FormData();
      form.append('cover', state.albumCoverFile);
      form.append('trackIds', JSON.stringify(trackIds));
      await api(`/session/${state.sessionId}/batch/cover`, { method: 'POST', body: form });
    }
    hideProgress();
    toast('Metadata Forged Successfully — Album', 'success');
    refreshSession();
  } catch (err) {
    hideProgress();
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  await loadSchemes();
  if (state.sessionId) {
    await refreshSession();
  } else {
    renderAll();
  }
})();
