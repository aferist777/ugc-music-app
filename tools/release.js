'use strict';

// ════════════════════════════════════════════════════════════════════════════
// PUBLISHING A RELEASE (phase 8, the owner 2026-11-13: "you propose the list of changes, I correct it, you edit it and
// publish"). Run from the folder the app is made in - never from a copy installed from GitHub.
//
//   node tools/release.js notes
//       what changed since the last release: the commits' subjects (the "Docs:" ones left out) - the raw stuff for the
//       English notes the owner reads and corrects.
//   node tools/release.js publish <version> <notes.md> [--dry]
//       1. the folder clean, <version> newer than package.json's, the notes not empty;
//       2. package.json / package-lock.json take the version, CHANGELOG.md gets "## <version> - <day>" and the notes on
//          top; committed as "Release <version>", tagged v<version> HERE;
//       3. THE PUBLIC HISTORY: a fresh copy of this repository in the temp folder, docs/plan.md and CLAUDE.md cut out of
//          EVERY commit (git filter-branch - the same commits get the same ids every time, so the public main only
//          moves forward), the copy checked: no commit holds those two files, no file of any commit holds a key's VALUE
//          (the settings of this app's libraries and the files named in MUSIC_RELEASE_KEY_FILES, ';' between) or
//          anything shaped like a key - one hit and nothing is sent;
//       4. main and the tag pushed to https://github.com/aferist777/ugc-music-app (gh's sign-in, only for that push -
//          git's own settings untouched; never forced: a main that does not just move forward is refused), and the
//          GitHub Release made with the notes - the copies installed from GitHub show "Update <version>";
//       5. the built app (tools/build-exe.js, from the release commit) uploaded to the release as
//          UGC-Music-Studio-<version>-win-x64.zip - the download for people without Node.js.
//       --dry: steps 1 and 3 only - nothing is changed here, nothing sent.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const REPO = 'aferist777/ugc-music-app';
const PRIVATE = ['docs/plan.md', 'CLAUDE.md'];

// A run whose output goes straight to the screen (stdio 'inherit') gives nothing back: an empty string then.
const run = (cmd, args, opts = {}) => String(execFileSync(cmd, args, Object.assign({ cwd: APP, windowsHide: true, maxBuffer: 1 << 30 }, opts)) || '');
const git = (args, cwd) => run('git', args, { cwd: cwd || APP });
const die = (msg) => { console.error('release: ' + msg); process.exit(1); };

const parse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? [+m[1], +m[2], +m[3]] : null; };
const newer = (a, b) => { const x = parse(a); const y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

function lastTag() {
  const tags = git(['tag', '--list', 'v*']).split('\n').map(s => s.trim()).filter(t => parse(t.slice(1)));
  return tags.sort((a, b) => (newer(a.slice(1), b.slice(1)) ? -1 : 1))[0] || null;
}

function notes() {
  const from = lastTag();
  const range = from ? from + '..HEAD' : 'HEAD';
  const subjects = git(['log', '--reverse', '--format=%s', range]).split('\n').filter(s => s && !/^Docs:/i.test(s) && !/^Release \d/.test(s));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  console.log('Now: ' + pkg.version + (from ? ', last release ' + from : ', no release yet'));
  console.log('Commits since (' + subjects.length + '):');
  for (const s of subjects) console.log('- ' + s);
}

// ── The key check of the public copy ────────────────────────────────────────

const SHAPES = {
  'Anthropic key': /sk-ant-[A-Za-z0-9_-]{20,}/,
  'OpenAI key': /\bsk-(proj-)?[A-Za-z0-9]{32,}/,
  'Replicate key': /\br8_[A-Za-z0-9]{30,}/,
  'GitHub token': /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  'AWS key': /\bAKIA[0-9A-Z]{16}\b/,
  'Google key': /\bAIza[0-9A-Za-z_-]{35}\b/,
  'Telegram bot token': /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
  'private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'a key in a literal': /(api[_-]?key|apikey|secret|token|password)["']?\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/i,
};

function keyValues() {
  const files = [path.join(APP, 'library/data/settings.json'), path.join(APP, 'dev-library/data/settings.json')]
    .concat(String(process.env.MUSIC_RELEASE_KEY_FILES || '').split(';').map(s => s.trim()).filter(Boolean));
  const values = new Set();
  const walk = (o) => {
    if (typeof o === 'string') { const v = o.trim(); if (v.length >= 16 && !/^https?:\/\//.test(v) && !/\s/.test(v)) values.add(v); return; }
    if (o && typeof o === 'object') for (const x of Object.values(o)) walk(x);
  };
  for (const f of files) { try { walk(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* not there */ } }
  return values;
}

/** Every file of every commit, and every message: the hits by name and place - never a value. */
function audit(dir) {
  const values = keyValues();
  const hits = [];
  const seen = new Set();
  for (const c of git(['rev-list', '--all'], dir).trim().split('\n')) {
    for (const line of git(['ls-tree', '-r', c], dir).split('\n')) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      if (PRIVATE.includes(m[2])) hits.push('a private file: ' + m[2]);
      const text = execFileSync('git', ['cat-file', '-p', m[1]], { cwd: dir, windowsHide: true, maxBuffer: 1 << 30 }).toString('latin1');
      for (const v of values) if (text.includes(v)) hits.push('a key VALUE in ' + m[2]);
      if (/\.(png|jpe?g|gif|webp|ico)$/i.test(m[2])) continue;
      for (const [name, re] of Object.entries(SHAPES)) if (re.test(text)) hits.push(name + ' in ' + m[2]);
    }
  }
  const msgs = git(['log', '--all', '--format=%B'], dir);
  for (const v of values) if (msgs.includes(v)) hits.push('a key VALUE in a commit message');
  return { hits, files: seen.size, values: values.size };
}

/** The public copy: this history with the private files cut out of every commit. */
function publicCopy() {
  const dir = path.join(os.tmpdir(), 'ugc-music-public');
  fs.rmSync(dir, { recursive: true, force: true });
  git(['clone', '-q', '--no-local', APP, dir], os.tmpdir());
  run('git', ['filter-branch', '-f', '--index-filter', 'git rm -q --cached --ignore-unmatch ' + PRIVATE.join(' '),
    '--prune-empty', '--tag-name-filter', 'cat', '--', '--all'], { cwd: dir, env: Object.assign({}, process.env, { FILTER_BRANCH_SQUELCH_WARNING: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  for (const ref of git(['for-each-ref', '--format=%(refname)', 'refs/original', 'refs/remotes'], dir).split('\n').filter(Boolean)) git(['update-ref', '-d', ref], dir);
  git(['remote', 'remove', 'origin'], dir);
  git(['reflog', 'expire', '--expire=now', '--all'], dir);
  git(['gc', '-q', '--prune=now'], dir);
  return dir;
}

function publish(version, notesFile, dry) {
  if (!parse(version)) die('the version is three numbers, 0.2.0');
  const text = fs.existsSync(notesFile || '') ? fs.readFileSync(notesFile, 'utf8').trim() : '';
  if (!text) die('the notes file is empty or missing');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  if (!newer(version, pkg.version)) die(version + ' is not newer than ' + pkg.version);
  if (git(['status', '--porcelain']).trim()) die('commit everything first - the folder has changes');
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'main') die('releases are made from main');
  if (!dry) {
    pkg.version = version;
    fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    const lockFile = path.join(APP, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
    const day = new Date().toISOString().slice(0, 10);
    const logFile = path.join(APP, 'CHANGELOG.md');
    const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').replace(/^# Changelog\s*/, '') : '';
    fs.writeFileSync(logFile, '# Changelog\n\n## ' + version + ' - ' + day + '\n\n' + text + '\n\n' + before.trim() + (before.trim() ? '\n' : ''));
    git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    const msg = path.join(os.tmpdir(), 'ugc-music-release-msg.txt');
    fs.writeFileSync(msg, 'Release ' + version + '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n');
    git(['commit', '-q', '-F', msg]);
    fs.rmSync(msg, { force: true });
    git(['tag', 'v' + version]);
  }
  console.log('making the public copy...');
  const dir = publicCopy();
  const a = audit(dir);
  console.log('checked ' + a.files + ' files of every commit against ' + a.values + ' key values and the shapes of keys');
  if (a.hits.length) die('NOT SENT - found:\n  ' + a.hits.join('\n  '));
  console.log('clean. public commits: ' + git(['rev-list', '--count', 'main'], dir).trim());
  if (dry) { console.log('dry run - nothing sent'); return; }
  const helper = ['-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential'];
  run('git', helper.concat(['push', 'https://github.com/' + REPO + '.git', 'main:main', 'refs/tags/v' + version + ':refs/tags/v' + version]), { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] });
  const notesTmp = path.join(os.tmpdir(), 'ugc-music-release-notes.md');
  fs.writeFileSync(notesTmp, text + '\n');
  run('gh', ['release', 'create', 'v' + version, '--repo', REPO, '--title', 'UGC Music Studio ' + version, '--notes-file', notesTmp], { stdio: ['ignore', 'inherit', 'inherit'] });
  fs.rmSync(notesTmp, { force: true });
  console.log('building the app...');
  run(process.execPath, [path.join(APP, 'tools', 'build-exe.js')], { stdio: ['ignore', 'inherit', 'inherit'] });
  const zip = path.join(os.tmpdir(), 'ugc-music-build', version, 'UGC-Music-Studio-' + version + '-win-x64.zip');
  run('gh', ['release', 'upload', 'v' + version, zip, '--repo', REPO], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log('released ' + version + ' - https://github.com/' + REPO + '/releases/tag/v' + version);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'notes') notes();
else if (cmd === 'publish') publish(rest[0], rest[1], rest.includes('--dry'));
else if (cmd === 'audit') { const a = audit(rest[0] || APP); console.log(a.hits.length ? a.hits.join('\n') : 'clean (' + a.files + ' files, ' + a.values + ' key values)'); }
else die('node tools/release.js notes | publish <version> <notes.md> [--dry] | audit [folder]');
