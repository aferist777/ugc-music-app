'use strict';

// The tag assistant's routes (phase 2): the chats, a message sent, the Mix, which models can be asked.

const express = require('express');
const STORE = require('../lib/tags-store');
const AGENT = require('../lib/tags-agent');

const router = express.Router();
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.get('/tags/steps', (req, res) => res.json({ steps: AGENT.steps() }));
router.get('/tags/chats', (req, res) => res.json({ chats: STORE.list() }));
router.get('/tags/chats/:id', (req, res) => res.json(STORE.get(req.params.id)));
router.post('/tags/send', (req, res) => res.json(STORE.send(b(req).chat || null, b(req).text)));
router.post('/tags/chats/:id/rename', (req, res) => res.json(STORE.rename(req.params.id, b(req).title)));
router.post('/tags/chats/:id/delete', (req, res) => res.json(STORE.remove(req.params.id)));
router.get('/tags/mix', (req, res) => res.json({ tags: STORE.getMix() }));
router.put('/tags/mix', (req, res) => res.json({ tags: STORE.setMix(b(req).tags) }));

module.exports = router;
