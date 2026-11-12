'use strict';

// The journal's store (phase 3; its own module since phase 5) - data/jobs.json, newest first, ONE list for every paid
// generation (Suno's tracks and lyrics, pictures, clips) and every render: lib/jobs.js and lib/visual.js write it, the
// Jobs window reads it. What is still waiting is never trimmed; the rest keeps the last 300.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'jobs.json');
const KEEP = 300;

let store = null;

function all() {
  if (!store) {
    try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')).jobs; } catch { store = []; }
    if (!Array.isArray(store)) store = [];
  }
  return store;
}

function save() {
  let kept = 0;
  writeJsonAtomic(FILE, { jobs: all().filter(j => j.state === 'pending' || kept++ < KEEP) });
}

const get = (id) => all().find(j => j.id === id) || null;

function patch(id, p) {
  const j = get(id);
  if (!j) return null;
  Object.assign(j, p);
  save();
  return j;
}

function add(job) {
  all().unshift(job);
  save();
  return job;
}

function remove(id) {
  store = all().filter(x => x.id !== id);
  save();
}

const list = (limit) => all().slice(0, Math.max(1, Math.min(200, +limit || 40)));
const newId = () => 'j' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

module.exports = { all, save, get, patch, add, remove, list, newId };
