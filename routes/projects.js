'use strict';

// The timeline's projects (phase 4): listed, made, read, written whole by the page (refused when changed meanwhile),
// renamed, deleted, rendered.

const express = require('express');
const PROJECTS = require('../lib/projects');
const JOBS = require('../lib/jobs');

const router = express.Router();
const b = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.get('/projects', (req, res) => res.json({ projects: PROJECTS.list() }));
router.post('/projects', (req, res) => res.json({ project: PROJECTS.create(b(req).name) }));
router.get('/projects/:id', (req, res) => res.json({ project: PROJECTS.get(req.params.id) }));
router.put('/projects/:id', (req, res) => res.json(PROJECTS.save(req.params.id, b(req))));
router.post('/projects/:id/rename', (req, res) => res.json(PROJECTS.rename(req.params.id, b(req).name)));
router.post('/projects/:id/delete', (req, res) => res.json(PROJECTS.remove(req.params.id)));
router.post('/projects/:id/render', (req, res) => res.json({ job: JOBS.startRender(req.params.id) }));

module.exports = router;
