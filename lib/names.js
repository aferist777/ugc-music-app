'use strict';

// Names of files and folders the person types: what Windows refuses is refused here first, in words.

const fs = require('fs');
const path = require('path');

const MAX_NAME = 80;
// A file's whole path: past ~260 characters Windows programs (ffmpeg among them) cannot open it; 240 leaves room.
const MAX_PATH = 240;
const BAD = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** A name as typed -> the name to use, or a 400 saying what is wrong with it. */
function cleanName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw bad('the name is empty');
  if (n.length > MAX_NAME) throw bad('the name is longer than ' + MAX_NAME + ' characters');
  if (BAD.test(n)) throw bad('a name cannot have \\ / : * ? " < > |');
  if (n === '.' || n === '..' || /[. ]$/.test(n)) throw bad('a name cannot end with a dot or a space');
  if (RESERVED.test(n)) throw bad('Windows keeps that name for itself');
  return n;
}

function checkPathLength(abs) {
  if (abs.length > MAX_PATH) throw bad('the path would be too long for Windows - use a shorter name or fewer folders');
}

/** "<base><ext>" in dir, or "<base> 2<ext>", "<base> 3<ext>"... - the first that is free (with its .txt beside it). */
function freeName(dir, base, ext) {
  for (let i = 1; i < 10000; i++) {
    const name = (i === 1 ? base : base + ' ' + i) + ext;
    const abs = path.join(dir, name);
    const txt = ext ? path.join(dir, (i === 1 ? base : base + ' ' + i) + '.txt') : null;
    if (!fs.existsSync(abs) && !(txt && fs.existsSync(txt))) return name;
  }
  throw bad('no free name for ' + base + ext);
}

module.exports = { cleanName, checkPathLength, freeName, MAX_PATH };
