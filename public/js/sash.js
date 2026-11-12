// The two dividers: the library's width and the timeline's height. Dragged, kept, a double press puts one back.

import { remembered, remember } from './api.js';

const LIB = { def: 260, min: 180, max: 480, workMin: 420 };
const TL = { def: 220, min: 120, upperMin: 220 };

const root = document.documentElement;

function _libW(w) {
  const max = Math.min(LIB.max, window.innerWidth - LIB.workMin);
  return Math.round(Math.max(LIB.min, Math.min(max, w)));
}

function _tlH(h) {
  const top = parseFloat(getComputedStyle(root).getPropertyValue('--top-h')) || 44;
  const max = window.innerHeight - top - TL.upperMin;
  return Math.round(Math.max(TL.min, Math.min(max, h)));
}

function _set(libW, tlH) {
  root.style.setProperty('--lib-w', libW + 'px');
  root.style.setProperty('--tl-h', tlH + 'px');
}

function _drag(sash, axis, onMove, onEnd) {
  sash.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('is-drag');
    document.body.classList.add('is-dragging', 'is-dragging-' + axis);
    const move = (ev) => onMove(ev);
    const up = () => {
      sash.removeEventListener('pointermove', move);
      sash.removeEventListener('pointerup', up);
      sash.removeEventListener('pointercancel', up);
      sash.classList.remove('is-drag');
      document.body.classList.remove('is-dragging', 'is-dragging-' + axis);
      onEnd();
    };
    sash.addEventListener('pointermove', move);
    sash.addEventListener('pointerup', up);
    sash.addEventListener('pointercancel', up);
  });
}

export function initSashes() {
  const st = remembered();
  let libW = _libW(st.libW || LIB.def);
  let tlH = _tlH(st.tlH || TL.def);
  _set(libW, tlH);

  const lib = document.getElementById('sash-lib');
  const tl = document.getElementById('sash-tl');
  const app = document.getElementById('app');

  _drag(lib, 'v', (e) => {
    libW = _libW(e.clientX);
    _set(libW, tlH);
  }, () => remember({ libW }));
  _drag(tl, 'h', (e) => {
    tlH = _tlH(app.getBoundingClientRect().bottom - e.clientY);
    _set(libW, tlH);
  }, () => remember({ tlH }));

  lib.addEventListener('dblclick', () => { libW = _libW(LIB.def); _set(libW, tlH); remember({ libW }); });
  tl.addEventListener('dblclick', () => { tlH = _tlH(TL.def); _set(libW, tlH); remember({ tlH }); });

  // A smaller window keeps both within reach; what was kept comes back when there is room again.
  window.addEventListener('resize', () => {
    const kept = remembered();
    libW = _libW(kept.libW || LIB.def);
    tlH = _tlH(kept.tlH || TL.def);
    _set(libW, tlH);
  });
}
