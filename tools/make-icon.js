'use strict';

// The app's icon, by hand (phase 8 - the exe needs one): the favicon's sign - a gold rounded square with a dark dot,
// a record seen from above - drawn here pixel by pixel (4x4 samples a pixel), no package.
//
//   node tools/make-icon.js      writes desktop/icon.png (256 px) and desktop/icon.ico (16-256 px, PNG pictures inside)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('../lib/zip');

const OUT = path.join(__dirname, '..', 'desktop');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const GOLD = [0xd6, 0xb2, 0x4e];
const DARK = [0x0f, 0x0f, 0x10];

// In the 16 x 16 units of public/favicon.svg: the square 0..16 with corners of 4, the dot at 8,8 of radius 3.
function sample(x, y) {
  const r = 4;
  const cx = Math.min(Math.max(x, r), 16 - r);
  const cy = Math.min(Math.max(y, r), 16 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || x < 0 || y < 0 || x > 16 || y > 16) return null;
  return (x - 8) ** 2 + (y - 8) ** 2 <= 9 ? DARK : GOLD;
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sj = 0; sj < N; sj++) {
        for (let si = 0; si < N; si++) {
          const c = sample((i + (si + 0.5) / N) * 16 / size, (j + (sj + 0.5) / N) * 16 / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (j * size + i) * 4;
      if (a) { px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a); }
      px[o + 3] = Math.round(a / (N * N) * 255);
    }
  }
  return px;
}

function png(size, px) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) px.copy(rows, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngs = SIZES.map(s => png(s, draw(s)));
fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[pngs.length - 1]);
// ICONDIR, one ICONDIRENTRY per size, then the PNGs.
const head = Buffer.alloc(6 + 16 * SIZES.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(SIZES.length, 4);
let offset = head.length;
SIZES.forEach((s, k) => {
  const e = 6 + 16 * k;
  head[e] = s >= 256 ? 0 : s;
  head[e + 1] = s >= 256 ? 0 : s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[k].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pngs[k].length;
});
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, ...pngs]));
console.log('desktop/icon.png and desktop/icon.ico (' + SIZES.join(', ') + ' px)');
