'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SUNO THROUGH KIE.AI (phase 3) - the ONLY place Suno's field names are written (UGC Studio's lib/audio-engines.js, the
// Suno part; kie.ai's jobs API, docs 2026-10-22). POST /api/v1/jobs/createTask { model: 'ai-music-api/<mode>', input },
// polled with GET /api/v1/jobs/recordInfo?taskId= (state waiting | queuing | generating | success | fail); HTTP is 200
// even for a refusal - the body's `code` says. Models V6, V6_MINI, V6_WILD. A generate makes TWO tracks (12 credits,
// $0.06); lyrics 0.4 credits (200 credits = $1).
//
//   normalize(mode, body)  the person's choices -> a request (a 400 in words for one that cannot be sent)
//   bodyOf(req, written)   the createTask body - `written`: what the enhancer wrote for Simple and Custom
//   create(body)           -> taskId; a failure says `unsure` when it may have started the task all the same
//   poll(taskId, kind)     -> { state: pending | success | failed, tracks?, lyrics?, error?, refused?, stage? }
// ════════════════════════════════════════════════════════════════════════════

const { getKey } = require('./settings');

const KIE = 'https://api.kie.ai';
const MODELS = ['V6', 'V6_MINI', 'V6_WILD'];
const PRICES = {
  simple: { credits: 12, usd: 0.06, note: 'two tracks' },
  custom: { credits: 12, usd: 0.06, note: 'two tracks' },
  lyrics: { credits: 0.4, usd: 0.002, note: '2-3 texts' },
};
// Simple's knobs: the written style held, a little freedom, Suno not rewriting it (variety 0 - at kie's 1, V6 REWRITES
// the style first; UGC Studio's V34.A research).
const SIMPLE_KNOBS = { style_weight: 0.7, weirdness_constraint: 0.35, variety: 0 };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const _s = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, n);
const _num = (v, lo, hi) => {
  if (v === '' || v == null) return null;
  const n = +v;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};
const _round = (n, k) => Math.round(n * k) / k;

function normalize(mode, body) {
  const b = body || {};
  if (!PRICES[mode]) throw bad('no such mode: ' + mode);
  const out = { mode };
  const model = MODELS.includes(String(b.model)) ? String(b.model) : 'V6';
  if (mode === 'simple') {
    out.chips = {};
    for (const g of ['genre', 'mood', 'sound']) out.chips[g] = (Array.isArray(b.chips && b.chips[g]) ? b.chips[g] : []).map(c => _s(c, 40)).filter(Boolean).slice(0, 8);
    out.mix = (Array.isArray(b.mix) ? b.mix : []).map(t => _s(t, 40).toLowerCase()).filter(Boolean).slice(0, 30);
    out.words = _s(b.words, 1000);
    out.instrumental = b.instrumental !== false;
    out.about = out.instrumental ? '' : _s(b.about, 400);
    const any = Object.values(out.chips).some(l => l.length) || out.mix.length || out.words || out.about;
    if (!any) throw bad('pick a chip, use your Mix or say in words what the music is');
    // Length: Suno's custom mode only (an instrumental here); 0 - the model decides.
    const sec = +b.seconds;
    out.seconds = out.instrumental && sec > 0 ? Math.round(Math.max(10, Math.min(360, sec))) : 0;
    out.writer = b.writer !== false;
    out.model = model;
    return out;
  }
  if (mode === 'custom') {
    out.title = _s(b.title, 80);
    if (!out.title) throw bad('a title is needed (up to 80 characters)');
    out.style = _s(b.style, 1000);
    out.instrumental = !!b.instrumental;
    const lyrics = String(b.lyrics || '').replace(/\r\n/g, '\n').trim();
    if (lyrics.length > 5000) throw bad('the lyrics are ' + lyrics.length + ' characters - Suno V6 takes up to 5000');
    out.lyrics = out.instrumental ? '' : lyrics;
    out.negative = _s(b.negative, 500);
    if (!out.style && !out.lyrics && !out.negative) throw bad('write a style, lyrics or what to avoid - Suno needs one of them');
    out.vocal = !out.instrumental && (b.vocal === 'm' || b.vocal === 'f') ? b.vocal : '';
    out.styleWeight = _num(b.styleWeight, 0, 1);
    out.weirdness = _num(b.weirdness, 0, 1);
    out.variety = b.variety === '' || b.variety == null ? 0 : Math.round(_num(b.variety, 0, 4) || 0);
    const sec = +b.seconds;
    out.seconds = sec > 0 ? Math.round(Math.max(10, Math.min(360, sec))) : 0;
    out.writer = b.writer === true;
    out.model = model;
    return out;
  }
  out.idea = _s(b.idea, 200);
  if (!out.idea) throw bad('say what the song is about (up to 200 characters)');
  return out;
}

/** The enhancer's task for a request, or null when nothing is written. */
function taskOf(req) {
  if (req.mode === 'simple') return req.instrumental ? 'instrumental' : 'song';
  if (req.mode === 'custom' && req.writer) return 'custom';
  return null;
}

function bodyOf(req, written) {
  const r = req || {};
  const w = written || {};
  if (r.mode === 'lyrics') return { model: 'ai-music-api/generate-lyrics', input: { prompt: r.idea } };
  if (r.mode === 'simple' && !r.instrumental) {
    // A song: Suno's mode without custom - it writes the lyrics itself from the description (the owner's C2).
    return { model: 'ai-music-api/generate', input: { custom_mode: false, instrumental: false, model: r.model, prompt: String(w.prompt || '').slice(0, 500) } };
  }
  const simple = r.mode === 'simple';
  const instrumental = simple ? true : !!r.instrumental;
  const input = {
    custom_mode: true,
    instrumental,
    model: r.model || 'V6',
    title: String((simple ? w.title : r.title) || 'Untitled').slice(0, 80),
  };
  const style = simple || r.writer ? w.style : r.style;
  const negative = simple || r.writer ? w.negative : r.negative;
  if (style) input.style = String(style).slice(0, 1000);
  if (!instrumental && r.lyrics) input.lyrics = String(r.lyrics).slice(0, 5000);
  if (negative) input.negative_tags = String(negative).slice(0, 500);
  if (!instrumental && r.vocal) input.vocal_gender = r.vocal;
  if (simple) Object.assign(input, SIMPLE_KNOBS);
  else {
    if (r.styleWeight != null) input.style_weight = _round(+r.styleWeight, 100);
    if (r.weirdness != null) input.weirdness_constraint = _round(+r.weirdness, 100);
    input.variety = Math.round(+r.variety || 0);
  }
  if (r.seconds) input.duration = r.seconds;
  return { model: 'ai-music-api/generate', input };
}

// ── Asking ──────────────────────────────────────────────────────────────────

const MODERATION = [/sensitive/i, /flagged/i, /SENSITIVE_WORD/, /moderat/i, /\bnsfw\b/i, /content (security |risk )?(policy|control|filter)/i, /artist name/i, /rephras/i];
const isRefusal = (s) => MODERATION.some(re => re.test(String(s || '')));
// A request that provably never left this computer.
const NEVER_LEFT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function _said(d) {
  if (!d) return '';
  return String(d.msg || d.message || (d.error && (d.error.message || d.error)) || '').trim().slice(0, 300);
}

async function create(body) {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(new Error('there is no kie.ai key - add it in API keys'), { unsure: false });
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
    const words = _said(d) || 'status ' + r.status;
    throw Object.assign(new Error('kie.ai did not start it: ' + words), { unsure: false, refused: isRefusal(words) });
  }
  const code = d ? +d.code : NaN;
  const taskId = d && d.data && d.data.taskId;
  if (code === 200 && taskId) return String(taskId);
  const words = _said(d) || 'code ' + (d && d.code != null ? d.code : '?');
  // kie's own 500 inside a 200, or a 200 with no number: it may have started the task.
  const unsure = !d || code === 200 || code === 500 || !d.code;
  throw Object.assign(new Error('kie.ai ' + (unsure ? 'did not say whether it started it: ' : 'did not start it: ') + words),
    { unsure, refused: !unsure && isRefusal(words) });
}

function _parse(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function _tracksOf(data) {
  const resp = _parse(data.response) || _parse(data.resultJson) || {};
  const lists = [resp.data, resp.sunoData, resp.tracks, resp.resultObject && resp.resultObject.data,
    resp.data && resp.data.data, resp.response && resp.response.sunoData];
  const list = lists.find(l => Array.isArray(l) && l.length) || [];
  return list.map(t => ({
    url: String((t && (t.audio_url || t.audioUrl || t.source_audio_url || t.sourceAudioUrl)) || ''),
    dur: +((t && t.duration) || 0) || 0,
    title: String((t && t.title) || ''),
    id: String((t && t.id) || ''),
    tags: String((t && t.tags) || ''),
    lyrics: String((t && (t.prompt || t.lyric || t.lyrics)) || '').slice(0, 6000),
  })).filter(t => t.url);
}

function _lyricsOf(data) {
  const resp = _parse(data.response) || _parse(data.resultJson) || {};
  const lists = [resp.resultObject && resp.resultObject.lyricsData, resp.lyricsData, resp.data, resp.resultObject && resp.resultObject.data];
  const list = lists.find(l => Array.isArray(l) && l.length) || [];
  return list.filter(x => x && x.text && String(x.status || 'complete') !== 'failed')
    .map(x => ({ title: String(x.title || '').slice(0, 120), text: String(x.text || '').slice(0, 6000) }));
}

/** One look at a task. Throws when kie did not answer about it - a poll turned away is not a failed task. */
async function poll(taskId, kind) {
  const r = await fetch(KIE + '/api/v1/jobs/recordInfo?taskId=' + encodeURIComponent(taskId), {
    headers: { Authorization: 'Bearer ' + getKey('kieApiKey') }, signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => null);
  if (!body || +body.code !== 200 || !body.data) throw new Error('kie.ai did not answer about the task: ' + (_said(body) || r.status));
  const data = body.data;
  const state = String(data.state || '').toLowerCase();
  if (state === 'success') {
    if (kind === 'lyrics') {
      const lyrics = _lyricsOf(data);
      return lyrics.length ? { state: 'success', lyrics } : { state: 'failed', error: 'kie.ai finished the task with no lyrics in it' };
    }
    const tracks = _tracksOf(data);
    return tracks.length ? { state: 'success', tracks } : { state: 'pending', stage: 'finished - waiting for the files' };
  }
  if (state === 'fail' || state === 'failed') {
    const error = String(data.failMsg || data.errorMessage || 'failed (' + (data.failCode || '?') + ')').slice(0, 400);
    return { state: 'failed', error, refused: isRefusal(error) };
  }
  return { state: 'pending', stage: state === 'generating' ? 'Suno is making it' : 'in kie.ai\'s queue' };
}

module.exports = { MODELS, PRICES, normalize, taskOf, bodyOf, create, poll };
