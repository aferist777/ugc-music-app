// The viewer (phase 1): a picture or a clip large over the page, its description (the .txt beside it) on the right;
// a track's description alone. Escape, ✕ or a press on the dark around it closes it. Opened by a press, never by
// hovering (the owner's rule in UGC Studio).

import { api } from '../api.js';
import { pushLayer } from '../layers.js';
import { q, el, icon, clock, mediaUrl } from './common.js';

let open = null;

function _close() {
  if (!open) return;
  const o = open;
  open = null;
  const v = o.ov.querySelector('video');
  if (v) v.pause();
  o.ov.remove();
  o.pop();
}

function _size(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

export function openViewer(L, root, f, { describe = false } = {}) {
  _close();
  const ov = el('div', 'overlay viewer-ov');
  const box = el('div', 'viewer' + (describe || f.kind === 'music' ? ' is-text' : ''));
  const x = el('button', 'btn icon ghost viewer-x');
  x.title = 'Close (Esc)';
  x.innerHTML = icon('x', 14);

  if (!describe && f.kind !== 'music') {
    const stage = el('div', 'viewer-stage');
    if (f.kind === 'video') {
      const v = el('video');
      v.src = mediaUrl(root, f.rel);
      v.controls = true;
      v.autoplay = true;
      L.player.pause();
      stage.append(v);
    } else {
      const img = el('img');
      img.src = mediaUrl(root, f.rel);
      img.alt = f.base;
      stage.append(img);
    }
    box.append(stage);
  }

  const side = el('div', 'viewer-side');
  side.append(el('h2', 'viewer-name', f.base));
  const facts = [f.ext.replace('.', '').toUpperCase(), _size(f.size)];
  if (f.duration) facts.push(clock(f.duration));
  side.append(el('div', 'viewer-facts', facts.join(' · ')));
  if (f.from) side.append(el('div', 'viewer-facts', 'from ' + f.from));
  side.append(el('div', 'viewer-label', 'Description'));
  const text = el('pre', 'viewer-desc', '…');
  side.append(text);
  box.append(side, x);
  ov.append(box);
  document.body.append(ov);

  open = { ov, pop: pushLayer(_close) };
  x.addEventListener('click', _close);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) _close(); });

  api('/api/library/desc?' + q({ root, rel: f.rel }))
    .then((r) => {
      text.textContent = r.text == null ? 'No description - it is written beside a file the app makes.' : r.text;
      text.classList.toggle('is-none', r.text == null);
    })
    .catch((e) => { text.textContent = e.message; text.classList.add('is-none'); });
}
