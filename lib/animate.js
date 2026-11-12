'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE CLIP MODELS (phase 5) - a picture brought to life. The ONLY place their field names are written; read on
// docs.kie.ai on 2026-11-13, prices from kie.ai's pages the same day.
//   Grok 1.5 (the owner's i9)     grok-imagine-video-1-5-preview: the picture as `image_urls` [one] - the clip's start
//                                 and its shape (UGC Studio's paid runs V10.1); 1-15 s, 480p / 720p / 1080p, its own
//                                 sound always (the timeline does not play it - T5); `nsfw_checker: false`.
//   Seedance 2.0 mini (i12)       bytedance/seedance-2-mini: `first_frame_url`, `last_frame_url` - LOOP ticked sends the
//                                 start frame as the last too (a clip that comes back to where it began); 4-15 s, 480p /
//                                 720p, the shape the picture's (`adaptive`), no sound of its own, `nsfw_checker: false`.
//
//   normalize(body)  -> a request (a 400 in words for one that cannot be sent)
//   framesOf(req)    the library pictures it sends, in order (start, then last)
//   bodyOf(req, prompt, urls)  the createTask body
//   priceOf(req)     { usd per second, total }
// ════════════════════════════════════════════════════════════════════════════

const PRICES_ASOF = '2026-11-13';
const MAX_WORDS = 2000;

const MODELS = [
  {
    id: 'grok-1.5', label: 'Grok 1.5', dur: { min: 1, max: 15, def: 6 }, res: ['480p', '720p', '1080p'], resDef: '720p',
    price: { '480p': 0.012, '720p': 0.0225, '1080p': 0.04 }, loop: false,
    limits: { maxMb: 20, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5] },
    note: 'xAI - lively motion, makes its own sound; 1-15 s',
    build: ({ prompt, urls, dur, res }) => ({
      model: 'grok-imagine-video-1-5-preview',
      input: { prompt, image_urls: [urls[0]], duration: dur, resolution: res, nsfw_checker: false },
    }),
  },
  {
    id: 'seedance-2-mini', label: 'Seedance 2.0 mini', dur: { min: 4, max: 15, def: 5 }, res: ['480p', '720p'], resDef: '720p',
    price: { '480p': 0.019, '720p': 0.041 }, loop: true,
    limits: { maxMb: 30, minPx: 301, maxPx: 5999, ratio: [0.4, 2.5] },
    note: 'ByteDance - a first and a last frame: Loop makes a clip that comes back to its start; 4-15 s',
    build: ({ prompt, urls, dur, res }) => ({
      model: 'bytedance/seedance-2-mini',
      input: Object.assign(
        { prompt, first_frame_url: urls[0], duration: dur, resolution: res, aspect_ratio: 'adaptive', generate_audio: false, nsfw_checker: false },
        urls[1] ? { last_frame_url: urls[1] } : {},
      ),
    }),
  },
];

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const modelOf = (id) => MODELS.find(m => m.id === id) || null;

function _pic(v) {
  if (!v || typeof v !== 'object') return null;
  const rel = String(v.rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!rel || rel.split('/').some(p => p === '.' || p === '..' || !p) || (v.root || 'images') !== 'images') return null;
  return { root: 'images', rel };
}

function normalize(body) {
  const b = body || {};
  const m = modelOf(String(b.model || '')) || MODELS[0];
  const start = _pic(b.start);
  if (!start) throw bad('pick a start frame - Animate under a picture in Images, or a picture\'s right button on the timeline');
  const loop = m.loop && b.loop !== false;
  const last = m.loop && !loop ? _pic(b.last) : null;
  const d = Math.round(+b.duration);
  const words = String(b.words || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_WORDS);
  const enhance = b.enhance !== false;
  if (!enhance && words.length < 3) throw bad('say in words how it moves');
  return {
    model: m.id,
    duration: Number.isFinite(d) ? Math.max(m.dur.min, Math.min(m.dur.max, d)) : m.dur.def,
    resolution: m.res.includes(b.resolution) ? b.resolution : m.resDef,
    start, last, loop, words, enhance,
  };
}

function framesOf(req) {
  return [req.start].concat(req.last ? [req.last] : []);
}

function priceOf(req) {
  const m = modelOf(req.model);
  const usd = m.price[req.resolution] || 0;
  return { usd, total: Math.round(usd * req.duration * 10000) / 10000, asof: PRICES_ASOF };
}

/** `urls`: the start frame's link, then the last frame's (Loop: the start's again). */
function bodyOf(req, prompt, urls) {
  const m = modelOf(req.model);
  const links = req.loop ? [urls[0], urls[0]] : urls;
  return m.build({ prompt, urls: links, dur: req.duration, res: req.resolution });
}

function info() {
  return {
    models: MODELS.map(m => ({ id: m.id, label: m.label, dur: m.dur, res: m.res, resDef: m.resDef, price: m.price, loop: m.loop, note: m.note })),
    pricesAsof: PRICES_ASOF,
  };
}

module.exports = { MODELS, normalize, framesOf, priceOf, bodyOf, info, modelOf };
