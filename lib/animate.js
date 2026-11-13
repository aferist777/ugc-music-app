'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE CLIP MODELS (phase 5) - a picture brought to life. The ONLY place their field names are written; read on
// docs.kie.ai on 2026-11-13, prices from kie.ai's pages the same day.
//   Grok 1.5 (the owner's i9)     grok-imagine-video-1-5-preview: the picture as `image_urls` [one] - the clip's start
//                                 and its shape (UGC Studio's paid runs V10.1); 1-15 s, 480p / 720p / 1080p, its own
//                                 sound always (the timeline does not play it - T5); `nsfw_checker: false`.
//   Kling 3.0 (the owner, 2026-11-13: "Kling 3.0 for the start and end frames" - Seedance 2.0 mini's loop came back to
//                                 nothing, i16)   kling-3.0/video: `image_urls` [first, last] (one - the first only),
//                                 `multi_shots: false`, `mode` std / pro / 4K = 720p / 1080p / 4K, `duration` a STRING
//                                 "3".."15", `sound: false` (the timeline does not play a clip's sound - T5; with it
//                                 dearer), no `aspect_ratio` - the clip takes the first frame's shape; the prompt up to
//                                 2500 characters; frames jpg / png up to 10 MB, 300 px a side at least, 1:2.5..2.5:1.
//                                 LOOP ticked sends the start frame as the last too. No safety switch - nothing sent.
//
//   normalize(body, { enhancer })  -> a request (a 400 in words for one that cannot be sent); `enhancer` false - none
//                    is there (no kie.ai or Anthropic key): the person's words go as they are
//   framesOf(req)    the library pictures it sends, in order (start, then last)
//   bodyOf(req, prompt, urls)  the createTask body
//   priceOf(req)     { usd per second, total }
// ════════════════════════════════════════════════════════════════════════════

const PRICES_ASOF = '2026-11-13';
const MAX_WORDS = 2000;
const KLING_MODE = { '720p': 'std', '1080p': 'pro', '4K': '4K' };

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
    id: 'kling-3.0', label: 'Kling 3.0', dur: { min: 3, max: 15, def: 5 }, res: ['720p', '1080p', '4K'], resDef: '720p',
    price: { '720p': 0.0755, '1080p': 0.101, '4K': 0.3775 }, loop: true,
    limits: { maxMb: 10, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5], types: ['.jpg', '.jpeg', '.png'] },
    note: 'Kuaishou - a first and a last frame: Loop makes a clip that comes back to its start; 3-15 s, no sound',
    build: ({ prompt, urls, dur, res }) => ({
      model: 'kling-3.0/video',
      input: {
        prompt: prompt.slice(0, 2500), image_urls: urls[1] ? [urls[0], urls[1]] : [urls[0]],
        sound: false, duration: String(dur), mode: KLING_MODE[res], multi_shots: false,
      },
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

function normalize(body, { enhancer = true } = {}) {
  const b = body || {};
  const m = modelOf(String(b.model || '')) || MODELS[0];
  const start = _pic(b.start);
  if (!start) throw bad('pick a start frame - Animate under a picture in Images, or a picture\'s right button on the timeline');
  const loop = m.loop && b.loop !== false;
  const last = m.loop && !loop ? _pic(b.last) : null;
  const d = Math.round(+b.duration);
  const words = String(b.words || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_WORDS);
  // Loop on: the loop agent writes the prompt by itself - the Prompt enhancer tick rests (phase 6, the owner's P9).
  const enhance = (loop || b.enhance !== false) && enhancer;
  if (!enhance && words.length < 3) {
    throw bad('say in words how it moves' + ((loop || b.enhance !== false) && !enhancer ? ' - the ' + (loop ? 'loop agent' : 'prompt enhancer') + ' needs a kie.ai or an Anthropic key (API keys)' : ''));
  }
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
