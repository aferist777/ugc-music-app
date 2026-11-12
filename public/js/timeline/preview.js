// ════════════════════════════════════════════════════════════════════════════
// THE PREVIEW AND PLAYING (phase 4; the owner's T7: left of the lanes, a double press - large). What the render will
// make, drawn by the page: Video 2's clip over Video 1's (a picture an <img>, a clip a muted <video> - a clip's own sound
// is not used, T5), every sound clip under the playhead playing at its second, its volume by the crossing rule
// (fades.js, T6). Playing is the page's clock (performance.now): each media element is kept on it, put right when it
// drifts more than a quarter of a second.
//   createPreview(box, { project(), onTime(t), onEnd(t) }) -> { show(t), play(t), pause(), playing(), refresh(), setFormat(f) }
// ════════════════════════════════════════════════════════════════════════════

import { pushLayer } from '../layers.js';
import { mediaUrl } from '../library/common.js';
import { fadesOf, gainAt } from './fades.js';

// The clock ticks by a timer, not by animation frames: a hidden or minimised window keeps its sounds in step.
const TICK = 30;
const DRIFT = 0.25;

function _clipAt(list, t) {
  let hit = null;
  for (const c of list || []) if (t >= c.start && t < c.start + c.dur && !c.missing) hit = c; // the later one covers
  return hit;
}

export function createPreview(box, { project, onTime, onEnd }) {
  const layers = {};
  for (const lane of ['v1', 'v2']) {
    const l = document.createElement('div');
    l.className = 'tl-layer is-' + lane;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const img = document.createElement('img');
    img.alt = '';
    l.append(v, img);
    box.append(l);
    layers[lane] = { el: l, v, img, cur: null };
  }
  const sounds = new Map(); // clip id -> Audio
  let fades = new Map();
  let playing = false;
  let t0 = 0;
  let from = 0;
  let timer = 0;
  let popBig = null;

  function _layer(lane, c, t, live) {
    const L = layers[lane];
    if (!c) {
      L.v.hidden = true;
      L.img.hidden = true;
      if (!L.v.paused) L.v.pause();
      L.cur = null;
      return;
    }
    const url = mediaUrl(c.root, c.rel);
    if (c.kind === 'image') {
      if (L.img.dataset.url !== url) { L.img.src = url; L.img.dataset.url = url; }
      L.img.hidden = false;
      L.v.hidden = true;
      if (!L.v.paused) L.v.pause();
      L.cur = c.id;
      return;
    }
    const want = c.in + (t - c.start);
    if (L.v.dataset.url !== url) {
      L.v.src = url;
      L.v.dataset.url = url;
      L.v.addEventListener('loadedmetadata', () => { L.v.currentTime = c.in + ((playing ? now() : t) - c.start); if (playing) L.v.play().catch(() => {}); }, { once: true });
    } else if (Math.abs(L.v.currentTime - want) > (live ? DRIFT : 0.04)) {
      L.v.currentTime = want;
    }
    L.v.hidden = false;
    L.img.hidden = true;
    if (live && L.v.paused) L.v.play().catch(() => {});
    if (!live && !L.v.paused) L.v.pause();
    L.cur = c.id;
  }

  function _sounds(t, live) {
    const p = project();
    const here = new Set();
    for (const lane of ['a1', 'a2']) {
      for (const c of (p && p.lanes[lane]) || []) {
        if (c.missing || t < c.start || t >= c.start + c.dur) continue;
        here.add(c.id);
        if (!live) continue;
        let a = sounds.get(c.id);
        const url = mediaUrl(c.root, c.rel);
        if (!a || a.dataset.url !== url) {
          if (a) a.pause();
          a = new Audio(url);
          a.preload = 'auto';
          a.dataset.url = url;
          sounds.set(c.id, a);
        }
        const want = c.in + (t - c.start);
        if (a.paused) { a.currentTime = want; a.play().catch(() => {}); } else if (Math.abs(a.currentTime - want) > DRIFT) a.currentTime = want;
        a.volume = gainAt(c, fades.get(String(c.id)), t);
      }
    }
    for (const [id, a] of sounds) if (!here.has(id) && !a.paused) a.pause();
  }

  const now = () => from + (performance.now() - t0) / 1000;

  function show(t) {
    const p = project();
    _layer('v1', p && _clipAt(p.lanes.v1, t), t, false);
    _layer('v2', p && _clipAt(p.lanes.v2, t), t, false);
  }

  function _end() {
    const p = project();
    let e = 0;
    if (p) for (const l of Object.keys(p.lanes)) for (const c of p.lanes[l]) e = Math.max(e, c.start + c.dur);
    return e;
  }

  function _tick() {
    if (!playing) return;
    const t = now();
    const end = _end();
    if (t >= end) {
      pause();
      if (onEnd) onEnd(end);
      return;
    }
    const p = project();
    _layer('v1', _clipAt(p.lanes.v1, t), t, true);
    _layer('v2', _clipAt(p.lanes.v2, t), t, true);
    _sounds(t, true);
    if (onTime) onTime(t);
    timer = setTimeout(_tick, TICK);
  }

  function play(t) {
    if (playing) return;
    fades = fadesOf(project());
    from = t;
    t0 = performance.now();
    playing = true;
    timer = setTimeout(_tick, 0);
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    for (const L of Object.values(layers)) if (!L.v.paused) L.v.pause();
    for (const a of sounds.values()) if (!a.paused) a.pause();
  }

  /** The project changed: the crossings worked out again, the sounds of clips gone let go. */
  function refresh() {
    const p = project();
    fades = fadesOf(p);
    const ids = new Set(p ? Object.values(p.lanes).flat().map(c => c.id) : []);
    for (const [id, a] of sounds) if (!ids.has(id)) { a.pause(); sounds.delete(id); }
  }

  function setFormat(f) {
    box.classList.toggle('is-916', f === '9:16');
  }

  // A double press: large in the middle of the window; again, Escape or a press on the dark - back.
  const dim = document.createElement('div');
  dim.className = 'tl-dim';
  dim.hidden = true;
  document.body.append(dim);
  const small = () => {
    box.classList.remove('is-big');
    dim.hidden = true;
    if (popBig) { popBig(); popBig = null; }
  };
  box.addEventListener('dblclick', () => {
    if (box.classList.contains('is-big')) { small(); return; }
    box.classList.add('is-big');
    dim.hidden = false;
    popBig = pushLayer(small);
  });
  dim.addEventListener('pointerdown', small);

  return { show, play, pause, playing: () => playing, refresh, setFormat };
}
