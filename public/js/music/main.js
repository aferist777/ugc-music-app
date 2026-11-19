// ════════════════════════════════════════════════════════════════════════════
// THE MUSIC TAB (phase 3; the minimal design of 2026-11-12 - the showcase's variant B) - UGC Studio's music chat through
// Suno, music only: Simple (the default), Custom, Lyrics. Phase 9 (the owner's B4): one row of three group buttons -
// Genre, Mood, Sound - each showing or hiding its row of chips under it, any of them at once; under them the TAGS OF
// THE CHAT OPEN IN THE TAGS TAB, every one once, picked by a press here or there alike (tags/main.js `chatTags`,
// `toggleChatTag`); the options in rows (no Recent row since the owner's word, 2026-11-19 - Jobs shows the presses); at
// the bottom the mode's main field with Generate on its right (Simple: your words, Custom: the style, Lyrics: the idea)
// and the price small over Generate (the owner, 2026-11-19: no line under the field). The tracks go into the Music
// folder selected in the library, else Music's root. A press is the server's from the moment it is made (lib/jobs.js):
// this page only follows the journal (jobs-store.js).
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { showError, showToast } from '../notice.js';
import { openMenu } from '../menu.js';
import { CHIPS } from './chips.js';
import { chatTags, toggleChatTag } from '../tags/main.js';
import * as JOBS from './jobs-store.js';

const LS = 'ms_music_v1';
const GROUPS = [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']];
const MODES = [['simple', 'Simple'], ['custom', 'Custom'], ['lyrics', 'Lyrics']];
const MAIN = {
  simple: { key: 'words', max: 1000, placeholder: 'In your words - optional, any language', go: 'Generate' },
  custom: { key: 'style', max: 1000, placeholder: 'Style - genre, mood, instruments, tempo, production', go: 'Generate' },
  lyrics: { key: 'idea', max: 200, placeholder: 'What the song is about - Suno writes two or three texts', go: 'Write' },
};

const DEF = {
  mode: 'simple', model: 'V6',
  groups: [],      // the chip groups shown - their rows under the group buttons
  project: null,   // the project last open on the timeline - another one empties the main fields
  simple: { picked: { genre: [], mood: [], sound: [] }, words: '', about: '', instrumental: true, writer: true, seconds: '' },
  custom: { title: '', style: '', instrumental: false, lyrics: '', vocal: '', negative: '', styleWeight: '', weirdness: '', variety: '', writer: false, seconds: '' },
  lyrics: { idea: '' },
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clone = (v) => JSON.parse(JSON.stringify(v));

function _load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS)) || {}; } catch { /* defaults */ }
  const out = clone(DEF);
  for (const k of ['mode', 'model', 'project']) if (s[k]) out[k] = s[k];
  for (const k of ['simple', 'custom', 'lyrics']) Object.assign(out[k], s[k] || {});
  delete out.simple.mixOff;
  out.groups = (Array.isArray(s.groups) ? s.groups : []).filter(g => GROUPS.some(x => x[0] === g));
  out.simple.picked = Object.assign(clone(DEF.simple.picked), out.simple.picked || {});
  if (!MODES.some(m => m[0] === out.mode)) out.mode = 'simple';
  return out;
}

const S = _load();
let chat = null;   // the Tags tab's open chat: { id, title, tags: [{ tag, group, why }], picked } - null when none
let folder = { root: 'music', rel: '' };
let info = { models: ['V6', 'V6_MINI', 'V6_WILD'], prices: {}, fake: false };
let saved = [];
let keepTimer = 0;
let headBox, bodyBox, askBox, priceEl, mainIn, goBtn;

function keep() {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* not kept */ } }, 300);
}

// ── Small builders ──────────────────────────────────────────────────────────

function row(label, ...content) {
  const r = el('div', 'mu-row');
  r.append(el('span', 'mu-k', label));
  const v = el('div', 'mu-v');
  v.append(...content);
  r.append(v);
  return r;
}

function input(obj, key, { area, rows, placeholder, max, title } = {}) {
  const t = el(area ? 'textarea' : 'input', 'field');
  if (area) t.rows = rows || 3; else t.type = 'text';
  if (placeholder) t.placeholder = placeholder;
  if (title) t.title = title;
  if (max) t.maxLength = max;
  t.spellcheck = false;
  t.value = obj[key] || '';
  t.addEventListener('input', () => { obj[key] = t.value; keep(); });
  return t;
}

function check(obj, key, label, title, onChange, off) {
  const l = el('label', 'check' + (off ? ' is-off' : ''));
  if (title) l.title = off || title;
  const c = el('input');
  c.type = 'checkbox';
  // `off` - why it cannot be ticked now (no kie.ai or Anthropic key): shown off, the person's choice kept for later.
  c.checked = !off && !!obj[key];
  c.disabled = !!off;
  c.addEventListener('change', () => { obj[key] = c.checked; keep(); if (onChange) onChange(); });
  l.append(c, document.createTextNode(label));
  return l;
}

// No key for any model - no enhancer anywhere (the owner 2026-11-13): the tick's words for why.
const _noEnhancer = () => (info.enhancer === false ? 'No kie.ai or Anthropic key - what you picked goes as it is. Add a key in API keys to have it enhanced.' : null);

function knob(obj, key, label, min, max, step, title) {
  const r = el('div', 'mu-knob');
  r.title = title;
  const name = el('span', null, label);
  const rg = el('input');
  rg.type = 'range';
  rg.min = min; rg.max = max; rg.step = step;
  const v = el('span', 'mu-knob-val');
  const paint = () => {
    const auto = obj[key] === '' || obj[key] == null;
    rg.value = auto ? (key === 'variety' ? 0 : (min + max) / 2) : obj[key];
    v.textContent = auto ? 'auto' : String(obj[key]);
    rg.classList.toggle('is-auto', auto);
  };
  rg.addEventListener('input', () => { obj[key] = +rg.value; keep(); paint(); });
  v.title = 'double press - back to auto';
  v.addEventListener('dblclick', () => { obj[key] = ''; keep(); paint(); });
  paint();
  r.append(name, rg, v);
  return r;
}

function chip(label, on, onClick, title) {
  const b = el('button', 'chip' + (on ? ' is-on' : ''), label);
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// ── The body of each mode ───────────────────────────────────────────────────


// A chip or a tag pressed in Custom: its words added to the style, never twice.
function _addToStyle(words) {
  const st = S.custom.style.trim();
  if (st.toLowerCase().includes(String(words).toLowerCase())) { showToast('Already in the style.'); return; }
  S.custom.style = st ? st + ', ' + words : words;
  keep();
  if (S.mode === 'custom') { mainIn.value = S.custom.style; _grow(); }
}

function _chipRows() {
  const out = [];
  // The group buttons: a press shows or hides the group's chips under them; the number - how many are picked in it.
  const groups = el('div', 'chips');
  for (const [g, label] of GROUPS) {
    const shown = S.groups.includes(g);
    const n = S.mode === 'simple' ? S.simple.picked[g].length : 0;
    const b = chip(label + (n ? ' · ' + n : '') + (shown ? ' ▴' : ' ▾'), shown, () => {
      const i = S.groups.indexOf(g);
      if (i >= 0) S.groups.splice(i, 1); else S.groups = GROUPS.map(x => x[0]).filter(x => x === g || S.groups.includes(x));
      keep();
      paintBody();
    }, shown ? 'Hide the ' + label.toLowerCase() + ' chips' : 'Show the ' + label.toLowerCase() + ' chips');
    b.classList.add('mu-group');
    groups.append(b);
  }
  out.push(row('Chips', groups));
  for (const [g, label] of GROUPS) {
    if (!S.groups.includes(g)) continue;
    const box = el('div', 'chips');
    for (const c of CHIPS[g]) {
      const on = S.mode === 'simple' && S.simple.picked[g].includes(c.id);
      box.append(chip(c.label, on, () => {
        if (S.mode === 'custom') { _addToStyle(c.style); return; }
        const list = S.simple.picked[g];
        const i = list.indexOf(c.id);
        if (i >= 0) list.splice(i, 1);
        else if (list.length >= 8) { showToast('Eight in a group at most.'); return; } else list.push(c.id);
        keep();
        paintBody();
      }, c.style));
    }
    out.push(row(label, box));
  }
  // The tags of the chat open in the Tags tab - every one once; none picked until pressed (the owner's B1-B3).
  const tags = el('div', 'chips');
  const list = chat ? chat.tags.map(t => t.tag) : [];
  if (!list.length) tags.append(el('span', 'hint', 'Ask in the Tags tab - its tags show here'));
  for (const t of chat ? chat.tags : []) {
    const on = S.mode === 'simple' && chat.picked.includes(t.tag);
    tags.append(chip(t.tag, on, () => {
      if (S.mode === 'custom') { _addToStyle(t.tag); return; }
      toggleChatTag(t.tag);
    }, t.why));
  }
  if (S.mode === 'custom' && list.length) {
    const all = el('button', 'link', '+ all');
    all.title = 'Add every tag of the chat to the style';
    all.addEventListener('click', () => {
      const have = S.custom.style.toLowerCase();
      const add = list.filter(t => !have.includes(t.toLowerCase()));
      if (!add.length) { showToast('They are in the style already.'); return; }
      S.custom.style = [S.custom.style.trim(), ...add].filter(Boolean).join(', ');
      keep();
      mainIn.value = S.custom.style;
      _grow();
    });
    tags.append(all);
  }
  const box = el('div', 'mu-chat');
  if (chat && chat.title) {
    const name = el('div', 'mu-chat-name', chat.title);
    name.title = 'The chat open in the Tags tab';
    box.append(name);
  }
  box.append(tags);
  out.push(row('Tags', box));
  return out;
}

function paintBody() {
  const keepScroll = bodyBox.scrollTop;
  bodyBox.textContent = '';
  if (S.mode === 'simple') {
    const f = S.simple;
    bodyBox.append(..._chipRows());
    const opts = el('div', 'mu-opts');
    opts.append(
      check(f, 'instrumental', 'Instrumental', 'Only the music. Untick it for a song: say what it is about and Suno writes the lyrics.', () => paintAll()),
      check(f, 'writer', 'Prompt enhancer', 'The enhancer (Kimi K3.1 Pro first, then DeepSeek, Claude, GPT - a fraction of a cent) turns the chips, the tags and your words into Suno\'s prompt; it is written into the track\'s description. Off - they go as they are.', null, _noEnhancer()),
    );
    bodyBox.append(row('', opts));
    if (!f.instrumental) {
      bodyBox.append(row('About', input(f, 'about', { area: true, rows: 2, max: 400, placeholder: 'What the song is about - name a language if you want the song in it' })));
    }
  } else if (S.mode === 'custom') {
    const f = S.custom;
    bodyBox.append(..._chipRows());
    bodyBox.append(row('Title', input(f, 'title', { max: 80, placeholder: 'the track\'s name' })));
    if (!f.instrumental) {
      const ly = input(f, 'lyrics', { area: true, rows: 5, max: 5000, placeholder: '[Verse]\n...\n[Chorus]\n...' });
      const links = el('div', 'mu-links');
      const wr = el('button', 'link', 'Write lyrics from an idea…');
      wr.addEventListener('click', () => {
        if (!S.lyrics.idea) S.lyrics.idea = [f.title, f.style].filter(Boolean).join(' - ').slice(0, 200);
        setMode('lyrics');
      });
      const sv = el('button', 'link', 'Save');
      sv.addEventListener('click', () => _saveText({ title: f.title, text: f.lyrics, from: 'own' }));
      links.append(wr, sv);
      bodyBox.append(row('Lyrics', _savedPick(f), ly, links));
      const vs = el('select', 'field');
      for (const [v, t] of [['', 'Any voice'], ['f', 'A woman\'s voice (likelier)'], ['m', 'A man\'s voice (likelier)']]) {
        const op = el('option', null, t);
        op.value = v;
        vs.append(op);
      }
      vs.value = f.vocal || '';
      vs.style.width = 'auto';
      vs.addEventListener('change', () => { f.vocal = vs.value; keep(); });
      bodyBox.append(row('Voice', vs));
    }
    bodyBox.append(row('Exclude', input(f, 'negative', { max: 500, placeholder: 'what Suno should avoid - bare words by commas', title: 'Never "no …" in the style: what must not be there goes here.' })));
    const kn = el('details', 'mu-knobs');
    kn.append(el('summary', null, 'auto'),
      knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'How closely it keeps to the style.'),
      knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'How far it may wander from the expected.'),
      knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written; 4 - the two tracks as different as they get.'));
    bodyBox.append(row('Fine-tuning', kn));
    const opts = el('div', 'mu-opts');
    opts.append(
      check(f, 'instrumental', 'Instrumental', 'Only the music: no voice and no lyrics.', () => paintBody()),
      check(f, 'writer', 'Prompt enhancer', 'It keeps every word of your style and adds what it leaves open - the sub-genre, a tempo, named instruments, the production.', null, _noEnhancer()),
    );
    bodyBox.append(row('', opts));
  } else {
    const made = JOBS.current().filter(j => j.kind === 'lyrics').slice(0, 6);
    const w = el('div', 'mu-v');
    if (!made.length) w.append(el('span', 'hint', 'Texts Suno writes appear here.'));
    for (const j of made) w.append(_lyricsJob(j));
    bodyBox.append(row('Written', w));
    const s = el('div', 'mu-v');
    if (!saved.length) s.append(el('span', 'hint', 'Texts you save are kept here.'));
    for (const it of saved) s.append(_textRow(it.title + (it.from === 'suno' ? ' · Suno' : ''), it.text, it));
    bodyBox.append(row('Saved', s));
  }
  bodyBox.scrollTop = keepScroll;
}

function _lyricsJob(j) {
  const box = el('div', 'mu-ljob');
  const head = el('div', 'mu-ljob-head', j.label + ' · ' + _state(j));
  head.dataset.id = j.id;
  box.append(head);
  for (const l of j.lyrics || []) box.append(_textRow(l.title || 'Untitled', l.text, null, j.id));
  return box;
}

function _textRow(title, body, item, gen) {
  const d = el('details', 'mu-text');
  const sum = el('summary', null, title);
  d.append(sum, el('pre', 'mu-text-body', body));
  const links = el('div', 'mu-links');
  const use = el('button', 'link', 'Use in Custom');
  use.addEventListener('click', () => useLyrics(title.replace(/ · Suno$/, ''), body));
  const copy = el('button', 'link', 'Copy');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(body); showToast('Copied.'); } catch { /* not allowed */ } });
  links.append(use, copy);
  if (!item) {
    const sv = el('button', 'link', 'Save');
    sv.addEventListener('click', () => _saveText({ title, text: body, from: 'suno', gen }));
    links.append(sv);
  } else {
    sum.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { label: 'Rename', act: () => _renameText(sum, item) },
        { sep: true },
        { label: 'Delete', danger: true, really: true, act: async () => {
          try { await api('/api/music/lyrics/' + item.id + '/delete', { method: 'POST', body: {} }); await loadSaved(); } catch (er) { showError(er.message); }
        } },
      ]);
    });
  }
  d.append(links);
  return d;
}

// A saved text renamed in place (the window has no prompt()).
function _renameText(sum, item) {
  const inp = el('input', 'rename-input');
  inp.value = item.title;
  sum.textContent = '';
  sum.append(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const t = inp.value.trim();
    if (save && t && t !== item.title) {
      try { await api('/api/music/lyrics/' + item.id + '/rename', { method: 'POST', body: { title: t } }); } catch (er) { showError(er.message); }
    }
    await loadSaved();
  };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
  inp.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
}

function _savedPick(f) {
  const s = el('select', 'field');
  const first = el('option', null, saved.length ? 'saved lyrics (' + saved.length + ')' : 'no saved lyrics yet');
  first.value = '';
  s.append(first);
  for (const it of saved) {
    const o = el('option', null, it.title + (it.from === 'suno' ? ' · Suno' : ''));
    o.value = it.id;
    s.append(o);
  }
  s.addEventListener('change', () => {
    const it = saved.find(x => x.id === s.value);
    if (!it) return;
    f.lyrics = it.text;
    if (!f.title) f.title = it.title.slice(0, 80);
    keep();
    paintBody();
  });
  return s;
}

async function _saveText(x) {
  if (!String(x.text || '').trim()) { showToast('Write the lyrics first.'); return; }
  try {
    const r = await api('/api/music/lyrics', { method: 'POST', body: x });
    showToast(r.already ? 'Already saved.' : 'Saved.');
    await loadSaved();
  } catch (e) { showError(e.message); }
}

export function useLyrics(title, body) {
  S.custom.lyrics = body;
  if (!S.custom.title) S.custom.title = String(title || '').slice(0, 80);
  S.custom.instrumental = false;
  keep();
  setMode('custom');
}

async function loadSaved() {
  try { saved = (await api('/api/music/lyrics')).items || []; } catch { saved = []; }
  if (bodyBox && S.mode !== 'simple') paintBody();
}

// ── Head, the main field and the line under it ─────────────────────────────

function setMode(m) {
  S.mode = m;
  keep();
  paintAll();
}

function paintHead() {
  headBox.textContent = '';
  const seg = el('div', 'seg');
  for (const [id, label] of MODES) {
    const b = el('button', S.mode === id ? 'is-on' : '', label);
    b.addEventListener('click', () => setMode(id));
    seg.append(b);
  }
  headBox.append(seg);
  if (S.mode === 'lyrics') return;
  const m = el('select', 'field mu-model');
  for (const id of info.models) {
    const o = el('option', null, id);
    o.value = id;
    m.append(o);
  }
  m.value = S.model;
  m.title = 'V6 - the newest, most natural · V6_MINI - faster · V6_WILD - bolder, stranger';
  m.addEventListener('change', () => { S.model = m.value; keep(); });
  const mf = el('label', 'mu-hf');
  mf.append(el('span', null, 'Model'), m);
  headBox.append(mf);
  const f = S[S.mode];
  if (!(S.mode === 'simple' && !f.instrumental)) {
    const len = el('input', 'field mu-len');
    len.type = 'number';
    len.min = 10; len.max = 360; len.placeholder = 'auto';
    len.title = '10-360 s. Empty - Suno decides. A target, not a timer.';
    len.value = f.seconds || '';
    len.addEventListener('input', () => { f.seconds = len.value; keep(); });
    const lf = el('label', 'mu-hf');
    lf.append(el('span', null, 'Length'), len, el('span', 'hint', 's'));
    headBox.append(lf);
  }
}

const _secs = (j) => Math.max(0, Math.round((Date.now() - (j.at || Date.now())) / 1000));

function _state(j) {
  if (j.state === 'pending') return (j.stage || 'working') + '… ' + _secs(j) + ' s';
  if (j.state === 'failed') return (j.refused ? 'refused: ' : 'failed: ') + j.error;
  if (j.kind === 'lyrics') return (j.lyrics || []).length + ' texts';
  return 'done';
}

function _grow() {
  mainIn.style.height = 'auto';
  mainIn.style.height = Math.min(mainIn.scrollHeight + 2, 120) + 'px';
  mainIn.style.overflowY = mainIn.scrollHeight > 120 ? 'auto' : 'hidden';
}

function paintAsk() {
  const m = MAIN[S.mode];
  mainIn.placeholder = m.placeholder;
  mainIn.maxLength = m.max;
  mainIn.value = S[S.mode][m.key] || '';
  goBtn.textContent = m.go;
  _grow();
}

// The price of a press, small over Generate.
function paintPrice() {
  const p = info.prices[S.mode];
  priceEl.textContent = p ? '$' + p.usd + ' · ' + p.note + (info.fake ? ' · FAKE' : '') : '';
}

async function generate() {
  const f = S[S.mode];
  let body;
  if (S.mode === 'simple') {
    body = {
      mode: 'simple', model: S.model, chips: f.picked, mix: chat ? chat.picked.slice() : [], words: f.words,
      instrumental: f.instrumental, about: f.about, writer: f.writer, seconds: f.seconds,
    };
  } else if (S.mode === 'custom') {
    body = Object.assign({ mode: 'custom', model: S.model }, f);
  } else {
    body = { mode: 'lyrics', idea: f.idea };
  }
  body.into = folder.root === 'music' ? folder.rel : '';
  goBtn.disabled = true;
  try {
    const r = await api('/api/music/gen', { method: 'POST', body });
    JOBS.put(r.job);
    showToast(S.mode === 'lyrics' ? 'Asked - the texts appear here in a minute.' : 'Asked - follow it in Jobs.');
  } catch (e) {
    showError(e.message);
  } finally {
    goBtn.disabled = false;
  }
}

function paintAll() {
  paintHead();
  paintBody();
  paintAsk();
  paintPrice();
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function initMusic() {
  const host = document.querySelector('[data-panel="music"]');
  host.textContent = '';
  headBox = el('div', 'mu-head');
  bodyBox = el('div', 'mu-body');
  askBox = el('form', 'ask');
  mainIn = el('textarea', 'ask-in');
  mainIn.rows = 1;
  mainIn.spellcheck = false;
  goBtn = el('button', 'btn primary', 'Generate');
  goBtn.type = 'submit';
  priceEl = el('span', 'mu-price');
  const goCol = el('div', 'mu-go');
  goCol.append(priceEl, goBtn);
  askBox.append(mainIn, goCol);
  host.append(headBox, bodyBox, askBox);

  mainIn.addEventListener('input', () => { S[S.mode][MAIN[S.mode].key] = mainIn.value; keep(); _grow(); });
  mainIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
  });
  askBox.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  // The field's height follows its width too: measured while the window was narrow, it stayed tall when it widened.
  let askWidth = 0;
  new ResizeObserver(() => { if (askBox.clientWidth !== askWidth) { askWidth = askBox.clientWidth; _grow(); } }).observe(askBox);
  // ANOTHER project opened on the timeline (the owner, 2026-11-19): the field beside Generate starts empty in every mode
  // - your words, the style with the tags put into it, the idea. The same project read again changes nothing.
  window.addEventListener('ms:project-opened', (e) => {
    const id = e.detail && e.detail.id;
    if (!id || id === S.project) return;
    const was = S.project;
    S.project = id;
    if (was) for (const [mode, m] of Object.entries(MAIN)) S[mode][m.key] = '';
    keep();
    if (was) paintAsk();
  });

  try { info = await api('/api/music/info'); } catch { /* the defaults */ }
  window.addEventListener('ms:keys', async () => {
    try { info = await api('/api/music/info'); } catch { return; }
    if (S.mode !== 'lyrics') paintBody();
  });
  chat = chatTags();
  window.addEventListener('ms:tags-chat', (e) => {
    chat = e.detail || null;
    if (S.mode !== 'lyrics') paintBody();
  });
  window.addEventListener('ms:folder', (e) => { folder = e.detail || folder; });
  let lyricsSeen = '';
  JOBS.subscribe((jobs) => {
    // Lyrics just written show in the Lyrics mode at once (drawn again only when a state changes).
    const ly = jobs.filter(j => j.kind === 'lyrics').map(j => j.id + j.state).join();
    if (S.mode === 'lyrics' && ly !== lyricsSeen) { lyricsSeen = ly; paintBody(); }
  });
  // The seconds of what is being made tick on; nothing with a field in it is drawn again.
  setInterval(() => {
    if (!JOBS.current().some(j => j.state === 'pending')) return;
    for (const h of bodyBox.querySelectorAll('.mu-ljob-head')) {
      const j = JOBS.current().find(x => x.id === h.dataset.id);
      if (j) h.textContent = j.label + ' · ' + _state(j);
    }
  }, 1000);
  paintAll();
  await loadSaved();
  JOBS.refresh();
}
