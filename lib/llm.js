'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE MODELS' LADDER (phase 2, made shared in phase 3) - every text agent of the app asks through it: the tag assistant
// (lib/tags-agent.js, with web search) and the prompt enhancer (lib/suno-writer.js, without - the owner's C3).
//
// THE ORDER (the owner, 2026-11-12): Claude Sonnet 5.5 when an Anthropic key is set -> Gemini 3.8 Flash on kie.ai ->
// GPT-6.1 Terra on kie.ai. The next step is asked only when the step before DID NOT WORK - no key, a refusal, a 4xx,
// "overloaded", kie's envelope saying no. A timeout, a dropped connection, a 5xx or a fault of our own STOPS the ladder
// (the owner's V8, "paid once" as in UGC Studio): the answer may have been written and billed.
//
// What the probes showed (2026-11-12, paid, the owner's V9): kie's Gemini 3.8 Flash searches with
// {"type":"function","function":{"name":"googleSearch"}} on its OpenAI-like endpoint and names its sources in words;
// GPT-6.1 Terra searches with {"type":"web_search"} on /codex/v1/responses, gives `url_citation` annotations, and MUST be
// streamed - kie answers 422 "the result is parsed as empty" to a long answer asked with stream:false. Both report
// `credits_consumed` (200 credits = $1).
//
//   ask({ system, turns, search, effort, maxTokens, only, onStage })
//     -> { ok: true, raw, sources, by: { step, label, model, searches, usd }, tried }
//      | { ok: false, error, tried }
//   turns    [{ role: 'user'|'assistant', content: string }]   the conversation, the person's message last
//   effort   'low' | 'medium'
//   onStage  ({ stage, searches, step })                       what the page shows while it waits
// ════════════════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk');
const { getKey } = require('./settings');

const KIE = 'https://api.kie.ai';
const TIMEOUT = 240000;
const MAX_SEARCHES = 5;

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// ── How a failure is read ───────────────────────────────────────────────────

// `next`: the step did not do the work - the next one may be asked. Otherwise the ladder stops (it may have been paid).
const notDone = (msg) => Object.assign(new Error(msg), { next: true });
const unsure = (msg) => Object.assign(new Error(msg), { next: false });

function _fromHttp(status, msg) {
  if (status === 429 || status === 503 || status === 529 || (status >= 400 && status < 500 && status !== 408)) return notDone(msg);
  return unsure(msg);
}

function _fromNetwork(e) {
  return unsure(e && e.name === 'TimeoutError' ? 'no answer in time' : 'the connection dropped');
}

// ── Claude (Anthropic) ──────────────────────────────────────────────────────

// $ per million tokens; a refusal may be answered by another Claude model (fallbacks), priced by the model that served.
const CLAUDE_PRICE = {
  'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5': [2, 10], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25],
};
const CLAUDE_MODEL = 'claude-sonnet-5-5';

async function _claude(q, onStage) {
  const apiKey = getKey('anthropicApiKey');
  if (!apiKey) throw Object.assign(notDone('no Anthropic key'), { skip: true });
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
  let messages = q.turns;
  const content = [];
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  let final = null;
  let searches = 0;
  try {
    // A long turn of server tools may pause (`pause_turn`): it is handed back and goes on, at most a few times.
    for (let round = 0; round < 4; round++) {
      const stream = client.beta.messages.stream(Object.assign({}, base, { messages }));
      for await (const ev of stream) {
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
      messages = q.turns.concat([{ role: 'assistant', content: final.content }]);
    }
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) throw _fromNetwork({ name: e instanceof Anthropic.APIConnectionTimeoutError ? 'TimeoutError' : '' });
    if (e instanceof Anthropic.AuthenticationError) throw notDone('the Anthropic key was refused - check it in API keys');
    if (e instanceof Anthropic.APIError) {
      const said = e.error && e.error.error && e.error.error.message;
      throw _fromHttp(e.status || 0, 'Claude ' + (e.status || '') + (said ? ': ' + said : ''));
    }
    throw e;
  }
  if (final.stop_reason === 'refusal') throw notDone('Claude declined');
  if (final.stop_reason === 'max_tokens') throw unsure('Claude\'s answer was cut off');
  const raw = content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!raw.trim()) throw unsure('Claude answered nothing');
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

// ── kie.ai ──────────────────────────────────────────────────────────────────

async function _gemini(q, onStage) {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(notDone('no kie.ai key'), { skip: true });
  onStage({ stage: q.search ? 'thinking · searching the web' : 'thinking', searches: 0 });
  const body = { stream: false, messages: [{ role: 'system', content: q.system }].concat(q.turns) };
  if (q.search) body.tools = [{ type: 'function', function: { name: 'googleSearch' } }];
  // Gemini on kie knows low and high only; medium leaves it to the model (UGC Studio's lib/agents.js).
  if (q.effort === 'low') body.reasoning_effort = 'low';
  let r;
  try {
    r = await fetch(KIE + '/gemini-3-8-flash-openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    throw _fromNetwork(e);
  }
  let j = null;
  try { j = await r.json(); } catch { /* no JSON */ }
  if (!r.ok) throw _fromHttp(r.status, 'kie.ai answered ' + r.status + (j && (j.msg || (j.error && j.error.message)) ? ': ' + (j.msg || j.error.message) : ''));
  if (!j) throw unsure('kie.ai answered something unreadable');
  // kie says "no" inside a 200: the envelope's code.
  if (j.code != null && Number(j.code) !== 200) throw notDone('kie.ai: ' + (j.msg || 'code ' + j.code));
  const choice = (j.choices || [])[0] || {};
  if (choice.finish_reason === 'length') throw unsure('Gemini\'s answer was cut off');
  const c = choice.message && choice.message.content;
  const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && p.text) || '').join('') : '';
  if (!raw.trim()) throw unsure('Gemini answered nothing');
  return { raw, sources: [], by: { step: 'gemini', model: 'gemini-3-8-flash', searches: null, usd: (+j.credits_consumed || 0) / 200 } };
}

const TERRA_PRICE = { in: 0.30, cached: 0.015, out: 1.50 }; // $ per million tokens on kie (2026-11-12)

async function _terra(q, onStage) {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(notDone('no kie.ai key'), { skip: true });
  onStage({ stage: 'thinking', searches: 0 });
  const body = {
    model: 'gpt-6-1-terra', instructions: q.system, input: q.turns,
    reasoning: { effort: q.effort === 'low' ? 'low' : 'medium' }, stream: true,
  };
  if (q.search) body.tools = [{ type: 'web_search' }];
  let r;
  try {
    r = await fetch(KIE + '/codex/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    throw _fromNetwork(e);
  }
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch { /* no JSON */ }
    throw _fromHttp(r.status, 'kie.ai answered ' + r.status + (j && j.msg ? ': ' + j.msg : ''));
  }
  // Server-sent events: "data: {...}" lines; the last word is response.completed with the whole response.
  let done = null;
  let failed = null;
  let searches = 0;
  let buf = '';
  const decoder = new TextDecoder();
  const take = (line) => {
    if (!line.startsWith('data:')) return;
    let d;
    try { d = JSON.parse(line.slice(5)); } catch { return; }
    if (d.code != null && Number(d.code) !== 200 && d.msg) { failed = notDone('kie.ai: ' + d.msg); return; }
    if (d.type === 'response.output_item.added' && d.item && d.item.type === 'web_search_call') onStage({ stage: 'searching the web', searches: ++searches });
    else if (d.type === 'response.output_text.delta') onStage({ stage: 'writing', searches });
    else if (d.type === 'response.completed') done = d.response;
    else if (d.type === 'response.failed' || d.type === 'error') failed = unsure('GPT-6.1 Terra failed: ' + ((d.response && d.response.error && d.response.error.message) || d.message || d.type));
  };
  try {
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    }
    if (buf.trim()) take(buf.trim());
  } catch (e) {
    throw _fromNetwork(e);
  }
  if (failed) throw failed;
  if (!done) throw unsure('GPT-6.1 Terra\'s answer broke off');
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
  if (!raw.trim()) throw unsure('GPT-6.1 Terra answered nothing');
  const u = done.usage || {};
  const cached = (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  const usd = done.credits_consumed != null
    ? (+done.credits_consumed || 0) / 200
    : ((u.input_tokens || 0) - cached) * TERRA_PRICE.in / 1e6 + cached * TERRA_PRICE.cached / 1e6 + (u.output_tokens || 0) * TERRA_PRICE.out / 1e6;
  return { raw, sources, by: { step: 'terra', model: 'gpt-6.1-terra', searches, usd } };
}

const STEPS = [
  { id: 'claude', label: 'Claude Sonnet 5.5', key: 'anthropicApiKey', run: _claude },
  { id: 'gemini', label: 'Gemini 3.8 Flash', key: 'kieApiKey', run: _gemini },
  { id: 'terra', label: 'GPT-6.1 Terra', key: 'kieApiKey', run: _terra },
];

/** The steps as the page shows them: which can be asked (their key is set). */
function steps() {
  return STEPS.map(s => ({ id: s.id, label: s.label, ready: !!getKey(s.key) }));
}

/** Asks the ladder. Never throws: a failure is an answer with `error`. `only` - one step by its id (checks). */
async function ask(q) {
  const onStage = q.onStage || (() => {});
  const tried = [];
  for (const s of STEPS.filter(x => !q.only || x.id === q.only)) {
    try {
      onStage({ stage: 'thinking', searches: 0, step: s.label });
      const r = await s.run(q, (st) => onStage(Object.assign({ step: s.label }, st)));
      return {
        ok: true, raw: r.raw, sources: r.sources,
        by: Object.assign({ label: s.label }, r.by, { usd: Math.round((r.by.usd || 0) * 10000) / 10000 }), tried,
      };
    } catch (e) {
      if (!e.skip) tried.push(s.label + ': ' + e.message);
      if (e.next === true) continue;
      // Anything else - an unsure answer or a fault of our own - stops the ladder: nothing is paid for twice.
      if (e.next !== false) console.error('[llm]', s.id, e);
      return { ok: false, error: (e.next === false ? e.message : s.label + ' failed') + ' - try again', tried };
    }
  }
  return { ok: false, error: tried.length ? 'no model answered' : 'no key for any model - add one in API keys', tried };
}

module.exports = { ask, steps };
