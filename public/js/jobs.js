// The Jobs window (phase 3): the journal of generations under the top strip's button - each press with its state, what
// it is doing and for how long; Stop (stop waiting), Retry (a new press - it pays again; not offered for a refusal),
// ✕ (out of the journal), show (the tracks in the library). The button counts what is being made.

import { api } from './api.js';
import { pushLayer } from './layers.js';
import { showError } from './notice.js';
import * as JOBS from './music/jobs-store.js';
import { revealFile } from './library/main.js';
import { useLyrics } from './music/main.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let panel = null;
let pop = null;

function _when(t) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _secs(j) {
  return Math.max(0, Math.round((Date.now() - j.at) / 1000));
}

async function _act(path, after) {
  try {
    const r = await api(path, { method: 'POST', body: {} });
    if (after) after(r);
  } catch (e) {
    showError(e.message);
  }
  JOBS.refresh();
}

function _row(j) {
  const row = el('div', 'jb-row is-' + j.state);
  const top = el('div', 'jb-top');
  const name = el('span', 'jb-name', (j.written && j.written.title) || j.label);
  name.title = j.label;
  const kind = j.mode === 'lyrics' ? 'Lyrics' : j.mode === 'custom' ? 'Custom' : 'Simple';
  top.append(name, el('span', 'jb-meta', kind + ' · ' + _when(j.at) + (j.fake ? ' · FAKE' : '')));
  row.append(top);
  let line = '';
  if (j.state === 'pending') line = (j.stage || 'working') + '… ' + _secs(j) + ' s';
  else if (j.state === 'failed') line = (j.refused ? 'Refused: ' : 'Failed: ') + j.error;
  else if (j.kind === 'lyrics') line = (j.lyrics || []).length + ' texts written';
  else line = (j.results || []).map(r => r.name).join(' · ');
  const st = el('div', 'jb-state', line);
  st.dataset.id = j.id;
  row.append(st);
  const acts = el('div', 'jb-acts');
  if (j.state === 'pending') {
    const b = el('button', 'link', 'Stop');
    b.title = 'Stop waiting for it';
    b.addEventListener('click', () => _act('/api/music/jobs/' + j.id + '/stop'));
    acts.append(b);
  } else {
    if (j.kind === 'music' && j.state === 'done' && (j.results || []).length) {
      const b = el('button', 'link', 'show');
      b.addEventListener('click', () => { revealFile('music', j.results[0].rel); close(); });
      acts.append(b);
    }
    if (j.kind === 'lyrics' && (j.lyrics || []).length) {
      const b = el('button', 'link', 'Use in Custom');
      b.title = 'The first text into Custom';
      b.addEventListener('click', () => { const l = j.lyrics[0]; useLyrics(l.title, l.text); close(); });
      acts.append(b);
    }
    if (!j.refused) {
      const b = el('button', 'link', 'Retry · pays again');
      b.addEventListener('click', () => _act('/api/music/jobs/' + j.id + '/retry', (r) => JOBS.put(r.job)));
      acts.append(b);
    }
    const x = el('button', 'link', '✕');
    x.title = 'Take it out of the journal (the files stay)';
    x.addEventListener('click', () => _act('/api/music/jobs/' + j.id + '/forget', () => JOBS.drop(j.id)));
    acts.append(x);
  }
  row.append(acts);
  return row;
}

function _paint(jobs) {
  const pending = jobs.filter(j => j.state === 'pending').length;
  const btn = document.getElementById('jobs-open');
  btn.disabled = false;
  btn.textContent = 'Jobs';
  if (pending) btn.append(el('span', 'jb-badge', String(pending)));
  if (!panel) return;
  const list = panel.querySelector('.jb-list');
  list.textContent = '';
  if (!jobs.length) list.append(el('div', 'hint', 'Every press of Generate is written here at once and followed to its end.'));
  for (const j of jobs) list.append(_row(j));
}

function close() {
  if (!panel) return;
  panel.remove();
  panel = null;
  if (pop) { pop(); pop = null; }
  document.removeEventListener('pointerdown', _away, true);
}

function _away(e) {
  if (panel && !panel.contains(e.target) && e.target.id !== 'jobs-open') close();
}

function open() {
  if (panel) { close(); return; }
  panel = el('div', 'jb-panel');
  panel.append(el('div', 'jb-head', 'Generations'), el('div', 'jb-list'));
  document.body.append(panel);
  pop = pushLayer(close);
  document.addEventListener('pointerdown', _away, true);
  _paint(JOBS.current());
  JOBS.refresh();
}

export function initJobs() {
  document.getElementById('jobs-open').addEventListener('click', open);
  JOBS.subscribe(_paint);
  setInterval(() => {
    if (!panel) return;
    for (const st of panel.querySelectorAll('.jb-row.is-pending .jb-state')) {
      const j = JOBS.current().find(x => x.id === st.dataset.id);
      if (j && j.state === 'pending') st.textContent = (j.stage || 'working') + '… ' + _secs(j) + ' s';
    }
  }, 1000);
}
