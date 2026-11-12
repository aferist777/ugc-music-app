'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE RENDER (phase 4) - a project into one MP4 (H.264 + AAC, 30 fps) with the app's ffmpeg, free. The frame is the
// project's (16:9 1920x1080 or 9:16 1080x1920); the film lasts to the end of its last clip. Video: a black frame, the
// clips of v1 laid on it at their seconds, then those of v2 over them (the upper lane covers the lower); every picture
// and clip fills the frame, its overflow cut (fill); a clip's own sound is not used (the owner's T5). Sound: every clip
// of a1 and a2 at its second, crossing where two overlap on a lane by the page's own rule (public/js/timeline/fades.js,
// the owner's T6), mixed. The file goes into Video / Renders named after the project (T8), with a description beside it.
//
//   run(project, { onProgress(pct), signal }) -> { rel, name }
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOTS, CACHE_DIR } = require('./config');
const { freeName, checkPathLength } = require('./names');
const { fadesOf } = require('../public/js/timeline/fades.js');

const FFMPEG = require('ffmpeg-static');
const SIZE = { '16:9': [1920, 1080], '9:16': [1080, 1920] };
const FPS = 30;
const VIDEO = ROOTS.find(r => r.id === 'video');

const absOf = (c) => {
  const root = ROOTS.find(r => r.id === c.root);
  return path.join(root.dir, ...c.rel.split('/'));
};
const sec = (n) => (Math.round(n * 1000) / 1000).toFixed(3);

function endOf(p) {
  let t = 0;
  for (const l of Object.keys(p.lanes)) for (const c of p.lanes[l]) t = Math.max(t, c.start + c.dur);
  return t;
}

/** The ffmpeg arguments and the filter graph of a project. */
function plan(p) {
  const [W, H] = SIZE[p.format] || SIZE['16:9'];
  const T = endOf(p);
  const args = ['-hide_banner', '-nostdin', '-y'];
  const graph = [];
  let n = 0;
  graph.push('color=c=black:s=' + W + 'x' + H + ':r=' + FPS + ':d=' + sec(T) + ',format=yuv420p[base0]');
  let base = 'base0';
  for (const lane of ['v1', 'v2']) {
    for (const c of p.lanes[lane]) {
      if (c.kind === 'image') args.push('-loop', '1', '-framerate', String(FPS), '-t', sec(c.dur), '-i', absOf(c));
      else args.push('-ss', sec(c.in), '-t', sec(c.dur), '-i', absOf(c));
      const v = 'v' + n;
      graph.push('[' + n + ':v]scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H
        + ',setsar=1,fps=' + FPS + ',format=yuv420p,setpts=PTS-STARTPTS+' + sec(c.start) + '/TB[' + v + ']');
      const next = 'base' + (n + 1);
      graph.push('[' + base + '][' + v + ']overlay=eof_action=pass:enable=\'between(t,' + sec(c.start) + ',' + sec(c.start + c.dur) + ')\'[' + next + ']');
      base = next;
      n++;
    }
  }
  graph.push('[' + base + ']null[vout]');
  const fades = fadesOf(p);
  const sounds = [];
  for (const lane of ['a1', 'a2']) {
    for (const c of p.lanes[lane]) {
      args.push('-ss', sec(c.in), '-t', sec(c.dur), '-i', absOf(c));
      const f = fades.get(String(c.id)) || { in: 0, out: 0 };
      const ms = Math.round(c.start * 1000);
      let chain = '[' + n + ':a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
      if (f.in > 0.01) chain += ',afade=t=in:st=0:d=' + sec(f.in);
      if (f.out > 0.01) chain += ',afade=t=out:st=' + sec(Math.max(0, c.dur - f.out)) + ':d=' + sec(f.out);
      chain += ',adelay=' + ms + '|' + ms + '[a' + n + ']';
      graph.push(chain);
      sounds.push('[a' + n + ']');
      n++;
    }
  }
  if (sounds.length) graph.push(sounds.join('') + 'amix=inputs=' + sounds.length + ':normalize=0:dropout_transition=0,apad,atrim=0:' + sec(T) + '[aout]');
  else graph.push('anullsrc=r=48000:cl=stereo,atrim=0:' + sec(T) + '[aout]');
  return { args, graph: graph.join(';\n'), T, W, H };
}

function _safe(name) {
  return String(name || 'Render').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 60) || 'Render';
}

function _describe(p, pl, name) {
  const lines = [
    'UGC Music Studio - render',
    'Project: ' + p.name,
    'Made: ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
    'Frame: ' + p.format + ' (' + pl.W + 'x' + pl.H + ', ' + FPS + ' fps), ' + pl.T.toFixed(1) + ' s',
  ];
  const label = { v2: 'Video 2', v1: 'Video 1', a1: 'Audio 1', a2: 'Audio 2' };
  for (const l of ['v2', 'v1', 'a1', 'a2']) {
    if (!p.lanes[l].length) continue;
    lines.push('', label[l] + ':');
    for (const c of p.lanes[l].slice().sort((a, b) => a.start - b.start)) {
      lines.push('  ' + c.start.toFixed(2) + 's - ' + (c.start + c.dur).toFixed(2) + 's  ' + c.rel + (c.in ? ' (from ' + c.in.toFixed(2) + 's)' : ''));
    }
  }
  lines.push('', 'File: ' + name);
  return lines.join('\n') + '\n';
}

/** Renders a project; resolves where the file went. `signal` stops ffmpeg (the file is not kept). */
async function run(p, { onProgress, signal } = {}) {
  const T = endOf(p);
  if (T <= 0) throw Object.assign(new Error('the timeline is empty'), { status: 400 });
  const dir = path.join(VIDEO.dir, 'Renders');
  fs.mkdirSync(dir, { recursive: true });
  const name = freeName(dir, _safe(p.name), '.mp4');
  const out = path.join(dir, name);
  checkPathLength(out);
  // Made in cache/ (never seen half-done in the library), then moved in: one library, one drive.
  const work = path.join(CACHE_DIR, 'render');
  fs.mkdirSync(work, { recursive: true });
  const part = path.join(work, p.id + '.part.mp4');
  const pl = plan(p);
  const script = path.join(work, p.id + '.txt');
  fs.writeFileSync(script, pl.graph);
  const args = pl.args.concat([
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-t', sec(T), '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', part,
  ]);
  await new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    let last = -1;
    ff.stdout.on('data', (b) => {
      const m = /out_time_us=(\d+)/.exec(String(b));
      if (!m) return;
      const pct = Math.min(99, Math.floor(+m[1] / 1e6 / T * 100));
      if (pct > last) { last = pct; if (onProgress) onProgress(pct); }
    });
    ff.stderr.on('data', (b) => { err = (err + b).slice(-4000); });
    const stop = () => { ff.kill(); };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', stop);
      if (signal && signal.aborted) { fs.rmSync(part, { force: true }); reject(new Error('you stopped it')); return; }
      if (code !== 0) {
        fs.rmSync(part, { force: true });
        const line = err.split('\n').map(s => s.trim()).filter(Boolean).slice(-2).join(' ');
        reject(new Error('ffmpeg could not make it: ' + line.slice(0, 300)));
        return;
      }
      resolve();
    });
  });
  fs.renameSync(part, out);
  fs.writeFileSync(out.slice(0, -4) + '.txt', _describe(p, pl, name), 'utf8');
  fs.rmSync(script, { force: true });
  return { rel: 'Renders/' + name, name };
}

module.exports = { run, endOf };
