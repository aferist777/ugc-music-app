// The shell: the library column (library/main.js), the tools' tabs, the timeline's frame, the dividers, the keys.

import { api, remembered, remember } from './api.js';
import { initSashes } from './sash.js';
import { initKeys } from './keys.js';
import { initLibrary } from './library/main.js';
import { initTags } from './tags/main.js';
import { initMusic } from './music/main.js';
import { initJobs } from './jobs.js';

const $ = (id) => document.getElementById(id);

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

// ── Timeline (its frame only until phase 4): a ruler of seconds as wide as the lanes ──

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
  initLibrary();
  initTags();
  initMusic();
  initJobs();
  paintRuler();
  new ResizeObserver(paintRuler).observe($('tl-lanes'));
  try {
    const h = await api('/api/health');
    $('fake-chip').hidden = !h.fake;
  } catch { /* the server is not there: the page stays as drawn */ }
}

start();
