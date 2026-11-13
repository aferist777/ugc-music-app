// ════════════════════════════════════════════════════════════════════════════
// WHAT THE IMAGES AND ANIMATE TABS SHARE (phase 5): the frame of a tab - the settings column on the left, the ONE chat
// on the right (the owner's i2) with the Prompt enhancer tick over the field and Generate on its right - the tick grey
// with no Anthropic key (the owner 2026-11-13: no key - nothing is enhanced, the words go as they are) -, the chat's
// reading (it follows the journal while a press is being made), a picture or a clip opened large OVER ITS OWN TAB by a
// press (the owner's i14), dragging a made file onto the timeline, and the person's own pictures brought in from this
// computer (into Images / Uploads - the owner's i13).
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { pushLayer } from '../layers.js';
import { showError, showToast } from '../notice.js';
import { el, mediaUrl, q, isPicture } from '../library/common.js';
import * as JOBS from '../music/jobs-store.js';

export { el };

export const thumbOf = (p) => '/api/library/thumb?' + q({ root: p.root, rel: p.rel });
const baseOf = (rel) => String(rel || '').split('/').pop().replace(/\.[^.]+$/, '');
export const money = (n) => '$' + (Math.round(n * 1000) / 1000);

export function loadState(key, def) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* the defaults */ }
  return Object.assign(JSON.parse(JSON.stringify(def)), s);
}

export function keeper(key, S) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(S)); } catch { /* not kept */ } }, 300);
  };
}

/** A small segmented switch. */
export function seg(options, value, onPick) {
  const box = el('div', 'seg');
  for (const [v, label] of options) {
    const b = el('button', v === value ? 'is-on' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => onPick(v));
    box.append(b);
  }
  return box;
}

export function select(options, value, onPick, title) {
  const s = el('select', 'field');
  for (const [v, label] of options) {
    const o = el('option', null, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  if (title) s.title = title;
  s.addEventListener('change', () => onPick(s.value));
  return s;
}

// ── The frame of a tab ──────────────────────────────────────────────────────

/**
 * Builds the tab: { side, thread, input, go, setEnhancer, enhancing } - the caller fills `side` and answers the press;
 * `setEnhancer(on)` - is there an enhancer (an Anthropic key); `enhancing()` - is the press to be enhanced.
 */
export function frame(panel, { placeholder, enhanceTitle, S, keep, onGo }) {
  panel.textContent = '';
  panel.classList.add('vz');
  const side = el('aside', 'vz-side');
  const main = el('div', 'vz-main');
  const thread = el('div', 'vz-thread');
  const opts = el('div', 'vz-opts');
  const lab = el('label', 'check');
  lab.title = enhanceTitle;
  const box = el('input');
  box.type = 'checkbox';
  box.checked = S.enhance !== false;
  box.addEventListener('change', () => { S.enhance = box.checked; keep(); });
  let present = true;
  // No key: the tick shows off and cannot be pressed; the person's own choice is kept for when a key is there.
  const setEnhancer = (on) => {
    present = !!on;
    box.disabled = !present;
    box.checked = present && S.enhance !== false;
    lab.classList.toggle('is-off', !present);
    lab.title = present ? enhanceTitle : 'No Anthropic key - your words go as they are. Add the key in API keys to have them enhanced.';
  };
  lab.append(box, document.createTextNode('Prompt enhancer'));
  opts.append(lab);
  const ask = el('form', 'ask');
  const input = el('textarea', 'ask-in');
  input.rows = 1;
  input.spellcheck = false;
  input.maxLength = 4000;
  input.placeholder = placeholder;
  input.value = S.words || '';
  const go = el('button', 'btn primary', 'Generate');
  go.type = 'submit';
  ask.append(input, go);
  main.append(thread, opts, ask);
  panel.append(side, main);
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 120) + 'px';
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  };
  input.addEventListener('input', () => { S.words = input.value; keep(); grow(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onGo(); } });
  ask.addEventListener('submit', (e) => { e.preventDefault(); onGo(); });
  // Measured again whenever its width changes - a tab drawn while hidden measures nothing.
  let width = 0;
  new ResizeObserver(() => { if (input.offsetWidth !== width) { width = input.offsetWidth; grow(); } }).observe(input);
  return { side, thread, input, go, setEnhancer, enhancing: () => present && S.enhance !== false };
}

// ── Opened large over its own tab (the owner's i14) ─────────────────────────

let peekOpen = null;

function _closePeek() {
  if (!peekOpen) return;
  const p = peekOpen;
  peekOpen = null;
  const v = p.box.querySelector('video');
  if (v) v.pause();
  p.box.remove();
  p.pop();
}

function peek(panel, item) {
  _closePeek();
  const box = el('div', 'vz-peek');
  box.title = 'Escape or a press - back';
  if (/\.(mp4|mov|webm)$/i.test(item.rel)) {
    const v = el('video');
    v.src = mediaUrl(item.root, item.rel);
    v.controls = true;
    v.autoplay = true;
    v.loop = true;
    box.append(v);
  } else {
    const im = el('img');
    im.src = mediaUrl(item.root, item.rel);
    im.alt = baseOf(item.rel);
    box.append(im);
  }
  box.append(el('div', 'vz-peek-name', baseOf(item.rel)));
  box.addEventListener('click', (e) => { if (e.target.tagName !== 'VIDEO') _closePeek(); });
  panel.append(box);
  peekOpen = { box, pop: pushLayer(_closePeek) };
}

// ── A made file: pressed - large; dragged - onto the timeline ──────────────

export function resultTile(panel, r, { video } = {}) {
  const f = el('figure', 'vz-res' + (r.gone ? ' is-gone' : ''));
  if (r.gone) {
    f.append(el('span', 'vz-gone', 'gone'));
    f.title = r.rel + ' - not in the library any more';
    return f;
  }
  f.title = r.rel.split('/').join(' / ') + ' - press to open; drag onto the timeline';
  if (video) {
    const v = el('video');
    v.src = mediaUrl(r.root, r.rel) + '#t=0.1';
    v.muted = true;
    v.preload = 'metadata';
    f.append(v);
  } else {
    const im = el('img');
    im.src = mediaUrl(r.root, r.rel);
    im.loading = 'lazy';
    im.alt = baseOf(r.rel);
    im.draggable = false;
    f.append(im);
  }
  f.draggable = true;
  f.addEventListener('dragstart', (e) => {
    window.msDrag = { root: r.root, rels: [r.rel] };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', r.name || baseOf(r.rel));
  });
  f.addEventListener('dragend', () => { window.msDrag = null; });
  f.addEventListener('click', () => peek(panel, r));
  return f;
}

// ── The chat, following the journal ─────────────────────────────────────────

const secs = (e) => Math.max(0, Math.round((Date.now() - e.at) / 1000));
const stateText = (e) => (e.state === 'pending' ? (e.stage || 'working') + '… ' + secs(e) + ' s' : e.state === 'failed' ? (e.refused ? 'refused: ' : 'failed: ') + (e.error || '') : e.error ? e.error : '');

/**
 * The chat of a kind, read again whenever a press of that kind changes in the journal. `paint(entries, grown)` - grown:
 * an entry was added since the last reading (the thread goes to its end).
 */
export function chatOf(kind, paint) {
  let entries = [];
  let sig = '';
  let count = -1;
  let busy = false;
  let again = false;
  const read = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      entries = (await api('/api/visual/chat?' + q({ kind }))).entries || [];
      const grown = count >= 0 && entries.length > count;
      const first = count < 0;
      count = entries.length;
      paint(entries, grown || first);
    } catch { /* the next change reads it again */ }
    busy = false;
    if (again) { again = false; read(); }
  };
  JOBS.subscribe((jobs) => {
    const s = jobs.filter(j => j.kind === kind).map(j => j.id + j.state + (j.stage || '') + (j.results || []).length).join('|');
    if (s !== sig) { sig = s; read(); }
  });
  // The seconds of what is being made tick on without drawing the chat again.
  setInterval(() => {
    for (const n of document.querySelectorAll('.vz-state[data-kind="' + kind + '"]')) {
      const e = entries.find(x => x.id === n.dataset.id);
      if (e && e.state === 'pending') n.textContent = stateText(e);
    }
  }, 1000);
  read();
  return { read, entries: () => entries };
}

/** The thread drawn again, its scroll kept unless it grew (then it goes to its end). */
export function paintThread(thread, entries, grown, entryEl, emptyText) {
  const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  const keepTop = thread.scrollTop;
  thread.textContent = '';
  if (!entries.length) {
    thread.append(el('div', 'vz-empty', emptyText));
    return;
  }
  for (const e of entries) thread.append(entryEl(e));
  if (grown || atEnd) thread.scrollTop = thread.scrollHeight; else thread.scrollTop = keepTop;
}

/** What every press shows: the person's words, the enhanced prompt folded (or why there is none), the line of what it was. */
export function pressHead(e) {
  const out = [];
  out.push(el('div', 'vz-you', e.words || '(no words - the enhancer decided)'));
  if (e.prompt) {
    const d = el('details', 'vz-prompt');
    d.append(el('summary', null, 'enhanced prompt · ' + (e.enhancedBy || 'Claude')), el('div', 'vz-prompt-text', e.prompt));
    out.push(d);
  } else if (e.fell) {
    const f = el('div', 'vz-fell', 'the enhancer failed - your words were sent as they are');
    f.title = e.fell;
    out.push(f);
  }
  return out;
}

/** The Keys window saved: what the tab offers is read again (an Anthropic key added or taken away). */
export function onKeys(fn) {
  window.addEventListener('ms:keys', fn);
}

export function pressLine(kind, e, facts) {
  const line = el('div', 'vz-meta');
  line.append(el('span', null, facts.filter(Boolean).join(' · ') + (e.fake ? ' · FAKE' : '')));
  const st = el('span', 'vz-state' + (e.state === 'failed' ? ' is-failed' : ''), stateText(e));
  st.dataset.id = e.id;
  st.dataset.kind = kind;
  if (e.state === 'pending') st.classList.add('is-pending');
  line.append(st);
  return line;
}

// ── The person's own pictures (the owner's i13) ─────────────────────────────

/** Pictures from this computer into Images / Uploads, shown in the Images chat; resolves the places they landed. */
export async function bringIn(fileList) {
  const files = [...(fileList || [])];
  const pics = files.filter(f => isPicture(f.name));
  const others = files.filter(f => !isPicture(f.name));
  if (others.length) showError('Only pictures can be brought in (jpg, png, webp, gif): ' + others.map(f => f.name).join(', '));
  const rels = [];
  for (const f of pics) {
    try {
      const res = await fetch('/api/library/import?' + q({ root: 'images', rel: '', name: f.name }), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f,
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error((d && d.error) || 'it could not be brought in');
      rels.push(d.rel);
    } catch (e) {
      showError(f.name + ': ' + e.message);
    }
  }
  if (!rels.length) return [];
  try { await api('/api/visual/images/uploaded', { method: 'POST', body: { rels } }); } catch (e) { showError(e.message); }
  showToast(rels.length + (rels.length === 1 ? ' picture' : ' pictures') + ' brought into Images / Uploads');
  window.dispatchEvent(new CustomEvent('ms:library-changed'));
  window.dispatchEvent(new CustomEvent('ms:chat-changed', { detail: { kind: 'image' } }));
  return rels.map(rel => ({ root: 'images', rel }));
}

export const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
/** Pictures of Images dragged inside the page (the library's rows, the chat's pictures). */
export const draggedPictures = () => {
  const d = window.msDrag;
  return d && d.root === 'images' ? d.rels.filter(isPicture).map(rel => ({ root: 'images', rel })) : [];
};
