'use strict';

// ════════════════════════════════════════════════════════════════════════════
// KIE.AI'S COMMON DOORS (phase 5; the jobs part moved here from lib/suno.js) - every paid generation of the app is a task
// of kie.ai's jobs API, and every picture of the library reaches it by a link of kie's own file upload (no R2 - phase 5).
//
//   createTask(body)    POST /api/v1/jobs/createTask -> its task number. A failure says `unsure` when kie may have
//                       started the task all the same (no answer, a 5xx, a 200 without a number) - PAID ONCE: such a
//                       press is never asked again by itself; `refused` when the words were refused.
//   recordInfo(taskId)  GET /api/v1/jobs/recordInfo -> the task's `data` (state waiting | queuing | generating |
//                       success | fail); throws when kie did not answer about it - a poll turned away is not a failure.
//   resultUrls(data)    the files a finished picture or clip task made (resultJson.resultUrls).
//   upload(abs, name)   a file of this computer -> a public link kie's models read. kie deletes it after 24 hours
//                       (docs.kie.ai, 2026-11-13), so a link is used again only within 20 hours (cache/kie-uploads.json).
//                       Free, so a failed upload is simply tried again by the next press.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE_DIR } = require('./config');
const { getKey } = require('./settings');
const { writeJsonAtomic } = require('./atomic-write');

const KIE = 'https://api.kie.ai';
// The file upload's own host - the one kie's quickstart and its examples name (docs.kie.ai/file-upload-api, 2026-11-13).
const UPLOAD = 'https://kieai.redpandaai.co/api/file-stream-upload';
const UPLOAD_PATH = 'ugc-music-studio';
const LINK_LIFE = 20 * 3600 * 1000;
const LINKS = path.join(CACHE_DIR, 'kie-uploads.json');

const MODERATION = [/sensitive/i, /flagged/i, /SENSITIVE_WORD/, /moderat/i, /\bnsfw\b/i, /content (security |risk )?(policy|control|filter)/i, /artist name/i, /rephras/i, /violat/i, /not allowed/i];
const isRefusal = (s) => MODERATION.some(re => re.test(String(s || '')));
// A request that provably never left this computer.
const NEVER_LEFT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function said(d) {
  if (!d) return '';
  return String(d.msg || d.message || (d.error && (d.error.message || d.error)) || '').trim().slice(0, 300);
}

function _key() {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(new Error('there is no kie.ai key - add it in API keys'), { unsure: false });
  return key;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

async function createTask(body) {
  const key = _key();
  let r;
  try {
    r = await fetch(KIE + '/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    const code = e && e.cause && e.cause.code;
    const left = !NEVER_LEFT.has(code);
    throw Object.assign(new Error('kie.ai ' + (left ? 'did not answer whether it started it' : 'could not be reached')), { unsure: left });
  }
  let d = null;
  try { d = await r.json(); } catch { /* no JSON */ }
  if (r.status >= 500) throw Object.assign(new Error('kie.ai answered ' + r.status + ' - it may have started it all the same'), { unsure: true });
  if (!r.ok) {
    const words = said(d) || 'status ' + r.status;
    throw Object.assign(new Error('kie.ai did not start it: ' + words), { unsure: false, refused: isRefusal(words) });
  }
  const code = d ? +d.code : NaN;
  const taskId = d && d.data && d.data.taskId;
  if (code === 200 && taskId) return String(taskId);
  const words = said(d) || 'code ' + (d && d.code != null ? d.code : '?');
  // kie's own 500 inside a 200, or a 200 with no number: it may have started the task.
  const unsure = !d || code === 200 || code === 500 || !d.code;
  throw Object.assign(new Error('kie.ai ' + (unsure ? 'did not say whether it started it: ' : 'did not start it: ') + words),
    { unsure, refused: !unsure && isRefusal(words) });
}

async function recordInfo(taskId) {
  const r = await fetch(KIE + '/api/v1/jobs/recordInfo?taskId=' + encodeURIComponent(taskId), {
    headers: { Authorization: 'Bearer ' + getKey('kieApiKey') }, signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => null);
  if (!body || +body.code !== 200 || !body.data) throw new Error('kie.ai did not answer about the task: ' + (said(body) || r.status));
  return body.data;
}

function parse(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function resultUrls(data) {
  const j = parse(data.resultJson) || parse(data.response) || {};
  const list = Array.isArray(j.resultUrls) ? j.resultUrls : Array.isArray(j.result_urls) ? j.result_urls : [];
  return list.map(String).filter(u => /^https?:\/\//.test(u));
}

/** A task's state in the app's words: pending (with a stage), success (its urls) or failed (refused or not). */
async function look(taskId) {
  const data = await recordInfo(taskId);
  const state = String(data.state || '').toLowerCase();
  if (state === 'success') {
    const urls = resultUrls(data);
    return urls.length ? { state: 'success', urls, credits: +data.creditsConsumed || null } : { state: 'pending', stage: 'finished - waiting for the file' };
  }
  if (state === 'fail' || state === 'failed') {
    const error = String(data.failMsg || data.errorMessage || 'failed (' + (data.failCode || '?') + ')').slice(0, 400);
    return { state: 'failed', error, refused: isRefusal(error) };
  }
  return { state: 'pending', stage: state === 'generating' ? 'being made' : 'in kie.ai\'s queue' };
}

// ── Upload ──────────────────────────────────────────────────────────────────

function _links() {
  try { return JSON.parse(fs.readFileSync(LINKS, 'utf8')) || {}; } catch { return {}; }
}

async function upload(abs) {
  const st = fs.statSync(abs);
  const id = crypto.createHash('sha1').update(abs + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 20);
  const links = _links();
  const known = links[id];
  if (known && Date.now() - known.at < LINK_LIFE) return known.url;
  const key = _key();
  const fileName = id + path.extname(abs).toLowerCase();
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(abs)]), fileName);
  fd.append('uploadPath', UPLOAD_PATH);
  fd.append('fileName', fileName);
  let r;
  try {
    r = await fetch(UPLOAD, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal: AbortSignal.timeout(120000) });
  } catch (e) {
    throw new Error('the picture could not be sent to kie.ai (' + (e && e.name === 'TimeoutError' ? 'no answer in time' : 'no connection') + ')');
  }
  const d = await r.json().catch(() => null);
  const url = d && d.data && (d.data.downloadUrl || d.data.fileUrl || d.data.url);
  if (!r.ok || !d || !(d.success === true || +d.code === 200) || !url) {
    throw new Error('kie.ai did not take the picture: ' + (said(d) || 'status ' + r.status));
  }
  // Links older than their life are dropped as the store is written.
  const now = Date.now();
  const kept = {};
  for (const [k, v] of Object.entries(links)) if (now - v.at < LINK_LIFE) kept[k] = v;
  kept[id] = { url: String(url), at: now };
  try { writeJsonAtomic(LINKS, kept); } catch { /* asked again next time */ }
  return String(url);
}

module.exports = { createTask, recordInfo, look, upload, isRefusal, said, parse };
