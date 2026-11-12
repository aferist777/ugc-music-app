'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PROMPT ENHANCER (phase 3; UGC Studio's lib/audio-writer-rules.js, its rules rewritten for FULL TRACKS - the owner's
// C1: UGC's writer made a bed under a voice). It turns the person's chips, the tags of their Mix and their own words into
// what Suno is sent, asking the models' ladder (lib/llm.js) without web search at effort low (the owner's C3):
//   task 'instrumental'  Simple, instrumental      -> { title, style, negative }   Suno custom mode, instrumental
//   task 'song'          Simple with a voice       -> { title, prompt }            Suno's mode without custom: it writes
//                                                                                  the lyrics from the description (C2)
//   task 'custom'        Custom, the box ticked    -> { style, negative }          the person's Style made fuller -
//                                                                                  nothing of theirs dropped
// No enhancer (unticked, or every model failed) - compose(): the chips' own phrases and the person's words as they are.
// Names of artists are never sent: the enhancer is told so, and _noNames is the net under it.
// ════════════════════════════════════════════════════════════════════════════

const LLM = require('./llm');
const A = require('../public/js/music/chips.js');

const LIMIT = { title: 80, style: 1000, negative: 500, prompt: 500 };
const GROUPS = ['genre', 'mood', 'sound'];

// ── The chips ───────────────────────────────────────────────────────────────

const _chip = (group, id) => (A.CHIPS[group] || []).find(c => c.id === id || c.label === id) || null;

function chipsOf(chips) {
  const c = chips || {};
  const out = {};
  for (const g of GROUPS) out[g] = (Array.isArray(c[g]) ? c[g] : []).map(id => _chip(g, id)).filter(Boolean);
  return out;
}

// The tempo: where the genre's and the mood's ranges meet, else the middle of whichever is there; rounded to 5. 0 - none.
function bpmOf(ch) {
  const mid = (r) => Math.round((r[0] + r[1]) / 2 / 5) * 5;
  const g = ch.genre.find(c => c.bpm);
  const m = ch.mood.find(c => c.bpm);
  if (g && m) {
    const lo = Math.max(g.bpm[0], m.bpm[0]);
    const hi = Math.min(g.bpm[1], m.bpm[1]);
    return lo <= hi ? mid([lo, hi]) : mid(g.bpm);
  }
  const one = g || m;
  return one ? mid(one.bpm) : 0;
}

// ── Cleaning ────────────────────────────────────────────────────────────────

const _one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function _tags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    for (const t of String(raw || '').split(',')) {
      const w = _one(t).replace(/^[-–—•.\s]+|[.\s]+$/g, '');
      const k = w.toLowerCase();
      if (!w || seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
  }
  return out;
}

// Cut at a comma, never in the middle of a tag.
function _fit(tags, max) {
  let s = '';
  for (const t of tags) {
    const next = s ? s + ', ' + t : t;
    if (next.length > max) break;
    s = next;
  }
  return s;
}

function _cut(s, max) {
  const t = _one(s);
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const at = Math.max(c.lastIndexOf('. '), c.lastIndexOf(', '));
  return (at > max * 0.6 ? c.slice(0, at + 1) : c).trim();
}

function _noNames(s) {
  return String(s || '').replace(/\b(in the style of|inspired by|sounds like|similar to|reminiscent of|à la|a la)\s+[^,.;]+/gi, '');
}

// "no drums" in Suno's style still says "drums": such a tag moves to the excludes as "drums".
function _splitNegatives(tags) {
  const keep = [];
  const neg = [];
  for (const t of tags) {
    const m = /^(?:no|without|zero|avoid)\s+(.+)$/i.exec(t);
    if (m) neg.push(m[1]); else keep.push(t);
  }
  return { keep, neg };
}

function _title(t, fallback) {
  const s = _one(t).replace(/^["'«“]+|["'»”]+$/g, '').slice(0, LIMIT.title).trim();
  return s || fallback || 'Untitled';
}

const _ascii = (s) => /^[\x20-\x7e]*$/.test(s);
const _cap = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

// ── Without the enhancer ────────────────────────────────────────────────────

function compose(input) {
  const i = input || {};
  let ch = chipsOf(i.chips);
  const mix = Array.isArray(i.mix) ? i.mix : [];
  const words = _one(i.words);
  if (!GROUPS.some(g => ch[g].length) && !mix.length && !words && !_one(i.about)) ch = chipsOf(A.CHIPS_DEFAULT);
  const bpm = bpmOf(ch);
  const title = _title([ch.mood[0] && ch.mood[0].label, ch.genre[0] && ch.genre[0].label].filter(Boolean).join(' ')
    || (mix[0] ? _cap(mix[0]) : '') || words.split(' ').slice(0, 4).join(' '), 'Untitled');
  if (i.task === 'song') {
    const parts = [_one(i.about), words, ...ch.genre.map(c => c.label), ...ch.mood.map(c => c.label), ...ch.sound.map(c => c.label), ...mix];
    return { title, prompt: _cut(_tags(parts).join(', '), LIMIT.prompt), by: 'as picked' };
  }
  if (i.task === 'custom') {
    const style = _fit(_tags([i.style || '']), LIMIT.style);
    return { style, negative: _fit(_tags([i.negative || '']), LIMIT.negative), by: 'as written' };
  }
  const { keep, neg } = _splitNegatives(_tags([
    ...ch.genre.map(c => c.style), bpm ? 'around ' + bpm + ' BPM' : '', ...ch.mood.map(c => c.style),
    ...ch.sound.map(c => c.style), ...mix, _ascii(words) ? words : '',
  ]));
  const avoid = GROUPS.flatMap(g => ch[g].flatMap(c => c.avoid || []));
  return {
    title,
    style: _fit(keep.concat(['instrumental']), LIMIT.style),
    negative: _fit(_tags(neg.concat(avoid)), LIMIT.negative),
    by: 'as picked',
  };
}

// ── The enhancer's rules ────────────────────────────────────────────────────

const COMMON = [
  'You are a music producer who writes prompts for Suno V6, an AI music model. You write the prompt for ONE track.',
  'You get the person\'s CHIPS (genre, mood, sound - each one their choice), TAGS they collected while exploring the sound, and their own WORDS in any language - a word or a paragraph. Their words come first; the chips and tags fill what the words leave open; never go against any of them. With nothing at all, a warm modern lo-fi track.',
  'Keep their facts - a genre, an instrument, a tempo, a mood, a use. Decide what they left open as a producer would, CONCRETELY: the sub-genre, two or three named instruments and how they play, the tempo, the arrangement and the production. Mood words alone come back bland; named instruments make the sound.',
  'NEVER name an artist, a band, a song, a film or a label - describe the sound instead (its genre, era, instruments, production). Suno refuses names.',
].join('\n');

const RULES = {
  instrumental: [
    'THE TRACK: an instrumental (no voice), sent in Suno\'s custom mode. You write three fields, in English.',
    'STYLE: 6-10 comma-separated descriptors, the most important first (Suno weighs the start most): the genre and sub-genre -> the tempo as a feel and a number ("driving, around 118 BPM") -> named instruments with their part ("analog synth bass arpeggio", "gated reverb drums", "airy pad swells") -> the mood (one direction, never two that fight) -> the shape when it matters ("slow build to a big final section", "steady groove throughout") -> the production ("warm analog mix", "punchy modern master"). 150-400 characters. Only POSITIVE words - never "no ..." or "without ...": a word in the style pulls its sound in even after "no"; what must not be there goes to NEGATIVE_TAGS. No vocal words.',
    'NEGATIVE_TAGS: 2-6 bare comma-separated tags for what THIS track must not have (sounds or styles that would clash with their choice). Never a tag of something you want.',
    'TITLE: 2-5 words in English, a name for the track, no quotes, no names of people.',
    'Answer as ONE json object and nothing else: {"title": "<title>", "style": "<style>", "negative_tags": "<tags>"}. Never ask: decide what is open. The track is made from your answer at once.',
  ].join('\n'),
  song: [
    'THE TRACK: a SONG with a voice, sent in Suno\'s simple mode - Suno writes the lyrics itself from your description.',
    'PROMPT: one description, at most 450 characters, in English: the genre and sub-genre, the tempo, two or three named instruments, the mood, the VOICE ("warm female vocals", "raspy male vocals", "a duet") and WHAT THE SONG IS ABOUT - its story or theme, taken from their words (translate it into English). If their words name a language for the song, end with "lyrics in <language>"; otherwise the song is in English.',
    'TITLE: 2-5 words, a name for the song, no quotes, no names of people.',
    'Answer as ONE json object and nothing else: {"title": "<title>", "prompt": "<prompt>"}. Never ask: decide what is open.',
  ].join('\n'),
  custom: [
    'THE TRACK: sent in Suno\'s custom mode; the person wrote its STYLE themselves (and maybe a title, lyrics, what to exclude). You make their style FULLER, in English.',
    'STYLE: keep every descriptor they wrote - nothing of theirs is dropped, changed in meaning or contradicted; add what it leaves open (the sub-genre, a tempo number, named instruments and their part, the production) until it holds 6-10 strong descriptors, the most important first. 150-500 characters. Only POSITIVE words; what must not be there goes to NEGATIVE_TAGS. A song with lyrics may get its voice described; an instrumental gets no vocal words.',
    'NEGATIVE_TAGS: everything they excluded, plus up to four bare tags of your own for what would clash. Never a tag of something they want.',
    'Answer as ONE json object and nothing else: {"style": "<style>", "negative_tags": "<tags>"}. Never ask.',
  ].join('\n'),
};

function messageFor(input) {
  const i = input || {};
  const ch = chipsOf(i.chips);
  const line = (label, list) => label + ': ' + (list.length ? list.map(c => c.label + ' (' + c.style + ')').join('; ') : 'none');
  const bpm = bpmOf(ch);
  const mix = Array.isArray(i.mix) ? i.mix : [];
  if (i.task === 'custom') {
    return [
      'Their title: ' + (_one(i.title) || '(none)'),
      'Their style: ' + (_one(i.style) || '(none)'),
      'Their exclude: ' + (_one(i.negative) || '(none)'),
      i.instrumental ? 'Instrumental: yes.' : (i.hasLyrics ? 'It has lyrics (a voice).' : 'A voice, no lyrics written.'),
    ].join('\n');
  }
  return [
    line('Genre chips', ch.genre),
    line('Mood chips', ch.mood),
    line('Sound chips', ch.sound),
    'Tags from their exploring: ' + (mix.length ? mix.join(', ') : 'none'),
    bpm ? 'Tempo from the chips: ' + bpm + ' BPM (change it if their words ask for another pace).' : 'Tempo: not set - choose one that fits.',
    +i.seconds > 0 ? 'Length: about ' + Math.round(+i.seconds) + ' seconds.' : '',
    'Their words: ' + (_one(i.words) || '(none)'),
    i.task === 'song' ? 'What the song is about: ' + (_one(i.about) || '(see their words)') : '',
  ].filter(Boolean).join('\n');
}

function _json(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// The enhancer's answer -> what is sent, cleaned: names out, "no X" into the excludes, the limits kept.
function finish(input, j, plain) {
  const i = input || {};
  if (i.task === 'song') {
    const prompt = _cut(_noNames(j.prompt), LIMIT.prompt);
    if (!prompt) return null;
    return { title: _title(j.title, plain.title), prompt };
  }
  const { keep, neg } = _splitNegatives(_tags([_noNames(j.style)]));
  if (!keep.length) return null;
  const ch = chipsOf(i.chips);
  const avoid = i.task === 'instrumental' ? GROUPS.flatMap(g => ch[g].flatMap(c => c.avoid || [])) : [];
  const wanted = new Set(keep.join(' ').toLowerCase().split(/[\s,]+/));
  const negative = _tags([...neg, j.negative_tags || '', ...(i.task === 'custom' ? [i.negative || ''] : []), ...avoid])
    .filter(t => i.task === 'custom' || !wanted.has(t.toLowerCase()));
  const out = {
    style: _fit(i.task === 'instrumental' ? keep.concat(['instrumental']) : keep, LIMIT.style),
    negative: _fit(negative, LIMIT.negative),
  };
  if (i.task !== 'custom') out.title = _title(j.title, plain.title);
  return out;
}

/**
 * What Suno is sent, written by the enhancer: { title?, style?, negative?, prompt?, by, usd, fell? } - `fell` says why
 * the plain composition went instead. `fake` - no model is asked.
 */
async function write(input, { fake, onStage } = {}) {
  const plain = compose(input);
  if (fake) return Object.assign({}, plain, { by: 'fake enhancer', usd: 0 }, plain.style ? { style: '[fake] ' + plain.style } : {});
  const r = await LLM.ask({
    system: COMMON + '\n\n' + RULES[input.task],
    turns: [{ role: 'user', content: messageFor(input) }],
    search: false, effort: 'low', maxTokens: 4000, onStage,
  });
  if (!r.ok) return Object.assign({}, plain, { fell: 'the enhancer failed (' + r.error + ') - sent as picked', usd: 0 });
  const j = _json(r.raw);
  const done = j && finish(input, j, plain);
  if (!done) return Object.assign({}, plain, { fell: 'the enhancer answered nothing usable - sent as picked', by: plain.by, usd: r.by.usd });
  return Object.assign(done, { by: r.by.label, usd: r.by.usd });
}

module.exports = { write, compose };
