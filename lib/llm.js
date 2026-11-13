'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE MODELS' LADDER (phase 2, shared since phase 3) - every text agent of the app asks through it: the tag assistant
// (lib/tags-agent.js, with web search where a step has it, and the pictures the person attached), Suno's prompt
// enhancer (lib/suno-writer.js), the pictures' and clips' enhancer and the loop agent (lib/enhancer.js - they SEE the
// pictures). ONE LADDER for all of them (the owner, 2026-11-13, phase 7: "Kimi and DeepSeek - they are really cheap -
// first in the queue, then Claude if there is a key, and on"; K2 "the same ladder"):
//
//   Kimi K3.1 Pro (kie)  ->  DeepSeek V4.1 Flash (kie)  ->  Claude Sonnet 5.5 (Anthropic key)  ->  GPT 6.1 Terra (kie)
//
// Kimi and DeepSeek have no web search (kie ignores the tool) - they answer from what they know; Claude and Terra search.
// Every step SEES pictures (probed 2026-11-13: a 512 px JPEG as base64 - Kimi 0.14 credits, DeepSeek 0.07, Terra 0.04).
// THE NEXT STEP IS ASKED AFTER ANY FAILURE (the owner's K4): no key, a refusal, a 4xx / 5xx, a dropped connection, an
// answer that broke off, or SILENCE - a step that sends nothing for 60 s is let go (kie's Gemini 3.8 answered 503 after
// 45 s). A wasted call costs a fraction of a cent. No key at all - nothing is asked.
//
// Probes (2026-11-13, the owner's K3, $0.0095 in all): a short JSON answer - Kimi K3.1 Pro 2.3-3.9 s 0.06-0.07 credits,
// DeepSeek V4.1 Flash 1.4 s 0.01, Terra 2.5-4.5 s 0.01-0.03 (Kimi K3 three times Kimi K3.1 Pro's price - not taken).
// All four kept to the JSON asked for. Terra searches with {"type":"web_search"} and MUST be streamed (phase 2).
//
//   ask({ system, turns, search, effort, maxTokens, onStage })
//     -> { ok: true, raw, sources, by: { step, label, model, searches, usd }, tried } | { ok: false, error, tried }
//   turns    [{ role: 'user'|'assistant', content: string, images?: [{ data: base64, type }] }]   the person's last
//   effort   'low' | 'medium'
//   onStage  ({ stage, searches, step })      what the page shows while it waits
//   hasAny() - is there a key for any step (kie.ai or Anthropic)
// ════════════════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk');
const { getKey } = require('./settings');

// MUSIC_KIE_BASE - another address for kie.ai (the free checks' own stand-in), never set in use.
const KIE = process.env.MUSIC_KIE_BASE || 'https://api.kie.ai';
const TIMEOUT = 240000;
const SILENCE = +process.env.MUSIC_LLM_SILENCE_MS || 60000;
const MAX_SEARCHES = 5;

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const failed = (msg, extra) => Object.assign(new Error(msg), extra || {});

// A step's watch: its request is let go after SILENCE ms with no word from it, or TIMEOUT ms in all.
function _watch() {
  const ctl = new AbortController();
  let why = '';
  const all = setTimeout(() => { why = 'no answer in ' + Math.round(TIMEOUT / 1000) + ' s'; ctl.abort(); }, TIMEOUT);
  let quiet = null;
  const ping = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => { why = 'no word for ' + Math.round(SILENCE / 1000) + ' s'; ctl.abort(); }, SILENCE);
  };
  ping();
  return {
    signal: ctl.signal, ping, why: () => why,
    stop: () => { clearTimeout(all); clearTimeout(quiet); },
  };
}

// ── Claude (Anthropic) ──────────────────────────────────────────────────────

// $ per million tokens; a refusal may be answered by another Claude model (fallbacks), priced by the model that served.
const CLAUDE_PRICE = {
  'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5': [2, 10], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25],
};
const CLAUDE_MODEL = 'claude-sonnet-5-5';

// A turn as Claude takes it: the pictures first, each named "Image n:", the words after them.
function _claudeTurn(t) {
  if (!t.images || !t.images.length) return { role: t.role, content: t.content };
  const content = [];
  t.images.forEach((im, i) => {
    content.push({ type: 'text', text: 'Image ' + (i + 1) + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.type || 'image/jpeg', data: im.data } });
  });
  content.push({ type: 'text', text: t.content || '(no words - the picture alone)' });
  return { role: t.role, content };
}

async function _claude(q, onStage) {
  const apiKey = getKey('anthropicApiKey');
  if (!apiKey) throw failed('no Anthropic key', { skip: true });
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT });
  const base = {
    model: CLAUDE_MODEL,
    max_tokens: q.maxTokens || 16000,
    system: q.system,
    output_config: { effort: q.effort === 'low' ? 'low' : 'medium' },
    // A refusal is answered by another Claude model on Anthropic's side (their recommended default).
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  if (q.search) base.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }];
  const turns = q.turns.map(_claudeTurn);
  let messages = turns;
  const content = [];
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  let final = null;
  let searches = 0;
  const w = _watch();
  try {
    // A long turn of server tools may pause (`pause_turn`): it is handed back and goes on, at most a few times.
    for (let round = 0; round < 4; round++) {
      const stream = client.beta.messages.stream(Object.assign({}, base, { messages }), { signal: w.signal });
      for await (const ev of stream) {
        w.ping();
        if (ev.type !== 'content_block_start') continue;
        const t = ev.content_block && ev.content_block.type;
        if (t === 'server_tool_use') onStage({ stage: 'searching the web', searches: ++searches });
        else if (t === 'text') onStage({ stage: 'writing', searches });
      }
      final = await stream.finalMessage();
      content.push(...final.content);
      const u = final.usage || {};
      usage.in += u.input_tokens || 0;
      usage.out += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0;
      usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      if (final.stop_reason !== 'pause_turn') break;
      messages = turns.concat([{ role: 'assistant', content: final.content }]);
    }
  } catch (e) {
    if (w.why()) throw failed(w.why());
    if (e instanceof Anthropic.APIConnectionError) throw failed(e instanceof Anthropic.APIConnectionTimeoutError ? 'no answer in time' : 'the connection dropped');
    if (e instanceof Anthropic.AuthenticationError) throw failed('the Anthropic key was refused - check it in API keys');
    if (e instanceof Anthropic.APIError) {
      const said = e.error && e.error.error && e.error.error.message;
      throw failed('Claude ' + (e.status || '') + (said ? ': ' + said : ''));
    }
    throw e;
  } finally {
    w.stop();
  }
  if (final.stop_reason === 'refusal') throw failed('Claude declined');
  if (final.stop_reason === 'max_tokens') throw failed('Claude\'s answer was cut off');
  const raw = content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!raw.trim()) throw failed('Claude answered nothing');
  // Sources: what the text cites; else the search results it read.
  const sources = [];
  const seen = new Set();
  const add = (url, title) => { if (url && !seen.has(url) && sources.length < 12) { seen.add(url); sources.push({ url, title: clean(title || url, 140) }); } };
  for (const b of content) for (const c of (b.type === 'text' && b.citations) || []) add(c.url, c.title);
  if (!sources.length) {
    for (const b of content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) add(r.url, r.title);
  }
  const model = final.model || CLAUDE_MODEL;
  const [pin, pout] = CLAUDE_PRICE[model] || CLAUDE_PRICE[CLAUDE_MODEL];
  const usd = (usage.in * pin + usage.out * pout + usage.cacheRead * pin * 0.1 + usage.cacheWrite * pin * 1.25) / 1e6 + usage.searches * 0.01;
  return { raw, sources, by: { step: 'claude', model, searches: usage.searches, usd } };
}

// ── kie.ai: the OpenAI Responses door (Kimi, DeepSeek - /openai; GPT - /codex) ─────────────────────────────

// A turn as the Responses door takes it: the pictures as data URLs, each named "Image n:", the words after them.
function _responsesTurn(t) {
  if (!t.images || !t.images.length) return { role: t.role, content: t.content };
  const content = [];
  t.images.forEach((im, i) => {
    content.push({ type: 'input_text', text: 'Image ' + (i + 1) + ':' });
    content.push({ type: 'input_image', image_url: 'data:' + (im.type || 'image/jpeg') + ';base64,' + im.data });
  });
  content.push({ type: 'input_text', text: t.content || '(no words - the picture alone)' });
  return { role: t.role, content };
}

/**
 * One kie.ai step on the Responses door. `effort` maps the app's low / medium to the model's own words; `search` -
 * the step can search the web ({"type":"web_search"}). Streamed: Server-Sent Events, the last one response.completed
 * with the whole response and kie's credits (200 credits = $1).
 */
function _kieStep({ id, label, path, model, effort, search }) {
  return async (q, onStage) => {
    const key = getKey('kieApiKey');
    if (!key) throw failed('no kie.ai key', { skip: true });
    onStage({ stage: 'thinking', searches: 0 });
    const body = {
      model, instructions: q.system, input: q.turns.map(_responsesTurn),
      reasoning: { effort: effort[q.effort === 'low' ? 'low' : 'medium'] }, stream: true,
    };
    if (q.search && search) body.tools = [{ type: 'web_search' }];
    const w = _watch();
    let r;
    try {
      r = await fetch(KIE + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: w.signal,
      });
    } catch (e) {
      w.stop();
      throw failed(w.why() || 'the connection dropped');
    }
    if (!r.ok) {
      w.stop();
      let j = null;
      try { j = await r.json(); } catch { /* no JSON */ }
      throw failed('kie.ai answered ' + r.status + (j && j.msg ? ': ' + j.msg : ''));
    }
    let done = null;
    let bad = null;
    let searches = 0;
    let credits = null;
    let buf = '';
    const decoder = new TextDecoder();
    const take = (line) => {
      if (!line.startsWith('data:')) return;
      let d;
      try { d = JSON.parse(line.slice(5)); } catch { return; }
      if (d.code != null && Number(d.code) !== 200 && d.msg) { bad = 'kie.ai: ' + d.msg; return; }
      if (d.credits_consumed != null) credits = d.credits_consumed;
      if (d.type === 'response.output_item.added' && d.item && d.item.type === 'web_search_call') onStage({ stage: 'searching the web', searches: ++searches });
      else if (d.type === 'response.output_text.delta') onStage({ stage: 'writing', searches });
      else if (d.type === 'response.completed') done = d.response;
      else if (d.type === 'response.failed' || d.type === 'error') bad = label + ' failed: ' + ((d.response && d.response.error && d.response.error.message) || d.message || d.type);
    };
    try {
      for await (const chunk of r.body) {
        w.ping();
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
      }
      if (buf.trim()) take(buf.trim());
    } catch (e) {
      throw failed(w.why() || 'the connection dropped');
    } finally {
      w.stop();
    }
    if (bad) throw failed(bad);
    if (!done) throw failed(label + '\'s answer broke off');
    let raw = '';
    const sources = [];
    const seen = new Set();
    for (const o of done.output || []) {
      if (o.type !== 'message') continue;
      for (const p of o.content || []) {
        if (typeof p.text === 'string') raw += p.text;
        for (const a of p.annotations || []) {
          if (a.type === 'url_citation' && a.url && !seen.has(a.url)) { seen.add(a.url); sources.push({ url: a.url, title: clean(a.title || a.url, 140) }); }
        }
      }
    }
    if (!raw.trim()) throw failed(label + ' answered nothing');
    const c = done.credits_consumed != null ? done.credits_consumed : credits;
    return { raw, sources, by: { step: id, model, searches, usd: (+c || 0) / 200 } };
  };
}

const STEPS = [
  {
    id: 'kimi', label: 'Kimi K3.1 Pro', key: 'kieApiKey',
    run: _kieStep({ id: 'kimi', label: 'Kimi K3.1 Pro', path: '/openai/v1/responses', model: 'kimi-k3-1-pro', effort: { low: 'low', medium: 'high' } }),
  },
  {
    id: 'deepseek', label: 'DeepSeek V4.1 Flash', key: 'kieApiKey',
    run: _kieStep({ id: 'deepseek', label: 'DeepSeek V4.1 Flash', path: '/openai/v1/responses', model: 'deepseek-v4-1-flash', effort: { low: 'low', medium: 'medium' } }),
  },
  { id: 'claude', label: 'Claude Sonnet 5.5', key: 'anthropicApiKey', run: _claude },
  {
    id: 'terra', label: 'GPT 6.1 Terra', key: 'kieApiKey',
    run: _kieStep({ id: 'terra', label: 'GPT 6.1 Terra', path: '/codex/v1/responses', model: 'gpt-6-1-terra', effort: { low: 'low', medium: 'medium' }, search: true }),
  },
];

/** Asks the ladder - the next step after ANY failure (the owner's K4). Never throws: a failure is an answer with `error`. */
async function ask(q) {
  const onStage = q.onStage || (() => {});
  const tried = [];
  for (const s of STEPS) {
    try {
      onStage({ stage: 'thinking', searches: 0, step: s.label });
      const r = await s.run(q, (st) => onStage(Object.assign({ step: s.label }, st)));
      return {
        ok: true, raw: r.raw, sources: r.sources,
        by: Object.assign({ label: s.label }, r.by, { usd: Math.round((r.by.usd || 0) * 10000) / 10000 }), tried,
      };
    } catch (e) {
      if (e.skip) continue;
      if (e instanceof TypeError || e instanceof ReferenceError) console.error('[llm]', s.id, e);
      tried.push(s.label + ': ' + (e.message || 'failed'));
    }
  }
  return { ok: false, error: tried.length ? 'no model answered - try again' : 'no key for any model - add a kie.ai or an Anthropic key in API keys', tried };
}

const hasAny = () => !!getKey('kieApiKey') || !!getKey('anthropicApiKey');

module.exports = { ask, hasAny };
