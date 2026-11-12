// What the library's page modules share: addresses, icons, time, small builders.

import { api } from '../api.js';

export const post = (url, body) => api(url, { method: 'POST', body: body || {} });

export const enc = (rel) => String(rel).split('/').map(encodeURIComponent).join('/');
export const mediaUrl = (root, rel) => '/media/' + root + '/' + enc(rel);
export const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
export const thumbUrl = (root, f) => '/api/library/thumb?' + q({ root, rel: f.rel, v: Math.round(f.mtime || 0) });

export const parentRel = (rel) => String(rel).split('/').slice(0, -1).join('/');
export const lastOf = (rel) => String(rel).split('/').pop();

export function clock(s) {
  const t = Math.max(0, +s || 0);
  const m = Math.floor(t / 60);
  return m + ':' + String(Math.floor(t - m * 60)).padStart(2, '0');
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const PATHS = {
  music: '<path d="M6 12.5V4l7-1.5v8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<circle cx="4.5" cy="12.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle cx="11.5" cy="10.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  images: '<rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle cx="6" cy="6.6" r="1.2" fill="currentColor"/>'
    + '<path d="M2.6 12l3.6-3.4 2.6 2.4 2-1.8 2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  video: '<rect x="2" y="4" width="9" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<path d="M11 7l3-1.8v5.6L11 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  archive: '<rect x="2" y="3" width="12" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<path d="M3 6v6.5c0 .6.4 1 1 1h8c.6 0 1-.4 1-1V6M6.5 9h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  folder: '<path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  project: '<rect x="2" y="3.5" width="12" height="9" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 7h12M5 3.5v3.5M9 7v5.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  caret: '<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  play: '<path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/>',
  pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/>',
};

export function icon(name, size) {
  const s = size || 16;
  return '<svg viewBox="0 0 16 16" width="' + s + '" height="' + s + '" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
}

/** A row's small wave: 64 points (0..100) as mirrored bars. */
export function miniWave(wave) {
  const w = Array.isArray(wave) ? wave : [];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'mini-wave');
  svg.setAttribute('viewBox', '0 0 128 20');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, (Math.max(0, Math.min(100, +w[i] || 0)) / 100) * 19);
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(i * 2));
    r.setAttribute('width', '1.2');
    r.setAttribute('y', String(10 - h / 2));
    r.setAttribute('height', String(h));
    svg.append(r);
  }
  return svg;
}

const PICTURE = /\.(jpe?g|png|webp|gif)$/i;
export const isPicture = (name) => PICTURE.test(String(name));
