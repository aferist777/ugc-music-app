'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT A FILE IS (phase 1), measured with the app's ffmpeg and kept in cache/:
//   info(abs)    -> { duration, wave, peaks }   a sound: decoded once (8 kHz, one channel) - `peaks` 400 points for the
//                                               player, `wave` 64 for its row (UGC Studio's lib/audio-wave.js measure:
//                                               each point the loudest moment of its share, 0..100 of the file's own
//                                               loudest); a video: its duration only
//   cached(abs)  -> { duration, wave } | null   what is already known, without asking ffmpeg
//   thumb(abs)   -> the path of a 96x96 jpg     a picture's or a video's small cover, cache/thumbs/
// A file is known by what it IS - its inode, size and time - not by where it lies, so a rename or a move keeps what was
// measured. At most two ffmpeg run at once; one file is never measured twice at the same time.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE_DIR, KINDS } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');

const FFMPEG = require('ffmpeg-static');
const STORE = path.join(CACHE_DIR, 'media-info.json');
const THUMBS = path.join(CACHE_DIR, 'thumbs');
const PEAKS = 400;
const WAVE = 64;
const RATE = 8000;
const THUMB = 96;
const MAX_RUNNING = 2;

const kindOf = (abs) => {
  const ext = path.extname(abs).toLowerCase();
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return k;
  return null;
};

// ── The store ───────────────────────────────────────────────────────────────

let store = null;
let saveTimer = null;

function _store() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { store = {}; }
  if (!store || typeof store !== 'object' || Array.isArray(store)) store = {};
  return store;
}

function _saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeJsonAtomic(STORE, store); } catch (e) { console.error('[media-info] not kept: ' + e.message); }
  }, 800);
}

function keyOf(abs) {
  const st = fs.statSync(abs, { bigint: true });
  return st.ino + '|' + st.size + '|' + st.mtimeMs;
}

// ── ffmpeg, two at a time ───────────────────────────────────────────────────

let running = 0;
const waiting = [];

function _slot(fn) {
  return new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    _next();
  });
}

function _next() {
  while (running < MAX_RUNNING && waiting.length) {
    const { fn, resolve, reject } = waiting.shift();
    running++;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; _next(); });
  }
}

function _run(args, { stdout } = {}) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], {
      stdio: ['ignore', stdout ? 'pipe' : 'ignore', 'pipe'], windowsHide: true,
    });
    const out = [];
    let err = '';
    if (stdout) p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => { if (err.length < 20000) err += b; });
    p.on('error', (e) => resolve({ code: -1, out: Buffer.alloc(0), err: String(e.message) }));
    p.on('close', (code) => resolve({ code, out: Buffer.concat(out), err }));
  });
}

// ── Measuring ───────────────────────────────────────────────────────────────

function _durationOf(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
}

function _shrink(peaks, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * peaks.length / n);
    const b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / n));
    let m = 0;
    for (let k = a; k < b; k++) m = Math.max(m, peaks[k] || 0);
    out.push(m);
  }
  return out;
}

async function _measureSound(abs) {
  const r = await _run(['-v', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { stdout: true });
  const n = Math.floor(r.out.length / 2);
  if (!n) return { duration: 0, peaks: [], wave: [] };
  const raw = new Array(PEAKS).fill(0);
  for (let i = 0; i < n; i++) {
    const v = Math.abs(r.out.readInt16LE(i * 2));
    const b = Math.min(PEAKS - 1, Math.floor(i * PEAKS / n));
    if (v > raw[b]) raw[b] = v;
  }
  const loudest = Math.max(1, ...raw);
  const peaks = raw.map(v => Math.round(v * 100 / loudest));
  return { duration: Math.round(n / RATE * 100) / 100, peaks, wave: _shrink(peaks, WAVE) };
}

async function _measureVideo(abs) {
  const r = await _run(['-i', abs]);
  return { duration: Math.round(_durationOf(r.err) * 100) / 100 };
}

const inFlight = new Map();

/** What a file is - measured once, then from the store. */
async function info(abs) {
  const key = keyOf(abs);
  const s = _store();
  if (s[key]) return s[key];
  if (inFlight.has(key)) return inFlight.get(key);
  const kind = kindOf(abs);
  const job = _slot(() => (kind === 'music' ? _measureSound(abs) : kind === 'video' ? _measureVideo(abs) : { duration: 0 }))
    .then((v) => {
      s[key] = v;
      _saveSoon();
      return v;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

function cached(abs) {
  try {
    const v = _store()[keyOf(abs)];
    return v ? { duration: v.duration, wave: v.wave } : null;
  } catch { return null; }
}

// ── Covers ──────────────────────────────────────────────────────────────────

const thumbsInFlight = new Map();

/** A small square cover of a picture or a video (its frame at half a second, or the first). Resolves its path. */
async function thumb(abs) {
  const hash = crypto.createHash('sha1').update(keyOf(abs)).digest('hex').slice(0, 20);
  const out = path.join(THUMBS, hash + '.jpg');
  if (fs.existsSync(out)) return out;
  if (thumbsInFlight.has(out)) return thumbsInFlight.get(out);
  const job = _slot(async () => {
    fs.mkdirSync(THUMBS, { recursive: true });
    const tmp = out + '.' + process.pid + '.tmp.jpg';
    const vf = 'scale=' + THUMB + ':' + THUMB + ':force_original_aspect_ratio=increase,crop=' + THUMB + ':' + THUMB;
    const base = ['-v', 'error', '-y'];
    const tail = ['-frames:v', '1', '-vf', vf, '-q:v', '4', tmp];
    let r = kindOf(abs) === 'video' ? await _run([...base, '-ss', '0.5', '-i', abs, ...tail]) : { code: 1 };
    if (r.code !== 0 || !fs.existsSync(tmp)) r = await _run([...base, '-i', abs, ...tail]);
    if (r.code !== 0 || !fs.existsSync(tmp)) throw Object.assign(new Error('no cover could be made'), { status: 422 });
    fs.renameSync(tmp, out);
    return out;
  }).finally(() => thumbsInFlight.delete(out));
  thumbsInFlight.set(out, job);
  return job;
}

module.exports = { info, cached, thumb };
