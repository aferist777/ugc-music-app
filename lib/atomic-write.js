'use strict';

// A store is written whole or not at all: into a temporary file beside it, then renamed over it. A crash in the middle
// leaves the old file, never half of a new one.

const fs = require('fs');
const path = require('path');

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function writeJsonAtomic(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

module.exports = { writeFileAtomic, writeJsonAtomic };
