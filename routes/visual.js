'use strict';

// The Images and Animate tabs' routes (phase 5): what each offers, a press (written into the journal at once, done in
// the background - lib/visual.js), the two chats, the person's own pictures shown in the Images chat. Stop, Retry and
// "take it out of the journal" are the journal's own routes (/api/music/jobs/:id/*).

const express = require('express');
const IMAGES = require('../lib/images');
const ANIMATE = require('../lib/animate');
const VISUAL = require('../lib/visual');
const CHATS = require('../lib/visual-chats');
const ENH = require('../lib/enhancer');
const { FAKE } = require('../lib/config');
const { getKey } = require('../lib/settings');

const router = express.Router();
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const keyed = () => {
  if (!FAKE && !getKey('kieApiKey')) throw Object.assign(new Error('there is no kie.ai key - add it in API keys'), { status: 400 });
};

// `enhancer` - is there one (a kie.ai or an Anthropic key): none - the tick is grey and the words go as they are.
router.get('/visual/info', (req, res) => res.json({ images: IMAGES.info(), animate: ANIMATE.info(), fake: FAKE, kie: !!getKey('kieApiKey'), enhancer: ENH.available() }));

// `into` - the folder of Images / Video selected in the library at the press.
router.post('/visual/images/gen', (req, res) => {
  keyed();
  res.json({ job: VISUAL.start('image', IMAGES.normalize(b(req), { enhancer: ENH.available() }), { into: String(b(req).into || '') }) });
});

router.post('/visual/animate/gen', (req, res) => {
  keyed();
  res.json({ job: VISUAL.start('animate', ANIMATE.normalize(b(req), { enhancer: ENH.available() }), { into: String(b(req).into || '') }) });
});

router.get('/visual/chat', (req, res) => res.json({ entries: CHATS.list(String(req.query.kind || '')) }));

// Pictures just brought into Images / Uploads from this computer: one entry of the Images chat.
router.post('/visual/images/uploaded', (req, res) => res.json({ entry: CHATS.addUploads(b(req).rels) }));

module.exports = router;
