'use strict';

// The shell's routes (phase 0): is the server alive and on which library, the keys (set or not - never a value), the
// library's three roots.

const express = require('express');
const fs = require('fs');
const { LIBRARY_DIR, ROOTS, FAKE } = require('../lib/config');
const SETTINGS = require('../lib/settings');
const { version } = require('../package.json');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, version, fake: FAKE, library: LIBRARY_DIR });
});

router.get('/settings/keys', (req, res) => {
  res.json({ keys: SETTINGS.keysView() });
});

router.put('/settings/keys', (req, res) => {
  res.json({ keys: SETTINGS.saveKeys(req.body) });
});

router.get('/library/roots', (req, res) => {
  res.json({
    roots: ROOTS.map(r => ({ id: r.id, label: r.label, exists: fs.existsSync(r.dir) })),
  });
});

module.exports = router;
