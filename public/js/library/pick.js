// "Move to…": a small window with the folders of one root; a press on one answers it. Escape, ✕ or the dark around it
// answers null. The folder the files lie in is shown but not offered.

import { pushLayer } from '../layers.js';
import { el, icon } from './common.js';

export function pickFolder(L, rootId, here) {
  return new Promise((resolve) => {
    const root = L.rootOf(rootId);
    if (!root) { resolve(null); return; }
    const ov = el('div', 'overlay');
    const box = el('div', 'dialog pick');
    const head = el('div', 'dialog-head');
    head.append(el('h2', null, 'Move to'));
    const x = el('button', 'btn icon ghost');
    x.title = 'Close (Esc)';
    x.innerHTML = icon('x', 14);
    head.append(x);
    const list = el('div', 'pick-list');
    let pop = null;
    const done = (v) => {
      ov.remove();
      if (pop) pop();
      resolve(v);
    };
    const add = (rel, label, depth) => {
      const b = el('button', 'pick-row' + (rel === here ? ' is-here' : ''));
      b.style.paddingLeft = (12 + depth * 16) + 'px';
      b.innerHTML = icon(rel ? 'folder' : root.id, 16);
      b.append(document.createTextNode(label));
      if (rel === here) { b.disabled = true; b.title = 'They are here already'; }
      b.addEventListener('click', () => done(rel));
      list.append(b);
    };
    const walk = (folders, depth) => {
      for (const f of folders || []) { add(f.rel, f.name, depth); walk(f.folders, depth + 1); }
    };
    add('', root.label, 0);
    walk(root.folders, 1);
    box.append(head, list);
    ov.append(box);
    document.body.append(ov);
    pop = pushLayer(() => done(null));
    x.addEventListener('click', () => done(null));
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) done(null); });
  });
}
