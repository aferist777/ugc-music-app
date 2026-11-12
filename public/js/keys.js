// The API keys window. The page never sees a key: each row says whether its key is there, a new one is pasted into an
// empty field and saved, Remove takes one away. A red dot on the top strip's button while there is no kie.ai key.

import { api } from './api.js';

const $ = (id) => document.getElementById(id);

let keys = [];
let opener = null;

function _msg(text, error) {
  const m = $('keys-msg');
  m.textContent = text || '';
  m.classList.toggle('is-error', !!error);
}

function _dot() {
  const kie = keys.find(k => k.id === 'kieApiKey');
  $('keys-dot').hidden = !kie || kie.set;
}

function _paint() {
  const form = $('keys-form');
  form.textContent = '';
  for (const k of keys) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const top = document.createElement('div');
    top.className = 'key-top';
    const label = document.createElement('label');
    label.className = 'key-label';
    label.htmlFor = 'key-' + k.id;
    label.textContent = k.label;
    const state = document.createElement('span');
    state.className = 'key-state' + (k.set ? ' is-set' : '');
    state.textContent = k.set ? 'set' : 'not set';
    top.append(label, state);

    const note = document.createElement('div');
    note.className = 'key-note';
    note.textContent = k.note;

    const line = document.createElement('div');
    line.className = 'key-line';
    const input = document.createElement('input');
    input.className = 'field';
    input.id = 'key-' + k.id;
    input.name = k.id;
    input.type = 'password';
    input.spellcheck = false;
    input.placeholder = k.set ? 'Paste a new key to replace it' : 'Paste the key';
    line.append(input);
    if (k.set) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn link';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => _save({ [k.id]: '' }, k.label + ' removed.'));
      line.append(rm);
    }

    row.append(top, note, line);
    form.append(row);
  }
}

async function _load() {
  const r = await api('/api/settings/keys');
  keys = r.keys || [];
  _dot();
}

async function _save(patch, done) {
  if (!Object.keys(patch).length) { _msg('Paste a key first.'); return; }
  $('keys-save').disabled = true;
  try {
    const r = await api('/api/settings/keys', { method: 'PUT', body: patch });
    keys = r.keys || [];
    _dot();
    _paint();
    _msg(done || 'Saved.');
    // The rows were drawn anew: the focus stays in the window rather than falling to the page under it.
    const first = $('keys-form').querySelector('input');
    if (first) first.focus();
  } catch (e) {
    _msg(e.message, true);
  } finally {
    $('keys-save').disabled = false;
  }
}

function _onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); }
}

export async function open() {
  opener = document.activeElement;
  _msg('');
  try { await _load(); } catch (e) { _msg(e.message, true); }
  _paint();
  $('keys-overlay').hidden = false;
  document.addEventListener('keydown', _onKey);
  const first = $('keys-form').querySelector('input');
  if (first) first.focus();
}

export function close() {
  $('keys-overlay').hidden = true;
  document.removeEventListener('keydown', _onKey);
  if (opener && opener.focus) opener.focus();
}

export function initKeys() {
  $('keys-open').addEventListener('click', open);
  $('keys-close').addEventListener('click', close);
  $('keys-overlay').addEventListener('pointerdown', (e) => { if (e.target === e.currentTarget) close(); });
  $('keys-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const patch = {};
    for (const input of $('keys-form').querySelectorAll('input')) {
      if (input.value.trim()) patch[input.name] = input.value.trim();
    }
    _save(patch);
  });
  _load().catch(() => { /* the dot stays hidden; the window says why when opened */ });
}
