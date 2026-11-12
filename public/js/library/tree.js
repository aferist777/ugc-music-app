// ════════════════════════════════════════════════════════════════════════════
// THE TREE of folders (phase 1): Music, Images, Video and - last - Archive, each with its folders. A press opens a
// folder (its files below), the caret or a double press folds it, the right button has its menu; a folder is dragged
// onto another of its root, picked files are dragged onto a folder of theirs, pictures from Explorer are dropped on any
// folder (into Images, the owner's B2). Which folders are unfolded is remembered.
// ════════════════════════════════════════════════════════════════════════════

import { remembered, remember } from '../api.js';
import { openMenu } from '../menu.js';
import { showError } from '../notice.js';
import { post, el, icon, joinRel, parentRel, lastOf } from './common.js';

const $ = (id) => document.getElementById(id);
const key = (root, rel) => root + ':' + rel;

export function initTree(L) {
  const host = $('lib-tree');
  const unfolded = new Set(remembered().unfolded || [key('music', '')]);
  let hoverTimer = null;

  const keep = () => remember({ unfolded: [...unfolded] });

  function paint() {
    host.textContent = '';
    for (const r of L.S.roots) host.append(_node(r.id, '', r.label, r.folders || [], 0));
    mark();
  }

  function _node(root, rel, label, folders, depth) {
    const wrap = el('div', 'tn');
    const row = el('div', 'tn-row' + (rel ? '' : ' is-root') + (root === 'archive' && !rel ? ' is-archive' : ''));
    row.dataset.root = root;
    row.dataset.rel = rel;
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = (4 + depth * 14) + 'px';
    const open = unfolded.has(key(root, rel));
    const caret = el('button', 'tn-caret' + (folders.length ? '' : ' is-empty') + (open ? ' is-open' : ''));
    caret.tabIndex = -1;
    caret.innerHTML = icon('caret', 12);
    const ic = el('span', 'tn-icon');
    ic.innerHTML = icon(rel ? 'folder' : root, 16);
    const name = el('span', 'tn-name', label);
    row.append(caret, ic, name);
    wrap.append(row);
    if (open && folders.length) {
      const kids = el('div', 'tn-kids');
      for (const f of folders) kids.append(_node(root, f.rel, f.name, f.folders || [], depth + 1));
      wrap.append(kids);
    }

    caret.addEventListener('click', (e) => { e.stopPropagation(); _fold(root, rel); });
    row.addEventListener('click', () => L.open(root, rel).catch(e => showError(e.message)));
    row.addEventListener('dblclick', () => { if (folders.length) _fold(root, rel); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(e, root, rel); });

    // A folder of a live root is dragged onto another folder of that root.
    if (rel && root !== 'archive') {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        L.drag = { type: 'folder', root, rel };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-ms-folder', JSON.stringify(L.drag));
      });
      row.addEventListener('dragend', () => { L.drag = null; _clearDrop(); });
    }
    row.addEventListener('dragover', (e) => {
      if (!_accepts(e, root, rel)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = L.drag ? 'move' : 'copy';
      if (!row.classList.contains('is-drop')) {
        _clearDrop();
        row.classList.add('is-drop');
        clearTimeout(hoverTimer);
        // Held over a folded folder, it unfolds - so a deeper one can be reached.
        if (folders.length && !unfolded.has(key(root, rel))) hoverTimer = setTimeout(() => _fold(root, rel, true), 700);
      }
    });
    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) { row.classList.remove('is-drop'); clearTimeout(hoverTimer); }
    });
    row.addEventListener('drop', (e) => {
      if (!_accepts(e, root, rel)) return;
      e.preventDefault();
      _clearDrop();
      _drop(e, root, rel);
    });
    return wrap;
  }

  function _clearDrop() {
    clearTimeout(hoverTimer);
    for (const r of host.querySelectorAll('.tn-row.is-drop')) r.classList.remove('is-drop');
  }

  function _fold(root, rel, openOnly) {
    const k = key(root, rel);
    if (unfolded.has(k) && !openOnly) unfolded.delete(k); else unfolded.add(k);
    keep();
    paint();
  }

  // What a folder takes: pictures from Explorer anywhere outside Archive; picked files of its own root (not the folder
  // they lie in); a folder of its root that is not itself or above it.
  function _accepts(e, root, rel) {
    const types = [...(e.dataTransfer ? e.dataTransfer.types : [])];
    if (root === 'archive') return false;
    if (!L.drag) return types.includes('Files');
    if (L.drag.root !== root) return false;
    if (L.drag.type === 'files') return rel !== L.S.rel || root !== L.S.root;
    if (L.drag.type === 'folder') {
      const f = L.drag.rel;
      return rel !== f && !rel.startsWith(f + '/') && parentRel(f) !== rel;
    }
    return false;
  }

  function _drop(e, root, rel) {
    const d = L.drag;
    L.drag = null;
    if (!d) { L.importFiles(e.dataTransfer.files, root, rel); return; }
    if (d.type === 'files') {
      L.act(() => post('/api/library/files/move', { root, rels: d.rels, to: rel }),
        r => r.moved.length ? r.moved.length + (r.moved.length === 1 ? ' file' : ' files') + ' moved' : '',
        async (r) => {
          for (const m of (r && r.moved) || []) L.player.follow(root, m.from, m.to);
          await L.refresh();
        });
    } else if (d.type === 'folder') {
      L.act(() => post('/api/library/folder/move', { root, rel: d.rel, to: rel }), null, async (r) => {
        if (r) {
          L.player.follow(root, d.rel, r.rel);
          _carryUnfolded(root, d.rel, r.rel);
          unfolded.add(key(root, rel));
          keep();
          await L.loadTree();
          const inside = L.S.root === root && (L.S.rel === d.rel || L.S.rel.startsWith(d.rel + '/'));
          await L.open(L.S.root, inside ? r.rel + L.S.rel.slice(d.rel.length) : L.S.rel, { keep: true });
        } else await L.refresh();
      });
    }
  }

  // A renamed or moved folder stays unfolded as it was, and so do the folders in it.
  function _carryUnfolded(root, from, to) {
    for (const k of [...unfolded]) {
      const [r, rel] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (r === root && (rel === from || rel.startsWith(from + '/'))) {
        unfolded.delete(k);
        unfolded.add(key(root, to + rel.slice(from.length)));
      }
    }
    keep();
  }

  /** The open folder shows as picked; the folders above it unfold. */
  function mark() {
    const { root, rel } = L.S;
    let changed = false;
    const parts = rel ? rel.split('/') : [];
    for (let i = 0; i < parts.length; i++) {
      const k = key(root, parts.slice(0, i).join('/'));
      if (!unfolded.has(k)) { unfolded.add(k); changed = true; }
    }
    if (changed) { keep(); paint(); return; }
    for (const r of host.querySelectorAll('.tn-row')) {
      r.classList.toggle('is-on', r.dataset.root === root && r.dataset.rel === rel);
    }
  }

  function _row(root, rel) {
    return [...host.querySelectorAll('.tn-row')].find(r => r.dataset.root === root && r.dataset.rel === rel) || null;
  }

  // ── Menus ────────────────────────────────────────────────────────────────

  function _menu(e, root, rel) {
    const reveal = { label: 'Show in Explorer', act: () => post('/api/library/reveal', { root, rel }).catch(err => showError(err.message)) };
    if (root === 'archive') {
      if (!rel) {
        openMenu(e.clientX, e.clientY, [
          { label: 'Empty archive', danger: true, really: 'Really? Delete everything in Archive for good', act: () => _emptyArchive() },
          { sep: true }, reveal,
        ]);
        return;
      }
      openMenu(e.clientX, e.clientY, [
        rel.includes('/') ? { label: 'Restore', act: () => _restore(rel) } : null,
        { label: 'Delete forever', danger: true, really: true, act: () => _purge(rel) },
        { sep: true }, reveal,
      ]);
      return;
    }
    openMenu(e.clientX, e.clientY, [
      { label: 'New folder', act: () => newFolder(root, rel) },
      rel ? { label: 'Rename', act: () => rename(root, rel) } : null,
      { sep: true }, reveal,
      rel ? { sep: true } : null,
      rel ? { label: 'Move to Archive', danger: true, really: true, act: () => _archive(root, rel) } : null,
    ]);
  }

  function _archive(root, rel) {
    L.act(() => post('/api/library/archive', { root, items: [{ rel, folder: true }] }),
      r => r.done.length ? '"' + lastOf(rel) + '" is in Archive' : '',
      async () => { L.player.forget(root, rel); await L.refresh(); });
  }

  function _restore(rel) {
    L.act(() => post('/api/library/restore', { items: [{ rel }] }),
      r => r.done.length ? '"' + lastOf(rel) + '" restored' : '',
      async (r) => {
        L.player.forget('archive', rel);
        await L.loadTree();
        const d = r && r.done[0];
        if (d) await L.open(d.root, parentRel(d.to)); else await L.refresh();
      });
  }

  function _purge(rel) {
    L.act(() => post('/api/library/purge', { items: [{ rel }] }), r => r.deleted ? '"' + lastOf(rel) + '" deleted for good' : '',
      async () => { L.player.forget('archive', rel); await L.refresh(); });
  }

  function _emptyArchive() {
    L.act(() => post('/api/library/archive/empty'), r => 'Archive is empty' + (r.deleted ? '' : ' already'),
      async () => { L.player.forget('archive', ''); await L.refresh(); });
  }

  // ── New folder and rename, typed in place ────────────────────────────────

  function _freeName(root, parent) {
    const node = _find(root, parent);
    const taken = new Set((node ? node.folders : []).map(f => f.name.toLowerCase()));
    for (let i = 1; ; i++) {
      const n = i === 1 ? 'New folder' : 'New folder ' + i;
      if (!taken.has(n.toLowerCase())) return n;
    }
  }

  function _find(root, rel) {
    const r = L.rootOf(root);
    if (!r) return null;
    let node = r;
    for (const p of rel ? rel.split('/') : []) {
      node = (node.folders || []).find(f => f.name === p);
      if (!node) return null;
    }
    return node;
  }

  /** A folder named "New folder" (or "New folder 2"…) in `parent`, then its name typed in place. */
  async function newFolder(root, parent) {
    try {
      const r = await post('/api/library/folder', { root, parent, name: _freeName(root, parent) });
      unfolded.add(key(root, parent));
      keep();
      await L.loadTree();
      rename(root, r.rel, { opening: true });
    } catch (e) {
      showError(e.message);
    }
  }

  function rename(root, rel, { opening } = {}) {
    const row = _row(root, rel);
    if (!row) return;
    const name = row.querySelector('.tn-name');
    const input = el('input', 'rename-input');
    input.value = lastOf(rel);
    input.spellcheck = false;
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const typed = input.value.trim();
      if (!save || !typed || typed === lastOf(rel)) {
        input.replaceWith(name);
        if (opening) L.open(root, rel).catch(() => {});
        return;
      }
      await L.act(() => post('/api/library/folder/rename', { root, rel, name: typed }), null, async (r) => {
        const to = r ? r.rel : rel;
        if (r) { L.player.follow(root, rel, to); _carryUnfolded(root, rel, to); }
        await L.loadTree();
        const inside = L.S.root === root && (L.S.rel === rel || L.S.rel.startsWith(rel + '/'));
        if (opening) await L.open(root, to);
        else await L.open(L.S.root, inside ? to + L.S.rel.slice(rel.length) : L.S.rel, { keep: true });
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  return { paint, mark, newFolder, rename, joinRel };
}
