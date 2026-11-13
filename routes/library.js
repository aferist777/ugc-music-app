'use strict';

// The library's routes (phase 1). Every change answers what it did or refuses in words (lib/library.js).

const express = require('express');
const LIB = require('../lib/library');
const INFO = require('../lib/media-info');

const router = express.Router();

// Express 4 does not catch a rejected promise: every async route goes through this.
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const q = (req, k) => String(req.query[k] == null ? '' : req.query[k]);
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.get('/library/tree', (req, res) => res.json({ roots: LIB.tree() }));

router.get('/library/list', (req, res) => res.json(LIB.list(q(req, 'root'), q(req, 'rel'))));

router.get('/library/info', a(async (req, res) => {
  const v = await INFO.info(LIB.fileAbs(q(req, 'root'), q(req, 'rel')));
  res.json({ duration: v.duration || 0, wave: v.wave || null });
}));

router.get('/library/peaks', a(async (req, res) => {
  const v = await INFO.info(LIB.fileAbs(q(req, 'root'), q(req, 'rel')));
  res.json({ duration: v.duration || 0, peaks: v.peaks || [] });
}));

router.get('/library/thumb', a(async (req, res) => {
  const file = await INFO.thumb(LIB.fileAbs(q(req, 'root'), q(req, 'rel')), q(req, 'size') || 's96');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(file);
}));

// The timeline's frames of a clip (phase 6): what the strip is, then the strip itself.
router.get('/library/strip', a(async (req, res) => {
  res.json(await INFO.strip(LIB.fileAbs(q(req, 'root'), q(req, 'rel'))));
}));

router.get('/library/strip-img', a(async (req, res) => {
  const file = await INFO.stripFile(LIB.fileAbs(q(req, 'root'), q(req, 'rel')));
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(file);
}));

// The preview's light copy of a clip (phase 6, the owner's P6): answered once it is made - the page asks one at a time.
router.get('/library/proxy', a(async (req, res) => {
  const r = await INFO.proxy(LIB.fileAbs(q(req, 'root'), q(req, 'rel')), q(req, 'q'));
  res.json(r.same ? { same: true } : { url: '/api/library/proxy-file?' + new URLSearchParams({ root: q(req, 'root'), rel: q(req, 'rel'), q: q(req, 'q') }) });
}));

router.get('/library/proxy-file', a(async (req, res) => {
  const r = await INFO.proxy(LIB.fileAbs(q(req, 'root'), q(req, 'rel')), q(req, 'q'));
  if (r.same) { res.status(404).json({ error: 'no copy - the file is light enough' }); return; }
  res.sendFile(r.file);
}));

router.get('/library/desc', (req, res) => res.json({ text: LIB.description(q(req, 'root'), q(req, 'rel')) }));

router.post('/library/folder', (req, res) => res.json(LIB.makeFolder(b(req).root, b(req).parent, b(req).name)));
router.post('/library/folder/rename', (req, res) => res.json(LIB.renameFolder(b(req).root, b(req).rel, b(req).name)));
router.post('/library/folder/move', (req, res) => res.json(LIB.moveFolder(b(req).root, b(req).rel, b(req).to)));

router.post('/library/file/rename', (req, res) => res.json(LIB.renameFile(b(req).root, b(req).rel, b(req).name)));
router.post('/library/files/move', (req, res) => res.json(LIB.moveFiles(b(req).root, b(req).rels, b(req).to)));

router.post('/library/archive', (req, res) => res.json(LIB.toArchive(b(req).root, b(req).items)));
router.post('/library/restore', (req, res) => res.json(LIB.restore(b(req).items)));
router.post('/library/purge', (req, res) => res.json(LIB.purge(b(req).items)));
router.post('/library/archive/empty', (req, res) => res.json(LIB.emptyArchive()));

// A picture from this computer: its bytes as the body, where and its name in the address.
router.post('/library/import', express.raw({ type: 'application/octet-stream', limit: '100mb' }), (req, res) => {
  res.json(LIB.importPicture({ root: q(req, 'root'), rel: q(req, 'rel'), name: q(req, 'name'), data: req.body }));
});

router.post('/library/reveal', (req, res) => res.json(LIB.reveal(b(req).root, b(req).rel)));

module.exports = router;
