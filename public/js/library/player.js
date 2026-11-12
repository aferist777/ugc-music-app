// ════════════════════════════════════════════════════════════════════════════
// THE PLAYER under the files (phase 1, the owner's sketch): ▶/⏸, the track's name, "0:41 / 2:41", its wave (400 points
// from the server) - a press or a drag on the wave moves the playhead. Space plays and pauses (not in a field, not
// under a window). A track renamed or moved keeps playing from where it was; one put into Archive leaves the player.
//   initPlayer(L) -> { load(root, file, { play }), toggle(), follow(root, from, to), forget(root, rel) }
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { blocked } from '../layers.js';
import { showError } from '../notice.js';
import { q, el, icon, clock, mediaUrl } from './common.js';

export function initPlayer() {
  const host = document.getElementById('player');
  const btn = el('button', 'pl-btn');
  btn.title = 'Play (Space)';
  const name = el('span', 'pl-name');
  const time = el('span', 'pl-time', '0:00 / 0:00');
  const canvas = el('canvas', 'pl-wave');
  // One line (the minimal design, 2026-11-12): play, the name, the wave, the time.
  host.append(btn, name, canvas, time);

  const audio = new Audio();
  audio.preload = 'auto';
  let cur = null; // { root, rel, base, duration }
  let peaks = [];
  let raf = 0;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function _icon() {
    btn.innerHTML = icon(audio.paused ? 'play' : 'pause', 14);
    btn.title = audio.paused ? 'Play (Space)' : 'Pause (Space)';
  }

  function _dur() {
    return (cur && cur.duration) || (Number.isFinite(audio.duration) ? audio.duration : 0);
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const d = _dur();
    const at = d ? Math.min(1, audio.currentTime / d) : 0;
    const n = Math.max(1, Math.floor(w / 3));
    const played = css('--ink') || '#eaeaea';
    const rest = css('--line2') || '#2e2e2e';
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * peaks.length / n);
      const b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / n));
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, peaks[k] || 0);
      const bh = Math.max(2, (m / 100) * (h - 4));
      g.fillStyle = (i + 0.5) / n <= at ? played : rest;
      g.fillRect(i * 3, (h - bh) / 2, 2, bh);
    }
    if (d) {
      g.fillStyle = css('--muted') || '#8c8c8c';
      g.fillRect(Math.round(at * w) - 1, 0, 2, h);
    }
    time.textContent = clock(audio.currentTime) + ' / ' + clock(d);
  }

  function _loop() {
    draw();
    raf = audio.paused ? 0 : requestAnimationFrame(_loop);
  }

  audio.addEventListener('play', () => { _icon(); if (!raf) raf = requestAnimationFrame(_loop); });
  audio.addEventListener('pause', () => { _icon(); draw(); });
  audio.addEventListener('ended', () => { _icon(); draw(); });
  audio.addEventListener('loadedmetadata', draw);
  audio.addEventListener('error', () => { if (cur) showError('"' + cur.base + '" cannot be played.'); });

  btn.addEventListener('click', toggle);

  // A press or a drag on the wave moves the playhead.
  canvas.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const seek = (ev) => {
      const r = canvas.getBoundingClientRect();
      const d = _dur();
      if (!d) return;
      audio.currentTime = Math.max(0, Math.min(d, (ev.clientX - r.left) / r.width * d));
      draw();
    };
    seek(e);
    const move = (ev) => seek(ev);
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });

  new ResizeObserver(draw).observe(canvas);
  // A theme changed: the wave takes its colours.
  window.addEventListener('resize', draw);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || blocked(e) || !cur) return;
    // A button with the focus would take Space as its own press too.
    e.preventDefault();
    toggle();
  });

  /** A track into the player; `play` starts it (a second load of the playing track pauses it). */
  async function load(root, f, { play } = {}) {
    if (cur && cur.root === root && cur.rel === f.rel) {
      if (play) toggle();
      return;
    }
    audio.pause();
    cur = { root, rel: f.rel, base: f.base, duration: f.duration || 0 };
    peaks = [];
    name.textContent = f.base;
    name.title = f.name;
    host.hidden = false;
    audio.src = mediaUrl(root, f.rel);
    _icon();
    draw();
    if (play) audio.play().catch(() => {});
    try {
      const r = await api('/api/library/peaks?' + q({ root, rel: f.rel }));
      if (cur && cur.rel === f.rel && cur.root === root) {
        peaks = r.peaks || [];
        if (r.duration) cur.duration = r.duration;
        draw();
      }
    } catch { /* no wave: the bar stays flat */ }
  }

  function toggle() {
    if (!cur) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  /** The track (or the folder it lies in) was renamed or moved: it goes on from where it was. */
  function follow(root, from, to) {
    if (!cur || cur.root !== root) return;
    if (cur.rel !== from && !cur.rel.startsWith(from + '/')) return;
    cur.rel = to + cur.rel.slice(from.length);
    cur.base = cur.rel.split('/').pop().replace(/\.[^.]+$/, '');
    name.textContent = cur.base;
    const t = audio.currentTime;
    const playing = !audio.paused;
    audio.src = mediaUrl(root, cur.rel);
    audio.currentTime = t;
    if (playing) audio.play().catch(() => {});
  }

  /** The track (or its folder) went into Archive: the player lets it go. */
  function forget(root, rel) {
    if (!cur || cur.root !== root) return;
    if (rel && cur.rel !== rel && !cur.rel.startsWith(rel + '/')) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    cur = null;
    host.hidden = true;
  }

  return { load, toggle, follow, forget, pause: () => audio.pause() };
}
