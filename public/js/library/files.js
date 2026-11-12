// ════════════════════════════════════════════════════════════════════════════
// THE FILES of the open folder, as ROWS (phase 1, the owner's B1): a cover or the wave, the name, the length, ✕.
//   a press picks one; Ctrl adds or takes away; Shift picks a run (the owner's B4); Ctrl+A all
//   a double press or Enter plays a track / opens a picture or a clip; F2 renames in place
//   ✕, Delete or the menu's "Move to Archive" ask by a SECOND press - "Really?" (the owner's B3); inside Archive the same
//   press deletes for good; Escape lets the question go
//   picked rows are dragged onto a folder of their root in the tree; pictures from Explorer are dropped on the rows
// ════════════════════════════════════════════════════════════════════════════

import { api } from '../api.js';
import { openMenu } from '../menu.js';
import { showError } from '../notice.js';
import { blocked } from '../layers.js';
import { post, q, el, icon, clock, miniWave, thumbUrl, lastOf } from './common.js';
import { pickFolder } from './pick.js';

const $ = (id) => document.getElementById(id);

const EMPTY = {
  music: 'Tracks you make with Suno land here.',
  images: 'Drop pictures here or press Import.',
  video: 'Clips you make land here.',
  archive: 'Nothing here. What you delete waits in Archive until you delete it for good.',
};

export function initFiles(L) {
  const S = L.S;
  const host = $('lib-files');
  const crumb = $('lib-crumb');
  const sortDate = $('lib-sort-date');
  const sortName = $('lib-sort-name');
  const emptyBtn = $('lib-empty-archive');
  let really = null; // { rels: Set, timer } - the rows waiting for the second press

  sortDate.addEventListener('click', () => L.setSort('date'));
  sortName.addEventListener('click', () => L.setSort('name'));

  // ── Drawing ──────────────────────────────────────────────────────────────

  function sorted() {
    const list = S.files.slice();
    if (S.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    else list.sort((a, b) => b.mtime - a.mtime);
    return list;
  }

  function paint() {
    _letGo();
    const root = L.rootOf(S.root);
    crumb.textContent = [root ? root.label : S.root, ...(S.rel ? S.rel.split('/') : [])].join(' / ');
    crumb.title = crumb.textContent;
    sortDate.classList.toggle('is-on', S.sort === 'date');
    sortName.classList.toggle('is-on', S.sort === 'name');
    emptyBtn.hidden = S.root !== 'archive';
    host.textContent = '';
    host.classList.toggle('is-archive', S.root === 'archive');
    const list = sorted();
    if (!list.length) {
      host.append(el('div', 'files-empty', EMPTY[S.root] || 'No files here.'));
      return;
    }
    for (const f of list) host.append(_row(f));
    _measure(list);
  }

  function _row(f) {
    const row = el('div', 'fr' + (S.sel.has(f.rel) ? ' is-sel' : ''));
    row.dataset.rel = f.rel;
    row.setAttribute('role', 'option');
    const lead = el('span', 'fr-lead');
    if (f.kind === 'images' || f.kind === 'video') {
      const img = el('img', 'fr-thumb');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = thumbUrl(S.root, f);
      img.addEventListener('error', () => { lead.innerHTML = icon(f.kind, 16); });
      lead.append(img);
    } else {
      lead.innerHTML = icon(f.kind || 'music', 16);
    }
    const mid = el('span', 'fr-mid');
    const name = el('span', 'fr-name', f.base);
    name.title = f.name;
    mid.append(name);
    if (f.from) mid.append(el('span', 'fr-from', 'from ' + f.from));
    const wave = el('span', 'fr-wave');
    if (f.kind === 'music' && f.wave) wave.append(miniWave(f.wave));
    const time = el('span', 'fr-time', f.duration ? clock(f.duration) : '');
    const x = el('button', 'fr-x');
    x.title = S.root === 'archive' ? 'Delete for good' : 'Move to Archive';
    x.innerHTML = icon('x', 12);
    x.addEventListener('click', (e) => { e.stopPropagation(); _askOrDo(_targets(f.rel), x); });
    x.addEventListener('dblclick', (e) => e.stopPropagation());
    row.append(lead, mid, wave, time, x);

    row.addEventListener('click', (e) => _pick(f.rel, e));
    row.addEventListener('dblclick', () => L.activate(f));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!S.sel.has(f.rel)) _pick(f.rel, {});
      _menu(e, f);
    });
    if (S.root !== 'archive') {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        if (!S.sel.has(f.rel)) _pick(f.rel, {});
        L.drag = { type: 'files', root: S.root, rels: [...S.sel] };
        window.msDrag = { root: S.root, rels: [...S.sel] };
        // A folder of the tree MOVES what is dropped on it, the timeline COPIES it in: both must be allowed here, or
        // Chromium refuses the timeline's drop without a word (its 'copy' is not among the allowed).
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/x-ms-files', JSON.stringify(L.drag));
      });
      row.addEventListener('dragend', () => { L.drag = null; window.msDrag = null; });
    }
    return row;
  }

  // The rows' lengths and waves that are not known yet are asked for, two at a time.
  const waiting = [];
  let asking = 0;
  function _measure(list) {
    waiting.length = 0;
    for (const f of list) if ((f.kind === 'music' || f.kind === 'video') && f.duration == null) waiting.push({ root: S.root, f });
    _pump();
  }
  function _pump() {
    while (asking < 2 && waiting.length) {
      const job = waiting.shift();
      asking++;
      api('/api/library/info?' + q({ root: job.root, rel: job.f.rel }))
        .then((v) => {
          job.f.duration = v.duration;
          if (v.wave) job.f.wave = v.wave;
          if (job.root !== S.root) return;
          const row = _rowOf(job.f.rel);
          if (!row) return;
          row.querySelector('.fr-time').textContent = v.duration ? clock(v.duration) : '';
          const w = row.querySelector('.fr-wave');
          if (v.wave && job.f.kind === 'music') { w.textContent = ''; w.append(miniWave(v.wave)); }
        })
        .catch(() => { job.f.duration = 0; })
        .finally(() => { asking--; _pump(); });
    }
  }

  const _rowOf = (rel) => [...host.querySelectorAll('.fr')].find(r => r.dataset.rel === rel) || null;
  const _fileOf = (rel) => S.files.find(f => f.rel === rel) || null;

  // ── Picking ──────────────────────────────────────────────────────────────

  function _pick(rel, e) {
    _letGo();
    if (e.shiftKey && S.anchor) {
      const list = sorted().map(f => f.rel);
      const a = list.indexOf(S.anchor);
      const b = list.indexOf(rel);
      if (a >= 0 && b >= 0) {
        if (!e.ctrlKey) S.sel.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(list[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (S.sel.has(rel)) S.sel.delete(rel); else S.sel.add(rel);
      S.anchor = rel;
    } else {
      S.sel = new Set([rel]);
      S.anchor = rel;
    }
    _paintSel();
    const f = _fileOf(rel);
    // A track picked alone stands in the player, ready (the owner's sketch).
    if (f && f.kind === 'music' && S.sel.size === 1 && !e.shiftKey && !e.ctrlKey) L.player.load(S.root, f, { play: false });
    host.focus({ preventScroll: true });
  }

  function _paintSel() {
    for (const r of host.querySelectorAll('.fr')) r.classList.toggle('is-sel', S.sel.has(r.dataset.rel));
  }

  // What an action on a row takes: the picked rows when the row is one of them, else the row alone.
  function _targets(rel) {
    return S.sel.has(rel) ? [...S.sel] : [rel];
  }

  // ── The second press ─────────────────────────────────────────────────────

  function _askOrDo(rels, button) {
    const same = really && rels.length === really.rels.size && rels.every(r => really.rels.has(r));
    if (same) { _letGo(); _remove(rels); return; }
    _letGo();
    really = { rels: new Set(rels), timer: setTimeout(_letGo, 5000) };
    for (const r of host.querySelectorAll('.fr')) {
      if (!really.rels.has(r.dataset.rel)) continue;
      r.classList.add('is-really');
    }
    const word = S.root === 'archive' ? 'Delete?' : 'Really?';
    const btn = button || (_rowOf(rels[0]) && _rowOf(rels[0]).querySelector('.fr-x'));
    if (btn) { btn.classList.add('is-really'); btn.textContent = word; }
  }

  function _letGo() {
    if (!really) return;
    clearTimeout(really.timer);
    really = null;
    for (const r of host.querySelectorAll('.fr.is-really')) r.classList.remove('is-really');
    for (const b of host.querySelectorAll('.fr-x.is-really')) { b.classList.remove('is-really'); b.innerHTML = icon('x', 12); }
  }

  // Into Archive - or, inside Archive, deleted for good.
  function _remove(rels) {
    const n = rels.length;
    const what = n === 1 ? '"' + lastOf(rels[0]).replace(/\.[^.]+$/, '') + '"' : n + ' files';
    if (S.root === 'archive') {
      L.act(() => post('/api/library/purge', { items: rels.map(rel => ({ rel })) }), r => r.deleted ? what + ' deleted for good' : '',
        async () => { for (const rel of rels) L.player.forget('archive', rel); await L.refresh(); });
      return;
    }
    const root = S.root;
    L.act(() => post('/api/library/archive', { root, items: rels.map(rel => ({ rel })) }),
      r => r.done.length ? what + (n === 1 ? ' is' : ' are') + ' in Archive' : '',
      async (r) => { for (const d of (r && r.done) || []) L.player.forget(root, d.rel); await L.refresh(); });
  }

  // ── Menu ─────────────────────────────────────────────────────────────────

  function _menu(e, f) {
    const rels = _targets(f.rel);
    const one = rels.length === 1;
    const root = S.root;
    const reveal = { label: 'Show in Explorer', disabled: !one, act: () => post('/api/library/reveal', { root, rel: f.rel }).catch(err => showError(err.message)) };
    if (root === 'archive') {
      openMenu(e.clientX, e.clientY, [
        { label: one ? 'Restore' : 'Restore ' + rels.length, act: () => _restore(rels) },
        { label: 'Description', disabled: !one, act: () => L.describe(f) },
        { sep: true }, reveal, { sep: true },
        { label: one ? 'Delete forever' : 'Delete ' + rels.length + ' forever', danger: true, really: true, act: () => _remove(rels) },
      ]);
      return;
    }
    openMenu(e.clientX, e.clientY, [
      { label: f.kind === 'music' ? 'Play' : 'Open', disabled: !one, act: () => L.activate(f) },
      { label: 'Rename', disabled: !one, act: () => rename(f.rel) },
      { label: one ? 'Move to…' : 'Move ' + rels.length + ' to…', act: () => _moveTo(rels) },
      { label: 'Description', disabled: !one, act: () => L.describe(f) },
      { sep: true }, reveal, { sep: true },
      { label: one ? 'Move to Archive' : 'Move ' + rels.length + ' to Archive', danger: true, really: true, act: () => _remove(rels) },
    ]);
  }

  async function _moveTo(rels) {
    const root = S.root;
    const to = await pickFolder(L, root, S.rel);
    if (to == null) return;
    L.act(() => post('/api/library/files/move', { root, rels, to }),
      r => r.moved.length ? r.moved.length + (r.moved.length === 1 ? ' file' : ' files') + ' moved' : '',
      async (r) => { for (const m of (r && r.moved) || []) L.player.follow(root, m.from, m.to); await L.refresh(); });
  }

  // Back to their places; a track of Archive that stood in the player follows it there.
  function _restore(rels) {
    L.act(() => post('/api/library/restore', { items: rels.map(rel => ({ rel })) }),
      r => r.done.length ? r.done.length + (r.done.length === 1 ? ' file' : ' files') + ' restored' : '',
      async (r) => {
        for (const d of (r && r.done) || []) L.player.forget('archive', d.rel);
        await L.refresh();
      });
  }

  // ── Rename in place ──────────────────────────────────────────────────────

  function rename(rel) {
    const row = _rowOf(rel);
    const f = _fileOf(rel);
    if (!row || !f || S.root === 'archive') return;
    const name = row.querySelector('.fr-name');
    const input = el('input', 'rename-input');
    input.value = f.base;
    input.spellcheck = false;
    name.replaceWith(input);
    row.draggable = false;
    input.focus();
    input.select();
    let done = false;
    const root = S.root;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const typed = input.value.trim();
      if (!save || !typed || typed === f.base) { input.replaceWith(name); row.draggable = true; host.focus(); return; }
      await L.act(() => post('/api/library/file/rename', { root, rel, name: typed }), null, async (r) => {
        if (r) L.player.follow(root, rel, r.rel);
        await L.open(L.S.root, L.S.rel, { pick: [r ? r.rel : rel] });
      });
      host.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    for (const t of ['click', 'dblclick', 'mousedown']) input.addEventListener(t, (e) => e.stopPropagation());
  }

  // ── Keys ─────────────────────────────────────────────────────────────────

  host.addEventListener('keydown', (e) => {
    if (blocked(e)) return;
    const list = sorted();
    if (!list.length) return;
    const at = list.findIndex(f => f.rel === S.anchor);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      _pick(next.rel, { shiftKey: e.shiftKey });
      const r = _rowOf(next.rel);
      if (r) r.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && S.sel.size === 1) {
      e.preventDefault();
      L.activate(_fileOf([...S.sel][0]));
    } else if (e.key === 'F2' && S.sel.size === 1) {
      e.preventDefault();
      rename([...S.sel][0]);
    } else if (e.key === 'Delete' && S.sel.size) {
      e.preventDefault();
      _askOrDo([...S.sel]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      S.sel = new Set(list.map(f => f.rel));
      S.anchor = list[list.length - 1].rel;
      _paintSel();
    } else if (e.key === 'Escape') {
      if (really) _letGo(); else { S.sel.clear(); _paintSel(); }
    }
  });

  // A press on the empty space under the rows lets the picked ones go.
  host.addEventListener('click', (e) => {
    if (e.target === host) { _letGo(); S.sel.clear(); S.anchor = null; _paintSel(); }
  });

  // Pictures from Explorer dropped on the list go into the open folder (into Images when this is not one of it).
  host.addEventListener('dragover', (e) => {
    if (L.drag || S.root === 'archive' || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    host.classList.add('is-drop');
  });
  host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) host.classList.remove('is-drop'); });
  host.addEventListener('drop', (e) => {
    host.classList.remove('is-drop');
    if (L.drag || S.root === 'archive') return;
    e.preventDefault();
    L.importFiles(e.dataTransfer.files, S.root, S.rel);
  });

  emptyBtn.addEventListener('click', () => {
    if (!emptyBtn.classList.contains('is-really')) {
      emptyBtn.classList.add('is-really');
      emptyBtn.textContent = 'Really? Empty';
      setTimeout(() => { emptyBtn.classList.remove('is-really'); emptyBtn.textContent = 'Empty archive'; }, 5000);
      return;
    }
    emptyBtn.classList.remove('is-really');
    emptyBtn.textContent = 'Empty archive';
    L.act(() => post('/api/library/archive/empty'), r => 'Archive is empty' + (r.deleted ? '' : ' already'),
      async () => { L.player.forget('archive', ''); await L.refresh(); });
  });

  return { paint };
}
