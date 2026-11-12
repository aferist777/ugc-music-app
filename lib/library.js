'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE LIBRARY (phase 1) - folders on disk, no database. Music, Images and Video hold the person's files, each only its
// own kind (lib/config.js KINDS); a made file has its description beside it - "<name>.txt" - which moves, is renamed,
// archived and restored WITH it and is never listed as a file of its own.
//
// Archive (the owner's B3): what is deleted goes there first - Archive/<Music|Images|Video>/<the path it had> - and only
// from there is it deleted for good. Where each thing came from is kept in data/archive.json (`entries`, keyed by its
// path in Archive); a thing with no entry (put there by hand) is placed back by its path.
//
// An address inside a root is `rel`: folder names joined by "/", "" for the root itself; it never leaves its root.
// Every change refuses in words (a 400 with the reason) rather than doing something else quietly.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { ROOTS, KINDS, DATA_DIR } = require('./config');
const { cleanName, checkPathLength, freeName, MAX_PATH } = require('./names');
const { writeJsonAtomic } = require('./atomic-write');
const INFO = require('./media-info');

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });

// ── Places and names ────────────────────────────────────────────────────────

function rootOf(id) {
  const r = ROOTS.find(x => x.id === id);
  if (!r) throw bad('no such place: ' + id);
  return r;
}

const ARCHIVE = rootOf('archive');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.json');

// Nothing is made, renamed or moved inside Archive: it is restored first.
function liveRoot(id) {
  const r = rootOf(id);
  if (r.id === 'archive') throw bad('nothing changes inside Archive - restore it first');
  return r;
}

function kindOf(name) {
  const ext = path.extname(String(name)).toLowerCase();
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return k;
  return null;
}

function normRel(rel) {
  const parts = String(rel || '').split(/[\\/]+/).filter(Boolean);
  if (parts.some(p => p === '.' || p === '..')) throw bad('no such place');
  return parts.join('/');
}

function absOf(root, rel) {
  const r = normRel(rel);
  const abs = r ? path.join(root.dir, ...r.split('/')) : root.dir;
  const back = path.relative(root.dir, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) throw bad('no such place');
  return abs;
}

const joinRel = (...parts) => parts.filter(Boolean).join('/');
const parentRel = (rel) => rel.split('/').slice(0, -1).join('/');
const lastOf = (rel) => rel.split('/').pop();
const txtOf = (abs) => abs.slice(0, abs.length - path.extname(abs).length) + '.txt';
const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };
const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// A file of the root's own kind (Archive takes every kind).
function _ownFile(root, name) {
  const k = kindOf(name);
  return root.kind ? k === root.kind : !!k;
}

function folderAbs(root, rel) {
  const abs = absOf(root, rel);
  if (!isDir(abs)) throw bad('that folder is not there any more', 404);
  return abs;
}

/** A file of the library by its root and address - the file itself must be there and be of its root's kind. */
function fileAbs(rootId, rel) {
  const root = rootOf(rootId);
  const r = normRel(rel);
  const abs = absOf(root, r);
  if (!r || !isFile(abs) || !_ownFile(root, abs)) throw bad('that file is not there any more', 404);
  return abs;
}

// The longest path anything under a folder has - a rename or a move must keep it within Windows' limit.
function _longest(abs) {
  let max = abs.length;
  let ents = [];
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return max; }
  for (const e of ents) {
    const p = path.join(abs, e.name);
    max = Math.max(max, e.isDirectory() ? _longest(p) : p.length);
  }
  return max;
}

function _checkSubtree(fromAbs, toAbs) {
  const longest = _longest(fromAbs);
  if (longest - fromAbs.length + toAbs.length > MAX_PATH) {
    throw bad('a path inside would be too long for Windows - use a shorter name or fewer folders');
  }
}

// Folders left empty in Archive by a restore or a delete go too - up to Archive itself, which stays.
function _dropEmptyUp(abs, stopAt) {
  let d = abs;
  while (d.length > stopAt.length && d.startsWith(stopAt)) {
    try {
      if (fs.readdirSync(d).length) return;
      fs.rmdirSync(d);
    } catch { return; }
    d = path.dirname(d);
  }
}

// A file and its description move as one: the description follows, and the file goes back if it cannot.
function _moveWithText(fromAbs, toAbs) {
  fs.renameSync(fromAbs, toAbs);
  const t = txtOf(fromAbs);
  if (!isFile(t)) return;
  try {
    fs.renameSync(t, txtOf(toAbs));
  } catch (e) {
    try { fs.renameSync(toAbs, fromAbs); } catch { /* left where it went */ }
    throw e;
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

function _folders(dir, rel) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort(byName)
    .map(name => {
      const r = joinRel(rel, name);
      return { name, rel: r, folders: _folders(path.join(dir, name), r) };
    });
}

/** Every root with its folders, nested. */
function tree() {
  return ROOTS.map(r => ({ id: r.id, label: r.label, kind: r.kind, folders: _folders(r.dir, '') }));
}

/** The files lying directly in a folder - only its root's kind, descriptions not listed. */
function list(rootId, rel) {
  const root = rootOf(rootId);
  const r = normRel(rel);
  const dir = folderAbs(root, r);
  const arch = root.id === 'archive' ? _archRead() : null;
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !_ownFile(root, e.name)) continue;
    const abs = path.join(dir, e.name);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    const ext = path.extname(e.name);
    const item = {
      name: e.name, base: e.name.slice(0, e.name.length - ext.length), ext: ext.toLowerCase(),
      rel: joinRel(r, e.name), kind: kindOf(e.name), size: st.size, mtime: st.mtimeMs, desc: isFile(txtOf(abs)),
    };
    const info = INFO.cached(abs);
    if (info) {
      item.duration = info.duration;
      if (info.wave) item.wave = info.wave;
    }
    if (arch) item.from = _fromLabel(originalOf(item.rel, arch));
    files.push(item);
  }
  return { root: root.id, rel: r, files };
}

/** The description beside a file, or null. */
function description(rootId, rel) {
  const t = txtOf(fileAbs(rootId, rel));
  if (!isFile(t)) return null;
  const buf = fs.readFileSync(t);
  return buf.subarray(0, 64 * 1024).toString('utf8');
}

// ── Folders ─────────────────────────────────────────────────────────────────

function makeFolder(rootId, parent, name) {
  const root = liveRoot(rootId);
  const p = normRel(parent);
  const dir = folderAbs(root, p);
  const n = cleanName(name);
  const abs = path.join(dir, n);
  checkPathLength(abs);
  if (fs.existsSync(abs)) throw bad('"' + n + '" is already there');
  fs.mkdirSync(abs);
  return { rel: joinRel(p, n) };
}

function renameFolder(rootId, rel, name) {
  const root = liveRoot(rootId);
  const r = normRel(rel);
  if (!r) throw bad('a root keeps its name');
  const abs = folderAbs(root, r);
  const n = cleanName(name);
  const to = path.join(path.dirname(abs), n);
  if (to === abs) return { rel: r };
  // A change of letter case only is the same folder to Windows.
  if (fs.existsSync(to) && to.toLowerCase() !== abs.toLowerCase()) throw bad('"' + n + '" is already there');
  _checkSubtree(abs, to);
  fs.renameSync(abs, to);
  return { rel: joinRel(parentRel(r), n) };
}

function moveFolder(rootId, rel, toParent) {
  const root = liveRoot(rootId);
  const r = normRel(rel);
  const t = normRel(toParent);
  if (!r) throw bad('a root stays where it is');
  const abs = folderAbs(root, r);
  const destDir = folderAbs(root, t);
  if (t === r || t.startsWith(r + '/')) throw bad('a folder cannot go inside itself');
  if (parentRel(r) === t) return { rel: r };
  const name = lastOf(r);
  const to = path.join(destDir, name);
  if (fs.existsSync(to)) throw bad('"' + name + '" is already there');
  _checkSubtree(abs, to);
  fs.renameSync(abs, to);
  return { rel: joinRel(t, name) };
}

// ── Files ───────────────────────────────────────────────────────────────────

function renameFile(rootId, rel, name) {
  const root = liveRoot(rootId);
  const abs = fileAbs(root.id, rel);
  const ext = path.extname(abs);
  let typed = String(name == null ? '' : name).trim();
  // "Night drive.mp3" typed for an mp3 is "Night drive": the extension is the file's and never changes.
  if (typed.toLowerCase().endsWith(ext.toLowerCase())) typed = typed.slice(0, typed.length - ext.length);
  const base = cleanName(typed);
  const to = path.join(path.dirname(abs), base + ext);
  if (to === abs) return { rel: normRel(rel) };
  const same = to.toLowerCase() === abs.toLowerCase();
  if (!same && (fs.existsSync(to) || isFile(txtOf(to)))) throw bad('"' + base + ext + '" is already here');
  checkPathLength(txtOf(to).length > to.length ? txtOf(to) : to);
  _moveWithText(abs, to);
  return { rel: joinRel(parentRel(normRel(rel)), base + ext) };
}

/** Files into another folder of the same root; each that cannot go says why, the rest go. */
function moveFiles(rootId, rels, toRel) {
  const root = liveRoot(rootId);
  const t = normRel(toRel);
  const destDir = folderAbs(root, t);
  const moved = [];
  const refused = [];
  for (const rel of Array.isArray(rels) ? rels : []) {
    try {
      const abs = fileAbs(root.id, rel);
      const r = normRel(rel);
      if (parentRel(r) === t) continue;
      const name = path.basename(abs);
      const to = path.join(destDir, name);
      if (fs.existsSync(to) || isFile(txtOf(to))) throw bad('"' + name + '" is already there');
      checkPathLength(to);
      _moveWithText(abs, to);
      moved.push({ from: r, to: joinRel(t, name) });
    } catch (e) {
      refused.push({ rel, why: e.status && e.status < 500 ? e.message : 'could not be moved' });
    }
  }
  return { moved, refused };
}

// ── Archive ─────────────────────────────────────────────────────────────────

function _archRead() {
  try {
    const j = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    if (j && j.entries && typeof j.entries === 'object') return j;
  } catch { /* none yet */ }
  return { entries: {} };
}

function _archWrite(j) {
  writeJsonAtomic(ARCHIVE_FILE, j);
}

/** Where a thing in Archive came from: { root, rel } - its own entry or its folder's; else its path says it. */
function originalOf(archRel, j) {
  const entries = (j || _archRead()).entries;
  const parts = normRel(archRel).split('/');
  for (let i = parts.length; i >= 1; i--) {
    const e = entries[parts.slice(0, i).join('/')];
    if (e) return { root: e.root, rel: joinRel(e.rel, parts.slice(i).join('/')) };
  }
  const r = ROOTS.find(x => x.label === parts[0] && x.id !== 'archive');
  return r && parts.length > 1 ? { root: r.id, rel: parts.slice(1).join('/') } : null;
}

function _fromLabel(o) {
  if (!o) return '';
  const r = ROOTS.find(x => x.id === o.root);
  return [r ? r.label : o.root, ...parentRel(o.rel).split('/').filter(Boolean)].join(' / ');
}

// The entries of a thing and of everything under it go when it leaves Archive.
function _forget(j, archRel) {
  for (const k of Object.keys(j.entries)) if (k === archRel || k.startsWith(archRel + '/')) delete j.entries[k];
}

/** Files and folders into Archive. items: [{ rel, folder }]. */
function toArchive(rootId, items) {
  const root = liveRoot(rootId);
  const j = _archRead();
  const done = [];
  const refused = [];
  for (const it of Array.isArray(items) ? items : []) {
    try {
      const r = normRel(it && it.rel);
      if (!r) throw bad('a root stays where it is');
      const abs = it.folder ? folderAbs(root, r) : fileAbs(root.id, r);
      const destDir = path.join(ARCHIVE.dir, root.label, ...parentRel(r).split('/').filter(Boolean));
      fs.mkdirSync(destDir, { recursive: true });
      const ext = it.folder ? '' : path.extname(abs);
      const name = freeName(destDir, lastOf(r).slice(0, lastOf(r).length - ext.length), ext);
      const to = path.join(destDir, name);
      if (it.folder) { _checkSubtree(abs, to); fs.renameSync(abs, to); } else { checkPathLength(to); _moveWithText(abs, to); }
      const archRel = joinRel(root.label, parentRel(r), name);
      _forget(j, archRel);
      j.entries[archRel] = { root: root.id, rel: r, at: Date.now() };
      done.push({ rel: r, archived: archRel });
    } catch (e) {
      refused.push({ rel: it && it.rel, why: e.status && e.status < 500 ? e.message : 'could not be put away' });
    }
  }
  _archWrite(j);
  return { done, refused };
}

/** Back where they came from (a taken name gets " 2"); the folders on the way are made again. items: [{ rel, folder }]. */
function restore(items) {
  const j = _archRead();
  const done = [];
  const refused = [];
  for (const it of Array.isArray(items) ? items : []) {
    try {
      const r = normRel(it && it.rel);
      const abs = absOf(ARCHIVE, r);
      const folder = isDir(abs);
      if (!r || (!folder && !isFile(abs))) throw bad('that is not in Archive any more', 404);
      if (r.split('/').length < 2) throw bad('"' + r + '" holds what came from ' + r + ' - restore what is inside it');
      const o = originalOf(r, j);
      if (!o) throw bad('cannot tell where it came from');
      const root = liveRoot(o.root);
      const destDir = absOf(root, parentRel(o.rel));
      fs.mkdirSync(destDir, { recursive: true });
      const ext = folder ? '' : path.extname(abs);
      const own = lastOf(o.rel);
      const name = freeName(destDir, own.slice(0, own.length - ext.length), ext);
      const to = path.join(destDir, name);
      if (folder) { _checkSubtree(abs, to); fs.renameSync(abs, to); } else { checkPathLength(to); _moveWithText(abs, to); }
      _forget(j, r);
      _dropEmptyUp(path.dirname(abs), ARCHIVE.dir);
      done.push({ rel: r, root: root.id, to: joinRel(parentRel(o.rel), name) });
    } catch (e) {
      refused.push({ rel: it && it.rel, why: e.status && e.status < 500 ? e.message : 'could not be restored' });
    }
  }
  _archWrite(j);
  return { done, refused };
}

/** Deleted for good - only from Archive. items: [{ rel }]; a folder goes with everything in it. */
function purge(items) {
  const j = _archRead();
  let n = 0;
  const refused = [];
  for (const it of Array.isArray(items) ? items : []) {
    try {
      const r = normRel(it && it.rel);
      if (!r) throw bad('use Empty archive for all of it');
      const abs = absOf(ARCHIVE, r);
      if (isDir(abs)) fs.rmSync(abs, { recursive: true, force: true });
      else if (isFile(abs)) { fs.rmSync(abs, { force: true }); fs.rmSync(txtOf(abs), { force: true }); } else throw bad('that is not in Archive any more', 404);
      _forget(j, r);
      _dropEmptyUp(path.dirname(abs), ARCHIVE.dir);
      n++;
    } catch (e) {
      refused.push({ rel: it && it.rel, why: e.status && e.status < 500 ? e.message : 'could not be deleted' });
    }
  }
  _archWrite(j);
  return { deleted: n, refused };
}

function emptyArchive() {
  let n = 0;
  for (const e of fs.readdirSync(ARCHIVE.dir)) {
    fs.rmSync(path.join(ARCHIVE.dir, e), { recursive: true, force: true });
    n++;
  }
  _archWrite({ entries: {} });
  return { deleted: n };
}

// ── Bringing a picture in (the owner's B6: pictures only) ──────────────────

// What a picture is, by its first bytes - the extension it is saved with.
function _pictureExt(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return '.gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

// A name from another computer may hold what Windows refuses: those characters become "_".
function _safeBase(name) {
  const b = String(name || '').replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  try { return cleanName(b.slice(0, 80)); } catch { return 'picture'; }
}

/**
 * A picture from this computer, COPIED into Images: into the folder it was dropped on when that is a folder of Images,
 * else into the root of Images (the owner's B2). Anything that is not a jpg, png, webp or gif is refused.
 */
function importPicture({ root, rel, name, data }) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.alloc(0);
  const ext = _pictureExt(buf);
  if (!ext) throw bad('only pictures can be brought in - jpg, png, webp or gif');
  const images = rootOf('images');
  let folder = '';
  if (root === 'images') {
    const r = normRel(rel);
    if (isDir(absOf(images, r))) folder = r;
  }
  const dir = absOf(images, folder);
  const own = path.extname(String(name || '')).toLowerCase();
  const keep = own === ext || (ext === '.jpg' && own === '.jpeg') ? own : ext;
  const file = freeName(dir, _safeBase(name), keep);
  const to = path.join(dir, file);
  checkPathLength(to);
  const tmp = to + '.' + process.pid + '.part';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, to);
  return { root: 'images', rel: joinRel(folder, file), elsewhere: root !== 'images' };
}

// ── Explorer ────────────────────────────────────────────────────────────────

/** Shows a file or folder in Explorer - only inside the app's window (the server runs in its process). */
function reveal(rootId, rel) {
  const root = rootOf(rootId);
  const abs = absOf(root, rel);
  if (!fs.existsSync(abs)) throw bad('that is not there any more', 404);
  if (!process.versions.electron) throw bad('Show in Explorer works in the app window only', 501);
  require('electron').shell.showItemInFolder(abs);
  return { ok: true };
}

module.exports = {
  rootOf, kindOf, fileAbs, tree, list, description,
  makeFolder, renameFolder, moveFolder, renameFile, moveFiles,
  toArchive, restore, purge, emptyArchive, originalOf,
  importPicture, reveal,
};
