'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TAG ASSISTANT (phase 2) - the person says in words what music they want; the agent thinks, searches the web when it
// helps and answers ONCE: a long answer in the person's language and, at its end, a JSON part with a name for the style
// and Suno tags in three groups - genre, mood, sound (English, never an artist's name). It asks the models' ladder
// (lib/llm.js) with web search, at effort medium.
//
//   ask(history, text, onStage) -> { ok, text, chips, title, sources, by, error, tried }
//     history  [{ role: 'user'|'assistant', text, chips? }]   earlier turns of the chat (failed answers left out)
//     onStage  ({ stage, searches, step })                    what the page shows while it waits
// ════════════════════════════════════════════════════════════════════════════

const LLM = require('./llm');
const { FAKE } = require('./config');

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

/** Asks the ladder with web search. Never throws: a failure is an answer with `error`. */
async function ask(history, text, onStage) {
  const turns = _turns(history, text);
  if (FAKE) {
    const r = await _fake(turns, (st) => onStage(Object.assign({ step: 'FAKE' }, st)));
    const p = parseAnswer(r.raw);
    return { ok: true, text: p.text, chips: p.chips, title: p.title, sources: r.sources, by: Object.assign({ label: 'FAKE' }, r.by), tried: [] };
  }
  const r = await LLM.ask({ system: SYSTEM, turns, search: true, effort: 'medium', maxTokens: 16000, onStage });
  if (!r.ok) return { ok: false, error: r.error.replace(/ - try again$/, ' - press Send again'), tried: r.tried };
  const p = parseAnswer(r.raw);
  return { ok: true, text: p.text, chips: p.chips, title: p.title, sources: r.sources, by: r.by, tried: r.tried };
}

module.exports = { ask };
