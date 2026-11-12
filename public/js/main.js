// The shell (phase 0): the library's three roots, the tools' tabs, the timeline's frame, the dividers, the keys.

import { api, remembered, remember } from './api.js';
import { initSashes } from './sash.js';
import { initKeys } from './keys.js';

const $ = (id) => document.getElementById(id);

const ICONS = {
  music: '<path d="M6 12.5V4l7-1.5v8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<circle cx="4.5" cy="12.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle cx="11.5" cy="10.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  images: '<rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle cx="6" cy="6.6" r="1.2" fill="currentColor"/>'
    + '<path d="M2.6 12l3.6-3.4 2.6 2.4 2-1.8 2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  video: '<rect x="2" y="4" width="9" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<path d="M11 7l3-1.8v5.6L11 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

// ── Library ─────────────────────────────────────────────────────────────────

async function paintRoots() {
  const list = $('roots');
  let roots = [];
  try { roots = (await api('/api/library/roots')).roots || []; } catch { /* drawn empty */ }
  const on = remembered().root || 'music';
  list.textContent = '';
  for (const r of roots) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'root' + (r.id === on ? ' is-on' : '');
    b.dataset.root = r.id;
    b.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' + (ICONS[r.id] || '') + '</svg>';
    b.append(document.createTextNode(r.label));
    b.addEventListener('click', () => {
      for (const x of list.querySelectorAll('.root')) x.classList.toggle('is-on', x === b);
      remember({ root: r.id });
    });
    li.append(b);
    list.append(li);
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────

function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const pick = (name, focus) => {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
    remember({ tab: name });
  };
  for (const t of tabs) t.addEventListener('click', () => pick(t.dataset.tab));
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    pick(next.dataset.tab, true);
  });
  const saved = remembered().tab;
  pick(tabs.some(t => t.dataset.tab === saved) ? saved : 'tags');
}

// ── Timeline (its frame only, phase 0): a ruler of seconds as wide as the lanes ──

const PX_PER_SEC = 20;

function paintRuler() {
  const lanes = $('tl-lanes');
  const ruler = $('tl-ruler');
  ruler.style.setProperty('--tick', PX_PER_SEC + 'px');
  ruler.textContent = '';
  const seconds = Math.ceil(lanes.clientWidth / PX_PER_SEC);
  for (let s = 0; s <= seconds; s += 5) {
    const t = document.createElement('span');
    t.className = 'tl-tick';
    t.style.left = s * PX_PER_SEC + 'px';
    t.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    ruler.append(t);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  initSashes();
  initTabs();
  initKeys();
  paintRoots();
  paintRuler();
  new ResizeObserver(paintRuler).observe($('tl-lanes'));
  try {
    const h = await api('/api/health');
    $('fake-chip').hidden = !h.fake;
  } catch { /* the server is not there: the page stays as drawn */ }
}

start();
