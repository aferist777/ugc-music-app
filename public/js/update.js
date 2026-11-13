// ════════════════════════════════════════════════════════════════════════════
// THE UPDATE CHIP (phase 8): a copy installed from GitHub shows "Update <version>" in the top strip when a newer release
// is out (lib/updates.js asks GitHub; this page only reads what it knows - every ten minutes and when the window comes
// back). It STAYS until the person presses Update now (the owner's O4). Pressed: a window with every newer release's
// notes, Update now and Later (Later only closes the window); while it updates - its stage; then Restart now.
// ════════════════════════════════════════════════════════════════════════════

import { api } from './api.js';
import { pushLayer } from './layers.js';
import { showError } from './notice.js';
import { renderMarkdown } from './tags/markdown.js';

const $ = (id) => document.getElementById(id);
const READ_MS = 10 * 60 * 1000;

let S = null;
let popLayer = null;
let follow = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _day(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function paintChip() {
  const chip = $('update-chip');
  const r = S && S.available ? S.releases[0] : null;
  chip.hidden = !r;
  if (!r) return;
  const going = S.job && !S.job.error;
  chip.textContent = S.job && S.job.done ? 'Restart for ' + r.version : going ? 'Updating…' : 'Update ' + r.version;
  chip.title = 'A newer version of UGC Music Studio is out - press to see what changed';
}

function paintWindow() {
  const box = $('update-body');
  if (!box || $('update-overlay').hidden) return;
  box.textContent = '';
  const list = (S && S.releases) || [];
  box.append(el('p', 'update-lead', list.length
    ? 'You have ' + S.current + '. ' + (list.length === 1 ? 'What is new in ' + list[0].version + ':' : list.length + ' newer versions - what is new in each:')
    : 'You have the newest version (' + (S ? S.current : '?') + ').'));
  for (const r of list) {
    const sec = el('section', 'update-rel');
    const head = el('div', 'update-rel-head');
    head.append(el('strong', null, r.name && r.name !== r.tag ? r.name : 'Version ' + r.version), el('span', 'update-date', _day(r.date)));
    const body = el('div', 'tg-text update-notes');
    body.innerHTML = renderMarkdown(r.notes || 'No notes.');
    sec.append(head, body);
    box.append(sec);
  }
  const msg = $('update-msg');
  const go = $('update-go');
  const job = S && S.job;
  msg.classList.toggle('is-error', !!(job && job.error));
  if (job && job.error) { msg.textContent = 'The update did not go: ' + job.error; go.textContent = 'Try again'; go.disabled = false; } else if (job && job.done) { msg.textContent = 'Version ' + job.version + ' is in place. A copy of your data is in library / backups.'; go.textContent = 'Restart now'; go.disabled = false; } else if (job) { msg.textContent = job.stage + '…'; go.textContent = 'Updating…'; go.disabled = true; } else { msg.textContent = 'Your library is not touched; a copy of the app\'s data is kept first.'; go.textContent = 'Update now'; go.disabled = !list.length; }
}

async function read() {
  try { S = await api('/api/update'); } catch { return; }
  paintChip();
  paintWindow();
}

function _follow() {
  clearTimeout(follow);
  const tick = async () => {
    await read();
    if (S && S.job && !S.job.done && !S.job.error) follow = setTimeout(tick, 800);
  };
  follow = setTimeout(tick, 400);
}

function openWindow() {
  $('update-overlay').hidden = false;
  if (!popLayer) popLayer = pushLayer(closeWindow);
  paintWindow();
}

function closeWindow() {
  $('update-overlay').hidden = true;
  if (popLayer) { const p = popLayer; popLayer = null; p(); }
}

async function press() {
  const job = S && S.job;
  try {
    if (job && job.done) {
      const r = await api('/api/update/restart', { method: 'POST', body: {} });
      if (!r.restarted) $('update-msg').textContent = r.message;
      return;
    }
    S = await api('/api/update/apply', { method: 'POST', body: {} });
    paintChip();
    paintWindow();
    _follow();
  } catch (e) {
    showError(e.message);
  }
}

export function initUpdate() {
  $('update-chip').addEventListener('click', openWindow);
  $('update-later').addEventListener('click', closeWindow);
  $('update-close').addEventListener('click', closeWindow);
  $('update-go').addEventListener('click', press);
  $('update-overlay').addEventListener('pointerdown', (e) => { if (e.target === $('update-overlay')) closeWindow(); });
  read();
  setInterval(read, READ_MS);
  window.addEventListener('focus', read);
}
