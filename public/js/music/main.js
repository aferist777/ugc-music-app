// ════════════════════════════════════════════════════════════════════════════
// THE MUSIC TAB (phase 3) - UGC Studio's music chat through Suno, music only (the owner's C6): Simple (the default),
// Custom, Lyrics. The feel on the left - the chips of UGC (Genre, Mood, Sound) and "From Tags", the Mix made in the Tags
// tab (C4); the press on the right; Recent under them (C8); at the foot the almanac, where the tracks go - the Music
// folder selected in the library, else the root of Music (C5) -, the price and Generate. A press is the server's from the
// moment it is made (lib/jobs.js): this page only follows the journal (jobs-store.js).
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { showError, showToast } from '../notice.js';
import { openMenu } from '../menu.js';
import { qmark, withQ } from '../qmark.js';
import { CHIPS } from './almanac-data.js';
import { openAlmanac } from './almanac.js';
import * as JOBS from './jobs-store.js';
import { playTrack, revealFile } from '../library/main.js';

const LS = 'ms_music_v1';
const GROUPS = [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']];
const MODES = [['simple', 'Simple'], ['custom', 'Custom'], ['lyrics', 'Lyrics']];
const MODEL_HELP = 'Suno\'s model - one price for all three.\nV6 - the newest, most natural · V6_MINI - faster · V6_WILD - bolder, stranger.';
const MODE_HELP = {
  simple: 'Music from the chips on the left, your Mix from Tags and your own words (any language). Instrumental - Suno makes the music only; untick it and say what the song is about - Suno writes the lyrics and sings them. The enhancer turns it all into Suno\'s prompt. Suno makes TWO tracks.',
  custom: 'You write it: a title, a style and - unless it is instrumental - the lyrics ([Verse], [Chorus]…). A chip on the left adds its words to the style; "+ Mix" adds your Mix. Suno makes TWO tracks.',
  lyrics: 'Song lyrics from an idea - two or three texts. "Use in Custom" puts one into Custom, "Save" keeps it for later.',
};
const CHIP_HELP = {
  genre: 'The kind of music - lo-fi, pop, cinematic…',
  mood: 'How it feels - calm, bright, dark…',
  sound: 'What it is made of - the instruments, the texture, the production.',
  mix: 'The Mix you made in the Tags tab. Simple: every tag of it goes with the press - a press on one leaves it out. Custom: a press adds it to the style.',
};

const DEF = {
  mode: 'simple', model: 'V6', open: 'genre',
  simple: { picked: { genre: [], mood: [], sound: [] }, mixOff: [], words: '', about: '', instrumental: true, writer: true, seconds: '' },
  custom: { title: '', style: '', instrumental: false, lyrics: '', vocal: '', negative: '', styleWeight: '', weirdness: '', variety: '', writer: false, seconds: '' },
  lyrics: { idea: '' },
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clone = (v) => JSON.parse(JSON.stringify(v));

function _load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS)) || {}; } catch { /* defaults */ }
  const out = clone(DEF);
  for (const k of ['mode', 'model', 'open']) if (s[k]) out[k] = s[k];
  for (const k of ['simple', 'custom', 'lyrics']) Object.assign(out[k], s[k] || {});
  out.simple.picked = Object.assign(clone(DEF.simple.picked), out.simple.picked || {});
  if (!MODES.some(m => m[0] === out.mode)) out.mode = 'simple';
  return out;
}

const S = _load();
let mix = [];
let folder = { root: 'music', rel: '' };
let info = { models: ['V6', 'V6_MINI', 'V6_WILD'], prices: {}, fake: false };
let saved = [];
let host = null;
let keepTimer = 0;

function keep() {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* not kept */ } }, 300);
}

// ── Small builders ──────────────────────────────────────────────────────────

function field(label, control, { max, help, value } = {}) {
  const wrap = el('div', 'mu-field');
  const head = el('div', 'mu-label');
  head.append(el('span', null, label));
  if (help) head.append(qmark(help));
  wrap.append(head, control);
  if (max) {
    const n = el('div', 'mu-count');
    const paint = () => {
      const len = (value ? value() : control.value || '').length;
      n.textContent = len + ' / ' + max;
      n.classList.toggle('is-over', len > max);
    };
    control.addEventListener('input', paint);
    paint();
    wrap.append(n);
  }
  return wrap;
}

function text(obj, key, { area, rows, placeholder, max } = {}) {
  const t = el(area ? 'textarea' : 'input', 'field mu-in' + (area ? ' is-area' : ''));
  if (area) t.rows = rows || 3; else t.type = 'text';
  if (placeholder) t.placeholder = placeholder;
  if (max) t.maxLength = max + 200;
  t.spellcheck = false;
  t.value = obj[key] || '';
  t.addEventListener('input', () => { obj[key] = t.value; keep(); });
  return t;
}

function check(obj, key, label, help, onChange) {
  const l = el('label', 'mu-check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; keep(); if (onChange) onChange(); });
  l.append(c, el('span', null, label));
  if (help) l.append(qmark(help));
  return l;
}

function knob(obj, key, label, min, max, step, help) {
  const row = el('div', 'mu-knob');
  const name = el('span', 'mu-knob-name', label);
  const r = el('input');
  r.type = 'range';
  r.min = min; r.max = max; r.step = step;
  const v = el('span', 'mu-knob-val');
  const paint = () => {
    const auto = obj[key] === '' || obj[key] == null;
    r.value = auto ? (key === 'variety' ? 0 : (min + max) / 2) : obj[key];
    v.textContent = auto ? 'auto' : String(obj[key]);
    r.classList.toggle('is-auto', auto);
  };
  r.addEventListener('input', () => { obj[key] = +r.value; keep(); paint(); });
  v.title = 'double press - back to auto';
  v.addEventListener('dblclick', () => { obj[key] = ''; keep(); paint(); });
  paint();
  row.append(withQ(name, help), r, v);
  return row;
}

// ── The feel (left) ─────────────────────────────────────────────────────────

const _chipsOf = (g) => CHIPS[g] || [];

function paintFeel(box) {
  box.textContent = '';
  const groups = GROUPS.concat([['mix', 'From Tags']]);
  for (const [g, label] of groups) {
    const open = S.open === g;
    const sec = el('div', 'mu-group' + (open ? ' is-open' : ''));
    const headBtn = el('button', 'mu-group-head');
    const picked = g === 'mix'
      ? mix.filter(t => !S.simple.mixOff.includes(t))
      : S.mode === 'simple' ? S.simple.picked[g].map(id => (_chipsOf(g).find(c => c.id === id) || {}).label).filter(Boolean) : [];
    headBtn.append(el('span', 'mu-group-name', label + (g === 'mix' ? ' · ' + mix.length : picked.length ? ' · ' + picked.length : '')));
    if (!open && picked.length && (S.mode === 'simple')) headBtn.append(el('span', 'mu-group-picked', picked.join(', ')));
    headBtn.append(qmark(CHIP_HELP[g]));
    headBtn.addEventListener('click', () => { S.open = open ? '' : g; keep(); paintFeel(box); });
    sec.append(headBtn);
    if (open) {
      const chips = el('div', 'mu-chips');
      if (g === 'mix') {
        if (!mix.length) chips.append(el('span', 'mu-hint', 'Your Mix is empty - press tags in the Tags tab.'));
        for (const t of mix) {
          const on = S.mode === 'simple' && !S.simple.mixOff.includes(t);
          const b = el('button', 'tg-chip' + (on ? ' is-in' : ''), t);
          b.addEventListener('click', () => {
            if (S.mode === 'custom') { _addToStyle(t); return; }
            const off = S.simple.mixOff;
            const i = off.indexOf(t);
            if (i >= 0) off.splice(i, 1); else off.push(t);
            keep();
            paintFeel(box);
            paintCard();
          });
          chips.append(b);
        }
      } else {
        for (const c of _chipsOf(g)) {
          const on = S.mode === 'simple' && S.simple.picked[g].includes(c.id);
          const b = el('button', 'tg-chip' + (on ? ' is-in' : ''), c.label);
          b.title = c.style;
          b.addEventListener('click', () => {
            if (S.mode === 'custom') { _addToStyle(c.style); return; }
            const list = S.simple.picked[g];
            const i = list.indexOf(c.id);
            if (i >= 0) list.splice(i, 1);
            else if (list.length >= 8) { showToast('Eight in a group at most.'); return; } else list.push(c.id);
            keep();
            paintFeel(box);
            paintCard();
          });
          chips.append(b);
        }
      }
      sec.append(chips);
    }
    box.append(sec);
  }
}

// A chip or a tag pressed in Custom: its words added to the style, never twice.
function _addToStyle(words) {
  const st = S.custom.style.trim();
  if (st.toLowerCase().includes(String(words).toLowerCase())) { showToast('Already in the style.'); return; }
  S.custom.style = st ? st + ', ' + words : words;
  keep();
  paintCard();
}

// ── The press (right) ───────────────────────────────────────────────────────

let cardBox = null;
let feelBox = null;

function paintCard() {
  const card = cardBox;
  card.textContent = '';
  if (S.mode === 'simple') {
    const f = S.simple;
    const feel = el('div', 'mu-picked');
    const picked = GROUPS.flatMap(([g]) => f.picked[g].map(id => (_chipsOf(g).find(c => c.id === id) || {}).label).filter(Boolean));
    const fromTags = mix.filter(t => !f.mixOff.includes(t));
    if (!picked.length && !fromTags.length) feel.append(el('span', 'mu-hint', 'No chips yet - pick the genre, the mood and the sound on the left, or use your Mix.'));
    for (const p of picked) feel.append(el('span', 'tg-chip is-in is-static', p));
    for (const t of fromTags) feel.append(el('span', 'tg-chip is-in is-static is-mix', t));
    card.append(field('The feel', feel, { help: 'The chips picked on the left and your Mix from Tags. None - the enhancer chooses.' }));
    card.append(field('In your words', text(f, 'words', { area: true, rows: 3, max: 1000, placeholder: 'e.g. late-night drive through a rainy city, warm and a little sad' }),
      { max: 1000, help: 'More about the music, in any language - optional.' }));
    card.append(check(f, 'instrumental', 'Instrumental', 'Only the music: no voice and no lyrics. Untick it for a song - say what it is about and Suno writes the lyrics.', () => { paintCard(); paintHead(); }));
    if (!f.instrumental) {
      card.append(field('What the song is about', text(f, 'about', { area: true, rows: 2, max: 400, placeholder: 'e.g. a summer road trip with old friends, nostalgic but happy; lyrics in English' }),
        { max: 400, help: 'The story or theme of the song - Suno writes the lyrics from it. Name a language if you want the song in it.' }));
    }
    card.append(check(f, 'writer', 'The enhancer writes Suno\'s prompt', 'The enhancer (Claude → Gemini → GPT, without web search, about a cent) turns the chips, your Mix and your words into Suno\'s style - or, for a song, its description. What it wrote is in the track\'s description.\nOff - they go to Suno as they are.'));
    return;
  }
  if (S.mode === 'custom') {
    const f = S.custom;
    card.append(field('Title', text(f, 'title', { max: 80, placeholder: 'the track\'s name' }), { max: 80, help: 'The track\'s name - both tracks are called by it.' }));
    const st = text(f, 'style', { area: true, rows: 3, max: 1000, placeholder: 'genre, mood, instruments, tempo, production - e.g. indie pop, bright clean guitars, 110 BPM, warm female vocal' });
    const sf = field('Style', st, { max: 1000, help: 'Genre, mood, instruments, tempo, production - by commas, the most important first. Only what you want: what must not be there goes to Exclude.' });
    const addMix = el('button', 'mu-link', '+ Mix');
    addMix.type = 'button';
    addMix.title = 'Add your Mix from Tags to the style';
    addMix.disabled = !mix.length;
    addMix.addEventListener('click', () => {
      const have = f.style.toLowerCase();
      const add = mix.filter(t => !have.includes(t.toLowerCase()));
      if (!add.length) { showToast(mix.length ? 'The Mix is in the style already.' : 'Your Mix is empty.'); return; }
      f.style = [f.style.trim(), ...add].filter(Boolean).join(', ');
      keep();
      paintCard();
    });
    sf.append(addMix);
    card.append(sf);
    card.append(check(f, 'instrumental', 'Instrumental', 'Only the music: no voice and no lyrics.', () => paintCard()));
    if (!f.instrumental) {
      const ly = text(f, 'lyrics', { area: true, rows: 7, max: 5000, placeholder: '[Verse]\n...\n[Chorus]\n...' });
      const lf = field('Lyrics', ly, { max: 5000, help: 'What is sung, in parts: [Verse], [Chorus]… Empty - Suno sings what it makes up.\nThe list over it - your saved texts: a choice replaces the text, the title only when it is empty.' });
      lf.insertBefore(_savedPick(f), ly);
      const links = el('div', 'mu-links');
      const wr = el('button', 'mu-link', 'Write lyrics from an idea…');
      wr.type = 'button';
      wr.addEventListener('click', () => {
        if (!S.lyrics.idea) S.lyrics.idea = [f.title, f.style].filter(Boolean).join(' - ').slice(0, 200);
        setMode('lyrics');
      });
      const sv = el('button', 'mu-link', 'Save');
      sv.type = 'button';
      sv.addEventListener('click', () => _saveText({ title: f.title, text: f.lyrics, from: 'own' }));
      links.append(wr, sv);
      lf.append(links);
      card.append(lf);
      const vs = el('select', 'field mu-in');
      for (const [v, t] of [['', 'Any voice'], ['f', 'A woman\'s voice (likelier)'], ['m', 'A man\'s voice (likelier)']]) {
        const op = el('option', null, t);
        op.value = v;
        vs.append(op);
      }
      vs.value = f.vocal || '';
      vs.addEventListener('change', () => { f.vocal = vs.value; keep(); });
      card.append(field('Voice', vs, { help: 'Whose voice Suno is asked for - it only makes it likelier. Saying it in the style ("warm female vocal") holds better.' }));
    }
    card.append(field('Exclude', text(f, 'negative', { max: 500, placeholder: 'e.g. heavy metal, distortion, choir' }),
      { max: 500, help: 'Styles and sounds Suno should avoid - bare words by commas, never "no …" in the style.' }));
    const kn = el('details', 'mu-knobs');
    const sum = el('summary', null, 'fine-tuning');
    sum.append(qmark('Suno\'s own values while "auto" - open it only to steer the result.'));
    kn.append(sum,
      knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'How closely it keeps to the style.'),
      knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'How far it may wander from the expected.'),
      knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written (V6 rewrites it at 1 and up); 4 - the two tracks as different as they get.'));
    card.append(kn);
    card.append(check(f, 'writer', 'The enhancer makes the style fuller', 'The enhancer keeps every word of your style and adds what it leaves open - the sub-genre, a tempo, named instruments, the production. What it wrote is in the track\'s description. Off - your style goes as you wrote it.'));
    return;
  }
  // Lyrics
  card.append(field('The idea', text(S.lyrics, 'idea', { area: true, rows: 2, max: 200, placeholder: 'e.g. a hopeful song about the first coffee of the morning' }),
    { max: 200, help: 'What the song is about - Suno writes two or three texts from it.' }));
  const made = JOBS.current().filter(j => j.kind === 'lyrics').slice(0, 6);
  if (made.length) {
    card.append(el('div', 'mu-sub', 'Written'));
    for (const j of made) card.append(_lyricsJob(j));
  }
  card.append(el('div', 'mu-sub', 'Saved · ' + saved.length));
  if (!saved.length) card.append(el('div', 'mu-hint', 'Texts you save - written here or your own from Custom - are kept here.'));
  for (const it of saved) card.append(_textRow(it.title + (it.from === 'suno' ? ' · Suno' : ''), it.text, it));
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
  d.append(sum);
  d.append(el('pre', 'mu-text-body', body));
  const row = el('div', 'mu-links');
  const use = el('button', 'mu-link', 'Use in Custom');
  use.addEventListener('click', () => useLyrics(title.replace(/ · Suno$/, ''), body));
  const copy = el('button', 'mu-link', 'Copy');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(body); showToast('Copied.'); } catch { /* not allowed */ } });
  row.append(use, copy);
  if (!item) {
    const sv = el('button', 'mu-link', 'Save');
    sv.addEventListener('click', () => _saveText({ title, text: body, from: 'suno', gen }));
    row.append(sv);
  } else {
    sum.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { label: 'Rename', act: () => {
          // Typed in place (the window has no prompt()).
          const input = el('input', 'rename-input');
          input.value = item.title;
          sum.textContent = '';
          sum.append(input);
          input.focus();
          input.select();
          let done = false;
          const finish = async (save) => {
            if (done) return;
            done = true;
            const t = input.value.trim();
            if (save && t && t !== item.title) {
              try { await api('/api/music/lyrics/' + item.id + '/rename', { method: 'POST', body: { title: t } }); } catch (er) { showError(er.message); }
            }
            await loadSaved();
          };
          input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
            if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
          });
          input.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
          input.addEventListener('blur', () => finish(true));
        } },
        { sep: true },
        { label: 'Delete', danger: true, really: true, act: async () => {
          try { await api('/api/music/lyrics/' + item.id + '/delete', { method: 'POST', body: {} }); await loadSaved(); } catch (er) { showError(er.message); }
        } },
      ]);
    });
  }
  d.append(row);
  return d;
}

function _savedPick(f) {
  const s = el('select', 'field mu-in mu-saved');
  const first = el('option', null, saved.length ? 'saved lyrics (' + saved.length + ') - pick one to put it below' : 'no saved lyrics yet');
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
    paintCard();
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
  if (host) paintCard();
}

// ── Head, Recent and foot ───────────────────────────────────────────────────

let headBox = null;
let recentBox = null;
let footBox = null;

function setMode(m) {
  S.mode = m;
  keep();
  paintAll();
}

function paintHead() {
  headBox.textContent = '';
  const modes = el('div', 'mu-modes');
  for (const [id, label] of MODES) {
    const b = el('button', 'mu-mode' + (S.mode === id ? ' is-on' : ''), label);
    b.addEventListener('click', () => setMode(id));
    modes.append(b);
  }
  modes.append(qmark(MODE_HELP[S.mode]));
  headBox.append(modes);
  if (S.mode !== 'lyrics') {
    const m = el('select', 'field mu-in mu-model');
    for (const id of info.models) {
      const o = el('option', null, id);
      o.value = id;
      m.append(o);
    }
    m.value = S.model;
    m.addEventListener('change', () => { S.model = m.value; keep(); });
    const ml = el('label', 'mu-headfield');
    ml.append(el('span', null, 'Model'), m, qmark(MODEL_HELP));
    headBox.append(ml);
    const f = S[S.mode];
    if (!(S.mode === 'simple' && !f.instrumental)) {
      const len = el('input', 'field mu-in mu-len');
      len.type = 'number';
      len.min = 10; len.max = 360; len.placeholder = 'auto';
      len.value = f.seconds || '';
      len.addEventListener('input', () => { f.seconds = len.value; keep(); });
      const ll = el('label', 'mu-headfield');
      ll.append(el('span', null, 'Length'), len, el('span', 'mu-unit', 's'), qmark('How long the track should be, 10-360 s. Empty - Suno decides. A target, not a timer.'));
      headBox.append(ll);
    }
  }
}

function _secs(j) {
  return Math.max(0, Math.round((Date.now() - (j.at || Date.now())) / 1000));
}

function _state(j) {
  if (j.state === 'pending') return (j.stage || 'working') + '… ' + _secs(j) + ' s';
  if (j.state === 'failed') return (j.refused ? 'refused: ' : 'failed: ') + j.error;
  if (j.kind === 'lyrics') return (j.lyrics || []).length + ' texts';
  return 'done';
}

function paintRecent() {
  recentBox.textContent = '';
  const list = JOBS.current().filter(j => j.kind === 'music').slice(0, 8);
  if (!list.length) { recentBox.hidden = true; return; }
  recentBox.hidden = false;
  recentBox.append(el('span', 'mu-recent-label', 'Recent'));
  for (const j of list) {
    const c = el('div', 'mu-rcard is-' + j.state);
    const name = el('div', 'mu-rname', (j.written && j.written.title) || j.label);
    name.title = j.label;
    c.append(name);
    if (j.state === 'done') {
      const row = el('div', 'mu-rrow');
      for (const r of j.results || []) {
        const b = el('button', 'mu-rplay', '▶ ' + r.n);
        b.title = 'Play ' + r.name;
        b.addEventListener('click', () => playTrack('music', r.rel, r.name, r.dur));
        row.append(b);
      }
      const show = el('button', 'mu-link', 'show');
      show.title = 'Show in the library';
      show.addEventListener('click', () => { const r = (j.results || [])[0]; if (r) revealFile('music', r.rel); });
      row.append(show);
      c.append(row);
    } else {
      const st = el('div', 'mu-rstate', _state(j));
      st.title = st.textContent;
      c.append(st);
    }
    recentBox.append(c);
  }
}

function paintFoot() {
  footBox.textContent = '';
  const alm = el('button', 'btn ghost', 'Almanac');
  alm.addEventListener('click', _almanac);
  footBox.append(alm);
  const into = el('span', 'mu-into');
  if (S.mode === 'lyrics') into.textContent = 'texts only · Save keeps one';
  else {
    const where = folder.root === 'music' && folder.rel ? 'Music / ' + folder.rel.split('/').join(' / ') : 'Music';
    into.textContent = 'into ' + where;
    into.title = 'The tracks go into the Music folder selected in the library; none selected - the root of Music.';
  }
  footBox.append(into);
  const p = info.prices[S.mode];
  const price = el('span', 'mu-price');
  if (p) price.textContent = '$' + p.usd + ' · ' + p.credits + ' credits · ' + p.note + (info.fake ? ' · FAKE' : '');
  footBox.append(price);
  const go = el('button', 'btn primary mu-go', S.mode === 'lyrics' ? 'Write the lyrics' : 'Generate');
  go.addEventListener('click', generate);
  footBox.append(go);
}

function _almanac() {
  const f = S[S.mode];
  const mainKey = S.mode === 'simple' ? 'words' : S.mode === 'custom' ? 'style' : 'idea';
  const mainLabel = S.mode === 'simple' ? 'In your words' : S.mode === 'custom' ? 'Style' : 'The idea';
  const add = (obj, key, words, sep) => {
    const have = String(obj[key] || '').trim();
    if (!words || have.toLowerCase().includes(words.toLowerCase())) return;
    obj[key] = have ? have + (sep || ', ') + words : words;
  };
  openAlmanac({
    mainLabel,
    into: (parts) => {
      if (S.mode === 'custom') {
        add(f, 'style', parts.main);
        add(f, 'negative', parts.negative);
        if (parts.lyrics) { f.instrumental = false; add(f, 'lyrics', parts.lyrics, '\n\n'); }
      } else {
        // In Simple an Exclude-only note is said as "without …"; Lyrics notes are words like the rest.
        add(f, mainKey, [parts.main, parts.lyrics, parts.negative ? 'without ' + parts.negative : ''].filter(Boolean).join(', '));
      }
      keep();
      paintCard();
    },
  });
}

async function generate() {
  const f = S[S.mode];
  let body;
  if (S.mode === 'simple') {
    body = {
      mode: 'simple', model: S.model, chips: f.picked, mix: mix.filter(t => !f.mixOff.includes(t)), words: f.words,
      instrumental: f.instrumental, about: f.about, writer: f.writer, seconds: f.seconds,
    };
  } else if (S.mode === 'custom') {
    body = Object.assign({ mode: 'custom', model: S.model }, f);
  } else {
    body = { mode: 'lyrics', idea: f.idea };
  }
  body.into = folder.root === 'music' ? folder.rel : '';
  const go = footBox.querySelector('.mu-go');
  go.disabled = true;
  try {
    const r = await api('/api/music/gen', { method: 'POST', body });
    JOBS.put(r.job);
    showToast(S.mode === 'lyrics' ? 'Asked - the texts appear here in a minute.' : 'Asked - follow it in Recent and Jobs.');
  } catch (e) {
    showError(e.message);
  } finally {
    go.disabled = false;
  }
}

function paintAll() {
  paintHead();
  feelBox.hidden = S.mode === 'lyrics';
  if (S.mode !== 'lyrics') paintFeel(feelBox);
  paintCard();
  paintRecent();
  paintFoot();
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function initMusic() {
  host = document.querySelector('[data-panel="music"]');
  host.textContent = '';
  host.classList.add('music');
  headBox = el('div', 'mu-head');
  const bodyBox = el('div', 'mu-body');
  feelBox = el('aside', 'mu-feel');
  cardBox = el('div', 'mu-card');
  bodyBox.append(feelBox, cardBox);
  recentBox = el('div', 'mu-recent');
  footBox = el('div', 'mu-foot');
  host.append(headBox, bodyBox, recentBox, footBox);

  try { info = await api('/api/music/info'); } catch { /* the defaults */ }
  try { mix = ((await api('/api/tags/mix')).tags || []).map(t => t.tag); } catch { mix = []; }
  window.addEventListener('ms:mix', (e) => {
    mix = (e.detail || []).map(t => t.tag);
    S.simple.mixOff = S.simple.mixOff.filter(t => mix.includes(t));
    if (S.mode !== 'lyrics') paintFeel(feelBox);
    paintCard();
  });
  window.addEventListener('ms:folder', (e) => { folder = e.detail || folder; paintFoot(); });
  let lastLyricsDone = '';
  JOBS.subscribe((jobs) => {
    paintRecent();
    // Lyrics just written show in the Lyrics mode at once.
    const ly = jobs.filter(j => j.kind === 'lyrics').map(j => j.id + j.state).join();
    if (S.mode === 'lyrics' && ly !== lastLyricsDone) { lastLyricsDone = ly; paintCard(); }
  });
  // The seconds of what is being made tick on; nothing with a field in it is drawn again.
  setInterval(() => {
    if (!JOBS.current().some(j => j.state === 'pending')) return;
    paintRecent();
    for (const h of cardBox.querySelectorAll('.mu-ljob-head')) {
      const j = JOBS.current().find(x => x.id === h.dataset.id);
      if (j) h.textContent = j.label + ' · ' + _state(j);
    }
  }, 1000);
  paintAll();
  await loadSaved();
  JOBS.refresh();
}
