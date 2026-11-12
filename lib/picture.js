'use strict';

// A picture of the library MADE SENDABLE before a model sees it (phase 5; UGC Studio's rule "every picture brought in is
// made sendable first"): a jpg, png or webp within the model's limits goes as it is; a gif (its first frame), a picture
// heavier than the model takes or larger than its longest side becomes a JPEG in cache/send/ (made once, known by the
// file's size and time). One the model can never take - too small, too long and thin - is refused IN WORDS before any
// money is asked.
//   sendable(abs, { maxMb, minPx, maxPx, ratio }) -> { abs, w, h }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE_DIR } = require('./config');

const FFMPEG = require('ffmpeg-static');
const SEND = path.join(CACHE_DIR, 'send');
const KEEP_AS_IS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function _ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, err }));
  });
}

/** A picture's width and height, read by ffmpeg. */
async function dims(abs) {
  const { err } = await _ffmpeg(['-hide_banner', '-i', abs]);
  const m = /Video: [^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(err);
  if (!m) throw bad(path.basename(abs) + ' could not be read as a picture');
  return { w: +m[1], h: +m[2] };
}

async function sendable(abs, { maxMb = 20, minPx = 1, maxPx = 4096, ratio = null } = {}) {
  const name = path.basename(abs);
  const st = fs.statSync(abs);
  const { w, h } = await dims(abs);
  if (Math.min(w, h) < minPx) throw bad(name + ' is ' + w + '×' + h + ' - this model needs at least ' + minPx + ' px a side');
  if (ratio && (w / h < ratio[0] || w / h > ratio[1])) {
    throw bad(name + ' is ' + w + '×' + h + ' - this model takes a shape between ' + ratio[0] + ' and ' + ratio[1] + ' (width to height)');
  }
  const ext = path.extname(abs).toLowerCase();
  if (KEEP_AS_IS.has(ext) && st.size <= maxMb * 1024 * 1024 && Math.max(w, h) <= maxPx) return { abs, w, h };
  // A JPEG of it, its longest side at most maxPx.
  const id = crypto.createHash('sha1').update(abs + '|' + st.size + '|' + st.mtimeMs + '|' + maxPx).digest('hex').slice(0, 20);
  const out = path.join(SEND, id + '.jpg');
  const k = Math.min(1, maxPx / Math.max(w, h));
  const W = Math.max(2, Math.round(w * k));
  const H = Math.max(2, Math.round(h * k));
  if (!fs.existsSync(out)) {
    fs.mkdirSync(SEND, { recursive: true });
    const part = out + '.part.jpg';
    const r = await _ffmpeg(['-v', 'error', '-y', '-i', abs, '-frames:v', '1', '-vf', 'scale=' + W + ':' + H, '-q:v', '2', part]);
    if (r.code !== 0 || !fs.existsSync(part)) throw bad(name + ' could not be turned into a JPEG to send');
    fs.renameSync(part, out);
  }
  if (fs.statSync(out).size > maxMb * 1024 * 1024) throw bad(name + ' is still heavier than ' + maxMb + ' MB as a JPEG');
  return { abs: out, w: W, h: H };
}

module.exports = { sendable };
