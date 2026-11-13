'use strict';

// ════════════════════════════════════════════════════════════════════════════
// UPDATES FROM GITHUB (phase 8, the owner 2026-11-13: "people who use the app see an Update chip with the list of
// changes; I publish updates from my session"). A copy installed from https://github.com/aferist777/ugc-music-app asks
// GitHub's public API for its releases a minute after the start and every six hours (no key - 60 asks an hour are
// allowed). A release newer than this program's version (package.json) is "available": the page shows the chip
// "Update <version>" and, pressed, every newer release's notes (English, the owner's O2). NOTHING IS FORCED (O4): the
// chip stays until the person presses Update now.
//
// Update now (O1 - the app updates itself):
//   1. the app's own stores - every .json of the library's data/ but the keys (settings.json) - into
//      backups/<day time> before <version>.zip, the last five kept (O5);
//   2. a git clone of the public repository whose files are untouched: `git fetch --tags` + `git merge --ff-only <tag>`;
//      anything else (a ZIP download): the tag's source archive from GitHub, unpacked whole into cache/update/ first,
//      then each program file put in place - the ones it replaces kept aside and put back if anything fails; the
//      library, dev-library/ and node_modules/ are never touched; the files of the version put in place are kept in
//      data/update.json, so the next archive update removes the files a release dropped;
//   3. `npm install` when package-lock.json's packages changed (its own version number does with every release);
//   4. "Restart now" - the window relaunches on the new version.
// THE OWNER'S OWN COPY - the folder this app is made in, with its CLAUDE.md, which the public repository never has -
// offers nothing and asks nothing: it is always the newest. THE BUILT APP (tools/build-exe.js - packaged.json beside the
// program): no git and no npm there - only the program's own files of the tag's archive are put in place; a release
// whose package-lock.json differs (its packages or Electron changed) is not put in place at all: the window says to
// download the full new version and links its release (`job.full`).
//
//   state()   -> { dev, current, available, releases: [{ version, tag, name, date, notes, url }], checkedAt, error, job }
//   check()   -> state()          asks GitHub now
//   apply()   -> state()          starts the update of the newest release (one at a time)
//   start()                       the timers (from server.js)
// MUSIC_UPDATE_API - another address for GitHub's API (the free checks' stand-in); MUSIC_UPDATE_FIRST_MS - the first
// ask's delay; MUSIC_UPDATE_NPM - another npm (the checks' stand-in, so a check never installs anything).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { APP_DIR, DATA_DIR, CACHE_DIR, LIBRARY_DIR } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');
const { zip } = require('./zip');

const REPO = 'aferist777/ugc-music-app';
const API = (process.env.MUSIC_UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');
const FIRST_MS = +process.env.MUSIC_UPDATE_FIRST_MS || 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const STATE = path.join(DATA_DIR, 'update.json');
const BACKUPS = path.join(LIBRARY_DIR, 'backups');
const KEEP_BACKUPS = 5;
// Never written by an update, whatever an archive holds.
const KEEP = /^(library|dev-library|node_modules|\.git)(\/|$)/i;

const CURRENT = require(path.join(APP_DIR, 'package.json')).version;
const DEV = fs.existsSync(path.join(APP_DIR, 'CLAUDE.md'));
const PACKAGED = fs.existsSync(path.join(APP_DIR, 'packaged.json'));
// What a built app's program is (tools/build-exe.js PROGRAM): the rest of a release's archive is not for it.
const PROGRAM = /^(desktop|lib|routes|public)\/|^(server\.js|package\.json|package-lock\.json|LICENSE|README\.md)$/;

const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });

// ── Versions ────────────────────────────────────────────────────────────────

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const newer = (a, b) => {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

// ── What is known ───────────────────────────────────────────────────────────

function _read() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch { return {}; }
}

let job = null; // { stage, error, done, version }

function state() {
  const s = _read();
  const releases = (s.releases || []).filter(r => newer(r.version, CURRENT));
  return {
    dev: DEV, packaged: PACKAGED, current: CURRENT, available: !DEV && releases.length > 0, releases,
    checkedAt: s.checkedAt || null, error: s.error || null, job,
  };
}

async function _get(url, accept) {
  const r = await fetch(url, {
    headers: { Accept: accept || 'application/vnd.github+json', 'User-Agent': 'UGC-Music-Studio/' + CURRENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  return r;
}

/** Asks GitHub for the releases now. Never throws: a failure is kept as `error` and said on the page. */
async function check() {
  if (DEV) return state();
  const s = _read();
  try {
    const list = await (await _get(API + '/repos/' + REPO + '/releases?per_page=30')).json();
    const releases = (Array.isArray(list) ? list : [])
      .filter(r => r && !r.draft && !r.prerelease && parse(r.tag_name))
      .map(r => ({
        version: r.tag_name.replace(/^v/, ''), tag: r.tag_name, name: String(r.name || r.tag_name).slice(0, 120),
        date: r.published_at || r.created_at || null, notes: String(r.body || '').slice(0, 20000), url: r.html_url || null,
      }))
      .sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0));
    writeJsonAtomic(STATE, Object.assign(s, { checkedAt: Date.now(), releases, error: null }));
  } catch (e) {
    writeJsonAtomic(STATE, Object.assign(s, { checkedAt: Date.now(), error: e.name === 'TimeoutError' ? 'GitHub did not answer' : e.message }));
  }
  return state();
}

let timers = null;
function start() {
  if (DEV || timers) return;
  timers = [setTimeout(check, FIRST_MS), setInterval(check, EVERY_MS)];
  for (const t of timers) if (t.unref) t.unref();
}

// ── Before: the app's stores into a ZIP (O5) ────────────────────────────────

function _backup(to) {
  const files = [];
  const walk = (dir, rel) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else if (/\.json$/i.test(d.name) && r !== 'settings.json') {
        const abs = path.join(dir, d.name);
        files.push({ name: 'data/' + r, data: fs.readFileSync(abs), time: fs.statSync(abs).mtime });
      }
    }
  };
  walk(DATA_DIR, '');
  fs.mkdirSync(BACKUPS, { recursive: true });
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const name = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + '-' + two(d.getMinutes())
    + ' before ' + to + '.zip';
  fs.writeFileSync(path.join(BACKUPS, name), zip(files));
  const all = fs.readdirSync(BACKUPS).filter(n => / before .+\.zip$/.test(n)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUPS, old), { force: true });
  return { name, files: files.length };
}

// ── A program run, its output kept for the error ────────────────────────────

function _run(cmd, args, { cwd = APP_DIR, shell = false, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b) => { out = (out + b).slice(-4000); };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    const t = setTimeout(() => p.kill(), timeout);
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

const _git = (args) => _run('git', args);

// Is this folder a clean clone of the public repository? Then git brings the update.
async function _gitClone() {
  if (!fs.existsSync(path.join(APP_DIR, '.git'))) return false;
  const url = await _git(['remote', 'get-url', 'origin']);
  if (url.code !== 0 || !/aferist777[/\\]ugc-music-app/i.test(url.out)) return false;
  const st = await _git(['status', '--porcelain', '--untracked-files=no']);
  if (st.code !== 0) return false;
  if (st.out.trim()) throw bad('the program\'s own files were changed in this folder - update it by hand (git pull)', 409);
  return true;
}

// ── The tag's source archive: a tar.gz, read here (no package) ──────────────

function _untar(buf) {
  const out = [];
  let i = 0;
  let longName = null;
  const str = (b, a, n) => b.toString('utf8', a, a + n).replace(/\0[\s\S]*$/, '');
  while (i + 512 <= buf.length) {
    const h = buf.subarray(i, i + 512);
    if (h.every(x => x === 0)) break;
    const size = parseInt(str(h, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h, 345, 155);
    let name = (prefix ? prefix + '/' : '') + str(h, 0, 100);
    const data = buf.subarray(i + 512, i + 512 + size);
    i += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'L') {
      // A long name: pax "path=" or GNU's next-name record.
      if (type === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (type === 'g') continue; // the archive's own note (the commit)
    if (longName) { name = longName; longName = null; }
    if (type === '0' || type === '\0' || type === '7') out.push({ name, data: Buffer.from(data) });
  }
  return out;
}

// GitHub's archive puts everything under one top folder "<owner>-<repo>-<commit>/": it is taken off; a path that
// would leave the program's folder is refused.
function _programFiles(entries) {
  const files = [];
  for (const e of entries) {
    const rel = e.name.replace(/\\/g, '/').split('/').slice(1).join('/');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.split('/').some(p => p === '..' || p === '') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) throw bad('the archive holds a strange path: ' + rel, 502);
    if (KEEP.test(rel) || (PACKAGED && !PROGRAM.test(rel))) continue;
    files.push({ rel, data: e.data });
  }
  if (!files.some(f => f.rel === 'package.json') || !files.some(f => f.rel === 'server.js')) throw bad('the archive is not this app', 502);
  return files;
}

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
// What package-lock.json says about the PACKAGES - its own version number left out: every release changes that one.
function _lockPrint(buf) {
  try {
    const j = JSON.parse(buf.toString('utf8'));
    delete j.version;
    if (j.packages && j.packages['']) delete j.packages[''].version;
    return sha(Buffer.from(JSON.stringify(j)));
  } catch { return sha(buf); }
}
const _lockHere = () => { try { return _lockPrint(fs.readFileSync(path.join(APP_DIR, 'package-lock.json'))); } catch { return ''; } };

async function _fromArchive(r, stage) {
  stage('downloading ' + r.tag);
  const res = await _get(API + '/repos/' + REPO + '/tarball/' + encodeURIComponent(r.tag), 'application/vnd.github+json');
  const gz = Buffer.from(await res.arrayBuffer());
  stage('unpacking');
  const files = _programFiles(_untar(zlib.gunzipSync(gz)));
  const want = JSON.parse(files.find(f => f.rel === 'package.json').data.toString('utf8')).version;
  if (want !== r.version) throw bad('the archive is version ' + want + ', not ' + r.version, 502);
  // A built app cannot install packages: a release that changes them is the full download, not this.
  const lockNow = _lockHere();
  const lockNew = _lockPrint(files.find(f => f.rel === 'package-lock.json').data);
  if (PACKAGED && lockNow !== lockNew) {
    job.full = r.url || 'https://github.com/' + REPO + '/releases/latest';
    throw bad('version ' + r.version + ' changes the app\'s parts - download the full new version (UGC-Music-Studio-' + r.version + '-win-x64.zip) and unpack it over this folder; your library stays', 409);
  }
  // Laid out whole first: nothing of the program is touched until every file is on the disk here.
  const staging = path.join(CACHE_DIR, 'update', r.tag);
  fs.rmSync(staging, { recursive: true, force: true });
  for (const f of files) {
    const abs = path.join(staging, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
  }
  stage('putting the new files in place');
  const aside = path.join(CACHE_DIR, 'update', 'before-' + r.tag);
  fs.rmSync(aside, { recursive: true, force: true });
  const kept = _read();
  const before = Array.isArray(kept.files) ? kept.files : [];
  const done = []; // { rel, had }
  const gone = before.filter(rel => !files.some(f => f.rel === rel) && !KEEP.test(rel));
  try {
    for (const f of files) {
      const dest = path.join(APP_DIR, ...f.rel.split('/'));
      const had = fs.existsSync(dest);
      if (had) {
        const keep = path.join(aside, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(keep), { recursive: true });
        fs.copyFileSync(dest, keep);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(staging, ...f.rel.split('/')), dest);
      done.push({ rel: f.rel, had });
    }
    for (const rel of gone) {
      const dest = path.join(APP_DIR, ...rel.split('/'));
      if (!fs.existsSync(dest)) continue;
      const keep = path.join(aside, ...rel.split('/'));
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.renameSync(dest, keep);
      done.push({ rel, had: true, removed: true });
    }
  } catch (e) {
    // Put back what was replaced: the program stays the version it was.
    for (const d of done.reverse()) {
      const dest = path.join(APP_DIR, ...d.rel.split('/'));
      const keep = path.join(aside, ...d.rel.split('/'));
      try { if (d.had) fs.copyFileSync(keep, dest); else fs.rmSync(dest, { force: true }); } catch { /* as much as can be */ }
    }
    throw new Error('the new files could not be put in place (' + e.message + ') - the program was put back as it was');
  }
  writeJsonAtomic(STATE, Object.assign(_read(), { files: files.map(f => f.rel), installed: r.version }));
  fs.rmSync(staging, { recursive: true, force: true });
  return { lockChanged: lockNow !== lockNew };
}

async function _fromGit(r, stage) {
  const lockBefore = _lockHere();
  stage('fetching ' + r.tag);
  let g = await _git(['fetch', '--tags', '--quiet', 'origin']);
  if (g.code !== 0) throw new Error('git could not fetch: ' + g.out.trim().split('\n').pop());
  stage('moving to ' + r.tag);
  g = await _git(['merge', '--ff-only', '--quiet', r.tag]);
  if (g.code !== 0) throw new Error('git could not move to ' + r.tag + ': ' + g.out.trim().split('\n').pop());
  return { lockChanged: lockBefore !== _lockHere() };
}

/** Starts the update to the newest release; the page follows `state().job`. */
function apply() {
  if (DEV) throw bad('this is the copy the app is made in - it is always the newest', 409);
  if (job && !job.done && !job.error) throw bad('the update is already going', 409);
  const r = state().releases[0];
  if (!r) throw bad('there is nothing newer than ' + CURRENT, 409);
  job = { version: r.version, stage: 'starting', done: false, error: null, restart: false };
  const stage = (s) => { job.stage = s; };
  (async () => {
    stage('keeping a copy of the app\'s data');
    const b = _backup(r.version);
    job.backup = b.name;
    const viaGit = !PACKAGED && await _gitClone();
    const res = viaGit ? await _fromGit(r, stage) : await _fromArchive(r, stage);
    if (res.lockChanged) {
      stage('installing what the new version needs (npm install)');
      const npm = process.env.MUSIC_UPDATE_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
      const n = await _run(npm, ['install', '--no-audit', '--no-fund'], { shell: process.platform === 'win32' });
      if (n.code !== 0) throw new Error('the files are in place, but npm install failed - close the app, run npm install in its folder and start it again: ' + n.out.trim().split('\n').slice(-2).join(' '));
    }
    job.via = viaGit ? 'git' : 'archive';
    job.done = true;
    job.stage = 'ready - restart to use ' + r.version;
  })().catch((e) => {
    console.error('[update]', e);
    job.error = e.message;
    job.stage = '';
  });
  return state();
}

/** The window relaunches on the new version (inside Electron); the server alone just says so. */
function restart() {
  if (!job || !job.done) throw bad('nothing to restart for', 409);
  let electron = null;
  try { electron = process.versions.electron ? require('electron') : null; } catch { electron = null; }
  if (!electron || !electron.app) return { restarted: false, message: 'start the app again to use ' + job.version };
  setTimeout(() => { electron.app.relaunch(); electron.app.exit(0); }, 300);
  return { restarted: true };
}

module.exports = { state, check, apply, restart, start, newer, _untar, _programFiles };
