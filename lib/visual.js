'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PRESS OF IMAGES OR ANIMATE (phase 5) - written into the journal (lib/journal.js) AT THE PRESS, before anything is
// asked; then the SERVER does it all and the page only follows the record and the chat (lib/visual-chats.js):
//   1. the pictures it is given - an Images press's references, an Animate press's start (and last) frame - are made
//      sendable (lib/picture.js) and handed to kie.ai by its upload link (lib/kie.js); a picture no model can take is
//      refused in words - nothing asked;
//   2. the prompt enhancer (ticked - lib/enhancer.js, Claude Sonnet 5.5 SEEING those pictures) writes the prompt and
//      the press goes on at once; no Anthropic key, or it failed - the person's words go as they are (the owner
//      2026-11-13), and with no words the press stops, nothing asked;
//   3. one paid create per picture asked (×1 · ×2 · ×4), `asked` written before each; a create with no clear answer
//      or a refusal stops the rest - PAID ONCE, never asked again by itself;
//   4. every task is looked at every 4 s; what is made is downloaded ONCE into the folder selected in the library at
//      the press (Images / Video; gone by then - the root) with its description `.txt` beside it (the owner's rule):
//      a picture "<first words> · n", a clip after its start frame's name.
// After a restart a task with its number is waited for again; one asked without its number is failed - "may have been
// paid for"; one never asked is failed - "nothing was paid". MUSIC_FAKE=1: nothing is uploaded or asked - after 20 s a
// test picture (ffmpeg) or a clip of the start frame is filed like a real one.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOTS, FAKE } = require('./config');
const { freeName, checkPathLength } = require('./names');
const J = require('./journal');
const KIE = require('./kie');
const PIC = require('./picture');
const ENH = require('./enhancer');
const IMAGES = require('./images');
const ANIMATE = require('./animate');
const CHATS = require('./visual-chats');

const FFMPEG = require('ffmpeg-static');
const POLL_MS = 4000;
const TIMEOUT = { image: 20 * 60 * 1000, animate: 40 * 60 * 1000 };
const FAKE_WAIT = +process.env.MUSIC_FAKE_WAIT || 20000;
const ROOT = { image: ROOTS.find(r => r.id === 'images'), animate: ROOTS.find(r => r.id === 'video') };
const MOD = { image: IMAGES, animate: ANIMATE };
const FAKE_SIZE = { '16:9': '1344x768', '9:16': '768x1344', '1:1': '1024x1024' };

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });
const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };
const timers = new Map();

// A picture of the library by its place - it must be there.
function _abs(p) {
  const root = ROOTS.find(r => r.id === p.root);
  const abs = root && path.join(root.dir, ...String(p.rel).split('/'));
  if (!abs || !fs.existsSync(abs)) throw bad((p.rel || '').split('/').pop() + ' is not in the library any more');
  return abs;
}

// ── The record and its chat entry ───────────────────────────────────────────

function _entry(job) {
  const r = job.req;
  const m = MOD[job.kind].modelOf(r.model);
  return {
    id: job.id, type: 'press', at: job.at,
    words: r.words, prompt: job.enhanced ? job.prompt : null, enhancedBy: job.enhanced ? job.enhanced.label : null,
    fell: job.enhanceFell || null,
    model: r.model, modelLabel: m ? m.label : r.model,
    tier: r.tier, aspect: r.aspect, count: r.count, duration: r.duration, resolution: r.resolution, loop: !!r.loop,
    pics: (job.kind === 'image' ? r.refs : ANIMATE.framesOf(r)).map(p => ({ root: p.root, rel: p.rel })),
    results: (job.results || []).map(x => Object.assign({}, x)),
    state: job.state, stage: job.stage, error: job.error || null, refused: !!job.refused, price: job.price, fake: !!job.fake,
  };
}

function _patch(id, p) {
  const job = J.patch(id, p);
  if (job) CHATS.put(job.kind, _entry(job));
  return job;
}

function _fail(id, error, extra) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  return _patch(id, Object.assign({ state: 'failed', stage: '', error, doneAt: Date.now() }, extra || {}));
}

function _label(kind, req) {
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (kind === 'animate') return (req.start.rel.split('/').pop().replace(/\.[^.]+$/, '') + (req.words ? ' - ' + one(req.words) : '')).slice(0, 60);
  return (one(req.words) || 'from ' + req.refs.length + (req.refs.length === 1 ? ' reference' : ' references')).slice(0, 60);
}

// ── A press ─────────────────────────────────────────────────────────────────

/** A press: its record written at once, then the work in the background. `prompt` - what an enhancer wrote before. */
function start(kind, req, { into, prompt, enhanced } = {}) {
  if (!MOD[kind]) throw bad('no such kind');
  const job = {
    id: J.newId(), kind, mode: kind, label: _label(kind, req), req,
    state: 'pending', stage: 'starting', at: Date.now(), asked: false,
    into: { root: ROOT[kind].id, rel: String(into || '') },
    prompt: prompt || null, enhanced: enhanced || null,
    parts: [], results: [], price: MOD[kind].priceOf(req), fake: FAKE,
  };
  J.add(job);
  CHATS.put(kind, _entry(job));
  _run(job.id).catch((e) => {
    console.error('[visual] run', e);
    const j = J.get(job.id);
    if (j && j.state === 'pending') _fail(job.id, j.asked ? 'it failed here after kie.ai was asked - look at its history' : 'it failed here before anything was asked', { unsure: !!j.asked });
  });
  return job;
}

const _live = (id) => { const j = J.get(id); return j && j.state === 'pending' ? j : null; };

async function _run(id) {
  let job = J.get(id);
  const kind = job.kind;
  const pics = kind === 'image' ? job.req.refs : ANIMATE.framesOf(job.req);
  const limits = kind === 'image' ? { maxMb: 30, maxPx: 4096 } : ANIMATE.modelOf(job.req.model).limits;
  // 1. The pictures, sendable, by kie's links.
  const urls = [];
  const abss = [];
  if (pics.length) {
    _patch(id, { stage: 'sending ' + (pics.length === 1 ? 'the picture' : pics.length + ' pictures') });
    try {
      for (const p of pics) {
        abss.push(_abs(p));
        const s = await PIC.sendable(abss[abss.length - 1], limits);
        urls.push(job.fake ? 'https://fake.invalid/' + encodeURIComponent(path.basename(s.abs)) : await KIE.upload(s.abs));
        if (!_live(id)) return;
      }
    } catch (e) {
      if (_live(id)) _fail(id, e.message + ' - nothing was asked');
      return;
    }
  }
  // 2. The enhancer sees them and writes the prompt; the press goes on at once. No enhancer (the key taken away since
  //    the press) or it failed: the person's words as they are; none - nothing is asked.
  if (!_live(id)) return;
  if (job.req.enhance && !job.prompt) {
    let fell = '';
    if (!ENH.available()) fell = 'no Anthropic key';
    else {
      _patch(id, { stage: 'the enhancer is looking' + (pics.length ? ' at the ' + (pics.length === 1 ? 'picture' : 'pictures') : ' at your words') });
      try {
        const m = MOD[kind].modelOf(job.req.model);
        const seen = job.fake ? [] : await Promise.all(abss.map(a => PIC.seeable(a)));
        const e = await ENH.write({ kind, model: m.label, words: job.req.words, images: seen, aspect: job.req.aspect, loop: job.req.loop, last: !!job.req.last }, { fake: job.fake });
        if (!_live(id)) return;
        job = _patch(id, { prompt: e.prompt, enhanced: e.by });
      } catch (e) {
        fell = e.message;
      }
    }
    if (!_live(id)) return;
    if (fell) {
      if (String(job.req.words || '').trim().length < 3) {
        _fail(id, 'the prompt enhancer failed (' + fell + ') and there are no words of yours to send - nothing was asked');
        return;
      }
      job = _patch(id, { prompt: job.req.words, enhanceFell: fell });
    }
  } else if (!job.prompt) job = _patch(id, { prompt: job.req.words });
  // 3. Paid: one create per picture asked, `asked` written before each.
  const bodies = kind === 'image' ? IMAGES.bodiesOf(job.req, job.prompt, urls) : [ANIMATE.bodyOf(job.req, job.prompt, urls)];
  const parts = job.parts;
  for (let n = 1; n <= bodies.length; n++) {
    if (!_live(id)) return;
    const part = { n, asked: true, askedAt: Date.now(), taskId: null, state: 'pending' };
    parts.push(part);
    _patch(id, {
      parts, asked: true, askedAt: job.askedAt || part.askedAt, sent: bodies[0].input,
      stage: 'asking kie.ai' + (bodies.length > 1 ? ' (' + n + ' of ' + bodies.length + ')' : ''),
    });
    try {
      part.taskId = job.fake ? 'fake-' + id + '-' + n : await KIE.createTask(bodies[n - 1]);
      _patch(id, { parts });
    } catch (e) {
      Object.assign(part, { state: 'failed', error: e.message, unsure: !!e.unsure, refused: !!e.refused });
      // Paid once: after a create with no clear answer, a refusal or a failure, the rest are not asked.
      for (let k = n + 1; k <= bodies.length; k++) {
        parts.push({ n: k, asked: false, state: 'failed', error: 'not asked - the one before ' + (e.unsure ? 'may have been paid for' : 'failed') });
      }
      _patch(id, { parts });
      break;
    }
  }
  _schedule(id, 0);
}

function _schedule(id, ms) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { _tick(id).catch(e => console.error('[visual] tick', e)); }, ms == null ? POLL_MS : ms));
}

function _fakeLook(job, p) {
  if (Date.now() - p.askedAt < FAKE_WAIT) return { state: 'pending', stage: 'being made (fake)' };
  if (/\?fail/.test(job.req.words || '')) return { state: 'failed', error: 'a fake failure', refused: false };
  return { state: 'success', urls: ['fake:' + p.n] };
}

async function _tick(id) {
  const job = _live(id);
  if (!job) return;
  const late = Date.now() - (job.askedAt || job.at) > TIMEOUT[job.kind];
  let stage = '';
  for (const p of job.parts) {
    if (p.state !== 'pending' || !p.taskId) continue;
    if (late) { Object.assign(p, { state: 'failed', error: 'kie.ai took too long - look at its history', unsure: true }); continue; }
    let r;
    try {
      r = job.fake ? _fakeLook(job, p) : await KIE.look(p.taskId);
    } catch {
      continue; // a look turned away is not a failed task: asked again next time
    }
    if (r.state === 'pending') { stage = r.stage || stage; continue; }
    if (r.state === 'failed') { Object.assign(p, { state: 'failed', error: r.error, refused: !!r.refused }); continue; }
    // Made and paid for: downloaded ONCE - the download is tried again a few times, never the task.
    try {
      _patch(id, { stage: 'downloading' });
      const res = await _file(job, p, r.urls[0]);
      Object.assign(p, { state: 'done', credits: r.credits || null });
      job.results = (job.results || []).filter(x => x.n !== p.n).concat([res]).sort((a, b) => a.n - b.n);
    } catch (e) {
      p.tries = (p.tries || 0) + 1;
      if (p.tries >= 5) Object.assign(p, { state: 'failed', error: 'it was made but could not be downloaded: ' + e.message });
    }
  }
  if (!_live(id)) return;
  if (job.parts.some(p => p.state === 'pending')) {
    _patch(id, { parts: job.parts, results: job.results, stage: stage || job.stage || 'being made' });
    _schedule(id);
    return;
  }
  _finish(id);
}

function _finish(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const job = J.get(id);
  const failed = job.parts.filter(p => p.state === 'failed');
  const errors = [...new Set(failed.map(p => p.error).filter(Boolean))];
  const done = (job.results || []).length;
  _patch(id, {
    state: done ? 'done' : 'failed', stage: '', doneAt: Date.now(), parts: job.parts, results: job.results,
    error: errors.length ? (done ? failed.length + ' of ' + job.parts.length + ' not made: ' : '') + errors.join('; ') : null,
    refused: !done && failed.length > 0 && failed.every(p => p.refused || !p.asked),
    unsure: failed.some(p => p.unsure),
  });
}

// ── Filing ──────────────────────────────────────────────────────────────────

function _safeBase(t) {
  const words = String(t || '').replace(/^\[fake\]\s*/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  let b = '';
  for (const w of words) {
    if ((b + ' ' + w).trim().length > 40) break;
    b = (b + ' ' + w).trim();
  }
  b = (b || words.join(' ').slice(0, 40)).replace(/[. ]+$/, '').trim();
  return b || 'Untitled';
}

function _ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('the fake file was not made'))));
  });
}

async function _fakeFile(job, part) {
  if (job.kind === 'image') {
    await _ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=' + (FAKE_SIZE[job.req.aspect] || FAKE_SIZE['16:9']) + ':d=1', '-frames:v', '1', '-q:v', '3', '-f', 'mjpeg', part]);
  } else {
    const dur = String(Math.min(job.req.duration, 6));
    await _ffmpeg(['-loop', '1', '-i', _abs(job.req.start), '-t', dur, '-vf', 'scale=\'min(1280,iw)\':-2,format=yuv420p', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-f', 'mp4', part]);
  }
}

async function _download(url, abs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error('the file answered ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new Error('the file came back empty');
  fs.writeFileSync(abs, buf);
}

async function _file(job, part, url) {
  const root = ROOT[job.kind];
  let rel = (job.into && job.into.rel) || '';
  let dir = rel ? path.join(root.dir, ...rel.split('/')) : root.dir;
  if (!isDir(dir)) { rel = ''; dir = root.dir; }
  let base;
  let ext;
  if (job.kind === 'image') {
    base = _safeBase(job.req.words || job.prompt) + ' · ' + part.n;
    const m = /\.(png|jpe?g|webp)(\?|$)/i.exec(url);
    ext = m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg';
  } else {
    base = job.req.start.rel.split('/').pop().replace(/\.[^.]+$/, '');
    const m = /\.(mp4|mov|webm)(\?|$)/i.exec(url);
    ext = m ? '.' + m[1].toLowerCase() : '.mp4';
  }
  const name = freeName(dir, base, ext);
  const abs = path.join(dir, name);
  checkPathLength(abs);
  const tmp = abs + '.part';
  if (job.fake) await _fakeFile(job, tmp); else await _download(url, tmp);
  fs.renameSync(tmp, abs);
  fs.writeFileSync(abs.slice(0, -ext.length) + '.txt', _describe(job, part, name), 'utf8');
  return { n: part.n, root: root.id, rel: rel ? rel + '/' + name : name, name };
}

// The description beside the file (the owner's rule): the model, what was asked, the prompt sent, what it cost.
function _describe(job, part, name) {
  const r = job.req;
  const m = MOD[job.kind].modelOf(r.model) || { label: r.model, tiers: [] };
  const when = new Date(part.askedAt || job.at);
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
  const place = (p) => (p.root === 'images' ? 'Images' : p.root) + ' / ' + p.rel.split('/').join(' / ');
  const lines = [];
  if (job.kind === 'image') {
    lines.push('UGC Music Studio - picture',
      'Picture: ' + name.replace(/\.[^.]+$/, '') + (r.count > 1 ? ' (' + part.n + ' of ' + r.count + ' from one press)' : ''),
      'Made: ' + stamp,
      'Model: ' + m.label + (m.tiers.length > 1 ? ' · ' + r.tier : '') + ' · ' + r.aspect + ' (kie.ai ' + _modelId(job) + ')',
      'Your words: ' + (r.words || '-'),
      'References: ' + (r.refs.length ? r.refs.map(place).join('; ') : '-'));
  } else {
    lines.push('UGC Music Studio - clip',
      'Clip: ' + name.replace(/\.[^.]+$/, ''),
      'Made: ' + stamp,
      'Model: ' + m.label + ' · ' + r.duration + ' s · ' + r.resolution + ' (kie.ai ' + _modelId(job) + ')',
      'Start frame: ' + place(r.start),
      'Last frame: ' + (r.loop ? 'the start frame (Loop)' : r.last ? place(r.last) : '-'),
      'Your words: ' + (r.words || '-'));
  }
  lines.push('Prompt enhancer: ' + (job.enhanced ? 'on - ' + job.enhanced.label + (job.enhanced.usd ? ' ($' + job.enhanced.usd + ')' : '')
    : job.enhanceFell ? 'failed (' + job.enhanceFell + ') - your words were sent as they are' : 'off'));
  lines.push('Prompt sent: ' + (job.prompt || '-'));
  lines.push('kie.ai task: ' + (part.taskId || '-'));
  const p = job.price;
  lines.push('Price: $' + (job.kind === 'image' ? p.usd + ' a picture' : p.total + ' ($' + p.usd + ' a second)') + ' - kie.ai\'s list of ' + p.asof
    + (job.fake ? ' - FAKE, nothing paid' : ''));
  return lines.join('\n') + '\n';
}

function _modelId(job) {
  if (!MOD[job.kind].modelOf(job.req.model)) return job.req.model;
  const b = job.kind === 'image' ? IMAGES.bodiesOf(Object.assign({}, job.req, { count: 1 }), '', job.req.refs.map(() => 'x'))[0] : ANIMATE.bodyOf(job.req, '', ['x', 'x']);
  return b.model;
}

// ── The person's hand ───────────────────────────────────────────────────────

function stop(id) {
  const job = _live(id);
  if (!job) throw bad('it is not waiting any more');
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!job.parts.length) return _fail(id, 'you stopped it - nothing was asked', { cancelled: true });
  for (const p of job.parts) {
    if (p.state !== 'pending') continue;
    Object.assign(p, { state: 'failed', error: p.taskId ? 'you stopped waiting - kie.ai may still make it: look at its history' : 'you stopped it', unsure: !!p.taskId });
  }
  _finish(id);
  return J.patch(id, { cancelled: true });
}

/** Again, as a NEW press - it pays again; what the enhancer wrote is carried, so it is not asked twice. */
function retry(id) {
  const j = J.get(id);
  if (!j) throw bad('no such generation', 404);
  if (j.state === 'pending') throw bad('it is still being made');
  if (j.refused) throw bad('kie.ai refused this one - change the words first');
  if (!MOD[j.kind].modelOf(j.req.model)) throw bad(j.req.model + ' is not offered any more - make it again with another model');
  return start(j.kind, j.req, { into: j.into && j.into.rel, prompt: j.enhanced ? j.prompt : null, enhanced: j.enhanced });
}

/** At start (lib/jobs.js boot): what was waiting goes on; what was cut before its task number is never asked again. */
function resume(id) {
  const job = _live(id);
  if (!job) return;
  if (!job.asked) { _fail(id, 'the app closed before it was asked - nothing was paid'); return; }
  for (const p of job.parts) {
    if (p.state === 'pending' && !p.taskId) Object.assign(p, { state: 'failed', error: 'the app closed while kie.ai was being asked - it may have been paid for: look at its history', unsure: true });
  }
  const asked = job.kind === 'image' ? job.req.count : 1;
  for (let n = job.parts.length + 1; n <= asked; n++) job.parts.push({ n, asked: false, state: 'failed', error: 'not asked - the app closed' });
  if (job.parts.some(p => p.state === 'pending')) { J.save(); _schedule(id, 1000); } else _finish(id);
}

module.exports = { start, stop, retry, resume };
