'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TAG ASSISTANT (phase 2) - the person says in words what music they want; the agent thinks, searches the web when it
// helps and answers ONCE: a long answer in the person's language and, at its end, a JSON part with a name for the style
// and Suno tags in three groups - genre, mood, sound (English, never an artist's name).
//
// THE LADDER (the owner, 2026-11-12): Claude Sonnet 5.5 when an Anthropic key is set (Anthropic's own web search) ->
// Gemini 3.8 Flash on kie.ai (Google Search) -> GPT-6.1 Terra on kie.ai (web search). The next step is asked only when
// the step before DID NOT WORK - no key, a refusal, a 4xx, "overloaded", kie's envelope saying no. A timeout, a dropped
// connection or a 5xx STOPS the ladder (the owner's V8, "paid once" as in UGC Studio): the answer may have been written
// and billed, so the person is told to press Send again instead of paying another model quietly.
//
// What the probes showed (2026-11-12, paid, the owner's V9): kie's Gemini 3.8 Flash searches with the tool
// {"type":"function","function":{"name":"googleSearch"}} on its OpenAI-like endpoint and names its sources in words, no
// links; GPT-6.1 Terra searches with {"type":"web_search"} on /codex/v1/responses and gives `url_citation` annotations.
// Both report `credits_consumed` (200 credits = $1).
//
//   ask(history, text, onStage) -> { ok, text, chips, title, sources, by, error }
//     history  [{ role: 'user'|'assistant', text, chips? }]   earlier turns of the chat (failed answers left out)
//     onStage  ({ stage, searches, step })                    what the page shows while it waits
// ════════════════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk');
const { getKey } = require('./settings');
const { FAKE } = require('./config');

const KIE = 'https://api.kie.ai';
const TIMEOUT = 240000;
const MAX_SEARCHES = 5;
const HISTORY = 12;
const GROUPS = ['genre', 'mood', 'sound'];

const SYSTEM = [
  'You help a person find the words for the music they want to make with Suno (an AI music generator).',
  'They describe it in their own words - a mood, a scene, a use, a reference. You think it through and, when it helps,',
  'search the web: genres and subgenres, scenes and eras, the instruments, production and tempo that make that sound, and',
  'how people describe it to Suno.',
  '',
  'Answer once, thoroughly, in the language the person writes in: what this music is, where it comes from, what makes the',
  'sound, a tempo and key that suit it, how to steer Suno toward it and what to keep out. Artists may be named in the text',
  'as references. Use short paragraphs and lists; no tables.',
  '',
  'End EVERY answer with one fenced JSON block and nothing after it:',
  '```json',
  '{"title": "2-5 English words naming this style",',
  ' "genre": [{"tag": "...", "why": "..."}],',
  ' "mood":  [{"tag": "...", "why": "..."}],',
  ' "sound": [{"tag": "...", "why": "..."}]}',
  '```',
  'Rules for the tags: English, lower case, 1-4 words each, the way Suno style prompts are written; 6-10 per group; no',
  'artist, band, song, album or label names, ever - describe their sound instead; no tag twice. genre = genres and',
  'subgenres; mood = feelings, energy, atmosphere; sound = instruments, timbres, rhythm, production, tempo ("90 bpm") and',
  'vocals if any. "why" is one short line in the person\'s language. Later in the chat the person may ask to change',
  'things ("darker", "no guitar") - answer the change and give the full set of tags again. The title stays the style\'s',
  'name for the whole chat.',
].join('\n');

// ── The answer's JSON part ──────────────────────────────────────────────────

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** The answer's text without its JSON part, and the JSON part checked: { text, chips|null, title }. */
function parseAnswer(raw) {
  const all = String(raw || '').trim();
  const fences = [...all.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  let json = null;
  let cut = all.length;
  for (let i = fences.length - 1; i >= 0 && !json; i--) {
    try {
      const v = JSON.parse(fences[i][1]);
      if (v && typeof v === 'object') { json = v; cut = fences[i].index; }
    } catch { /* not this one */ }
  }
  // A model now and then leaves the fences out: the last object in the text that holds the groups is taken.
  if (!json) {
    const end = all.lastIndexOf('}');
    for (let i = all.lastIndexOf('{', end), n = 0; i >= 0 && n < 60 && !json; i = all.lastIndexOf('{', i - 1), n++) {
      try {
        const v = JSON.parse(all.slice(i, end + 1));
        if (v && typeof v === 'object' && GROUPS.some(g => Array.isArray(v[g]))) { json = v; cut = i; }
      } catch { /* not from here */ }
    }
  }
  const text = all.slice(0, cut).trim();
  if (!json) return { text, chips: null, title: '' };
  const chips = {};
  const seen = new Set();
  for (const g of GROUPS) {
    chips[g] = [];
    for (const c of Array.isArray(json[g]) ? json[g] : []) {
      const tag = clean(c && (c.tag || c.label || (typeof c === 'string' ? c : '')), 40).toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      chips[g].push({ tag, why: clean(c && c.why, 160) });
      if (chips[g].length >= 12) break;
    }
  }
  const any = GROUPS.some(g => chips[g].length);
  return { text, chips: any ? chips : null, title: clean(json.title, 60) };
}

// Earlier turns as the models are told them: an answer with its tags in the same JSON form it gave them.
function _turns(history, text) {
  const out = [];
  for (const m of (Array.isArray(history) ? history : []).slice(-HISTORY)) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant' && m.text) {
      const tags = m.chips ? '\n\n```json\n' + JSON.stringify(Object.assign({ title: m.title || '' }, m.chips)) + '\n```' : '';
      out.push({ role: 'assistant', content: m.text + tags });
    }
  }
  out.push({ role: 'user', content: text });
  // A chat starts with the person: anything before their first message is dropped.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

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

async function _claude(turns, onStage) {
  const apiKey = getKey('anthropicApiKey');
  if (!apiKey) throw Object.assign(notDone('no Anthropic key'), { skip: true });
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT });
  const base = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }],
    output_config: { effort: 'medium' },
    // A refusal is answered by another Claude model on Anthropic's side (their recommended default).
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  let messages = turns;
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
      messages = turns.concat([{ role: 'assistant', content: final.content }]);
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

async function _kiePost(path, body) {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(notDone('no kie.ai key'), { skip: true });
  let r;
  try {
    r = await fetch(KIE + path, {
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
  return j;
}

async function _gemini(turns, onStage) {
  onStage({ stage: 'thinking · searching the web', searches: 0 });
  const j = await _kiePost('/gemini-3-8-flash-openai/v1/chat/completions', {
    stream: false,
    messages: [{ role: 'system', content: SYSTEM }].concat(turns),
    tools: [{ type: 'function', function: { name: 'googleSearch' } }],
  });
  const choice = (j.choices || [])[0] || {};
  if (choice.finish_reason === 'length') throw unsure('Gemini\'s answer was cut off');
  const c = choice.message && choice.message.content;
  const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && p.text) || '').join('') : '';
  if (!raw.trim()) throw unsure('Gemini answered nothing');
  return { raw, sources: [], by: { step: 'gemini', model: 'gemini-3-8-flash', searches: null, usd: (+j.credits_consumed || 0) / 200 } };
}

// GPT-6.1 Terra is asked STREAMED: kie's /codex/v1/responses with stream:false answers 422 "the result is parsed as
// empty" once the answer is long (2026-11-12, reproduced twice with these instructions; short answers came back), while
// the same request streamed completes. The stream also says when the model searches.
const TERRA_PRICE = { in: 0.30, cached: 0.015, out: 1.50 }; // $ per million tokens on kie (2026-11-12)

async function _terra(turns, onStage) {
  const key = getKey('kieApiKey');
  if (!key) throw Object.assign(notDone('no kie.ai key'), { skip: true });
  onStage({ stage: 'thinking', searches: 0 });
  let r;
  try {
    r = await fetch(KIE + '/codex/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: 'gpt-6-1-terra', instructions: SYSTEM, input: turns,
        reasoning: { effort: 'medium' }, tools: [{ type: 'web_search' }], stream: true,
      }),
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
    else if (d.type === 'response.output_text.delta' && searches >= 0) onStage({ stage: 'writing', searches });
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

// ── Free runs ───────────────────────────────────────────────────────────────

async function _fake(turns, onStage) {
  onStage({ stage: 'searching the web', searches: 1 });
  await new Promise(r => setTimeout(r, 1200));
  onStage({ stage: 'writing', searches: 1 });
  await new Promise(r => setTimeout(r, 800));
  const asked = turns[turns.length - 1].content;
  const raw = '[fake] An answer to: "' + asked.slice(0, 120) + '".\n\nNight-drive music sits between **synthwave** and '
    + '**darkwave**: analog pads, a steady 90-100 bpm pulse, gated drums.\n\n- keep vocals out for a background\n- ask '
    + 'for a long intro\n\n```json\n' + JSON.stringify({
      title: 'Night City Synthwave',
      genre: [{ tag: 'synthwave', why: 'the core' }, { tag: 'darkwave', why: 'colder edge' }, { tag: 'outrun', why: 'driving pulse' }, { tag: 'chillwave', why: 'softer haze' }, { tag: 'retrowave', why: '80s colour' }, { tag: 'electro', why: 'drum machine bite' }],
      mood: [{ tag: 'nocturnal', why: 'night' }, { tag: 'melancholic', why: 'a little sad' }, { tag: 'driving', why: 'motion' }, { tag: 'cinematic', why: 'wide' }, { tag: 'hypnotic', why: 'repetition' }, { tag: 'cool', why: 'distance' }],
      sound: [{ tag: 'analog pads', why: 'warm bed' }, { tag: 'gated reverb drums', why: '80s snare' }, { tag: 'arpeggiated bass', why: 'pulse' }, { tag: 'tape saturation', why: 'warmth' }, { tag: '95 bpm', why: 'cruising' }, { tag: 'no vocals', why: 'background' }],
    }) + '\n```';
  return { raw, sources: [{ url: 'https://example.com/', title: 'example.com (fake)' }], by: { step: 'fake', model: 'FAKE', searches: 1, usd: 0 } };
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
async function ask(history, text, onStage, { only } = {}) {
  const turns = _turns(history, text);
  const tried = [];
  const ladder = FAKE ? [{ id: 'fake', label: 'FAKE', run: _fake }] : STEPS.filter(s => !only || s.id === only);
  for (const s of ladder) {
    try {
      onStage({ stage: 'thinking', searches: 0, step: s.label });
      const r = await s.run(turns, (st) => onStage(Object.assign({ step: s.label }, st)));
      const p = parseAnswer(r.raw);
      return {
        ok: true, text: p.text, chips: p.chips, title: p.title, sources: r.sources,
        by: Object.assign({ label: s.label }, r.by, { usd: Math.round((r.by.usd || 0) * 10000) / 10000 }), tried,
      };
    } catch (e) {
      if (!e.skip) tried.push(s.label + ': ' + e.message);
      if (e.next === true) continue;
      // Anything else - an unsure answer or a fault of our own - stops the ladder: nothing is paid for twice.
      if (e.next !== false) console.error('[tags]', s.id, e);
      return { ok: false, error: (e.next === false ? e.message : s.label + ' failed') + ' - press Send again', tried };
    }
  }
  return { ok: false, error: tried.length ? 'no model answered' : 'no key for any model - add one in API keys', tried };
}

module.exports = { ask, steps, parseAnswer, SYSTEM };
