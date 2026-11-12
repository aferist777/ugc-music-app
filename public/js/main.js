// The shell: the library column (library/main.js), the tools' tabs, the timeline (timeline/main.js), the dividers, the
// keys, the theme.

import { api, remembered, remember } from './api.js';
import { initSashes } from './sash.js';
import { initKeys } from './keys.js';
import { initLibrary } from './library/main.js';
import { initTags } from './tags/main.js';
import { initMusic } from './music/main.js';
import { initJobs } from './jobs.js';
import { initTimeline } from './timeline/main.js';

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

// ── The theme (the owner, 2026-11-12: monochrome, dark or light) ─────────────

function initTheme() {
  const btn = $('theme-toggle');
  const paint = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? 'Dark' : 'Light'; };
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ms_theme', next); } catch { /* not kept */ }
    paint();
    // The waves drawn on canvases take the new colours.
    window.dispatchEvent(new Event('resize'));
  });
  paint();
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  initTheme();
  initSashes();
  initTabs();
  initKeys();
  initLibrary();
  initTags();
  initMusic();
  initJobs();
  initTimeline();
  try {
    const h = await api('/api/health');
    $('fake-chip').hidden = !h.fake;
  } catch { /* the server is not there: the page stays as drawn */ }
}

start();
