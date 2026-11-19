// ════════════════════════════════════════════════════════════════════════════
// THE TIMELINE (phase 4) - the project picked under Projects in the library (the owner's T1) on two video lanes (Video 2
// over Video 1) and two sound lanes (T2). Clips come from the library's rows and from Recent of the Music tab by a drag:
// music onto a sound lane, clips and pictures onto a video lane (a picture lasts 5 s - T3). A clip is moved (along its
// lane and onto the other lane of its kind), trimmed by its edges, split at the playhead (S), deleted (Delete); several
// are picked with Ctrl / Shift or a band; everything snaps to the clips' edges and the playhead; Ctrl+Z / Ctrl+Y; Ctrl+C /
// Ctrl+X / Ctrl+V (phase 6: pasted at the playhead - after the clip it stands on -, the playhead then at their end); Alt +
// wheel zooms around the playhead; a press on the ruler moves the playhead. Space plays it when the timeline was used last. The frame's
// shape is the button over the preview - it says the OTHER shape (T4). The project is saved by itself after every
// change; one the library changed meanwhile (a file renamed, moved, archived) is read again. Phase 6: the lanes fill the
// timeline's height (sound lanes half as tall again as video ones); a clip or a picture is a row of square frames (no
// name - it is in the hint); a sound clip is see-through - the one dragged goes on top and its wave, where it lies over
// another, is drawn in the second colour, the fades' curves over both.
// ════════════════════════════════════════════════════════════════════════════

import { api, remembered, remember } from '../api.js';
import { showError, showToast } from '../notice.js';
import { blocked } from '../layers.js';
import { openMenu } from '../menu.js';
import { spaceOwner, setSpaceOwner } from '../space.js';
import { q, clock } from '../library/common.js';
import * as JOBS from '../music/jobs-store.js';
import { createPreview, QUALITIES } from './preview.js';
import { fadesOf, gainAt } from './fades.js';

const $ = (id) => document.getElementById(id);
const LANES = [['v2', 'Video 2', 'video'], ['v1', 'Video 1', 'video'], ['a1', 'Audio 1', 'audio'], ['a2', 'Audio 2', 'audio']];
const KIND_OF_ROOT = { music: 'audio', video: 'video', images: 'image' };
const IMAGE_SEC = 5;
const TILE = 4000;      // a canvas at most this wide (css px) - a much wider one draws nothing
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
  dragIds: null,    // the clips being dragged - drawn on top
};
// Ctrl+C / Ctrl+X: the window's own buffer, kept while it is open - pasted into this project or another.
let clipboard = null;
const strips = new Map(); // root + rel -> { meta, img } | 'asking' | 'none'
let seen = null;          // a clip's frames are asked for once it comes into sight
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
  // The Images tab's frame follows the project's (phase 5, the owner's i4).
  window.dispatchEvent(new CustomEvent('ms:project-opened', { detail: { id: S.p.id, format: S.p.format } }));
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
  $('tl-name').textContent = S.p ? S.p.name + ' ▾' : '';
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
  if (seen) seen.disconnect();
  const fades = fadesOf(S.p);
  for (const [lane] of LANES) {
    const host = lanesEl.querySelector('[data-lane="' + lane + '"]');
    host.textContent = '';
    // The clip's inside: the lane less its 2 px above and below and its border.
    const h = Math.max(6, host.clientHeight - 7);
    for (const c of (S.p && S.p.lanes[lane]) || []) host.append(_clipEl(c, lane, h, fades));
  }
  paintTime();
}

function _clipEl(c, lane, h, fades) {
  const d = el('div', 'clip is-' + c.kind + (S.sel.has(c.id) ? ' is-sel' : '') + (c.missing ? ' is-missing' : '')
    + (S.dragIds && S.dragIds.has(c.id) ? ' is-drag' : ''));
  d.dataset.id = c.id;
  d.style.left = c.start * S.pps + 'px';
  const w = Math.max(2, c.dur * S.pps);
  d.style.width = w + 'px';
  const name = c.rel.split('/').pop();
  d.title = name + (c.missing ? ' - its file is gone' : '');
  if (c.kind === 'audio') {
    _paintWave(d, c, lane, w, h, fades.get(String(c.id)));
    d.append(el('span', 'clip-name', name.replace(/\.[^.]+$/, '')));
  } else if (!c.missing) {
    _paintFrames(d, c, w, h);
  }
  return d;
}

// Canvases side by side over a clip's width (one canvas of a long clip zoomed in would be too wide to draw), each
// handed the clip's own x: draw(g, x0, x1).
function _tiles(d, w, h, draw) {
  const dpr = window.devicePixelRatio || 1;
  for (let x0 = 0; x0 < w; x0 += TILE) {
    const tw = Math.min(TILE, w - x0);
    const cv = el('canvas', 'clip-cv');
    cv.width = Math.max(1, Math.ceil(tw * dpr));
    cv.height = Math.max(1, Math.ceil(h * dpr));
    cv.style.left = x0 + 'px';
    cv.style.width = tw + 'px';
    cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, 0);
    draw(g, x0, x0 + tw);
    d.append(cv);
  }
}

const _css = (name, or) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || or;

// A sound clip draws its part of its file's wave (the 400 points the player uses). Where it lies OVER another clip of
// its lane (it comes later in the lane's order - the one dragged last is on top), or while it is dragged, the wave is
// in the second colour; the fades' volume curves are drawn over it, what they take away shaded.
function _paintWave(d, c, lane, w, h, f) {
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
  const list = S.p.lanes[lane];
  const at = list.findIndex(x => x.id === c.id);
  const over = list.slice(0, at)
    .filter(o => o.start < c.start + c.dur && o.start + o.dur > c.start)
    .map(o => [Math.max(o.start, c.start) - c.start, Math.min(o.start + o.dur, c.start + c.dur) - c.start]);
  const dragged = !!(S.dragIds && S.dragIds.has(c.id));
  const low = _css('--wave', '#888');
  const top = _css('--wave-top', '#5aa0ff');
  const shade = _css('--fade-shade', 'rgba(0,0,0,.35)');
  const line = _css('--ink2', '#bbb');
  const total = have.duration || c.fileDur || c.dur;
  _tiles(d, w, h, (g, x0, x1) => {
    for (let x = x0 - (x0 % 2); x < x1; x += 2) {
      const sec = x / S.pps;
      const ft = c.in + sec;
      const i = Math.min(have.peaks.length - 1, Math.floor(ft / total * have.peaks.length));
      const bh = Math.max(1, (have.peaks[i] || 0) / 100 * h);
      g.fillStyle = dragged || over.some(([a, b]) => sec >= a && sec < b) ? top : low;
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
    if (!f || (f.in < 0.01 && f.out < 0.01)) return;
    const spans = [];
    if (f.in >= 0.01) spans.push([0, f.in * S.pps]);
    if (f.out >= 0.01) spans.push([w - f.out * S.pps, w]);
    for (const [a0, b0] of spans) {
      const a = Math.max(a0, x0);
      const b = Math.min(b0, x1);
      if (b <= a) continue;
      const ys = [];
      for (let x = a; x <= b; x += 1) ys.push([x, h - gainAt(c, f, c.start + x / S.pps) * h]);
      g.beginPath();
      g.moveTo(a, 0);
      for (const [x, y] of ys) g.lineTo(x, y);
      g.lineTo(b, 0);
      g.closePath();
      g.fillStyle = shade;
      g.fill();
      g.beginPath();
      ys.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.stroke();
    }
  });
}

// A clip or a picture: square frames side by side over its whole length, each the frame of its own moment in the
// file (a picture - itself in every square). The frames are one strip the server makes once (lib/media-info.js
// `strip`), asked for only once the clip comes into sight.
function _paintFrames(d, c, w, h) {
  const key = c.root + '/' + c.rel;
  const have = strips.get(key);
  if (!have) { d.dataset.strip = key; if (seen) seen.observe(d); return; }
  if (have === 'asking' || have === 'none') return;
  const { n, step, size } = have.meta;
  _tiles(d, w, h, (g, x0, x1) => {
    for (let x = Math.floor(x0 / h) * h; x < x1; x += h) {
      const ft = c.kind === 'image' || !step ? 0 : c.in + (x + h / 2) / S.pps;
      const i = step ? Math.max(0, Math.min(n - 1, Math.round(ft / step))) : 0;
      g.drawImage(have.img, i * size, 0, size, size, x, 0, Math.max(1, h - 1), h);
    }
  });
}

function _askStrip(key) {
  if (strips.has(key)) return;
  strips.set(key, 'asking');
  const cut = key.indexOf('/');
  const root = key.slice(0, cut);
  const rel = key.slice(cut + 1);
  api('/api/library/strip?' + q({ root, rel })).then((meta) => {
    const img = new Image();
    img.onload = () => { strips.set(key, { meta, img }); paintLanes(); };
    img.onerror = () => strips.set(key, 'none');
    img.src = '/api/library/strip-img?' + q({ root, rel });
  }).catch(() => strips.set(key, 'none'));
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

/** The lanes scrolled so the playhead stands in their middle (at the film's start they begin at 0). */
function centerPlayhead() {
  const body = $('tl-body');
  const view = body.clientWidth - body.querySelector('.tl-names').offsetWidth;
  body.scrollLeft = Math.max(0, S.t * S.pps - view / 2);
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
    // The button let go where the window did not hear it (outside it): the drag ends where it was.
    if (ev.buttons === 0) { up(); return; }
    const dx = (ev.clientX - x0) / S.pps;
    if (!started) {
      if (Math.abs(ev.clientX - x0) < 3 && _laneAt(ev.clientY) === orig.get(id).lane) return;
      started = true;
      begin();
      // A sound clip dragged goes on top of its lane (last in its order) - drawn over the others, its wave in the
      // second colour where it lies over one (phase 6, the owner's P3).
      for (const cid of orig.keys()) {
        const c = clipOf(cid);
        const l = laneOf(cid);
        if (c && c.kind === 'audio') S.p.lanes[l] = S.p.lanes[l].filter(x => x.id !== cid).concat([c]);
      }
      S.dragIds = new Set(orig.keys());
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
    S.dragIds = null;
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

/** The picked clips into the window's buffer, with their lanes and their places to one another. */
function copyPicked() {
  const picked = [...S.sel].map(id => ({ lane: laneOf(id), clip: clipOf(id) })).filter(x => x.lane && x.clip);
  if (!picked.length) return false;
  const t0 = Math.min(...picked.map(x => x.clip.start));
  clipboard = picked.map(({ lane, clip }) => ({ lane, clip: Object.assign({}, clip, { start: clip.start - t0 }) }));
  showToast(picked.length === 1 ? 'Clip copied' : picked.length + ' clips copied');
  return true;
}

/**
 * The buffer laid on its own lanes STARTING AT THE PLAYHEAD - or, when the playhead stands on a clip of one of those
 * lanes, right after that clip (and after any clip that goes on from there) - the owner's answer to item 1. The pasted
 * clips are picked and the playhead goes to their end, so Ctrl+V again lays the next copy after them. One Ctrl+Z step.
 */
function paste() {
  if (!clipboard || !clipboard.length || !S.p) return;
  const lanes = [...new Set(clipboard.map(x => x.lane))];
  const span = Math.max(...clipboard.map(x => x.clip.start + x.clip.dur));
  let at = S.t;
  for (let guard = 0; guard < 1000; guard++) {
    const under = lanes.flatMap(l => S.p.lanes[l]).filter(c => at >= c.start - 1e-6 && at < c.start + c.dur - 1e-6);
    if (!under.length) break;
    at = Math.max(...under.map(c => c.start + c.dur));
  }
  begin();
  const ids = [];
  for (const { lane, clip } of clipboard) {
    const c = Object.assign({}, clip, { id: newId(), start: at + clip.start });
    S.p.lanes[lane].push(c);
    ids.push(c.id);
  }
  S.sel = new Set(ids);
  S.t = at + span;
  commit();
  _keepInView();
}

/** The lanes scrolled, when they must, so the playhead is in sight. */
function _keepInView() {
  const body = $('tl-body');
  const names = body.querySelector('.tl-names').offsetWidth;
  const x = S.t * S.pps;
  if (x < body.scrollLeft || x > body.scrollLeft + body.clientWidth - names - 20) centerPlayhead();
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
  seen = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting || !e.target.dataset.strip) continue;
      seen.unobserve(e.target);
      _askStrip(e.target.dataset.strip);
    }
  }, { root: $('tl-body'), rootMargin: '0px 600px' });
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
  // The preview's quality (phase 6, the owner's P6) - beside the frame's shape: 360p, 720p, Full in turn.
  const qBtn = $('tl-quality');
  const paintQuality = () => {
    qBtn.textContent = preview.quality();
    qBtn.title = 'The preview plays ' + (preview.quality() === 'Full' ? 'the files themselves' : 'light ' + preview.quality()
      + ' copies, made once in the background') + ' - press for ' + QUALITIES[(QUALITIES.indexOf(preview.quality()) + 1) % QUALITIES.length]
      + '. The render always takes the files themselves.';
  };
  qBtn.addEventListener('click', () => {
    preview.setQuality(QUALITIES[(QUALITIES.indexOf(preview.quality()) + 1) % QUALITIES.length]);
    paintQuality();
  });
  paintQuality();
  $('tl-play').addEventListener('click', togglePlay);
  $('tl-render').addEventListener('click', render);
  $('tl-format').addEventListener('click', () => {
    if (!S.p) return;
    S.p.format = S.p.format === '9:16' ? '16:9' : '9:16';
    paintAll();
    saveSoon();
    window.dispatchEvent(new CustomEvent('ms:format', { detail: { format: S.p.format } }));
  });
  $('tl-ruler').addEventListener('pointerdown', _onRulerDown);
  $('tl-lanes').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('#tl-ruler')) return;
    const d = e.target.closest('.clip');
    if (d) _onClipDown(e, d); else _onEmptyDown(e);
  });
  // Alt + wheel zooms AROUND THE PLAYHEAD, which then stands in the middle of the lanes (phase 6, the owner).
  $('tl-body').addEventListener('wheel', (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    S.pps = Math.max(2, Math.min(400, S.pps * (e.deltaY < 0 ? 1.25 : 0.8)));
    remember({ tlPps: S.pps });
    paintLanes();
    centerPlayhead();
  }, { passive: false });

  // A picture's right button: Animate - the picture becomes the Animate tab's start frame (phase 5, the owner's i8).
  $('tl-lanes').addEventListener('contextmenu', (e) => {
    const d = e.target.closest('.clip');
    const c = d && clipOf(d.dataset.id);
    if (!c || c.kind !== 'image') return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [{
      label: 'Animate', disabled: !!c.missing,
      act: () => window.dispatchEvent(new CustomEvent('ms:animate', { detail: { root: c.root, rel: c.rel } })),
    }]);
  });

  // Files dragged from the library's rows, from Recent, or from the Images and Animate chats.
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
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (k === 'c' || k === 'x' || k === 'v')) {
      e.preventDefault();
      if (k === 'v') paste();
      else if (copyPicked() && k === 'x') removePicked();
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); } else if (k === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); split(); } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePicked(); } else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(e.shiftKey); } else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); undo(true); } else if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      S.sel = new Set(allClips().map(c => c.id));
      paintLanes();
    } else if (e.key === 'Escape' && S.sel.size) { S.sel.clear(); paintLanes(); }
  });

  window.addEventListener('ms:project-open', async (e) => { await flush(); load(e.detail.id); });
  // The project's name opens the list of projects (phase 9, the owner's B5): another one, or a new one - made and named
  // under Projects in the library, as its "+" does.
  $('tl-name').addEventListener('click', async () => {
    let list = [];
    try { list = (await api('/api/projects')).projects || []; } catch (e) { showError(e.message); return; }
    const r = $('tl-name').getBoundingClientRect();
    const open = (id) => window.dispatchEvent(new CustomEvent('ms:project-open', { detail: { id } }));
    openMenu(r.left, r.bottom + 2, [
      ...list.map(p => ({ label: (S.p && p.id === S.p.id ? '✓ ' : '') + p.name, act: () => { if (!S.p || p.id !== S.p.id) open(p.id); } })),
      { sep: true },
      { label: 'New project', act: () => window.dispatchEvent(new CustomEvent('ms:project-new')) },
    ]);
  });
  window.addEventListener('ms:project-renamed', (e) => { if (S.p && e.detail.id === S.p.id) load(S.p.id); });
  window.addEventListener('ms:project-deleted', (e) => { if (S.p && e.detail.id === S.p.id) { S.p = null; ensureProject(); } });
  // A file renamed, moved or archived in the library: the project is read again (the server followed it).
  window.addEventListener('ms:library-ops', async () => { if (S.p) { await flush(); load(S.p.id); } });
  new ResizeObserver(() => { if (S.p) paintLanes(); }).observe($('tl-body'));
  window.addEventListener('resize', () => { if (S.p) paintLanes(); });
  await ensureProject();
}
