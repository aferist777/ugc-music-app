'use strict';

// Copies the keys this app uses from UGC Studio's settings.json into this app's library - once, at the setup (the
// owner, 2026-11-12). The values are never printed: only which keys were copied.
//
//   node tools/import-keys.js <UGC Studio's data/settings.json> [--library <folder>]
//
// --library defaults to library/ beside the program (the owner's). A key already set here is replaced.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const li = args.indexOf('--library');
const library = li >= 0 ? path.resolve(args[li + 1] || '') : path.resolve(__dirname, '..', 'library');
const from = args.find((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
if (!from) {
  console.error('usage: node tools/import-keys.js <settings.json> [--library <folder>]');
  process.exit(2);
}

process.env.MUSIC_LIBRARY_DIR = library;
const { ensureLibrary } = require('../lib/config');
const SETTINGS = require('../lib/settings');

let src;
try {
  src = JSON.parse(fs.readFileSync(path.resolve(from), 'utf8'));
} catch (e) {
  console.error('cannot read ' + from + ': ' + e.message);
  process.exit(1);
}

const patch = {};
for (const k of SETTINGS.KEYS) {
  if (typeof src[k.id] === 'string' && src[k.id].trim()) patch[k.id] = src[k.id].trim();
}
ensureLibrary();
SETTINGS.saveKeys(patch);
for (const k of SETTINGS.KEYS) console.log(k.id + ': ' + (patch[k.id] ? 'copied' : 'not in the source'));
console.log('into ' + SETTINGS.FILE);
