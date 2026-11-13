'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PICTURE MODELS (phase 5, the owner's i1: UGC Studio's kie.ai models but seedream) - the ONLY place their field names
// are written. Read on docs.kie.ai on 2026-11-13; prices from each model's kie.ai page the same day (200 credits = $1).
//   nano-banana-2          one id both ways; references `image_input` (up to 10); resolution 1K / 2K / 4K
//   nano-banana-2-lite     references `image_urls` (up to 10); no resolution - one JPEG
//   grok-imagine-image-2   text-to-image, or `image-edit` with `image_urls` (up to 5); no safety switch on the page
//   gpt-image-2.5-sunburst text-to-image, or image-to-image with `input_urls` (16 on kie; the app's ten); 1K / 2K / 4K
// The window offers at most ten references (the owner's i3), fewer when the model takes fewer. The safety check is off
// wherever a model has a switch - none of these four has one, so nothing is sent.
//
//   normalize(body, { enhancer })  the person's choices -> a request (a 400 in words for one that cannot be sent);
//                    `enhancer` false - none is there (no Anthropic key): the words go as they are
//   bodiesOf(req, prompt, urls)  one createTask body per picture asked (×1 · ×2 · ×4 - the owner's i5)
//   priceOf(req)     { usd per picture, total }
// ════════════════════════════════════════════════════════════════════════════

const PRICES_ASOF = '2026-11-13';
const ASPECTS = ['16:9', '9:16', '1:1'];
const COUNTS = [1, 2, 4];
const MAX_REFS = 10;
const MAX_WORDS = 4000;

const MODELS = [
  {
    id: 'nano-banana-2', label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K', refs: 10,
    price: { '1K': 0.04, '2K': 0.06, '4K': 0.09 },
    note: 'Google - sharp, follows words and references well; 1K / 2K / 4K',
    build: ({ prompt, aspect, tier, urls }) => ({
      model: 'nano-banana-2',
      input: Object.assign({ prompt, aspect_ratio: aspect, resolution: tier, output_format: 'jpg' }, urls.length ? { image_input: urls } : {}),
    }),
  },
  {
    id: 'nano-banana-2-lite', label: 'nano-banana-2-lite', tiers: ['standard'], def: 'standard', refs: 10,
    price: { standard: 0.02 },
    note: 'Google, lighter and cheaper - one size',
    build: ({ prompt, aspect, urls }) => ({
      model: 'nano-banana-2-lite',
      input: Object.assign({ prompt, aspect_ratio: aspect }, urls.length ? { image_urls: urls } : {}),
    }),
  },
  {
    id: 'grok-imagine-image-2', label: 'grok-imagine-image-2', tiers: ['standard'], def: 'standard', refs: 5,
    price: { standard: 0.02 },
    note: 'xAI - quick and cheap; up to 5 references',
    build: ({ prompt, aspect, urls }) => (urls.length
      ? { model: 'grok-imagine-image-2-0/image-edit', input: { prompt, image_urls: urls, aspect_ratio: aspect } }
      : { model: 'grok-imagine-image-2-0/text-to-image', input: { prompt, aspect_ratio: aspect } }),
  },
  {
    id: 'gpt-image-2.5-sunburst', label: 'gpt-image-2.5-sunburst', tiers: ['1K', '2K', '4K'], def: '2K', refs: 10,
    price: { '1K': 0.03, '2K': 0.05, '4K': 0.08 },
    note: 'OpenAI - strong with text in the picture and with edits; 1K / 2K / 4K',
    build: ({ prompt, aspect, tier, urls }) => (urls.length
      ? { model: 'gpt-image-2-5-sunburst-image-to-image', input: { prompt, input_urls: urls, aspect_ratio: aspect, resolution: tier } }
      : { model: 'gpt-image-2-5-sunburst-text-to-image', input: { prompt, aspect_ratio: aspect, resolution: tier } }),
  },
];

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const modelOf = (id) => MODELS.find(m => m.id === id) || null;

function _rel(v) {
  const rel = String(v || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!rel || rel.split('/').some(p => p === '.' || p === '..' || !p)) return null;
  return rel;
}

function normalize(body, { enhancer = true } = {}) {
  const b = body || {};
  const m = modelOf(String(b.model || '')) || MODELS[0];
  const refs = [];
  for (const r of Array.isArray(b.refs) ? b.refs : []) {
    const rel = _rel(r && r.rel);
    if (rel && (r.root || 'images') === 'images' && !refs.some(x => x.rel === rel)) refs.push({ root: 'images', rel });
  }
  if (refs.length > Math.min(m.refs, MAX_REFS)) throw bad(m.label + ' takes up to ' + Math.min(m.refs, MAX_REFS) + ' references - take ' + (refs.length - Math.min(m.refs, MAX_REFS)) + ' off');
  const words = String(b.words || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_WORDS);
  const enhance = b.enhance !== false && enhancer;
  if (!words && !(enhance && refs.length)) {
    throw bad(enhance ? 'say in words what the picture is, or give it references'
      : 'say in words what the picture is' + (b.enhance !== false && !enhancer ? ' - the prompt enhancer needs an Anthropic key (API keys)' : ''));
  }
  return {
    model: m.id,
    tier: m.tiers.includes(b.tier) ? b.tier : m.def,
    aspect: ASPECTS.includes(b.aspect) ? b.aspect : '16:9',
    count: COUNTS.includes(+b.count) ? +b.count : 1,
    words,
    refs,
    enhance,
  };
}

function priceOf(req) {
  const m = modelOf(req.model);
  const usd = m.price[req.tier] || 0;
  return { usd, total: Math.round(usd * req.count * 10000) / 10000, asof: PRICES_ASOF };
}

function bodiesOf(req, prompt, urls) {
  const m = modelOf(req.model);
  const body = m.build({ prompt, aspect: req.aspect, tier: req.tier, urls: urls || [] });
  return Array.from({ length: req.count }, () => JSON.parse(JSON.stringify(body)));
}

/** What the page offers. */
function info() {
  return {
    models: MODELS.map(m => ({ id: m.id, label: m.label, tiers: m.tiers, def: m.def, refs: Math.min(m.refs, MAX_REFS), price: m.price, note: m.note })),
    aspects: ASPECTS, counts: COUNTS, pricesAsof: PRICES_ASOF,
  };
}

module.exports = { MODELS, normalize, priceOf, bodiesOf, info, modelOf };
