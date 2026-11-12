// ════════════════════════════════════════════════════════════════════════════
// THE TIMELINE (phase 4) - the project picked under Projects in the library (the owner's T1) on two video lanes (Video 2
// over Video 1) and two sound lanes (T2). Clips come from the library's rows and from Recent of the Music tab by a drag:
// music onto a sound lane, clips and pictures onto a video lane (a picture lasts 5 s - T3). A clip is moved (along its
// lane and onto the other lane of its kind), trimmed by its edges, split at the playhead (S), deleted (Delete); several
// are picked with Ctrl / Shift or a band; everything snaps to the clips' edges and the playhead; Ctrl+Z / Ctrl+Y; Alt +
// wheel zooms; a press on the ruler moves the playhead. Space plays it when the timeline was used last. The frame's
// shape is the button over the preview - it says the OTHER shape (T4). The project is saved by itself after every
// change; one the library changed meanwhile (a file renamed, moved, archived) is read again.
// ════════════════════════════════════════════════════════════════════════════

import { api, remembered, remember } from '../api.js';
import { showError, showToast } from '../notice.js';
import { blocked } from '../layers.js';
import { spaceOwner, setSpaceOwner } from '../space.js';
import { q, clock } from '../library/common.js';
import * as JOBS from '../music/jobs-store.js';
import { createPreview } from './preview.js';

const $ = (id) => document.getElementById(id);
const LANES = [['v2', 'Video 2', 'video'], ['v1', 'Video 1', 'video'], ['a1', 'Audio 1', 'audio'], ['a2', 'Audio 2', 'audio']];
const KIND_OF_ROOT = { music: 'audio', video: 'video', images: 'image' };
const IMAGE_SEC = 5;
const SNAP_PX = 8;
const EDGE_PX = 6;
const MIN_DUR = 0.1;

const S = {
  p: null,          // the project
  sel: new Set(),   // picked clips' ids
  pps: +remembered().tlPps || 20,
  t: 0,
  undo: [],
  redo: [],
};
let preview = null;
let saveTimer = 0;
let saving = null;
const peaks = new Map(); // root + rel -> { peaks, duration } | 'asking'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const laneKind = (lane) => (lane.startsWith('a') ? 'audio' : 'video');
const fits = (lane, kind) => (laneKind(lane) === 'audio' ? kind === 'audio' : kind !== 'audio');
const allClips = () => (S.p ? Object.values(S.p.lanes).flat() : []);
const laneOf = (id) => S.p && Object.keys(S.p.lanes).find(l => S.p.lanes[l].some(c => c.id === id));
const clipOf = (id) => allClips().find(c => c.id === id);
const endOf = () => allClips().reduce((m, c) => Math.max(m, c.start + c.dur), 0);
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}

// ── Loading and saving ──────────────────────────────────────────────────────

async function load(id) {
  try {
    S.p = (await api('/api/projects/' + id)).project;
  } catch (e) {
    showError(e.message);
    return;
  }
  S.sel.clear();
  S.undo = [];
  S.redo = [];
  S.t = Math.min(S.t, endOf());
  remember({ tlProject: S.p.id });
  window.dispatchEvent(new CustomEvent('ms:project-opened', { detail: { id: S.p.id } }));
  preview.pause();
  preview.refresh();
  paintAll();
}

async function ensureProject() {
  let list = [];
  try { list = (await api('/api/projects')).projects || []; } catch { /* drawn empty */ }
  const last = remembered().tlProject;
  let id = list.some(p => p.id === last) ? last : (list[0] && list[0].id);
  if (!id) {
    try {
      id = (await api('/api/projects', { method: 'POST', body: { name: 'Untitled' } })).project.id;
      window.dispatchEvent(new CustomEvent('ms:projects-changed'));
    } catch (e) { showError(e.message); return; }
  }
  await load(id);
}

function _plain() {
  const lanes = {};
  for (const [l] of LANES) lanes[l] = S.p.lanes[l].map(({ missing, ...c }) => c); // eslint-disable-line no-unused-vars
  return { rev: S.p.rev, format: S.p.format, lanes };
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

/** The project written now - the one the library changed meanwhile is read again instead. */
async function flush() {
  clearTimeout(saveTimer);
  if (!S.p) return;
  if (saving) await saving;
  const id = S.p.id;
  saving = api('/api/projects/' + id, { method: 'PUT', body: _plain() })
    .then((r) => { if (S.p && S.p.id === id) S.p.rev = r.rev; })
    .catch(async (e) => {
      // The library moved a file of it meanwhile: it is read again as the server keeps it.
      if (/changed meanwhile/.test(e.message)) await load(id); else showError(e.message);
    })
    .finally(() => { saving = null; });
  await saving;
}

// A change: the lanes as they were kept for Ctrl+Z, then drawn and saved.
function begin() {
  S.undo.push(JSON.stringify(S.p.lanes));
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}

function commit() {
  preview.refresh();
  paintLanes();
  preview.show(S.t);
  saveSoon();
}

function undo(redo) {
  const from = redo ? S.redo : S.undo;
  const to = redo ? S.undo : S.redo;
  if (!from.length) return;
  to.push(JSON.stringify(S.p.lanes));
  S.p.lanes = JSON.parse(from.pop());
  const ids = new Set(allClips().map(c => c.id));
  S.sel = new Set([...S.sel].filter(id => ids.has(id)));
  commit();
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function paintAll() {
  $('tl-name').textContent = S.p ? S.p.name : '';
  $('tl-format').textContent = S.p && S.p.format === '9:16' ? '16:9' : '9:16';
  $('tl-format').title = 'The frame is ' + (S.p ? S.p.format : '16:9') + ' - press for ' + $('tl-format').textContent;
  preview.setFormat(S.p ? S.p.format : '16:9');
  paintLanes();
  paintTime();
  preview.show(S.t);
}

function paintTime() {
  $('tl-time').textContent = fmt(S.t) + ' / ' + fmt(endOf());
  $('tl-playhead').style.left = S.t * S.pps + 'px';
  $('tl-play').innerHTML = preview.playing()
    ? '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
}

function paintRuler(width) {
  const ruler = $('tl-ruler');
  ruler.textContent = '';
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find(s => s * S.pps >= 60) || 600;
  for (let s = 0; s * S.pps <= width; s += step) {
    const t = el('span', 'tl-tick', step < 1 ? s.toFixed(1) : clock(s));
    t.style.left = s * S.pps + 'px';
    ruler.append(t);
  }
}

function paintLanes() {
  const body = $('tl-body');
  const names = body.querySelector('.tl-names');
  const width = Math.max(body.clientWidth - names.offsetWidth - 2, (endOf() + 20) * S.pps);
  const lanesEl = $('tl-lanes');
  lanesEl.style.width = width + 'px';
  paintRuler(width);
  for (const [lane] of LANES) {
    const host = lanesEl.querySelector('[data-lane="' + lane + '"]');
    host.textContent = '';
    for (const c of (S.p && S.p.lanes[lane]) || []) host.append(_clipEl(c));
  }
  paintTime();
}

function _clipEl(c) {
  const d = el('div', 'clip is-' + c.kind + (S.sel.has(c.id) ? ' is-sel' : '') + (c.missing ? ' is-missing' : ''));
  d.dataset.id = c.id;
  d.style.left = c.start * S.pps + 'px';
  d.style.width = Math.max(2, c.dur * S.pps) + 'px';
  const name = c.rel.split('/').pop();
  d.title = name + (c.missing ? ' - its file is gone' : '');
  if (c.kind === 'audio') {
    const cv = el('canvas', 'clip-wave');
    d.append(cv);
    _wave(cv, c);
  } else if (!c.missing) {
    const im = el('img', 'clip-thumb');
    im.alt = '';
    im.loading = 'lazy';
    im.src = '/api/library/thumb?' + q({ root: c.root, rel: c.rel });
    im.addEventListener('error', () => im.remove());
    d.append(im);
  }
  d.append(el('span', 'clip-name', name.replace(/\.[^.]+$/, '')));
  return d;
}

// A sound clip draws its part of its file's wave (the 400 points the player uses).
function _wave(cv, c) {
  const key = c.root + '/' + c.rel;
  const have = peaks.get(key);
  if (!have) {
    if (c.missing) return;
    peaks.set(key, 'asking');
    api('/api/library/peaks?' + q({ root: c.root, rel: c.rel }))
      .then((r) => { peaks.set(key, r); paintLanes(); })
      .catch(() => peaks.delete(key));
    return;
  }
  if (have === 'asking' || !have.peaks || !have.peaks.length) return;
  const w = Math.max(2, Math.round(c.dur * S.pps));
  const h = 22;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#888';
  const total = have.duration || c.fileDur || c.dur;
  for (let x = 0; x < w; x += 2) {
    const ft = c.in + (x / S.pps);
    const i = Math.min(have.peaks.length - 1, Math.floor(ft / total * have.peaks.length));
    const bh = Math.max(1, (have.peaks[i] || 0) / 100 * h);
    g.fillRect(x, (h - bh) / 2, 1, bh);
  }
}

// ── Snapping ────────────────────────────────────────────────────────────────

function _snapPoints(except) {
  const pts = [0, S.t];
  for (const c of allClips()) if (!except.has(c.id)) pts.push(c.start, c.start + c.dur);
  return pts;
}

// The nearest point to any of `edges` within the snap's reach: how far to shift them (0 - none).
function _snap(edges, except) {
  const reach = SNAP_PX / S.pps;
  let best = 0;
  let bestD = reach;
  for (const p of _snapPoints(except)) {
    for (const e of edges) {
      const d = Math.abs(p - e);
      if (d < bestD) { bestD = d; best = p - e; }
    }
  }
  return best;
}

// ── Pointer on the lanes ────────────────────────────────────────────────────

function _laneAt(y) {
  for (const [lane] of LANES) {
    const r = $('tl-lanes').querySelector('[data-lane="' + lane + '"]').getBoundingClientRect();
    if (y >= r.top && y < r.bottom) return lane;
  }
  return null;
}

const _tAt = (x) => Math.max(0, (x - $('tl-lanes').getBoundingClientRect().left) / S.pps);

function _onClipDown(e, d) {
  const id = d.dataset.id;
  if (e.ctrlKey || e.metaKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); } else if (e.shiftKey) S.sel.add(id);
  else if (!S.sel.has(id)) S.sel = new Set([id]);
  const r = d.getBoundingClientRect();
  const x = e.clientX - r.left;
  const edge = S.sel.size === 1 && x < EDGE_PX ? 'l' : S.sel.size === 1 && x > r.width - EDGE_PX ? 'r' : null;
  const orig = new Map([...S.sel].map(cid => [cid, Object.assign({}, clipOf(cid), { lane: laneOf(cid) })]));
  const x0 = e.clientX;
  let started = false;
  const move = (ev) => {
    const dx = (ev.clientX - x0) / S.pps;
    if (!started) {
      if (Math.abs(ev.clientX - x0) < 3 && _laneAt(ev.clientY) === orig.get(id).lane) return;
      started = true;
      begin();
    }
    if (edge) {
      const o = orig.get(id);
      const c = clipOf(id);
      if (edge === 'l') {
        const lo = c.kind === 'image' ? 0 : Math.max(0, o.start - o.in);
        let s = Math.min(o.start + o.dur - MIN_DUR, Math.max(lo, o.start + dx));
        s += _snap([s], new Set([id]));
        s = Math.min(o.start + o.dur - MIN_DUR, Math.max(lo, s));
        c.start = s;
        if (c.kind !== 'image') c.in = o.in + (s - o.start);
        c.dur = o.dur - (s - o.start);
      } else {
        const hi = c.kind === 'image' || !o.fileDur ? Infinity : o.start + (o.fileDur - o.in);
        let end = Math.max(o.start + MIN_DUR, Math.min(hi, o.start + o.dur + dx));
        end += _snap([end], new Set([id]));
        end = Math.max(o.start + MIN_DUR, Math.min(hi, end));
        c.dur = end - o.start;
      }
    } else {
      let delta = dx;
      const minStart = Math.min(...[...orig.values()].map(o => o.start));
      delta = Math.max(-minStart, delta);
      const edges = [...orig.values()].flatMap(o => [o.start + delta, o.start + o.dur + delta]);
      delta += _snap(edges, new Set(orig.keys()));
      delta = Math.max(-minStart, delta);
      for (const [cid, o] of orig) clipOf(cid).start = o.start + delta;
      // One clip goes onto the other lane of its kind under the pointer.
      if (orig.size === 1) {
        const to = _laneAt(ev.clientY);
        const from = laneOf(id);
        const c = clipOf(id);
        if (to && to !== from && fits(to, c.kind)) {
          S.p.lanes[from] = S.p.lanes[from].filter(x => x.id !== id);
          S.p.lanes[to].push(c);
        }
      }
    }
    paintLanes();
    preview.show(S.t);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (started) commit(); else paintLanes();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function _onEmptyDown(e) {
  const lanesEl = $('tl-lanes');
  const r0 = lanesEl.getBoundingClientRect();
  const x0 = e.clientX;
  const y0 = e.clientY;
  const keep = e.ctrlKey || e.shiftKey || e.metaKey ? new Set(S.sel) : new Set();
  const band = el('div', 'tl-band');
  let started = false;
  const move = (ev) => {
    if (!started) {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return;
      started = true;
      lanesEl.append(band);
    }
    const l = Math.min(x0, ev.clientX);
    const t = Math.min(y0, ev.clientY);
    const w = Math.abs(ev.clientX - x0);
    const h = Math.abs(ev.clientY - y0);
    Object.assign(band.style, { left: (l - r0.left) + 'px', top: (t - r0.top) + 'px', width: w + 'px', height: h + 'px' });
    S.sel = new Set(keep);
    for (const d of lanesEl.querySelectorAll('.clip')) {
      const r = d.getBoundingClientRect();
      if (r.right > l && r.left < l + w && r.bottom > t && r.top < t + h) S.sel.add(d.dataset.id);
    }
    for (const d of lanesEl.querySelectorAll('.clip')) d.classList.toggle('is-sel', S.sel.has(d.dataset.id));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    band.remove();
    if (!started) { S.sel = keep; paintLanes(); }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function _onRulerDown(e) {
  const set = (ev) => {
    S.t = Math.min(_tAt(ev.clientX), Math.max(endOf(), 0));
    if (preview.playing()) { preview.pause(); preview.play(S.t); }
    preview.show(S.t);
    paintTime();
  };
  set(e);
  const up = () => { window.removeEventListener('pointermove', set); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', set);
  window.addEventListener('pointerup', up);
}

// ── Dropping files from the library ─────────────────────────────────────────

async function place(root, rels, lane, t) {
  const kind = KIND_OF_ROOT[root];
  if (!kind) { showError('Only music, clips and pictures go on the timeline.'); return; }
  if (!fits(lane, kind)) { showError(kind === 'audio' ? 'Music goes on a sound lane.' : 'Clips and pictures go on a video lane.'); return; }
  const add = [];
  let at = t;
  for (const rel of rels) {
    let dur = IMAGE_SEC;
    let fileDur = null;
    if (kind !== 'image') {
      try { fileDur = (await api('/api/library/info?' + q({ root, rel }))).duration || 0; } catch { fileDur = 0; }
      if (!fileDur) { showError(rel.split('/').pop() + ': its length could not be read.'); continue; }
      dur = fileDur;
    }
    add.push({ id: newId(), kind, root, rel, name: rel.split('/').pop(), start: at, dur, in: 0, fileDur, missing: false });
    at += dur;
  }
  if (!add.length) return;
  begin();
  S.p.lanes[lane].push(...add);
  S.sel = new Set(add.map(c => c.id));
  commit();
}

// ── Commands ────────────────────────────────────────────────────────────────

function split() {
  const t = S.t;
  const targets = (S.sel.size ? [...S.sel].map(clipOf) : allClips()).filter(c => c && t > c.start + 0.01 && t < c.start + c.dur - 0.01);
  if (!targets.length) return;
  begin();
  for (const c of targets) {
    const lane = laneOf(c.id);
    const cut = t - c.start;
    const second = Object.assign({}, c, { id: newId(), start: t, dur: c.dur - cut, in: c.kind === 'image' ? 0 : c.in + cut });
    c.dur = cut;
    S.p.lanes[lane].push(second);
  }
  commit();
}

function removePicked() {
  if (!S.sel.size) return;
  begin();
  for (const l of Object.keys(S.p.lanes)) S.p.lanes[l] = S.p.lanes[l].filter(c => !S.sel.has(c.id));
  S.sel.clear();
  commit();
}

function togglePlay() {
  if (preview.playing()) { preview.pause(); paintTime(); return; }
  if (S.t >= endOf() - 0.05) S.t = 0;
  setSpaceOwner('timeline');
  preview.play(S.t);
  paintTime();
}

async function render() {
  await flush();
  try {
    const r = await api('/api/projects/' + S.p.id + '/render', { method: 'POST', body: {} });
    JOBS.put(r.job);
    showToast('Rendering - it goes into Video / Renders; see Jobs.');
  } catch (e) {
    showError(e.message);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function initTimeline() {
  preview = createPreview($('tl-preview'), {
    project: () => S.p,
    onTime: (t) => {
      S.t = t;
      paintTime();
      // The lanes follow the playhead while it plays.
      const body = $('tl-body');
      const x = t * S.pps;
      const names = body.querySelector('.tl-names').offsetWidth;
      if (x > body.scrollLeft + body.clientWidth - names - 40) body.scrollLeft = x - 80;
    },
    onEnd: (t) => { S.t = t; paintTime(); },
  });
  $('tl-play').addEventListener('click', togglePlay);
  $('tl-render').addEventListener('click', render);
  $('tl-format').addEventListener('click', () => {
    if (!S.p) return;
    S.p.format = S.p.format === '9:16' ? '16:9' : '9:16';
    paintAll();
    saveSoon();
  });
  $('tl-ruler').addEventListener('pointerdown', _onRulerDown);
  $('tl-lanes').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('#tl-ruler')) return;
    const d = e.target.closest('.clip');
    if (d) _onClipDown(e, d); else _onEmptyDown(e);
  });
  $('tl-body').addEventListener('wheel', (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    const body = $('tl-body');
    const tAt = _tAt(e.clientX);
    const before = e.clientX - body.getBoundingClientRect().left;
    S.pps = Math.max(2, Math.min(400, S.pps * (e.deltaY < 0 ? 1.25 : 0.8)));
    remember({ tlPps: S.pps });
    paintLanes();
    body.scrollLeft = Math.max(0, tAt * S.pps - before + body.querySelector('.tl-names').offsetWidth);
  }, { passive: false });

  // Files dragged from the library's rows or from Recent.
  const lanesEl = $('tl-lanes');
  lanesEl.addEventListener('dragover', (e) => {
    const d = window.msDrag;
    const lane = _laneAt(e.clientY);
    for (const h of lanesEl.querySelectorAll('.tl-lane')) h.classList.toggle('is-drop', !!(d && lane && h.dataset.lane === lane && fits(lane, KIND_OF_ROOT[d.root])));
    if (!d || !lane || !fits(lane, KIND_OF_ROOT[d.root])) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  lanesEl.addEventListener('dragleave', (e) => {
    if (!lanesEl.contains(e.relatedTarget)) for (const h of lanesEl.querySelectorAll('.tl-lane')) h.classList.remove('is-drop');
  });
  lanesEl.addEventListener('drop', (e) => {
    for (const h of lanesEl.querySelectorAll('.tl-lane')) h.classList.remove('is-drop');
    const d = window.msDrag;
    const lane = _laneAt(e.clientY);
    if (!d || !lane) return;
    e.preventDefault();
    window.msDrag = null;
    let t = _tAt(e.clientX);
    t += _snap([t], new Set());
    place(d.root, d.rels, lane, Math.max(0, t));
  });

  document.addEventListener('keydown', (e) => {
    if (blocked(e) || spaceOwner() !== 'timeline' || !S.p) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); } else if (k === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); split(); } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePicked(); } else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(e.shiftKey); } else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); undo(true); } else if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      S.sel = new Set(allClips().map(c => c.id));
      paintLanes();
    } else if (e.key === 'Escape' && S.sel.size) { S.sel.clear(); paintLanes(); }
  });

  window.addEventListener('ms:project-open', async (e) => { await flush(); load(e.detail.id); });
  window.addEventListener('ms:project-renamed', (e) => { if (S.p && e.detail.id === S.p.id) load(S.p.id); });
  window.addEventListener('ms:project-deleted', (e) => { if (S.p && e.detail.id === S.p.id) { S.p = null; ensureProject(); } });
  // A file renamed, moved or archived in the library: the project is read again (the server followed it).
  window.addEventListener('ms:library-ops', async () => { if (S.p) { await flush(); load(S.p.id); } });
  new ResizeObserver(() => { if (S.p) paintLanes(); }).observe($('tl-body'));
  window.addEventListener('resize', () => { if (S.p) paintLanes(); });
  await ensureProject();
}
