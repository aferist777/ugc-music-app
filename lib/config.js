'use strict';

// Two roots. APP_DIR is the program - never written into. LIBRARY_DIR is everything the app writes: the person's files
// in Music / Images / Video (real folders), what was put away in Archive, the app's stores in data/, what can be made
// again in cache/. The Electron window sets MUSIC_LIBRARY_DIR to <app>/library (the owner's); the server started alone
// works on <app>/dev-library, so a test never touches the owner's library.

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const LIBRARY_DIR = process.env.MUSIC_LIBRARY_DIR
  ? path.resolve(process.env.MUSIC_LIBRARY_DIR)
  : path.join(APP_DIR, 'dev-library');

const DATA_DIR = path.join(LIBRARY_DIR, 'data');
const CACHE_DIR = path.join(LIBRARY_DIR, 'cache');

// What each kind of file is, by its extension (lower case, with the dot).
const KINDS = {
  music: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
  images: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  video: ['.mp4', '.mov', '.webm'],
};

// The roots of the library, in the order the tree shows them. Archive is last: what was put away from the other three,
// under a folder named after the root it came from (phase 1, the owner's B3).
const ROOTS = [
  { id: 'music', label: 'Music', kind: 'music', dir: path.join(LIBRARY_DIR, 'Music') },
  { id: 'images', label: 'Images', kind: 'images', dir: path.join(LIBRARY_DIR, 'Images') },
  { id: 'video', label: 'Video', kind: 'video', dir: path.join(LIBRARY_DIR, 'Video') },
  { id: 'archive', label: 'Archive', kind: null, dir: path.join(LIBRARY_DIR, 'Archive') },
];

// Free runs of the paid paths (from phase 2): only when asked for by the variable.
const FAKE = process.env.MUSIC_FAKE === '1';

function ensureLibrary() {
  for (const d of [LIBRARY_DIR, DATA_DIR, CACHE_DIR, ...ROOTS.map(r => r.dir)]) fs.mkdirSync(d, { recursive: true });
}

// APP_DIR is exported for one writer only: lib/updates.js, which puts a new release's program files in place (phase 8).
module.exports = { APP_DIR, PUBLIC_DIR, LIBRARY_DIR, DATA_DIR, CACHE_DIR, KINDS, ROOTS, FAKE, ensureLibrary };
