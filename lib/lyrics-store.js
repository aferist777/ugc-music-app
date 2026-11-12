'use strict';

// Saved song texts (phase 3, the owner's C7 - as UGC Studio's lib/lyrics-store.js): data/lyrics.json, newest first.
// What Suno's Lyrics mode wrote is saved by "Save"; one's own text by "Save" under Custom's lyrics. A text saved twice
// from the same press is the same item.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'lyrics.json');
const MAX_ITEMS = 2000;

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });

function _read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j.items) ? j.items : [];
  } catch { return []; }
}

const _write = (items) => writeJsonAtomic(FILE, { items: items.slice(0, MAX_ITEMS) });
const _norm = (t) => String(t || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

// A text's name when none is given: its first line that is not a [section] tag.
function _titleOf(text) {
  const line = _norm(text).split('\n').map(l => l.trim()).find(l => l && !/^\[.*\]$/.test(l));
  return (line || 'Untitled').slice(0, 120);
}

function list() {
  return _read();
}

function add({ title, text, from, gen }) {
  const t = _norm(text);
  if (!t) throw bad('the text is empty');
  if (t.length > 20000) throw bad('the text is longer than 20000 characters');
  const items = _read();
  const same = items.find(x => _norm(x.text) === t && (!gen || x.gen === gen || !x.gen));
  if (same) return { item: same, already: true };
  const item = {
    id: 'ly' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || _titleOf(t),
    text: t,
    from: from === 'suno' ? 'suno' : 'own',
    gen: gen ? String(gen).slice(0, 40) : '',
    date: Date.now(),
  };
  items.unshift(item);
  _write(items);
  return { item };
}

function rename(id, title) {
  const items = _read();
  const it = items.find(x => x.id === id);
  if (!it) throw bad('no such text', 404);
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) throw bad('the name is empty');
  it.title = t;
  _write(items);
  return { item: it };
}

function remove(id) {
  const items = _read();
  const next = items.filter(x => x.id !== id);
  if (next.length === items.length) throw bad('no such text', 404);
  _write(next);
  return { ok: true };
}

module.exports = { list, add, rename, remove };
