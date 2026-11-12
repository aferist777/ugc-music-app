// ════════════════════════════════════════════════════════════════════════════
// THE ANIMATE TAB (phase 5) - built like Images: one chat, forever. On the left the model (Grok 1.5 - the owner's i9;
// Seedance 2.0 mini - a first and a last frame, i12), under it the length and the resolution with the price on their
// right, the START FRAME - set by Animate under a picture of the Images chat or by a picture's right button on the
// timeline (i8), or dropped on it - and for Seedance the LOOP tick (on: the clip ends on its start frame) or, unticked,
// a last frame dropped on its place; then where the clip goes (the Video folder selected in the library, else its root
// - i10). On the right the chat of clips, the Prompt enhancer tick (Gemini 3.8 Flash sees the frame) and the field.
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { showError } from '../notice.js';
import * as JOBS from '../music/jobs-store.js';
import {
  el, thumbOf, money, loadState, keeper, select, frame, resultTile, chatOf, paintThread,
  pressHead, pressLine, bringIn, hasFiles, draggedPictures,
} from './common.js';

const LS = 'ms_animate_v1';
const DEF = { model: 'grok-1.5', durs: {}, res: {}, start: null, last: null, loop: true, enhance: true, words: '' };

const S = loadState(LS, DEF);
const keep = keeper(LS, S);
let info = { models: [] };
let folder = { root: 'video', rel: '' };
let panel;
let ui;
let chat;
let loaded = false;

const modelOf = () => info.models.find(m => m.id === S.model) || info.models[0];
const durOf = (m) => { const d = +S.durs[m.id]; return d >= m.dur.min && d <= m.dur.max ? d : m.dur.def; };
const resOf = (m) => (m.res.includes(S.res[m.id]) ? S.res[m.id] : m.resDef);

/** A picture becomes the start frame (Animate under a picture, a timeline picture's right button). */
function setStart(p) {
  S.start = { root: 'images', rel: p.rel };
  keep();
  paintSide();
}

// ── A frame's place: its picture, or the words of where it comes from; pictures may be dropped on it ──

function _slot(key, hint) {
  const p = S[key];
  const box = el('div', 'vz-frame vz-drop' + (p ? '' : ' is-empty'));
  if (p) {
    const im = el('img');
    im.src = thumbOf(p);
    im.alt = '';
    im.addEventListener('error', () => box.classList.add('is-gone'));
    box.title = p.rel.split('/').join(' / ');
    const x = el('button', 'vz-ref-x', '✕');
    x.type = 'button';
    x.title = 'Take it off';
    x.addEventListener('click', () => { S[key] = null; keep(); paintSide(); });
    box.append(im, x);
  } else {
    box.append(el('span', 'vz-drop-hint', hint));
  }
  box.addEventListener('dragover', (e) => {
    if (!hasFiles(e) && !draggedPictures().length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    box.classList.add('is-drop');
  });
  box.addEventListener('dragleave', () => box.classList.remove('is-drop'));
  box.addEventListener('drop', async (e) => {
    box.classList.remove('is-drop');
    const inPage = draggedPictures();
    if (!hasFiles(e) && !inPage.length) return;
    e.preventDefault();
    window.msDrag = null;
    const got = inPage.length ? inPage : await bringIn(e.dataTransfer.files);
    if (got.length) { S[key] = got[0]; keep(); paintSide(); }
  });
  return box;
}

// ── The left column ─────────────────────────────────────────────────────────

function paintSide() {
  const side = ui.side;
  side.textContent = '';
  const m = modelOf();
  if (!m) { if (loaded) side.append(el('div', 'hint', 'The models could not be read.')); return; }
  side.append(select(info.models.map(x => [x.id, x.label]), m.id, (v) => { S.model = v; keep(); paintSide(); }, m.note));
  const dur = durOf(m);
  const res = resOf(m);
  const line = el('div', 'vz-line');
  const secs = [];
  for (let s = m.dur.min; s <= m.dur.max; s++) secs.push([String(s), s + ' s']);
  line.append(
    select(secs, String(dur), (v) => { S.durs[m.id] = +v; keep(); paintSide(); }, 'Length'),
    select(m.res.map(r => [r, r]), res, (v) => { S.res[m.id] = v; keep(); paintSide(); }, 'Resolution'),
  );
  const price = el('span', 'vz-price', money((m.price[res] || 0) * dur));
  price.title = money(m.price[res] || 0) + ' a second - kie.ai\'s price, read on ' + (info.pricesAsof || '?');
  line.append(price);
  side.append(line);
  side.append(el('div', 'vz-k', 'Start frame'));
  side.append(_slot('start', 'Animate under a picture in Images, or a picture\'s right button on the timeline'));
  if (m.loop) {
    const lab = el('label', 'check');
    lab.title = 'The clip ends on its start frame - it plays round without a jump';
    const c = el('input');
    c.type = 'checkbox';
    c.checked = S.loop !== false;
    c.addEventListener('change', () => { S.loop = c.checked; keep(); paintSide(); });
    lab.append(c, document.createTextNode('Loop - it ends on the start frame'));
    side.append(lab);
    if (S.loop === false) {
      side.append(el('div', 'vz-k', 'Last frame'));
      side.append(_slot('last', 'Drop a picture here - or none: the model decides how it ends'));
    }
  }
  const into = el('div', 'vz-into', 'into ' + (folder.root === 'video' && folder.rel ? 'Video / ' + folder.rel.split('/').join(' / ') : 'Video'));
  into.title = 'The clips go into the Video folder selected in the library; none selected - the root of Video.';
  side.append(into);
}

// ── The chat ────────────────────────────────────────────────────────────────

function _entry(e) {
  const box = el('div', 'vz-msg');
  box.append(...pressHead(e));
  const frames = el('div', 'vz-in');
  frames.append(el('span', 'vz-k', 'from'));
  (e.pics || []).forEach((p, i) => {
    if (i) frames.append(el('span', 'vz-k', '→'));
    const im = el('img', 'vz-in-pic');
    im.src = thumbOf(p);
    im.alt = '';
    im.title = p.rel.split('/').join(' / ') + (p.gone ? ' - gone' : '');
    frames.append(im);
  });
  if (e.loop) frames.append(el('span', 'vz-k', '↻ loop'));
  box.append(frames);
  const out = el('div', 'vz-out');
  for (const r of e.results || []) {
    const cell = el('div', 'vz-cell');
    cell.append(resultTile(panel, r, { video: true }));
    out.append(cell);
  }
  if (e.state === 'pending') out.append(el('div', 'vz-wait-tile'));
  if (out.childNodes.length) box.append(out);
  box.append(pressLine('animate', e, [e.modelLabel, e.duration + ' s', e.resolution, e.price ? money(e.price.total) : '']));
  return box;
}

// ── A press ─────────────────────────────────────────────────────────────────

async function generate() {
  const m = modelOf();
  if (!m) return;
  ui.go.disabled = true;
  try {
    const r = await api('/api/visual/animate/gen', {
      method: 'POST',
      body: {
        model: m.id, duration: durOf(m), resolution: resOf(m), start: S.start, last: S.loop === false ? S.last : null,
        loop: S.loop !== false, words: S.words, enhance: S.enhance !== false, into: folder.root === 'video' ? folder.rel : '',
      },
    });
    JOBS.put(r.job);
    chat.read();
  } catch (e) {
    showError(e.message);
  } finally {
    ui.go.disabled = false;
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function initAnimate() {
  panel = document.querySelector('[data-panel="animate"]');
  ui = frame(panel, {
    placeholder: 'How it moves - in your words, any language',
    enhanceTitle: 'Gemini 3.8 Flash looks at the frame, adds to your words and sends it at once',
    S, keep, onGo: generate,
  });
  // The page's events are heard from the start - the library speaks before the models are read.
  window.addEventListener('ms:folder', (e) => { folder = e.detail || folder; paintSide(); });
  // Animate under a picture of Images, or a timeline picture's right button: it becomes the start frame, the tab opens.
  window.addEventListener('ms:animate', (e) => {
    if (!e.detail || !e.detail.rel) return;
    setStart(e.detail);
    window.dispatchEvent(new CustomEvent('ms:tab', { detail: { tab: 'animate' } }));
  });
  try { info = (await api('/api/visual/info')).animate; } catch (e) { showError('The clip models could not be read: ' + e.message); }
  loaded = true;
  if (!info.models.some(m => m.id === S.model)) S.model = info.models[0] ? info.models[0].id : S.model;
  paintSide();
  chat = chatOf('animate', (entries, grown) => paintThread(ui.thread, entries, grown, _entry,
    'Clips you make appear here. Press Animate under a picture in Images, or a picture\'s right button on the timeline, to start.'));
}
