// ════════════════════════════════════════════════════════════════════════════
// THE TAGS TAB (phase 2): the list of chats on the left (the owner's V5 - each named after the style of its first
// answer, each keeping its chips), the chat on the right: the person's messages, the assistant's answers with their
// sources (folded, V7) and their tags in three groups; a press on a tag puts it into the Mix (again - takes it out), the
// Mix is one for the whole tab and kept on the server; "+ tag" adds one's own (V4). While an answer is being made the
// chat shows what the assistant is doing and for how long (V6) - the page only follows the server (lib/tags-store.js).
// ════════════════════════════════════════════════════════════════════════════

import { api, remembered, remember } from '../api.js';
import { openMenu } from '../menu.js';
import { showError, showToast } from '../notice.js';
import { renderMarkdown } from './markdown.js';

const $ = (id) => document.getElementById(id);
const GROUPS = [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const S = {
  chats: [],
  open: null,      // the open chat's id; null - a new chat, made by its first message
  chat: null,
  pending: null,
  mix: [],
  steps: [],
  fake: false,
};

let pollTimer = 0;
let tickTimer = 0;

// ── The list of chats ───────────────────────────────────────────────────────

function _when(t) {
  const d = new Date(t);
  const now = new Date();
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + hm;
}

async function loadChats() {
  try { S.chats = (await api('/api/tags/chats')).chats || []; } catch (e) { showError(e.message); }
  paintChats();
}

function paintChats() {
  const host = $('tg-chats');
  host.textContent = '';
  if (!S.chats.length) {
    host.append(el('div', 'tg-chats-empty', 'Your chats will be listed here.'));
    return;
  }
  for (const c of S.chats) {
    const row = el('div', 'tg-chat' + (c.id === S.open ? ' is-on' : ''));
    row.setAttribute('role', 'listitem');
    row.dataset.id = c.id;
    const name = el('span', 'tg-chat-name', c.title || 'New chat');
    name.title = c.title || '';
    const when = el('span', 'tg-chat-when', c.pending ? 'answering…' : _when(c.updatedAt));
    const x = el('button', 'tg-chat-x', '✕');
    x.title = 'Delete this chat';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!x.classList.contains('is-really')) {
        x.classList.add('is-really');
        x.textContent = 'Really?';
        setTimeout(() => { x.classList.remove('is-really'); x.textContent = '✕'; }, 4000);
        return;
      }
      _delete(c.id);
    });
    row.append(name, when, x);
    row.addEventListener('click', () => open(c.id));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { label: 'Rename', act: () => _rename(row, c) },
        { sep: true },
        { label: 'Delete chat', danger: true, really: true, act: () => _delete(c.id) },
      ]);
    });
    host.append(row);
  }
}

function _rename(row, c) {
  const name = row.querySelector('.tg-chat-name');
  const input = el('input', 'rename-input');
  input.value = c.title || '';
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const t = input.value.trim();
    if (save && t && t !== c.title) {
      try { await api('/api/tags/chats/' + c.id + '/rename', { method: 'POST', body: { title: t } }); } catch (e) { showError(e.message); }
    }
    await loadChats();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function _delete(id) {
  try {
    await api('/api/tags/chats/' + id + '/delete', { method: 'POST', body: {} });
    if (S.open === id) newChat();
    await loadChats();
  } catch (e) {
    showError(e.message);
  }
}

// ── One chat ────────────────────────────────────────────────────────────────

function newChat() {
  S.open = null;
  S.chat = null;
  S.pending = null;
  remember({ tagsChat: null });
  _stopPolling();
  paintThread();
  paintChats();
  $('tg-input').focus();
}

async function open(id) {
  _stopPolling();
  try {
    const r = await api('/api/tags/chats/' + encodeURIComponent(id));
    S.open = id;
    S.chat = r.chat;
    S.pending = r.pending;
    remember({ tagsChat: id });
  } catch (e) {
    showError(e.message);
    newChat();
    return;
  }
  paintChats();
  paintThread(true);
  if (S.pending) _startPolling();
}

function _usd(v) {
  if (v == null) return '';
  return v < 0.01 ? '<$0.01' : '$' + v.toFixed(2);
}

function _answer(m) {
  const box = el('div', 'tg-msg is-agent');
  if (!m.ok) {
    box.classList.add('is-error');
    box.append(el('div', 'tg-error', m.error || 'No answer.'));
    if (m.tried && m.tried.length) box.append(el('div', 'tg-tried', m.tried.join(' · ')));
    return box;
  }
  const by = m.by || {};
  const head = [by.label || 'Assistant'];
  if (by.searches) head.push(by.searches + (by.searches === 1 ? ' search' : ' searches'));
  if (by.usd != null) head.push(_usd(by.usd));
  if (m.seconds) head.push(m.seconds + ' s');
  box.append(el('div', 'tg-by', head.join(' · ')));
  if (m.tried && m.tried.length) box.append(el('div', 'tg-tried', 'before it: ' + m.tried.join(' · ')));
  const body = el('div', 'tg-text');
  body.innerHTML = renderMarkdown(m.text);
  box.append(body);
  if (m.sources && m.sources.length) {
    const d = el('details', 'tg-sources');
    d.append(el('summary', null, 'Sources · ' + m.sources.length));
    for (const s of m.sources) {
      const a = el('a', null, s.title || s.url);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      d.append(a);
    }
    box.append(d);
  }
  if (m.chips) {
    const tags = el('div', 'tg-tags');
    for (const [g, label] of GROUPS) {
      const list = m.chips[g] || [];
      if (!list.length) continue;
      const row = el('div', 'tg-group');
      row.append(el('span', 'tg-group-label', label));
      const chips = el('span', 'tg-group-chips');
      for (const c of list) chips.append(_chip(c.tag, g, c.why));
      row.append(chips);
      tags.append(row);
    }
    box.append(tags);
  } else {
    box.append(el('div', 'tg-tried', 'No tags came with this answer - ask again or rephrase.'));
  }
  return box;
}

function _chip(tag, group, why) {
  const b = el('button', 'tg-chip' + (S.mix.some(t => t.tag === tag) ? ' is-in' : ''), tag);
  b.dataset.tag = tag;
  b.dataset.group = group;
  if (why) b.title = why;
  b.addEventListener('click', () => toggleMix(tag, group));
  return b;
}

function _status() {
  const p = S.pending;
  if (!p) return '';
  const secs = Math.max(0, Math.round((Date.now() - (p.since || Date.now())) / 1000));
  let what = p.stage || 'thinking';
  if (p.searches) what += ' (' + p.searches + ')';
  return (p.step ? p.step + ' · ' : '') + what + '… ' + secs + ' s';
}

function paintThread(scroll) {
  const host = $('tg-thread');
  const keepBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  host.textContent = '';
  const msgs = (S.chat && S.chat.messages) || [];
  if (!msgs.length && !S.pending) {
    const hint = el('div', 'tg-empty');
    hint.append(el('h2', null, 'Tag assistant'));
    hint.append(el('p', null, 'Describe the music you want - a mood, a scene, a use, a reference. The assistant searches the web if it needs to and answers with genre, mood and sound tags to mix.'));
    host.append(hint);
  }
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      host.append(el('div', 'tg-msg is-you', m.text));
      // A question with no answer after it, and nothing waiting: the app was closed while it waited.
      const next = msgs[i + 1];
      if (!next && !S.pending) host.append(el('div', 'tg-msg is-agent is-error', 'No answer - the app was closed while it waited. Send it again.'));
    } else host.append(_answer(m));
  });
  if (S.pending) host.append(el('div', 'tg-msg is-agent tg-wait', _status()));
  $('tg-send').disabled = !!S.pending;
  if (scroll || keepBottom) host.scrollTop = host.scrollHeight;
}

// ── Waiting for an answer ───────────────────────────────────────────────────

function _stopPolling() {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  pollTimer = 0;
  tickTimer = 0;
}

function _startPolling() {
  _stopPolling();
  tickTimer = setInterval(() => {
    const w = document.querySelector('.tg-wait');
    if (w) w.textContent = _status();
  }, 1000);
  const poll = async () => {
    const id = S.open;
    try {
      const r = await api('/api/tags/chats/' + encodeURIComponent(id));
      if (S.open !== id) return;
      S.chat = r.chat;
      const was = !!S.pending;
      S.pending = r.pending;
      if (!r.pending) {
        _stopPolling();
        paintThread(true);
        await loadChats();
        return;
      }
      if (was) { const w = document.querySelector('.tg-wait'); if (w) w.textContent = _status(); } else paintThread(true);
    } catch { /* the next poll tries again */ }
    pollTimer = setTimeout(poll, 1200);
  };
  pollTimer = setTimeout(poll, 800);
}

async function send() {
  const input = $('tg-input');
  const text = input.value.trim();
  if (!text || S.pending) return;
  $('tg-send').disabled = true;
  try {
    const r = await api('/api/tags/send', { method: 'POST', body: { chat: S.open, text } });
    input.value = '';
    _grow();
    S.open = r.id;
    remember({ tagsChat: r.id });
    const c = await api('/api/tags/chats/' + encodeURIComponent(r.id));
    S.chat = c.chat;
    S.pending = c.pending;
    paintThread(true);
    await loadChats();
    if (S.pending) _startPolling();
  } catch (e) {
    showError(e.message);
    $('tg-send').disabled = false;
  }
}

function _grow() {
  const t = $('tg-input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 140) + 'px';
  t.style.overflowY = t.scrollHeight > 140 ? 'auto' : 'hidden';
}

// ── The Mix ─────────────────────────────────────────────────────────────────

let saveTimer = 0;

function _saveMix() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { S.mix = (await api('/api/tags/mix', { method: 'PUT', body: { tags: S.mix } })).tags || []; } catch (e) { showError(e.message); }
  }, 250);
}

function paintMix() {
  // The Music tab follows the Mix (phase 3, "From Tags").
  window.dispatchEvent(new CustomEvent('ms:mix', { detail: S.mix.slice() }));
  const host = $('tg-mix-tags');
  host.textContent = '';
  if (!S.mix.length) host.append(el('span', 'tg-mix-empty', 'press tags in an answer to mix them'));
  for (const t of S.mix) {
    const b = el('button', 'tg-chip is-in is-mix is-' + t.group, t.tag);
    b.title = 'Take it out of the Mix';
    b.addEventListener('click', () => toggleMix(t.tag, t.group));
    host.append(b);
  }
  for (const c of document.querySelectorAll('.tg-thread .tg-chip')) c.classList.toggle('is-in', S.mix.some(t => t.tag === c.dataset.tag));
  $('tg-mix-copy').disabled = !S.mix.length;
  $('tg-mix-clear').disabled = !S.mix.length;
}

function toggleMix(tag, group) {
  const i = S.mix.findIndex(t => t.tag === tag);
  if (i >= 0) S.mix.splice(i, 1); else S.mix.push({ tag, group });
  paintMix();
  _saveMix();
}

/** The Mix as it stands - phase 3's Suno form takes it. */
export function mixTags() {
  return S.mix.slice();
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function initTags() {
  $('tg-new').addEventListener('click', newChat);
  $('tg-ask').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  const input = $('tg-input');
  input.addEventListener('input', _grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  const add = $('tg-mix-add');
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tag = add.value.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!tag) return;
    if (!S.mix.some(t => t.tag === tag)) { S.mix.push({ tag, group: 'own' }); paintMix(); _saveMix(); }
    add.value = '';
  });
  $('tg-mix-copy').addEventListener('click', async () => {
    const line = S.mix.map(t => t.tag).join(', ');
    try { await navigator.clipboard.writeText(line); showToast('Copied: ' + line); } catch { showError('The Mix could not be copied.'); }
  });
  $('tg-mix-clear').addEventListener('click', () => { S.mix = []; paintMix(); _saveMix(); });

  try {
    const [mix, steps, health] = await Promise.all([api('/api/tags/mix'), api('/api/tags/steps'), api('/api/health')]);
    S.mix = mix.tags || [];
    S.steps = steps.steps || [];
    S.fake = !!health.fake;
  } catch (e) {
    showError(e.message);
  }
  const foot = $('tg-foot');
  foot.textContent = '';
  if (S.fake) foot.append(el('span', 'tg-step is-ready', 'FAKE - free test answers'));
  else {
    S.steps.forEach((s, i) => {
      if (i) foot.append(el('span', 'tg-arrow', '→'));
      const sp = el('span', 'tg-step' + (s.ready ? ' is-ready' : ''), s.label);
      sp.title = s.ready ? 'asked in this order until one answers' : 'no key - skipped';
      foot.append(sp);
    });
  }
  paintMix();
  await loadChats();
  const last = remembered().tagsChat;
  if (last && S.chats.some(c => c.id === last)) await open(last); else paintThread();
}
