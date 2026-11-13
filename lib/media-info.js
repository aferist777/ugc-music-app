'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT A FILE IS (phase 1), measured with the app's ffmpeg and kept in cache/:
//   info(abs)    -> { duration, wave, peaks }   a sound: decoded once (8 kHz, one channel) - `peaks` 400 points for the
//                                               player, `wave` 64 for its row (UGC Studio's lib/audio-wave.js measure:
//                                               each point the loudest moment of its share, 0..100 of the file's own
//                                               loudest); a video: its duration only
//   cached(abs)  -> { duration, wave } | null   what is already known, without asking ffmpeg
//   thumb(abs, size) -> the path of a jpg        a picture's or a video's cover, cache/thumbs/: 's96' a 96x96 square
//                                               (the library's rows), 'm512' / 'p640' / 'p1280' its longest side at
//                                               most that, never larger (the chats' tiles; the preview's pictures)
//   strip(abs)   -> { n, step, size }           the timeline's frames of a clip (phase 6): n squares of 128 px in
//                                               one jpg, square k the frame at k * step s; a picture - one square
//   stripFile(abs) -> its path (made if missing)
//   proxy(abs, q) -> { file } | { same: true }  the preview's light copy (phase 6, the owner's P6): its shorter side q
//                                               (360 / 720), no sound, a key frame every 12 - cache/proxy/; `same` -
//                                               the file is no larger, the preview plays it as it is. One at a time.
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
const STRIPS = path.join(CACHE_DIR, 'strips');
const PROXIES = path.join(CACHE_DIR, 'proxy');
const THUMB_SIZES = { s96: 96, m512: 512, p640: 640, p1280: 1280 };
const STRIP_PX = 128;
const STRIP_MAX = 120;
const PROXY_Q = [360, 720];
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

// A queue of work that runs at most `max` at a time.
function _queue(max) {
  let running = 0;
  const waiting = [];
  const next = () => {
    while (running < max && waiting.length) {
      const { fn, resolve, reject } = waiting.shift();
      running++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

const _slot = _queue(MAX_RUNNING);
// The preview's copies take long: one at a time, never holding up the covers and the measures.
const _proxySlot = _queue(1);

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

const _hash = (abs) => crypto.createHash('sha1').update(keyOf(abs)).digest('hex').slice(0, 20);

// One piece of work per output file at a time: a second ask waits for the first.
const made = new Map();
function _once(out, fn) {
  if (made.has(out)) return made.get(out);
  const job = Promise.resolve().then(fn).finally(() => made.delete(out));
  made.set(out, job);
  return job;
}

/** A cover of a picture or a video (its frame at half a second, or the first) - `size` one of THUMB_SIZES. Resolves its path. */
async function thumb(abs, size = 's96') {
  if (!THUMB_SIZES[size]) throw Object.assign(new Error('no such cover size'), { status: 400 });
  const out = path.join(THUMBS, _hash(abs) + (size === 's96' ? '' : '-' + size) + '.jpg');
  if (fs.existsSync(out)) return out;
  return _once(out, () => _slot(async () => {
    fs.mkdirSync(THUMBS, { recursive: true });
    const tmp = out + '.' + process.pid + '.tmp.jpg';
    const n = THUMB_SIZES[size];
    const vf = size === 's96'
      ? 'scale=' + n + ':' + n + ':force_original_aspect_ratio=increase,crop=' + n + ':' + n
      : "scale='min(iw," + n + ")':'min(ih," + n + ")':force_original_aspect_ratio=decrease";
    const base = ['-v', 'error', '-y'];
    const tail = ['-frames:v', '1', '-vf', vf, '-q:v', size === 's96' ? '4' : '3', tmp];
    let r = kindOf(abs) === 'video' ? await _run([...base, '-ss', '0.5', '-i', abs, ...tail]) : { code: 1 };
    if (r.code !== 0 || !fs.existsSync(tmp)) r = await _run([...base, '-i', abs, ...tail]);
    if (r.code !== 0 || !fs.existsSync(tmp)) throw Object.assign(new Error('no cover could be made'), { status: 422 });
    fs.renameSync(tmp, out);
    return out;
  }));
}

// ── The timeline's frames ───────────────────────────────────────────────────

/** A clip's frames for its element on the timeline - n squares in one row, square k at k * step seconds. */
async function strip(abs) {
  const base = path.join(STRIPS, _hash(abs));
  try {
    const meta = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    if (fs.existsSync(base + '.jpg')) return meta;
  } catch { /* made below */ }
  return _once(base, async () => {
    const video = kindOf(abs) === 'video';
    const dur = video ? (await info(abs)).duration || 0 : 0;
    const step = video && dur > 0 ? Math.max(0.5, dur / STRIP_MAX) : 0;
    const n = step ? Math.max(1, Math.floor(dur / step)) : 1;
    await _slot(async () => {
      fs.mkdirSync(STRIPS, { recursive: true });
      const tmp = base + '.' + process.pid + '.tmp.jpg';
      const vf = (step ? 'fps=1/' + step.toFixed(4) + ',' : '')
        + 'scale=' + STRIP_PX + ':' + STRIP_PX + ':force_original_aspect_ratio=increase,crop=' + STRIP_PX + ':' + STRIP_PX
        + (n > 1 ? ',tile=' + n + 'x1' : '');
      const r = await _run(['-v', 'error', '-y', '-i', abs, '-vf', vf, '-frames:v', '1', '-q:v', '5', tmp]);
      if (r.code !== 0 || !fs.existsSync(tmp)) throw Object.assign(new Error('no frames could be made'), { status: 422 });
      fs.renameSync(tmp, base + '.jpg');
    });
    const meta = { n, step, size: STRIP_PX };
    writeJsonAtomic(base + '.json', meta);
    return meta;
  });
}

async function stripFile(abs) {
  await strip(abs);
  return path.join(STRIPS, _hash(abs) + '.jpg');
}

// ── The preview's light copies ──────────────────────────────────────────────

async function proxy(abs, q) {
  q = +q;
  if (!PROXY_Q.includes(q)) throw Object.assign(new Error('no such preview quality'), { status: 400 });
  if (kindOf(abs) !== 'video') throw Object.assign(new Error('only a clip has a preview copy'), { status: 400 });
  const out = path.join(PROXIES, _hash(abs) + '-' + q + '.mp4');
  if (fs.existsSync(out)) return { file: out };
  return _once(out, async () => {
    const probe = await _run(['-i', abs]);
    const m = /Video:.*?, (\d{2,5})x(\d{2,5})/.exec(probe.err);
    if (!m) throw Object.assign(new Error('its frame could not be read'), { status: 422 });
    const [w, h] = [+m[1], +m[2]];
    if (Math.min(w, h) <= q) return { same: true };
    const vf = w >= h ? 'scale=-2:' + q : 'scale=' + q + ':-2';
    await _proxySlot(async () => {
      fs.mkdirSync(PROXIES, { recursive: true });
      const tmp = out + '.' + process.pid + '.tmp.mp4';
      const r = await _run(['-v', 'error', '-y', '-i', abs, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '27', '-g', '12', '-keyint_min', '12', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp]);
      if (r.code !== 0 || !fs.existsSync(tmp)) {
        fs.rmSync(tmp, { force: true });
        throw Object.assign(new Error('the preview copy could not be made'), { status: 422 });
      }
      fs.renameSync(tmp, out);
    });
    return { file: out };
  });
}

module.exports = { info, cached, thumb, strip, stripFile, proxy };
