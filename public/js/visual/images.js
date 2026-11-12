// ════════════════════════════════════════════════════════════════════════════
// THE IMAGES TAB (phase 5) - one chat, forever (the owner's i2). On the left, under the model: its quality with the
// price on its right, the frame (the open project's by default - i4), how many (×1 · ×2 · ×4 - i5), the references
// (up to ten, fewer when the model takes fewer - i3: library rows or the chat's pictures dropped there, Reference
// under a picture, pictures from this computer) and where the pictures go (the Images folder selected in the library,
// else its root - i7). On the right the chat, the Prompt enhancer tick (Gemini 3.8 Flash sees the references and sends
// at once - i6) and the field with Generate. Under every picture: Animate (the Animate tab, it as the start frame -
// i8) and Reference. Pictures from this computer dropped on the tab go into Images / Uploads (i13).
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { showError, showToast } from '../notice.js';
import * as JOBS from '../music/jobs-store.js';
import {
  el, thumbOf, money, loadState, keeper, seg, select, frame, resultTile, chatOf, paintThread,
  pressHead, pressLine, bringIn, hasFiles, draggedPictures,
} from './common.js';

const LS = 'ms_images_v1';
const DEF = { model: 'nano-banana-2', tiers: {}, aspect: '16:9', count: 1, refs: [], enhance: true, words: '' };

const S = loadState(LS, DEF);
const keep = keeper(LS, S);
let info = { models: [], aspects: ['16:9', '9:16', '1:1'], counts: [1, 2, 4] };
let folder = { root: 'images', rel: '' };
let panel;
let ui;
let chat = null;
let loaded = false;

const modelOf = () => info.models.find(m => m.id === S.model) || info.models[0];
const tierOf = (m) => (m.tiers.includes(S.tiers[m.id]) ? S.tiers[m.id] : m.def);

// ── The references ──────────────────────────────────────────────────────────

export function addRefs(list) {
  const m = modelOf();
  const max = m ? m.refs : 10;
  let added = 0;
  for (const p of list) {
    if (S.refs.some(r => r.rel === p.rel)) continue;
    if (S.refs.length >= max) { showToast((m ? m.label : 'This model') + ' takes up to ' + max + ' references.'); break; }
    S.refs.push({ root: 'images', rel: p.rel });
    added++;
  }
  if (added) { keep(); paintSide(); }
}

function _refsBox() {
  const m = modelOf();
  const max = m ? m.refs : 10;
  const wrap = el('div', 'vz-block');
  const head = el('div', 'vz-k');
  head.append(document.createTextNode('References ' + S.refs.length + '/' + max));
  if (S.refs.length) {
    const clear = el('button', 'link', 'clear');
    clear.type = 'button';
    clear.addEventListener('click', () => { S.refs = []; keep(); paintSide(); });
    head.append(clear);
  }
  const zone = el('div', 'vz-refs vz-drop');
  zone.title = 'Drop pictures here - rows of Images, pictures of this chat, or files from this computer';
  for (const r of S.refs) {
    const t = el('div', 'vz-ref' + (S.refs.indexOf(r) >= max ? ' is-over' : ''));
    t.title = r.rel.split('/').join(' / ');
    const im = el('img');
    im.src = thumbOf(r);
    im.alt = '';
    im.addEventListener('error', () => t.classList.add('is-gone'));
    const x = el('button', 'vz-ref-x', '✕');
    x.type = 'button';
    x.title = 'Take it off';
    x.addEventListener('click', () => { S.refs = S.refs.filter(y => y !== r); keep(); paintSide(); });
    t.append(im, x);
    zone.append(t);
  }
  if (!S.refs.length) zone.append(el('span', 'vz-drop-hint', 'Drop pictures here - from the library, this chat or this computer'));
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e) && !draggedPictures().length) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('is-drop');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drop'));
  zone.addEventListener('drop', async (e) => {
    zone.classList.remove('is-drop');
    const inPage = draggedPictures();
    if (!hasFiles(e) && !inPage.length) return;
    e.preventDefault();
    e.stopPropagation();
    window.msDrag = null;
    if (inPage.length) { addRefs(inPage); return; }
    addRefs(await bringIn(e.dataTransfer.files));
  });
  wrap.append(head, zone);
  return wrap;
}

// ── The left column ─────────────────────────────────────────────────────────

function paintSide() {
  const side = ui.side;
  side.textContent = '';
  const m = modelOf();
  if (!m) { if (loaded) side.append(el('div', 'hint', 'The models could not be read.')); return; }
  side.append(select(info.models.map(x => [x.id, x.label]), m.id, (v) => { S.model = v; keep(); paintSide(); }, m.note));
  const tier = tierOf(m);
  const line = el('div', 'vz-line');
  const t = select(m.tiers.map(x => [x, x]), tier, (v) => { S.tiers[m.id] = v; keep(); paintSide(); }, 'Quality');
  t.disabled = m.tiers.length < 2;
  const usd = m.price[tier] || 0;
  const price = el('span', 'vz-price', S.count > 1 ? money(usd) + ' × ' + S.count + ' = ' + money(usd * S.count) : money(usd));
  price.title = 'kie.ai\'s price a picture, read on ' + (info.pricesAsof || '?');
  line.append(t, price);
  side.append(line);
  const fr = el('div', 'vz-line');
  fr.append(el('span', 'vz-k', 'Frame'), seg(info.aspects.map(a => [a, a]), S.aspect, (v) => { S.aspect = v; keep(); paintSide(); }));
  side.append(fr);
  const ct = el('div', 'vz-line');
  ct.append(el('span', 'vz-k', 'Count'), seg(info.counts.map(n => [n, '×' + n]), S.count, (v) => { S.count = v; keep(); paintSide(); }));
  side.append(ct);
  side.append(_refsBox());
  const into = el('div', 'vz-into', 'into ' + (folder.root === 'images' && folder.rel ? 'Images / ' + folder.rel.split('/').join(' / ') : 'Images'));
  into.title = 'The pictures go into the Images folder selected in the library; none selected - the root of Images.';
  side.append(into);
}

// ── The chat ────────────────────────────────────────────────────────────────

function _entry(e) {
  const box = el('div', 'vz-msg');
  if (e.type === 'upload') {
    box.append(el('div', 'vz-you is-note', 'uploaded ' + e.results.length + (e.results.length === 1 ? ' picture' : ' pictures') + ' into Images / Uploads'));
  } else {
    box.append(...pressHead(e));
    if ((e.pics || []).length) {
      const refs = el('div', 'vz-in');
      refs.append(el('span', 'vz-k', 'with'));
      for (const p of e.pics) {
        const im = el('img', 'vz-in-pic');
        im.src = thumbOf(p);
        im.alt = '';
        im.title = p.rel.split('/').join(' / ') + (p.gone ? ' - gone' : '');
        refs.append(im);
      }
      box.append(refs);
    }
  }
  const out = el('div', 'vz-out');
  for (const r of e.results || []) {
    const cell = el('div', 'vz-cell');
    cell.append(resultTile(panel, r));
    if (!r.gone) {
      const acts = el('div', 'vz-acts');
      const an = el('button', 'link', 'Animate');
      an.type = 'button';
      an.title = 'Into the Animate tab as the start frame';
      an.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ms:animate', { detail: { root: r.root, rel: r.rel } })));
      const rf = el('button', 'link', 'Reference');
      rf.type = 'button';
      rf.title = 'Add to the references on the left';
      rf.addEventListener('click', () => addRefs([{ root: r.root, rel: r.rel }]));
      acts.append(an, rf);
      cell.append(acts);
    }
    out.append(cell);
  }
  if (e.type === 'press' && e.state === 'pending') {
    for (let k = (e.results || []).length; k < e.count; k++) out.append(el('div', 'vz-wait-tile' + (e.aspect === '9:16' ? ' is-tall' : e.aspect === '1:1' ? ' is-square' : '')));
  }
  if (out.childNodes.length) box.append(out);
  if (e.type === 'press') {
    box.append(pressLine('image', e, [e.modelLabel, e.tier !== 'standard' ? e.tier : '', e.aspect, e.count > 1 ? '×' + e.count : '', e.price ? money(e.price.total) : '']));
  }
  return box;
}

// ── A press ─────────────────────────────────────────────────────────────────

async function generate() {
  const m = modelOf();
  if (!m) return;
  ui.go.disabled = true;
  try {
    const r = await api('/api/visual/images/gen', {
      method: 'POST',
      body: {
        model: m.id, tier: tierOf(m), aspect: S.aspect, count: S.count, words: S.words, refs: S.refs.slice(0, m.refs),
        enhance: S.enhance !== false, into: folder.root === 'images' ? folder.rel : '',
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

export async function initImages() {
  panel = document.querySelector('[data-panel="images"]');
  ui = frame(panel, {
    placeholder: 'What the picture is - in your words, any language',
    enhanceTitle: 'Gemini 3.8 Flash looks at the references, adds to your words and sends it at once',
    S, keep, onGo: generate,
  });
  // The page's events are heard from the start - the library and the timeline speak before the models are read.
  window.addEventListener('ms:chat-changed', (e) => { if (e.detail && e.detail.kind === 'image' && chat) chat.read(); });
  window.addEventListener('ms:folder', (e) => { folder = e.detail || folder; paintSide(); });
  // The frame follows the project open on the timeline (the owner's i4); a pick holds until it changes.
  const follow = (e) => { const f = e.detail && e.detail.format; if (f && info.aspects.includes(f) && f !== S.aspect) { S.aspect = f; keep(); paintSide(); } };
  window.addEventListener('ms:project-opened', follow);
  window.addEventListener('ms:format', follow);
  try { info = (await api('/api/visual/info')).images; } catch (e) { showError('The picture models could not be read: ' + e.message); }
  loaded = true;
  if (!info.models.some(m => m.id === S.model)) S.model = info.models[0] ? info.models[0].id : S.model;
  paintSide();
  chat = chatOf('image', (entries, grown) => paintThread(ui.thread, entries, grown, _entry,
    'Pictures you make appear here, each under its words. Drop pictures from this computer here to bring them into Images / Uploads.'));
  // Pictures from this computer dropped anywhere on the tab: into Images / Uploads, shown in the chat.
  panel.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('is-drop');
  });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('is-drop'); });
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('is-drop');
    if (!hasFiles(e)) return;
    e.preventDefault();
    bringIn(e.dataTransfer.files);
  });
}
