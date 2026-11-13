// ════════════════════════════════════════════════════════════════════════════
// THE PREVIEW AND PLAYING (phase 4; the owner's T7: left of the lanes, a double press - large). What the render will
// make, drawn by the page: Video 2's clip over Video 1's (a picture an <img>, a clip a muted <video> - a clip's own sound
// is not used, T5), every sound clip under the playhead playing at its second, its volume by the crossing rule
// (fades.js, T6 / P4). Playing is the page's clock (performance.now): each media element is kept on it, put right when
// it drifts more than a quarter of a second.
// Phase 6 (the owner: "at a seam of the video lane the preview stalls"): each video lane has TWO players - the one
// shown and the next clip, loaded and stood on its first frame AHEAD seconds before the seam, so the seam is a swap,
// not a load; the next picture is decoded ahead, the next sounds loaded ahead. The preview's QUALITY (the button beside
// the frame's, the owner's P6): 360p / 720p play light copies the server makes once in the background (pictures a
// copy of 640 / 1280 px), Full the files themselves; a copy not made yet - the file itself meanwhile. The render
// always takes the files themselves.
//   createPreview(box, { project(), onTime(t), onEnd(t) })
//     -> { show(t), play(t), pause(), playing(), refresh(), setFormat(f), quality(), setQuality(q) }
// ════════════════════════════════════════════════════════════════════════════

import { api, remembered, remember } from '../api.js';
import { pushLayer } from '../layers.js';
import { mediaUrl, q } from '../library/common.js';
import { fadesOf, gainAt } from './fades.js';

// The clock ticks by a timer, not by animation frames: a hidden or minimised window keeps its sounds in step.
const TICK = 30;
const DRIFT = 0.25;
const AHEAD = 2;
export const QUALITIES = ['360p', '720p', 'Full'];
const PICTURE = { '360p': 'p640', '720p': 'p1280' };

function _clipAt(list, t) {
  let hit = null;
  for (const c of list || []) if (t >= c.start && t < c.start + c.dur && !c.missing) hit = c; // the later one covers
  return hit;
}

// The clip a lane shows next after `t` - within AHEAD seconds: one that starts later, or one under the playhead now,
// covered by the one playing, that goes on after it ends.
function _nextAt(list, t, cur) {
  const from = cur ? cur.start + cur.dur : t;
  let best = null;
  let bestAt = Infinity;
  for (const c of list || []) {
    if (c.missing || (cur && c.id === cur.id)) continue;
    const at = c.start > t ? c.start : (c.start + c.dur > from + 0.001 ? from : Infinity);
    if (at > t + AHEAD || at >= bestAt) continue;
    best = c;
    bestAt = at;
  }
  return best;
}

export function createPreview(box, { project, onTime, onEnd }) {
  const layers = {};
  for (const lane of ['v1', 'v2']) {
    const l = document.createElement('div');
    l.className = 'tl-layer is-' + lane;
    const slots = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      const img = document.createElement('img');
      img.alt = '';
      l.append(v, img);
      return { v, img, id: null, kind: null };
    });
    box.append(l);
    layers[lane] = { el: l, slots, shown: null };
  }
  const sounds = new Map(); // clip id -> Audio
  let fades = new Map();
  let playing = false;
  let t0 = 0;
  let from = 0;
  let timer = 0;
  let popBig = null;
  let lastShown = 0;
  let quality = QUALITIES.includes(remembered().tlQuality) ? remembered().tlQuality : '720p';

  // ── The light copies ──────────────────────────────────────────────────────
  const copies = new Map(); // quality|root/rel -> { url } | { same } | 'asking' | 'none'
  const queue = [];
  let asking = false;
  const _ckey = (c) => quality + '|' + c.root + '/' + c.rel;

  function _wantCopies() {
    if (quality === 'Full') return;
    const p = project();
    for (const lane of ['v1', 'v2']) {
      for (const c of (p && p.lanes[lane]) || []) {
        if (c.kind !== 'video' || c.missing || copies.has(_ckey(c))) continue;
        copies.set(_ckey(c), 'asking');
        queue.push({ key: _ckey(c), root: c.root, rel: c.rel, q: parseInt(quality, 10) });
      }
    }
    _askNext();
  }

  // One at a time - a copy can take a while, and the page keeps its few connections for everything else.
  async function _askNext() {
    if (asking || !queue.length) return;
    asking = true;
    const job = queue.shift();
    try {
      const r = await api('/api/library/proxy?' + q({ root: job.root, rel: job.rel, q: job.q }));
      copies.set(job.key, r.same ? { same: true } : { url: r.url });
      if (!playing) show(lastShown);
    } catch {
      copies.set(job.key, 'none');
    }
    asking = false;
    _askNext();
  }

  function urlOf(c) {
    if (c.kind === 'image') {
      return quality === 'Full' ? mediaUrl(c.root, c.rel) : '/api/library/thumb?' + q({ root: c.root, rel: c.rel, size: PICTURE[quality] });
    }
    const got = quality === 'Full' ? null : copies.get(_ckey(c));
    return got && got.url ? got.url : mediaUrl(c.root, c.rel);
  }

  // ── The players ───────────────────────────────────────────────────────────

  const now = () => from + (performance.now() - t0) / 1000;

  // A slot made to hold clip `c` at its file's second `at` (a video waits for its first data, then stands there).
  function _load(s, c, at) {
    const url = urlOf(c);
    s.id = c.id;
    s.kind = c.kind;
    if (c.kind === 'image') {
      if (s.img.dataset.url !== url) {
        s.img.src = url;
        s.img.dataset.url = url;
        if (s.img.decode) s.img.decode().catch(() => {});
      }
      if (!s.v.paused) s.v.pause();
      return;
    }
    if (s.v.dataset.url !== url) {
      s.v.src = url;
      s.v.dataset.url = url;
      s.want = at;
      s.v.addEventListener('loadedmetadata', () => { if (s.want != null) s.v.currentTime = s.want; s.want = null; }, { once: true });
    } else if (s.v.readyState >= 1 && Math.abs(s.v.currentTime - at) > 0.04) {
      s.v.currentTime = at;
    } else if (s.v.readyState < 1) {
      s.want = at;
    }
  }

  function _showSlot(L, s) {
    for (const x of L.slots) {
      const on = x === s;
      x.v.classList.toggle('is-on', on && x.kind === 'video');
      x.img.classList.toggle('is-on', on && x.kind === 'image');
      if (!on && !x.v.paused) x.v.pause();
    }
    L.shown = s;
  }

  function _lane(lane, t, live) {
    const L = layers[lane];
    const p = project();
    const list = p && p.lanes[lane];
    const cur = _clipAt(list, t);
    const next = _nextAt(list, t, cur);
    if (!cur) {
      _showSlot(L, null);
    } else {
      let s = L.slots.find(x => x.id === cur.id);
      if (!s) s = L.slots.find(x => x !== L.shown && (!next || x.id !== next.id)) || L.slots.find(x => !next || x.id !== next.id) || L.slots[0];
      const want = cur.kind === 'image' ? 0 : cur.in + (t - cur.start);
      if (s.id !== cur.id || !live) _load(s, cur, want);
      _showSlot(L, s);
      if (cur.kind === 'video' && s.v.readyState >= 1) {
        if (live && Math.abs(s.v.currentTime - want) > DRIFT) s.v.currentTime = want;
        if (live && s.v.paused) s.v.play().catch(() => {});
        if (!live && !s.v.paused) s.v.pause();
      } else if (cur.kind === 'video' && live && !s.waiting) {
        s.waiting = true;
        s.v.addEventListener('canplay', () => { s.waiting = false; if (playing && L.shown === s) s.v.play().catch(() => {}); }, { once: true });
      }
    }
    // The next clip of the lane, ready in the other slot.
    if (next) {
      const o = L.slots.find(x => x !== L.shown) || null;
      const holds = o && (next.kind === 'image' ? o.img.dataset.url : o.v.dataset.url);
      if (o && (o.id !== next.id || o.kind !== next.kind || holds !== urlOf(next))) {
        _load(o, next, next.kind === 'image' ? 0 : next.in);
      }
    }
  }

  function _sounds(t, live) {
    const p = project();
    const here = new Set();
    for (const lane of ['a1', 'a2']) {
      for (const c of (p && p.lanes[lane]) || []) {
        if (c.missing) continue;
        const url = mediaUrl(c.root, c.rel);
        // The next sounds loaded ahead and stood on their first second.
        if (c.start > t && c.start <= t + AHEAD) {
          let a = sounds.get(c.id);
          if (!a || a.dataset.url !== url) {
            if (a) a.pause();
            a = new Audio(url);
            a.preload = 'auto';
            a.dataset.url = url;
            a.currentTime = c.in;
            sounds.set(c.id, a);
          }
          continue;
        }
        if (t < c.start || t >= c.start + c.dur) continue;
        here.add(c.id);
        if (!live) continue;
        let a = sounds.get(c.id);
        if (!a || a.dataset.url !== url) {
          if (a) a.pause();
          a = new Audio(url);
          a.preload = 'auto';
          a.dataset.url = url;
          sounds.set(c.id, a);
        }
        const want = c.in + (t - c.start);
        if (a.paused) { if (Math.abs(a.currentTime - want) > 0.05) a.currentTime = want; a.play().catch(() => {}); } else if (Math.abs(a.currentTime - want) > DRIFT) a.currentTime = want;
        a.volume = gainAt(c, fades.get(String(c.id)), t);
      }
    }
    for (const [id, a] of sounds) if (!here.has(id) && !a.paused) a.pause();
  }

  function show(t) {
    lastShown = t;
    _lane('v1', t, false);
    _lane('v2', t, false);
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
    _lane('v1', t, true);
    _lane('v2', t, true);
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
    for (const L of Object.values(layers)) for (const s of L.slots) if (!s.v.paused) s.v.pause();
    for (const a of sounds.values()) if (!a.paused) a.pause();
  }

  /** The project changed: the crossings worked out again, the sounds of clips gone let go, the copies asked for. */
  function refresh() {
    const p = project();
    fades = fadesOf(p);
    const ids = new Set(p ? Object.values(p.lanes).flat().map(c => c.id) : []);
    for (const [id, a] of sounds) if (!ids.has(id)) { a.pause(); sounds.delete(id); }
    for (const L of Object.values(layers)) for (const s of L.slots) if (s.id && !ids.has(s.id)) s.id = null;
    _wantCopies();
  }

  function setFormat(f) {
    box.classList.toggle('is-916', f === '9:16');
  }

  function setQuality(qq) {
    if (!QUALITIES.includes(qq)) return;
    quality = qq;
    remember({ tlQuality: qq });
    for (const L of Object.values(layers)) for (const s of L.slots) s.id = null;
    _wantCopies();
    if (!playing) show(lastShown);
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

  return { show, play, pause, playing: () => playing, refresh, setFormat, quality: () => quality, setQuality };
}
