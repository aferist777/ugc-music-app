'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TWO CHATS OF PHASE 5 - Images and Animate, ONE CHAT EACH, FOREVER (the owner's i2): data/chats/<kind>.json, its
// entries oldest first. An entry is a press (what was asked, the enhanced prompt, the pictures it was given, what it
// made, its state - written again by lib/visual.js at every step of the press) or, in Images, the person's own pictures
// brought in (`upload`, the owner's i8 / i13). Taking a press out of the journal leaves it here.
//
// A file renamed, moved, archived or restored in the library is FOLLOWED here in the same step (`follow`, called by
// lib/library.js beside the timeline projects): every entry - and every picture or clip press still waiting in the
// journal - points at its new place. A file deleted for good shows as gone.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, ROOTS } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');
const J = require('./journal');

const DIR = path.join(DATA_DIR, 'chats');
const KINDS = ['image', 'animate'];
const SHOWN = 200;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const fileOf = (kind) => {
  if (!KINDS.includes(kind)) throw bad('no such chat');
  return path.join(DIR, kind + '.json');
};

function _read(kind) {
  try {
    const c = JSON.parse(fs.readFileSync(fileOf(kind), 'utf8'));
    return Array.isArray(c.entries) ? c : { entries: [] };
  } catch (e) {
    if (e.status) throw e;
    return { entries: [] };
  }
}

function _write(kind, c) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(fileOf(kind), c);
}

/** An entry written whole - added at the end, or put in the place of the one with its id. */
function put(kind, entry) {
  const c = _read(kind);
  const i = c.entries.findIndex(e => e.id === entry.id);
  if (i >= 0) c.entries[i] = entry; else c.entries.push(entry);
  _write(kind, c);
}

const _there = (p) => {
  const root = ROOTS.find(r => r.id === p.root);
  return !!root && fs.existsSync(path.join(root.dir, ...String(p.rel).split('/')));
};

/** The last entries, every picture and clip in them told whether its file is still there. */
function list(kind) {
  const entries = _read(kind).entries.slice(-SHOWN);
  for (const e of entries) {
    for (const p of (e.pics || []).concat(e.results || [])) p.gone = !_there(p);
  }
  return entries;
}

/** The person's own pictures, just brought into Images (Uploads), as one entry of the Images chat. */
function addUploads(rels) {
  const results = (Array.isArray(rels) ? rels : []).map(String).filter(r => r && !r.split('/').includes('..'))
    .slice(0, 50).map(rel => ({ root: 'images', rel, name: rel.split('/').pop() }));
  if (!results.length) throw bad('no pictures');
  const entry = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), type: 'upload', at: Date.now(), results };
  put('image', entry);
  return entry;
}

// ── Following the library ───────────────────────────────────────────────────

function _move(p, root, rel, toRoot, toRel) {
  if (!p || p.root !== root || !p.rel) return false;
  if (p.rel === rel) { p.root = toRoot; p.rel = toRel; } else if (p.rel.startsWith(rel + '/')) {
    p.root = toRoot;
    p.rel = toRel + p.rel.slice(rel.length);
  } else return false;
  if ('name' in p) p.name = p.rel.split('/').pop();
  return true;
}

/** A file or a folder moved from (root, rel) to (toRoot, toRel): every picture and clip of the chats follows it. */
function follow(root, rel, toRoot, toRel) {
  if (!rel) return;
  for (const kind of KINDS) {
    const c = _read(kind);
    let changed = false;
    for (const e of c.entries) {
      for (const p of (e.pics || []).concat(e.results || [])) if (_move(p, root, rel, toRoot, toRel)) changed = true;
    }
    if (changed) _write(kind, c);
  }
  // A press still being made writes its entry again from the journal: its record follows too.
  let moved = false;
  for (const j of J.all()) {
    if (j.kind !== 'image' && j.kind !== 'animate') continue;
    const r = j.req || {};
    for (const p of (r.refs || []).concat([r.start, r.last], j.results || [])) if (_move(p, root, rel, toRoot, toRel)) moved = true;
  }
  if (moved) J.save();
}

module.exports = { put, list, addUploads, follow };
