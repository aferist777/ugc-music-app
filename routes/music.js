'use strict';

// The Music tab's routes (phase 3): a press of Generate, the journal, the saved song texts.

const express = require('express');
const SUNO = require('../lib/suno');
const JOBS = require('../lib/jobs');
const LYRICS = require('../lib/lyrics-store');
const { FAKE } = require('../lib/config');
const { getKey } = require('../lib/settings');
const ENH = require('../lib/enhancer');

const router = express.Router();
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

// `enhancer` - is there one (a kie.ai or an Anthropic key): none - the Prompt enhancer tick is grey, what is picked goes as it is.
router.get('/music/info', (req, res) => res.json({ models: SUNO.MODELS, prices: SUNO.PRICES, fake: FAKE, kie: !!getKey('kieApiKey'), enhancer: ENH.available() }));

// A press: checked, written into the journal, done in the background. `into` - the Music folder selected at the press.
router.post('/music/gen', (req, res) => {
  const body = b(req);
  if (!FAKE && !getKey('kieApiKey')) throw Object.assign(new Error('there is no kie.ai key - add it in API keys'), { status: 400 });
  const r = SUNO.normalize(String(body.mode || ''), body, { enhancer: ENH.available() });
  res.json({ job: JOBS.start(r, { into: String(body.into || '') }) });
});

router.get('/music/jobs', (req, res) => res.json({ jobs: JOBS.list(req.query.limit) }));
router.get('/music/jobs/:id', (req, res) => res.json({ job: JOBS.get(req.params.id) }));
router.post('/music/jobs/:id/stop', (req, res) => res.json({ job: JOBS.stop(req.params.id) }));
router.post('/music/jobs/:id/retry', (req, res) => res.json({ job: JOBS.retry(req.params.id) }));
router.post('/music/jobs/:id/forget', (req, res) => res.json(JOBS.forget(req.params.id)));

router.get('/music/lyrics', (req, res) => res.json({ items: LYRICS.list() }));
router.post('/music/lyrics', (req, res) => res.json(LYRICS.add(b(req))));
router.post('/music/lyrics/:id/rename', (req, res) => res.json(LYRICS.rename(req.params.id, b(req).title)));
router.post('/music/lyrics/:id/delete', (req, res) => res.json(LYRICS.remove(req.params.id)));

module.exports = router;
