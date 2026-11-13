'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TAG ASSISTANT'S CHATS (phase 2, the owner's V5): one file per chat in data/tags/<id>.json - its messages, every
// answer with its tags, so an old chat keeps its chips; a chat is named after the STYLE the first answer names (the
// agent's `title`) until the person renames it. The Mix - the tags picked from any answer - is data/tags/mix.json.
// While a chat waits for its answer the job lives in memory (`pending`); a chat left waiting when the app closed shows
// its question without an answer, and the person sends again. Phase 7: a message may carry up to 4 pictures of Images
// (`pics`, the library's own - the page brings a picture from this computer into Images / Uploads first); they are
// shown to the models as small JPEGs (lib/picture.js `seeable`); a refused answer (`refused` - off music, or a message
// that tried to change the rules) never names the chat and is left out of what the models are told later, with the
// message it answered.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');
const AGENT = require('./tags-agent');
const LIB = require('./library');
const PIC = require('./picture');

const DIR = path.join(DATA_DIR, 'tags');
const MIX = path.join(DIR, 'mix.json');
const MAX_TEXT = 4000;
const MAX_MIX = 60;
const MAX_PICS = 4;
const PICTURE = /\.(jpe?g|png|webp|gif)$/i;

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });
const fileOf = (id) => {
  if (!/^t[a-z0-9]{6,24}$/.test(String(id))) throw bad('no such chat', 404);
  return path.join(DIR, id + '.json');
};

function _read(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch (e) {
    if (e.status) throw e;
    throw bad('no such chat', 404);
  }
}

const _write = (chat) => writeJsonAtomic(fileOf(chat.id), chat);

// ── Chats ───────────────────────────────────────────────────────────────────

const pending = new Map(); // chat id -> { stage, searches, step, since }

function list() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^t[a-z0-9]+\.json$/.test(n)) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
      out.push({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: (c.messages || []).length, pending: pending.has(c.id) });
    } catch { /* a broken file is skipped */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function get(id) {
  const chat = _read(id);
  return { chat, pending: pending.get(id) || null };
}

function _new(text) {
  const now = Date.now();
  const id = 't' + now.toString(36) + crypto.randomBytes(3).toString('hex');
  return { id, title: text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'A picture', titled: false, createdAt: now, updatedAt: now, messages: [] };
}

// The message's pictures: pictures of Images that are there, each once, at most MAX_PICS.
function _pics(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const rel = String((p && p.rel) || '').replace(/\\/g, '/');
    if ((p && p.root) !== 'images' || !PICTURE.test(rel) || out.some(x => x.rel === rel)) continue;
    LIB.fileAbs('images', rel); // throws in words when it is not there
    out.push({ root: 'images', rel });
  }
  if (out.length > MAX_PICS) throw bad('at most ' + MAX_PICS + ' pictures in one message');
  return out;
}

/**
 * The person's message: written at once, then the ladder asked in the background; the page follows the chat until its
 * `pending` is gone. One question at a time per chat.
 */
function send(id, text, pics) {
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  const p = _pics(pics);
  if (!t && !p.length) throw bad('write what music you want first - or attach a picture');
  if (t.length > MAX_TEXT) throw bad('the message is longer than ' + MAX_TEXT + ' characters');
  let chat;
  if (id) {
    chat = _read(id);
    if (pending.has(chat.id)) throw bad('this chat is still waiting for its answer', 409);
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    chat = _new(t);
  }
  // What the models are told: the earlier turns that were answered (a question left without an answer is left out).
  const history = [];
  const msgs = chat.messages || [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const answered = msgs[i + 1] && msgs[i + 1].role === 'assistant' && msgs[i + 1].ok && !msgs[i + 1].refused;
    if (m.role === 'user' && answered) history.push(m);
    else if (m.role === 'assistant' && m.ok && !m.refused) history.push(m);
  }
  chat.messages = msgs.concat([Object.assign({ role: 'user', text: t, at: Date.now() }, p.length ? { pics: p } : {})]);
  chat.updatedAt = Date.now();
  _write(chat);
  pending.set(chat.id, { stage: 'thinking', searches: 0, step: '', since: Date.now() });
  _answer(chat.id, history, t, p);
  return { id: chat.id };
}

async function _answer(id, history, text, pics) {
  const since = Date.now();
  let a;
  try {
    // The pictures as the models see them: small JPEGs, made once (lib/picture.js).
    const images = [];
    for (const p of pics || []) {
      const small = await PIC.seeable(LIB.fileAbs('images', p.rel));
      images.push({ data: fs.readFileSync(small).toString('base64'), type: 'image/jpeg' });
    }
    a = await AGENT.ask(history, text, (st) => pending.set(id, Object.assign({}, pending.get(id), st, { since })), images);
  } catch (e) {
    console.error('[tags] ask failed', e);
    a = { ok: false, error: 'the assistant failed - press Send again', tried: [] };
  }
  try {
    const chat = _read(id);
    const msg = { role: 'assistant', ok: !!a.ok, at: Date.now(), seconds: Math.round((Date.now() - since) / 1000), tried: a.tried || [] };
    if (a.ok) Object.assign(msg, { text: a.text, chips: a.chips, title: a.title, sources: a.sources, by: a.by }, a.refused ? { refused: true } : {});
    else msg.error = a.error;
    chat.messages.push(msg);
    // The chat is named after the style its first answer names - once, and never over a name the person gave.
    if (a.ok && !a.refused && a.title && !chat.titled) { chat.title = a.title; chat.titled = true; }
    chat.updatedAt = Date.now();
    _write(chat);
  } catch (e) {
    console.error('[tags] the answer could not be kept', e);
  } finally {
    pending.delete(id);
  }
}

function rename(id, title) {
  const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!t) throw bad('the name is empty');
  const chat = _read(id);
  chat.title = t;
  chat.titled = true;
  _write(chat);
  return { id, title: t };
}

function remove(id) {
  if (pending.has(id)) throw bad('this chat is still waiting for its answer', 409);
  fs.rmSync(fileOf(id), { force: true });
  return { ok: true };
}

// ── The Mix ─────────────────────────────────────────────────────────────────

function getMix() {
  try {
    const j = JSON.parse(fs.readFileSync(MIX, 'utf8'));
    return Array.isArray(j.tags) ? j.tags : [];
  } catch { return []; }
}

/** The whole Mix, as the page has it: [{ tag, group }] - English tags, each once. */
function setMix(tags) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tags) ? tags : []) {
    const tag = String((t && t.tag) || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, group: ['genre', 'mood', 'sound'].includes(t.group) ? t.group : 'own' });
    if (out.length >= MAX_MIX) break;
  }
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(MIX, { tags: out });
  return out;
}

module.exports = { list, get, send, rename, remove, getMix, setMix };
