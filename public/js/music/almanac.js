// ════════════════════════════════════════════════════════════════════════════
// THE ALMANAC (phase 3; UGC Studio's sound window almanac, suno-form.js) - a window in the middle of the page: the
// sections on the left, the open section's notes as chips under their categories; a chip pressed shows its note - "+ add"
// puts its text into "Your prompt" at the bottom (gold chips are in it), "Copy" copies it; "into <field>" puts the prompt
// into the open mode's field - in Custom a note meant only for Exclude goes to Exclude and one for Lyrics to Lyrics, the
// rest to Style; text already in a field is not added twice. What was open and the prompt are remembered.
//   openAlmanac({ mainLabel, into(parts) })   parts: { main, negative, lyrics } - strings to add
// ════════════════════════════════════════════════════════════════════════════

import { SECTIONS, FIELDS, SOURCES } from './almanac-data.js';
import { pushLayer } from '../layers.js';
import { showToast } from '../notice.js';

const LS = 'ms_almanac_v1';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function _load() {
  try { return Object.assign({ section: SECTIONS[0].id, note: '', prompt: '', added: [] }, JSON.parse(localStorage.getItem(LS)) || {}); } catch { return { section: SECTIONS[0].id, note: '', prompt: '', added: [] }; }
}
function _keep(s) {
  try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* not kept */ }
}

// Between what is there and what is added: a comma - or a blank line when either has lines of its own.
function _join(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x) return y;
  if (!y) return x;
  return x + (x.includes('\n') || y.includes('\n') ? '\n\n' : ', ') + y;
}

const _note = (id) => { for (const s of SECTIONS) { const n = s.notes.find(x => x.id === id); if (n) return n; } return null; };

let openNow = null;

export function openAlmanac({ mainLabel, into }) {
  if (openNow) return;
  const S = _load();
  if (!SECTIONS.some(s => s.id === S.section)) S.section = SECTIONS[0].id;

  const ov = el('div', 'overlay');
  const box = el('div', 'dialog alm');
  const head = el('div', 'dialog-head');
  head.append(el('h2', null, 'Almanac'));
  const x = el('button', 'btn icon ghost', '✕');
  x.title = 'Close (Esc)';
  head.append(x);
  const body = el('div', 'alm-body');
  const nav = el('nav', 'alm-nav');
  const main = el('div', 'alm-main');
  body.append(nav, main);
  const foot = el('div', 'alm-foot');
  const promptLabel = el('div', 'alm-prompt-label', 'Your prompt');
  const prompt = el('textarea', 'alm-prompt');
  prompt.rows = 3;
  prompt.value = S.prompt;
  prompt.placeholder = 'Notes you add collect here - edit them as you like.';
  const clear = el('button', 'btn ghost s', 'Clear');
  const intoBtn = el('button', 'btn primary', 'into ' + mainLabel);
  const row = el('div', 'alm-foot-row');
  row.append(clear, intoBtn);
  foot.append(promptLabel, prompt, row);
  box.append(head, body, foot);
  ov.append(box);
  document.body.append(ov);

  const close = () => { ov.remove(); pop(); openNow = null; };
  const pop = pushLayer(close);
  openNow = close;
  x.addEventListener('click', close);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  prompt.addEventListener('input', () => { S.prompt = prompt.value; _keep(S); paintMain(); });
  clear.addEventListener('click', () => { S.prompt = ''; S.added = []; prompt.value = ''; _keep(S); paintMain(); });
  intoBtn.addEventListener('click', () => {
    const text = prompt.value.trim();
    if (!text) { showToast('Add a note first.'); return; }
    // Each added note still in the prompt goes where it is meant to; the rest of the prompt goes to the main field.
    const parts = { main: '', negative: '', lyrics: '' };
    let rest = text;
    for (const id of S.added) {
      const n = _note(id);
      if (!n || !rest.includes(n.text)) continue;
      const only = n.to.length === 1 ? n.to[0] : '';
      const where = only === 'negative' ? 'negative' : n.to[0] === 'lyrics' ? 'lyrics' : 'main';
      parts[where] = _join(parts[where], n.text);
      rest = rest.replace(n.text, '');
    }
    rest = rest.replace(/(^[\s,]+|[\s,]+$)/g, '').replace(/,\s*,/g, ',').trim();
    parts.main = _join(parts.main, rest);
    into(parts);
    close();
  });

  function paintNav() {
    nav.textContent = '';
    for (const s of SECTIONS) {
      const b = el('button', 'alm-sec' + (s.id === S.section ? ' is-on' : ''), s.label);
      b.title = s.about;
      b.addEventListener('click', () => { S.section = s.id; S.note = ''; _keep(S); paintNav(); paintMain(); main.scrollTop = 0; });
      nav.append(b);
    }
  }

  function paintMain() {
    const s = SECTIONS.find(x => x.id === S.section);
    main.textContent = '';
    main.append(el('p', 'alm-about', s.about));
    for (const c of s.cats) {
      const notes = s.notes.filter(n => n.cat === c.id);
      if (!notes.length) continue;
      main.append(el('div', 'alm-cat', c.label));
      const chips = el('div', 'alm-chips');
      for (const n of notes) {
        const b = el('button', 'alm-chip' + (n.to.length ? '' : ' is-advice') + (S.prompt.includes(n.text) ? ' is-in' : '') + (n.id === S.note ? ' is-open' : ''), n.title);
        b.addEventListener('click', () => { S.note = S.note === n.id ? '' : n.id; _keep(S); paintMain(); });
        chips.append(b);
      }
      main.append(chips);
      const open = notes.find(n => n.id === S.note);
      if (open) main.append(_noteCard(open));
    }
  }

  function _noteCard(n) {
    const card = el('div', 'alm-note');
    card.append(el('div', 'alm-note-for', n.to.length ? 'for ' + n.to.map(f => (FIELDS[f] ? FIELDS[f].label : f)).join(', ') : 'advice'));
    card.append(el('div', 'alm-note-text', n.text));
    if (n.why) card.append(el('div', 'alm-note-why', n.why));
    if (n.set) card.append(el('div', 'alm-note-why', 'try ' + Object.entries(n.set).map(([k, v]) => k.replace(/_/g, ' ') + ' ' + v).join(', ') + ' - set them by hand'));
    const links = (n.src || []).map(id => SOURCES[id]).filter(Boolean);
    if (links.length) {
      const src = el('div', 'alm-note-src');
      links.forEach((l, i) => {
        if (i) src.append(document.createTextNode(' · '));
        const a = el('a', null, l.name);
        a.href = l.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        src.append(a);
      });
      card.append(src);
    }
    const row = el('div', 'alm-note-row');
    if (n.to.length) {
      const inIt = S.prompt.includes(n.text);
      const add = el('button', 'btn s', inIt ? '− take out' : '+ add');
      add.addEventListener('click', () => {
        if (S.prompt.includes(n.text)) {
          S.prompt = S.prompt.replace(n.text, '').replace(/(^[\s,]+|[\s,]+$)/g, '').replace(/,\s*,/g, ',').replace(/\n{3,}/g, '\n\n');
          S.added = S.added.filter(id => id !== n.id);
        } else {
          S.prompt = _join(S.prompt, n.text);
          if (!S.added.includes(n.id)) S.added.push(n.id);
        }
        prompt.value = S.prompt;
        _keep(S);
        paintMain();
      });
      row.append(add);
    }
    const copy = el('button', 'btn ghost s', 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(n.text); showToast('Copied.'); } catch { /* not allowed */ }
    });
    row.append(copy);
    card.append(row);
    return card;
  }

  paintNav();
  paintMain();
}
