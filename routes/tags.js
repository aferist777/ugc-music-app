'use strict';

// The tag assistant's routes (phase 2): the chats, a message sent (with its pictures - phase 7), a chat's picked tags
// (phase 9).

const express = require('express');
const STORE = require('../lib/tags-store');

const router = express.Router();
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.get('/tags/chats', (req, res) => res.json({ chats: STORE.list() }));
router.get('/tags/chats/:id', (req, res) => res.json(STORE.get(req.params.id)));
router.post('/tags/send', (req, res) => res.json(STORE.send(b(req).chat || null, b(req).text, b(req).pics)));
router.post('/tags/chats/:id/rename', (req, res) => res.json(STORE.rename(req.params.id, b(req).title)));
router.post('/tags/chats/:id/delete', (req, res) => res.json(STORE.remove(req.params.id)));
router.put('/tags/chats/:id/picked', (req, res) => res.json(STORE.pick(req.params.id, b(req).tags)));

module.exports = router;
