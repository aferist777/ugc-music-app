'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TIMELINE PROJECTS (phase 4) - data/projects/<id>.json, listed in the library as the top row "Projects" (the owner's
// T1). A project: its name, its frame (16:9 by default, or 9:16 - T4) and four lanes - v2 over v1 (two video lanes) and
// a1, a2 (two sound lanes; the owner's T2). A clip: where its file is (root + rel), where it starts on the timeline, how
// long it lasts there and from which second of the file (`in`); a picture lasts 5 s until stretched (T3).
//
// A file renamed, moved, put into Archive or restored in the library is FOLLOWED here in the same step (`follow`, called
// by lib/library.js): every clip pointing at it - or into a folder that moved - points at its new place, and the
// project's `rev` goes up, so a page holding the older project is told to read it again rather than write it back.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, ROOTS } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');

const DIR = path.join(DATA_DIR, 'projects');
const LANES = ['v2', 'v1', 'a1', 'a2'];
const FORMATS = ['16:9', '9:16'];
const ROOT_IDS = new Set(ROOTS.map(r => r.id));

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });
const fileOf = (id) => {
  if (!/^p[a-z0-9]{6,24}$/.test(String(id))) throw bad('no such project', 404);
  return path.join(DIR, id + '.json');
};

function _read(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch (e) {
    if (e.status) throw e;
    throw bad('no such project', 404);
  }
}

function _write(p) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(fileOf(p.id), p);
}

function _all() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^p[a-z0-9]+\.json$/.test(n)) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'))); } catch { /* a broken file is skipped */ }
  }
  return out;
}

const _num = (v, lo, hi, dflt) => {
  const n = +v;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

// A clip as the page sent it -> as it is kept; null for one that cannot be.
function _clip(c, lane) {
  if (!c || typeof c !== 'object') return null;
  const root = String(c.root || '');
  const rel = String(c.rel || '').replace(/\\/g, '/');
  if (!ROOT_IDS.has(root) || !rel || rel.split('/').includes('..')) return null;
  const kind = lane.startsWith('a') ? 'audio' : (c.kind === 'image' ? 'image' : 'video');
  return {
    id: /^c[a-z0-9]{4,30}$/.test(String(c.id)) ? String(c.id) : 'c' + crypto.randomBytes(6).toString('hex'),
    kind, root, rel,
    name: String(c.name || rel.split('/').pop()).slice(0, 200),
    start: _num(c.start, 0, 86400, 0),
    dur: _num(c.dur, 0.05, 86400, 1),
    in: kind === 'image' ? 0 : _num(c.in, 0, 86400, 0),
    fileDur: kind === 'image' ? null : _num(c.fileDur, 0, 86400, 0),
  };
}

function _normalize(p) {
  const out = {
    id: p.id, name: String(p.name || 'Untitled').slice(0, 80), format: FORMATS.includes(p.format) ? p.format : '16:9',
    createdAt: p.createdAt || Date.now(), updatedAt: Date.now(), rev: (+p.rev || 0) + 1, lanes: {},
  };
  for (const l of LANES) out.lanes[l] = (Array.isArray(p.lanes && p.lanes[l]) ? p.lanes[l] : []).map(c => _clip(c, l)).filter(Boolean);
  return out;
}

// ── The list ────────────────────────────────────────────────────────────────

function list() {
  return _all()
    .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function _freeName(name, except) {
  const taken = new Set(_all().filter(p => p.id !== except).map(p => p.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : name + ' ' + i;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

function _cleanName(name) {
  const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw bad('the name is empty');
  return n;
}

function create(name) {
  const now = Date.now();
  const p = _normalize({ id: 'p' + now.toString(36) + crypto.randomBytes(3).toString('hex'), name: _freeName(_cleanName(name || 'Untitled')), createdAt: now, rev: 0 });
  _write(p);
  return p;
}

/** A project, every clip told whether its file is there. */
function get(id) {
  const p = _read(id);
  for (const l of LANES) {
    for (const c of p.lanes[l] || []) {
      const root = ROOTS.find(r => r.id === c.root);
      c.missing = !root || !fs.existsSync(path.join(root.dir, ...c.rel.split('/')));
    }
  }
  return p;
}

/** The page's project written whole - refused (409) when the project changed since the page read it (`rev`). */
function save(id, body) {
  const old = _read(id);
  if (+body.rev !== +old.rev) throw bad('the project changed meanwhile - it is read again', 409);
  const p = _normalize(Object.assign({}, body, { id, name: old.name, createdAt: old.createdAt, rev: old.rev }));
  _write(p);
  return { rev: p.rev, updatedAt: p.updatedAt };
}

function rename(id, name) {
  const p = _read(id);
  const n = _cleanName(name);
  if (n !== p.name) p.name = _freeName(n, id);
  p.rev = (+p.rev || 0) + 1;
  p.updatedAt = Date.now();
  _write(p);
  return { id, name: p.name, rev: p.rev };
}

function remove(id) {
  fs.rmSync(fileOf(id), { force: true });
  return { ok: true };
}

// ── Following the library ───────────────────────────────────────────────────

/** A file or a folder moved from (root, rel) to (toRoot, toRel): every clip pointing at it or into it follows. */
function follow(root, rel, toRoot, toRel) {
  if (!rel) return;
  for (const p of _all()) {
    let changed = false;
    for (const l of LANES) {
      for (const c of p.lanes[l] || []) {
        if (c.root !== root) continue;
        if (c.rel === rel) { c.root = toRoot; c.rel = toRel; changed = true; } else if (c.rel.startsWith(rel + '/')) {
          c.root = toRoot;
          c.rel = toRel + c.rel.slice(rel.length);
          changed = true;
        }
        c.name = c.rel.split('/').pop();
      }
    }
    if (changed) {
      p.rev = (+p.rev || 0) + 1;
      p.updatedAt = Date.now();
      _write(p);
    }
  }
}

module.exports = { list, create, get, save, rename, remove, follow };
