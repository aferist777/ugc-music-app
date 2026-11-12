'use strict';

// data/settings.json - the keys. The page never receives a key: only whether it is there.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeJsonAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'settings.json');

// The keys this app knows, with the words the Keys window shows.
const KEYS = [
  { id: 'kieApiKey', label: 'kie.ai API key', note: 'Suno, Gemini, GPT, Grok and pictures' },
  { id: 'anthropicApiKey', label: 'Anthropic API key', note: 'optional - Claude goes first for the tag assistant' },
];
const MAX_KEY = 400;

function getSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

function getKey(id) {
  const v = getSettings()[id];
  return typeof v === 'string' ? v.trim() : '';
}

/** What the page may see: each key's label and whether it is set. */
function keysView() {
  const s = getSettings();
  return KEYS.map(k => ({ id: k.id, label: k.label, note: k.note, set: typeof s[k.id] === 'string' && !!s[k.id].trim() }));
}

/**
 * Changes some keys. A string sets the key (trimmed; an empty one removes it); a key not named stays as it is.
 * Throws a 400 in words for a key this app does not know or a value that cannot be a key.
 */
function saveKeys(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const known = new Set(KEYS.map(k => k.id));
  const next = getSettings();
  for (const [id, v] of Object.entries(p)) {
    if (!known.has(id)) throw Object.assign(new Error('unknown key: ' + id), { status: 400 });
    if (typeof v !== 'string') throw Object.assign(new Error(id + ' must be text'), { status: 400 });
    const t = v.trim();
    if (t.length > MAX_KEY || /\s/.test(t)) throw Object.assign(new Error('that does not look like a key'), { status: 400 });
    if (t) next[id] = t; else delete next[id];
  }
  writeJsonAtomic(FILE, next);
  return keysView();
}

module.exports = { KEYS, getKey, keysView, saveKeys, FILE };
