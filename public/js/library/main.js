// ════════════════════════════════════════════════════════════════════════════
// THE LIBRARY COLUMN (phase 1, the owner's B1): folders on top (tree.js), the open folder's files as rows below
// (files.js), the player under them (player.js). This module holds what is open and picked, loads the tree and the
// list, brings pictures in (the owner's B6: pictures only; one dropped on a folder of Images lands in it, anywhere else
// in Images / Uploads - phase 5, i13) and reads the library again whenever the window comes back - what was changed in Explorer shows then.
// ════════════════════════════════════════════════════════════════════════════

import { api, remembered, remember } from '../api.js';
import { showError, showToast } from '../notice.js';
import { q, isPicture, parentRel } from './common.js';
import { initTree } from './tree.js';
import { initFiles } from './files.js';
import { initPlayer } from './player.js';
import { openViewer } from './viewer.js';

let openTurn = 0;

const S = {
  roots: [],
  projects: [],
  project: null, // the project open on the timeline
  root: 'music',
  rel: '',
  want: null, // the folder asked for last - what a reading of the library opens again
  files: [],
  sort: remembered().sort === 'name' ? 'name' : 'date',
  sel: new Set(),
  anchor: null,
};

const L = {
  S,
  drag: null, // what is being dragged inside the page: { type: 'files', root, rels } | { type: 'folder', root, rel }

  rootOf(id) {
    return S.roots.find(r => r.id === id) || null;
  },

  async loadTree() {
    const [t, p] = await Promise.all([api('/api/library/tree'), api('/api/projects')]);
    S.roots = t.roots || [];
    S.projects = p.projects || [];
    L.tree.paint();
  },

  async loadProjects() {
    S.projects = (await api('/api/projects')).projects || [];
    L.tree.paint();
  },

  /**
   * Opens a folder; one that is not there any more opens its parent. `keep` keeps the picked files that are still there.
   * The LAST open wins: an answer to an earlier one that comes back later is dropped, and a reading of the library
   * started meanwhile (the window coming back) reads the folder asked for last, not the one shown.
   */
  async open(root, rel, { keep = false, pick = null } = {}) {
    const turn = ++openTurn;
    S.want = { root, rel };
    let r;
    try {
      r = await api('/api/library/list?' + q({ root, rel }));
    } catch (e) {
      if (turn !== openTurn) return null;
      if (rel) return L.open(root, parentRel(rel), { keep: false, pick });
      throw e;
    }
    if (turn !== openTurn) return null;
    const moved = r.root !== S.root || r.rel !== S.rel;
    S.root = r.root;
    S.rel = r.rel;
    S.files = r.files;
    const here = new Set(S.files.map(f => f.rel));
    if (pick) {
      S.sel = new Set(pick.filter(x => here.has(x)));
      S.anchor = pick[pick.length - 1] || null;
    } else if (moved || !keep) {
      S.sel.clear();
      S.anchor = null;
    } else {
      S.sel = new Set([...S.sel].filter(x => here.has(x)));
      if (!here.has(S.anchor)) S.anchor = null;
    }
    remember({ open: { root: S.root, rel: S.rel } });
    L.tree.mark();
    L.files.paint();
    // The Music tab files its tracks into the folder selected here (phase 3, the owner's C5).
    window.dispatchEvent(new CustomEvent('ms:folder', { detail: { root: S.root, rel: S.rel } }));
    return r;
  },

  async refresh(opts) {
    await L.loadTree();
    const w = S.want || { root: S.root, rel: S.rel };
    await L.open(w.root, w.rel, Object.assign({ keep: true }, opts || {}));
  },

  /** A change on the server: its message, or its error in words; the library is read again either way. */
  async act(fn, said, after) {
    let r = null;
    try {
      r = await fn();
      const refused = r && Array.isArray(r.refused) ? r.refused : [];
      for (const x of refused) showError((x.rel ? x.rel.split('/').pop() + ': ' : '') + x.why);
      const text = said && said(r);
      if (text) showToast(text);
    } catch (e) {
      showError(e.message);
    }
    try {
      if (after) await after(r); else await L.refresh();
    } catch (e) {
      showError(e.message);
    }
    // The timeline reads its project again: the server may have followed a file that moved (phase 4).
    window.dispatchEvent(new CustomEvent('ms:library-ops'));
    return r;
  },

  setSort(sort) {
    S.sort = sort === 'name' ? 'name' : 'date';
    remember({ sort: S.sort });
    L.files.paint();
  },

  /** A double press or Enter on a file: a track plays, a picture or a clip opens. */
  activate(f) {
    if (f.kind === 'music') L.player.load(S.root, f, { play: true });
    else openViewer(L, S.root, f);
  },

  describe(f) {
    openViewer(L, S.root, f, { describe: true });
  },

  /** Pictures from this computer (the Import button or a drop from Explorer) into the folder dropped on. */
  async importFiles(list, root, rel) {
    const files = [...(list || [])];
    const pics = files.filter(f => isPicture(f.name));
    const others = files.filter(f => !isPicture(f.name));
    if (others.length) showError('Only pictures can be brought in (jpg, png, webp, gif): ' + others.map(f => f.name).join(', '));
    const made = [];
    let uploads = false;
    for (const f of pics) {
      try {
        const res = await fetch('/api/library/import?' + q({ root, rel, name: f.name }), {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'it could not be brought in');
        made.push(data.rel);
        if (data.uploads) uploads = true;
      } catch (e) {
        showError(f.name + ': ' + e.message);
      }
    }
    if (!made.length) return;
    const n = made.length;
    showToast(n + (n === 1 ? ' picture' : ' pictures') + ' brought in' + (uploads ? ' - into Images / Uploads' : ''));
    await L.loadTree();
    // Where they landed opens, with them picked.
    await L.open('images', parentRel(made[made.length - 1]), { pick: made });
  },
};

function _guardDrops() {
  // A file dropped anywhere else must never make the window open it.
  for (const t of ['dragover', 'drop']) {
    window.addEventListener(t, (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
    });
  }
}

/** A track of the library into the player, playing (the Music tab's Recent). */
export function playTrack(root, rel, name, dur) {
  if (!L.player) return;
  const base = String(name || rel.split('/').pop()).replace(/\.[^.]+$/, '');
  L.player.load(root, { rel, name: name || rel.split('/').pop(), base, duration: dur || 0, kind: 'music' }, { play: true });
}

/** The folder a file lies in opens with the file picked. */
export async function revealFile(root, rel) {
  try {
    await L.loadTree();
    await L.open(root, parentRel(rel), { pick: [rel] });
  } catch (e) {
    showError(e.message);
  }
}

export async function initLibrary() {
  // The project on the timeline shows as picked under Projects.
  // Only the mark moves - the tree is not drawn again (a project's name may be being typed in it).
  window.addEventListener('ms:project-opened', (e) => {
    S.project = e.detail && e.detail.id;
    for (const r of document.querySelectorAll('#lib-tree [data-project]')) r.classList.toggle('is-on', r.dataset.project === S.project);
  });
  window.addEventListener('ms:projects-changed', () => { L.loadProjects().catch(() => {}); });
  // A press of the Music tab landed: the library is read again (never under a name being typed).
  window.addEventListener('ms:library-changed', () => {
    if (document.querySelector('.rename-input')) return;
    L.refresh().catch(() => {});
  });
  L.tree = initTree(L);
  L.files = initFiles(L);
  L.player = initPlayer(L);
  _guardDrops();

  const input = document.getElementById('lib-import-input');
  document.getElementById('lib-import').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    // Into the open folder when it is one of Images, else into Images / Uploads (phase 5).
    L.importFiles(files, 'images', S.root === 'images' ? S.rel : '');
  });
  document.getElementById('lib-new-folder').addEventListener('click', () => {
    if (S.root === 'archive') { showError('Nothing is made inside Archive.'); return; }
    L.tree.newFolder(S.root, S.rel);
  });

  // What changed in Explorer shows when the window comes back - never while a name is being typed.
  let busy = false;
  window.addEventListener('focus', async () => {
    if (busy || document.querySelector('.rename-input')) return;
    busy = true;
    try { await L.refresh(); } catch { /* the server is gone: the page stays */ }
    busy = false;
  });

  const was = remembered().open || {};
  try {
    await L.loadTree();
    await L.open(L.rootOf(was.root) ? was.root : 'music', was.rel || '');
  } catch (e) {
    showError('The library could not be read: ' + e.message);
  }
}
