'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE JOURNAL OF GENERATIONS (phase 3; UGC Studio's rule "every paid generation is an Alert") - data/jobs.json, newest
// first. A press is written HERE before anything is asked; the SERVER writes the style (the enhancer), asks Suno, waits
// for it (every 4 s), downloads both tracks ONCE and files them - into the Music folder that was selected at the press
// (the owner's C5; gone by then - the root of Music) with a description beside each; the page only follows the record.
//
// PAID ONCE: `asked` is written just before the paid create. A create with no answer (`unsure`) fails the record with
// "it may have been paid for" and is never asked again by itself; after a restart a record with its task number is
// waited for again, one without it is failed - "may have been paid for" if it was asked, "not asked" if not. A poll
// turned away is not a failed task (asked again next tick). A refusal of the content is `refused` - no retry offered.
// Retry from the journal is a NEW record ("pays again"), carrying what the enhancer wrote.
//
// MUSIC_FAKE=1: nothing is asked - after 20 s two tones are filed like real tracks (lyrics: two texts).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DATA_DIR, ROOTS, FAKE } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');
const { freeName, checkPathLength } = require('./names');
const SUNO = require('./suno');
const WRITER = require('./suno-writer');
const INFO = require('./media-info');

const FILE = path.join(DATA_DIR, 'jobs.json');
const POLL_MS = 4000;
const TIMEOUT_MS = 40 * 60 * 1000;
const KEEP = 300;
const FAKE_WAIT = +process.env.MUSIC_FAKE_WAIT || 20000;
const MUSIC = ROOTS.find(r => r.id === 'music');

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });
const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };

// ── The store ───────────────────────────────────────────────────────────────

let store = null;
const timers = new Map();

function _jobs() {
  if (!store) {
    try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')).jobs; } catch { store = []; }
    if (!Array.isArray(store)) store = [];
  }
  return store;
}

function _save() {
  const all = _jobs();
  let kept = 0;
  writeJsonAtomic(FILE, { jobs: all.filter(j => j.state === 'pending' || kept++ < KEEP) });
}

const _get = (id) => _jobs().find(j => j.id === id) || null;

function _patch(id, patch) {
  const j = _get(id);
  if (!j) return null;
  Object.assign(j, patch);
  _save();
  return j;
}

function _fail(id, error, extra) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  return _patch(id, Object.assign({ state: 'failed', stage: '', error, doneAt: Date.now() }, extra || {}));
}

// ── What the page sees ──────────────────────────────────────────────────────

function list(limit) {
  return _jobs().slice(0, Math.max(1, Math.min(200, +limit || 40)));
}

function get(id) {
  const j = _get(id);
  if (!j) throw bad('no such generation', 404);
  return j;
}

function _label(req) {
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (req.mode === 'lyrics') return one(req.idea).slice(0, 60);
  if (req.mode === 'custom') return one(req.title).slice(0, 60);
  const chips = Object.values(req.chips || {}).flat();
  return (one(req.words) || one(req.about) || chips.concat(req.mix || []).slice(0, 4).join(', ') || 'Simple').slice(0, 60);
}

// ── A press ─────────────────────────────────────────────────────────────────

/** A press of Generate: its record written at once, then the work in the background. */
function start(req, { into, written } = {}) {
  const now = Date.now();
  const job = {
    id: 'j' + now.toString(36) + crypto.randomBytes(3).toString('hex'),
    kind: req.mode === 'lyrics' ? 'lyrics' : 'music',
    mode: req.mode,
    label: _label(req),
    req,
    state: 'pending',
    stage: 'starting',
    asked: false,
    at: now,
    into: req.mode === 'lyrics' ? null : { rel: String(into || '') },
    written: written || null,
    results: [],
    lyrics: [],
    price: SUNO.PRICES[req.mode],
    fake: FAKE,
  };
  _jobs().unshift(job);
  _save();
  _run(job.id).catch((e) => {
    console.error('[jobs] run failed', e);
    _fail(job.id, 'it failed here before Suno was asked');
  });
  return job;
}

function _writerInput(req) {
  return {
    task: SUNO.taskOf(req), chips: req.chips, mix: req.mix, words: req.words, about: req.about, seconds: req.seconds,
    title: req.title, style: req.style, negative: req.negative, instrumental: req.instrumental, hasLyrics: !!req.lyrics,
  };
}

async function _run(id) {
  let job = _get(id);
  const task = SUNO.taskOf(job.req);
  // 1. What Suno is sent: the enhancer writes it (ticked), else the chips and words as they are.
  if (task && !job.written) {
    const input = _writerInput(job.req);
    let written;
    if (job.req.writer === false || (job.req.mode === 'custom' && !job.req.writer)) written = WRITER.compose(input);
    else {
      _patch(id, { stage: 'writing the style' });
      written = await WRITER.write(input, {
        fake: FAKE,
        onStage: (s) => { const j = _get(id); if (j && j.state === 'pending' && !j.asked) { j.stage = 'writing the style · ' + (s.step || ''); } },
      });
    }
    job = _patch(id, { written });
  }
  job = _get(id);
  if (!job || job.state !== 'pending') return;
  // 2. Suno, paid: `asked` first.
  const body = SUNO.bodyOf(job.req, job.written);
  _patch(id, { stage: 'asking Suno', asked: true, askedAt: Date.now(), sent: body.input });
  let taskId;
  try {
    taskId = FAKE ? 'fake-' + id : await SUNO.create(body);
  } catch (e) {
    if (e.unsure) { _fail(id, e.message + ' - it may have been paid for: look at kie.ai\'s history before asking again', { unsure: true }); return; }
    _fail(id, e.message, { refused: !!e.refused });
    return;
  }
  _patch(id, { taskId, stage: 'in kie.ai\'s queue' });
  _schedule(id, 0);
}

function _schedule(id, ms) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { _tick(id).catch(e => console.error('[jobs] tick', e)); }, ms == null ? POLL_MS : ms));
}

function _fakePoll(job) {
  if (Date.now() - job.askedAt < FAKE_WAIT) return { state: 'pending', stage: 'Suno is making it (fake)' };
  if (job.kind === 'lyrics') {
    return { state: 'success', lyrics: [1, 2].map(n => ({ title: '[fake] ' + job.req.idea.slice(0, 40) + ' ' + n, text: '[Verse]\nA fake line about ' + job.req.idea.slice(0, 60) + '\nAnother fake line ' + n + '\n\n[Chorus]\nFake chorus, la la la' })) };
  }
  return { state: 'success', tracks: [1, 2].map(n => ({ url: 'fake:' + n, dur: 6, title: '', id: 'fake' + n, tags: 'fake', lyrics: '' })) };
}

async function _tick(id) {
  const job = _get(id);
  if (!job || job.state !== 'pending') return;
  if (Date.now() - (job.askedAt || job.at) > TIMEOUT_MS) {
    _fail(id, 'Suno took longer than 40 minutes - look at kie.ai\'s history', { unsure: true });
    return;
  }
  let p;
  try {
    p = job.fake ? _fakePoll(job) : await SUNO.poll(job.taskId, job.kind);
  } catch {
    _schedule(id); // a poll turned away is not a failed task
    return;
  }
  if (p.state === 'pending') {
    if (p.stage && p.stage !== job.stage) _patch(id, { stage: p.stage });
    _schedule(id);
    return;
  }
  if (p.state === 'failed') { _fail(id, p.error, { refused: !!p.refused }); return; }
  if (job.kind === 'lyrics') {
    _patch(id, { state: 'done', stage: '', lyrics: p.lyrics, doneAt: Date.now() });
    return;
  }
  _patch(id, { stage: 'downloading the tracks' });
  try {
    await _file(id, p.tracks);
    _patch(id, { state: 'done', stage: '', doneAt: Date.now() });
  } catch (e) {
    // The tracks are made and paid for: their download is tried again a few times, never the task.
    const tries = (job.downloadTries || 0) + 1;
    if (tries >= 5) { _fail(id, 'the tracks were made but could not be downloaded: ' + e.message); return; }
    _patch(id, { downloadTries: tries, stage: 'downloading the tracks again (' + tries + ')' });
    _schedule(id, 5000 * tries);
  }
}

// ── Filing ──────────────────────────────────────────────────────────────────

function _safeBase(t) {
  const b = String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 60);
  return b || 'Untitled';
}

function _tone(abs, n) {
  return new Promise((resolve, reject) => {
    const p = spawn(require('ffmpeg-static'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=' + (n === 1 ? 392 : 523) + ':duration=6',
      '-af', 'volume=0.5', abs], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('the fake tone was not made'))));
  });
}

async function _download(url, abs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error('the file answered ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new Error('the file came back empty');
  fs.writeFileSync(abs, buf);
}

async function _file(id, tracks) {
  const job = _get(id);
  let rel = (job.into && job.into.rel) || '';
  let dir = rel ? path.join(MUSIC.dir, ...rel.split('/')) : MUSIC.dir;
  if (!isDir(dir)) { rel = ''; dir = MUSIC.dir; }
  const w = job.written || {};
  const base = _safeBase(w.title || job.req.title || (tracks[0] && tracks[0].title) || job.label);
  const results = job.results || [];
  for (let n = 1; n <= Math.min(tracks.length, 4); n++) {
    if (results.some(x => x.n === n)) continue; // filed on an earlier try
    const t = tracks[n - 1];
    const m = /\.(wav|m4a|ogg|flac)(\?|$)/i.exec(t.url);
    const ext = m ? '.' + m[1].toLowerCase() : '.mp3';
    const name = freeName(dir, base + ' · ' + n, ext);
    const abs = path.join(dir, name);
    checkPathLength(abs);
    const part = abs + '.part';
    if (job.fake) await _tone(part + '.mp3', n).then(() => fs.renameSync(part + '.mp3', part));
    else await _download(t.url, part);
    fs.renameSync(part, abs);
    fs.writeFileSync(abs.slice(0, -ext.length) + '.txt', _describe(job, t, n, name), 'utf8');
    let dur = t.dur || 0;
    try { dur = (await INFO.info(abs)).duration || dur; } catch { /* measured when listed */ }
    results.push({ n, name, rel: rel ? rel + '/' + name : name, dur, sunoId: t.id, sunoTags: t.tags });
    _patch(id, { results });
  }
}

// The description beside a track (the owner, 2026-11-12): the model, the tags, the prompt - everything that made it.
function _describe(job, t, n, name) {
  const r = job.req;
  const w = job.written || {};
  const s = job.sent || {};
  const when = new Date(job.askedAt || job.at);
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
  const mode = r.mode === 'simple' ? 'Simple, ' + (r.instrumental ? 'instrumental' : 'a song (Suno wrote the lyrics)') : 'Custom' + (r.instrumental ? ', instrumental' : '');
  const lines = [
    'UGC Music Studio - Suno',
    'Track: ' + name.replace(/\.[^.]+$/, '') + ' (' + n + ' of ' + 2 + ' from one press)',
    'Made: ' + stamp,
    'Model: Suno ' + (r.model || 'V6') + ' - ' + mode,
  ];
  if (r.mode === 'simple') {
    const chips = Object.entries(r.chips || {}).filter(([, l]) => l.length).map(([g, l]) => g + ': ' + l.join(', ')).join('; ');
    lines.push('Chips: ' + (chips || '-'));
    lines.push('From Tags: ' + ((r.mix || []).join(', ') || '-'));
    lines.push('Your words: ' + (r.words || '-'));
    if (!r.instrumental) lines.push('What the song is about: ' + (r.about || '-'));
  } else {
    lines.push('Title: ' + r.title);
    lines.push('Your style: ' + (r.style || '-'));
    lines.push('Your exclude: ' + (r.negative || '-'));
    if (r.vocal) lines.push('Voice: ' + (r.vocal === 'f' ? 'female' : 'male'));
  }
  const enh = SUNO.taskOf(r) && !(r.mode === 'custom' && !r.writer) && r.writer !== false;
  lines.push('Prompt enhancer: ' + (enh ? 'on - ' + (w.fell || 'written by ' + (w.by || '?')) + (w.usd ? ' ($' + w.usd.toFixed(4) + ')' : '') : 'off'));
  if (s.style) lines.push('Style sent: ' + s.style);
  if (s.negative_tags) lines.push('Exclude sent: ' + s.negative_tags);
  if (s.prompt) lines.push('Description sent: ' + s.prompt);
  const knobs = ['style_weight', 'weirdness_constraint', 'variety'].filter(k => s[k] != null).map(k => k.replace('_constraint', '').replace('_', ' ') + ' ' + s[k]);
  if (knobs.length) lines.push('Knobs: ' + knobs.join(', '));
  lines.push('Length asked: ' + (s.duration ? s.duration + ' s' : 'auto'));
  if (t.tags) lines.push('Suno\'s own tags: ' + t.tags);
  lines.push('Suno task: ' + (job.taskId || '-') + (t.id ? ', track ' + t.id : ''));
  lines.push('Price: ' + job.price.credits + ' kie.ai credits ($' + job.price.usd + ') for both tracks' + (job.fake ? ' - FAKE, nothing paid' : ''));
  const lyrics = s.lyrics || t.lyrics;
  if (lyrics) lines.push('', 'Lyrics:', lyrics);
  return lines.join('\n') + '\n';
}

// ── The person's hand ───────────────────────────────────────────────────────

function stop(id) {
  const j = get(id);
  if (j.state !== 'pending') throw bad('it is not waiting any more');
  return _fail(id, j.asked ? 'you stopped waiting for it - Suno may still make it: look at kie.ai\'s history' : 'you stopped it before Suno was asked', { cancelled: true });
}

/** Again, as a new record - it pays again; what the enhancer wrote is carried. */
function retry(id) {
  const j = get(id);
  if (j.state === 'pending') throw bad('it is still being made');
  if (j.refused) throw bad('Suno refused this one - change the words first');
  const written = j.written && !j.written.fell ? j.written : null;
  return start(j.req, { into: j.into && j.into.rel, written });
}

function forget(id) {
  const j = get(id);
  if (j.state === 'pending') throw bad('it is still being made');
  store = _jobs().filter(x => x.id !== id);
  _save();
  return { ok: true };
}

/** At start: what was waiting goes on; what was cut before its task number is never asked again by itself. */
function boot() {
  for (const j of _jobs()) {
    if (j.state !== 'pending') continue;
    if (j.taskId) _schedule(j.id, 1000);
    else if (j.asked) _fail(j.id, 'the app closed while Suno was being asked - it may have been paid for: look at kie.ai\'s history', { unsure: true });
    else _fail(j.id, 'the app closed before Suno was asked - nothing was paid');
  }
}

module.exports = { list, get, start, stop, retry, forget, boot };
