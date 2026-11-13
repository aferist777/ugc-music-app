'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE BUILT APP (phase 8, the owner 2026-11-13: "one exe, and the library folder beside it") - a folder people unpack
// and start, with no Node.js, git or npm:
//
//   UGC Music Studio\
//     UGC Music Studio.exe      the launcher (desktop/launcher/Launcher.cs, compiled here by Windows' own csc.exe, the
//                               app's icon) - it starts app\UGC Music Studio.exe and goes
//     app\                      Electron under the app's name, its resources\app the program: desktop lib routes public
//                               server.js package.json package-lock.json LICENSE README.md - from the LAST COMMIT
//                               (`git archive HEAD`), never half-made edits - and the production node_modules (no
//                               electron, no dev packages); resources\app\packaged.json says it is a built copy
//     library\                  made at the first start - the person's files and the app's data
//
//   node tools/build-exe.js [--out <folder>] [--worktree] [--no-zip]
//     --out       where (default: the temp folder, ugc-music-build\<version>) - never inside OneDrive
//     --worktree  the program from the folder as it is (a check before a commit)
//     then UGC-Music-Studio-<version>-win-x64.zip beside the folder - the release's download (tools/release.js)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const NAME = 'UGC Music Studio';
const PROGRAM = ['desktop', 'lib', 'routes', 'public', 'server.js', 'package.json', 'package-lock.json', 'LICENSE', 'README.md'];
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const TAR = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, Object.assign({ cwd: APP, windowsHide: true, maxBuffer: 1 << 30 }, opts)).toString();
const say = (s) => console.log('[build] ' + s);

function sizeOf(dir) {
  let n = 0;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) n += d.isDirectory() ? sizeOf(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size;
  return n;
}

function main() {
  const worktree = has('--worktree');
  const pkg = JSON.parse(worktree ? fs.readFileSync(path.join(APP, 'package.json'), 'utf8') : run('git', ['show', 'HEAD:package.json']));
  const version = pkg.version;
  const base = path.resolve(arg('--out') || path.join(os.tmpdir(), 'ugc-music-build', version));
  if (/onedrive/i.test(base)) throw new Error('build outside OneDrive - thousands of files would sync');
  const top = path.join(base, NAME);
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(top, { recursive: true });

  // 1. Electron under the app's name.
  const dist = path.join(APP, 'node_modules', 'electron', 'dist');
  const electron = JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  say('Electron ' + electron);
  const appDir = path.join(top, 'app');
  // Chromium's languages: the app speaks English - en-US alone is kept (Chromium falls back to it).
  fs.cpSync(dist, appDir, {
    recursive: true,
    filter: (src) => path.basename(src) !== 'default_app.asar' && !(/[\\/]locales[\\/][^\\/]+\.pak$/i.test(src) && !/en-US\.pak$/i.test(src)),
  });
  fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, NAME + '.exe'));

  // 2. The program: the last commit's files (or the folder's).
  const prog = path.join(appDir, 'resources', 'app');
  fs.mkdirSync(prog, { recursive: true });
  let commit = 'worktree';
  if (worktree) {
    for (const p of PROGRAM) fs.cpSync(path.join(APP, p), path.join(prog, p), { recursive: true });
  } else {
    commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();
    const tar = path.join(base, 'program.tar');
    run('git', ['archive', '--format=tar', '-o', tar, 'HEAD', '--'].concat(PROGRAM));
    run(TAR, ['-xf', tar, '-C', prog]);
    fs.rmSync(tar, { force: true });
  }
  if (fs.existsSync(path.join(prog, 'CLAUDE.md')) || fs.existsSync(path.join(prog, 'docs'))) throw new Error('the private notes got into the program');

  // 3. The production packages only (package-lock's non-dev tree), as they are installed here.
  const list = run('cmd', ['/c', 'npm', 'ls', '--omit=dev', '--all', '--parseable']).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const nm = path.join(APP, 'node_modules');
  const tops = new Set();
  for (const abs of list) {
    const rel = path.relative(nm, abs);
    if (!rel || rel.startsWith('..')) continue;
    const parts = rel.split(path.sep);
    tops.add(parts[0].startsWith('@') ? parts.slice(0, 2).join(path.sep) : parts[0]);
  }
  if (tops.has('electron')) throw new Error('electron is not a production package');
  for (const t of tops) fs.cpSync(path.join(nm, t), path.join(prog, 'node_modules', t), { recursive: true });
  say(tops.size + ' production packages');
  if (!fs.existsSync(path.join(prog, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'))) throw new Error('ffmpeg.exe is missing - run npm install');

  fs.writeFileSync(path.join(prog, 'packaged.json'), JSON.stringify({ version, electron, commit, built: new Date().toISOString() }, null, 2) + '\n');

  // 4. The launcher with the app's icon.
  if (!fs.existsSync(CSC)) throw new Error('Windows\' C# compiler is missing: ' + CSC);
  run(CSC, ['/nologo', '/target:winexe', '/optimize+', '/win32icon:' + path.join(APP, 'desktop', 'icon.ico'),
    '/r:System.Windows.Forms.dll', '/r:System.Core.dll', '/out:' + path.join(top, NAME + '.exe'), path.join(APP, 'desktop', 'launcher', 'Launcher.cs')]);

  say('folder ' + top + ' - ' + Math.round(sizeOf(top) / 1048576) + ' MB');
  if (has('--no-zip')) return;
  const zip = path.join(base, 'UGC-Music-Studio-' + version + '-win-x64.zip');
  run(TAR, ['-a', '-c', '-f', zip, '-C', base, NAME]);
  say('zip ' + zip + ' - ' + Math.round(fs.statSync(zip).size / 1048576) + ' MB');
}

try { main(); } catch (e) { console.error('[build] ' + e.message); process.exit(1); }
