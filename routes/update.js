'use strict';

// Updates from GitHub (phase 8): what is known, ask now, update to the newest release, restart on it (lib/updates.js).

const express = require('express');
const UPD = require('../lib/updates');

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/update', (req, res) => res.json(UPD.state()));
router.post('/update/check', a(async (req, res) => res.json(await UPD.check())));
router.post('/update/apply', (req, res) => res.json(UPD.apply()));
router.post('/update/restart', (req, res) => res.json(UPD.restart()));

module.exports = router;
