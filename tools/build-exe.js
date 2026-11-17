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
//     LICENSE.txt               the app's own licence (MIT)
//     THIRD-PARTY-NOTICES.txt   everything by others inside, each with its licence (the owner, 2026-11-17): Electron
//                               and Chromium, FFmpeg (GNU GPL v3 - its source named), every production package with
//                               its licence's full text - made here from what is actually copied
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

  // The licences: the app's own beside the exe, and the notices of everything by others.
  fs.copyFileSync(path.join(prog, 'LICENSE'), path.join(top, 'LICENSE.txt'));
  fs.writeFileSync(path.join(top, 'THIRD-PARTY-NOTICES.txt'), notices(prog, electron, version));
  say('THIRD-PARTY-NOTICES.txt');

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

// ── The notices ─────────────────────────────────────────────────────────────

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const licenseOf = (pj) => (typeof pj.license === 'string' ? pj.license : (pj.license && pj.license.type)
  || (Array.isArray(pj.licenses) ? pj.licenses.map(l => l.type).join(' OR ') : 'see its files'));
const authorOf = (pj) => (typeof pj.author === 'string' ? pj.author : pj.author && pj.author.name) || '';
const homeOf = (pj) => pj.homepage || (typeof pj.repository === 'string' ? pj.repository : pj.repository && pj.repository.url) || '';

/** Every package the program carries (any depth), its licence and the full text of its licence file. */
function notices(prog, electron, version) {
  const pkgs = [];
  const walk = (dir) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith('@')) { walk(path.join(dir, d.name)); continue; }
      const p = path.join(dir, d.name);
      let pj = null;
      try { pj = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')); } catch { /* not a package */ }
      if (pj && pj.name) {
        const files = fs.readdirSync(p).filter(f => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f) && !/\.exe\./i.test(f));
        pkgs.push({ pj, text: files.map(f => fs.readFileSync(path.join(p, f), 'utf8').trim()).join('\n\n') });
      }
      walk(path.join(p, 'node_modules'));
    }
  };
  walk(path.join(prog, 'node_modules'));
  pkgs.sort((a, b) => a.pj.name.localeCompare(b.pj.name) || String(a.pj.version).localeCompare(String(b.pj.version)));
  const ffReadme = (() => { try { return fs.readFileSync(path.join(prog, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe.README'), 'utf8'); } catch { return ''; } })();
  const ffVersion = (/^Version:\s*(.+)$/m.exec(ffReadme) || [])[1] || 'see ffmpeg.exe.README';
  const ffSource = (/^Source Code:\s*(\S+)/m.exec(ffReadme) || [])[1] || 'https://ffmpeg.org/download.html';
  const out = [];
  const line = '='.repeat(100);
  out.push('UGC Music Studio ' + version + ' - THIRD-PARTY NOTICES', '',
    'UGC Music Studio itself is under the MIT License, copyright (c) 2026 aferist777 - LICENSE.txt beside this file;',
    'its source is at https://github.com/aferist777/ugc-music-app.', '',
    'This download also holds software by others, each under its own licence:', '',
    '1. Electron ' + electron + ' (https://www.electronjs.org) - MIT License, its text in app\\LICENSE. Electron contains',
    '   Chromium and other projects, under BSD-style and other licences - their full texts are in app\\LICENSES.chromium.html.', '',
    '2. FFmpeg ' + ffVersion + ' (https://ffmpeg.org) - GNU General Public License, version 3 or later.',
    '   The program app\\resources\\app\\node_modules\\ffmpeg-static\\ffmpeg.exe, a Windows build by gyan.dev',
    '   (https://www.gyan.dev/ffmpeg/builds/). The licence\'s full text is ffmpeg.exe.LICENSE beside it, the build\'s',
    '   configuration ffmpeg.exe.README. Its source code: ' + ffSource,
    '   UGC Music Studio runs FFmpeg as a separate program. The package that brings it, ffmpeg-static, is also under',
    '   the GNU GPL, version 3 or later (listed below).', '',
    '3. ' + pkgs.length + ' Node.js packages in app\\resources\\app\\node_modules:', '');
  for (const { pj } of pkgs) {
    out.push('   ' + (pj.name + ' ' + pj.version).padEnd(44) + ' ' + licenseOf(pj).padEnd(18) + ' ' + homeOf(pj).replace(/^git\+/, '').replace(/\.git$/, ''));
  }
  out.push('', 'The full licence texts of these packages follow, as each package ships them. A package whose folder holds',
    'no licence file is given the text its package.json names (MIT, with its author as the holder).', '');
  for (const { pj, text } of pkgs) {
    out.push(line, pj.name + ' ' + pj.version + ' - ' + licenseOf(pj) + (authorOf(pj) ? ' - ' + authorOf(pj) : ''), line, '');
    if (text) out.push(text, '');
    else if (/^MIT$/i.test(licenseOf(pj))) out.push('Copyright (c) ' + (authorOf(pj) || 'the authors of ' + pj.name), '', MIT_TEXT, '');
    else out.push('(no licence file in the package - its licence: ' + licenseOf(pj) + ')', '');
  }
  return out.join('\r\n') + '\r\n';
}

try { main(); } catch (e) { console.error('[build] ' + e.message); process.exit(1); }
