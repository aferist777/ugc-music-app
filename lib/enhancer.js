'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PICTURES' PROMPT ENHANCER (phase 5, the owner's i6, 2026-11-13): "an agent that sees well what is in the pictures,
// relates it to what the person wants, adds to it - and sends it to be made at once". ITS MODEL IS CLAUDE (the owner
// the same day, after kie's Gemini lay down: "the enhancer is Claude, whose key is there; no key - nothing is enhanced
// anywhere, the requests go as they are"); since phase 7 the agents' LADDER (lib/llm.js - Kimi K3.1 Pro, DeepSeek V4.1
// Flash, Claude Sonnet 5.5 by the Anthropic key, GPT 6.1 Terra; the owner's K2 "the same ladder") is handed the person's words and the
// pictures - the references of a picture, the start (and last) frame of a clip, each a small JPEG (lib/picture.js
// `seeable`) - and writes ONE English prompt for the chosen model. Nothing waits for a look: the press goes on with
// what it wrote. No kie.ai and no Anthropic key - `available()` is false: the tick is grey on the page and the press sends the
// person's words as they are. It failed - lib/visual.js sends the words as they are (none - it stops before money).
// TWO AGENTS (phase 6, the owner's P9: "one only enhances while Loop is off; the second writes the person's prompt AND
// the loop well, and the first rests"): with Loop on, THE LOOP AGENT writes the prompt - by itself, whether the Prompt
// enhancer is ticked or not: it studies the frame for everything that would break the loop (people and cars that leave
// the frame, rain, smoke, water, a camera move, light that changes for good, hair, cloth, reflections, things in hands),
// keeps what the person asked for, makes it vivid, and adds how each of those moves so the clip comes back to its start
// frame; it also names what it added (`added`), shown in the chat and the description.
// MUSIC_FAKE=1 - "[fake] <the words>", nothing asked; "?enhfail" in the words - a fake failure.
//   write({ kind: 'image'|'animate', model, words, images, aspect, loop, last })
//     -> { prompt, by, agent: 'enhancer'|'loop', added }   images: paths
//   available() -> is there an enhancer at all (a kie.ai or an Anthropic key, or the fake)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const LLM = require('./llm');
const { FAKE } = require('./config');

const MAX_PROMPT = 4000;

const IMAGE_SYSTEM = `You write the prompt for an image-generation model. You are given the person's own words (any language, maybe short or empty) and, sometimes, reference pictures in order: image 1, image 2, ...

Look at every reference closely: who or what is in it, the face and body, the clothes, the objects, the place, the light, the colours, the camera angle, the style and the mood. Decide what each reference is FOR in what the person wants - a character to keep the same, a product to show, a place, a style or a palette to follow - and what must change.

Then write ONE prompt in English that the model will follow:
- concrete and visual: the subject and what it does, the setting, the composition and framing, the camera and lens, the light, the colours, the style, the mood;
- name the references where they matter ("the woman from image 1", "in the style of image 2"), and say what to keep from each;
- keep everything the person asked for; add only what makes it better and fits it; never add text, captions, logos or watermarks they did not ask for;
- 50-160 words.

Answer with JSON only, no other words: {"prompt": "..."}`;

const ANIMATE_SYSTEM = `You write the prompt for a video model that brings a still picture to life. The picture is the FIRST frame of the clip. You are given the person's own words (any language, maybe short or empty) and the picture (and sometimes a second picture - the LAST frame).

Look at the picture closely: what is in it, what could move (the subject, the face, hair, cloth, water, smoke, light, the background) and how the camera sees it.

Then write ONE prompt in English, 30-90 words:
- the subject's action and the small secondary motion around it, the camera's move (or a camera that stays still), the pace and the mood;
- keep everything in the picture as it is - the same people, the same place, the same light; no new objects, no cuts, no text;
- keep what the person asked for, and make it vivid and physically believable.

Answer with JSON only, no other words: {"prompt": "..."}`;

const LOOP_SYSTEM = `You write the prompt for a video model that makes a SEAMLESS LOOP from one still picture: the picture is BOTH the first and the last frame of the clip, so when the clip plays round, its end must flow back into its start with no jump. You are given the person's own words (any language, maybe short or empty) and the picture.

First study the picture closely and list for yourself EVERY element that could move or change: people (body, head, face, eyes, mouth, hands and what they hold), hair, clothes and cloth, animals, vehicles, water, rain, snow, smoke, steam, fire, clouds, leaves and plants, flags, reflections, screens and signs, lights and shadows, and the camera.

For each element decide how it moves so that at the last frame it is EXACTLY where it is in the picture:
- a cycle that returns - breathing, a sway, a blink, a gentle turn of the head and back, a step in place, a ripple, a flicker that settles back;
- a continuous texture that looks the same at any moment - falling rain or snow, flowing water, drifting smoke or steam, rolling clouds, shimmering neon, flowing hair in steady wind - it never runs out and never builds up;
- or stillness.
Anything that would travel and not come back must not happen: a person or a car going out of the frame or coming into it, a door opening, an object put down or picked up, a light switching on or off for good, the sun or shadows moving, a camera push-in, pan or zoom that does not return, a change of expression that stays. Say it stays, or turn it into a motion that returns.

Then write ONE prompt in English, 70-150 words:
- what the person asked for comes first - their action, mood and style, made vivid and physically believable;
- then the looping details for every element they did not mention, concrete and short;
- the camera: "locked-off static camera", or a small move that comes back to the same framing;
- end by saying the clip finishes exactly on the opening frame, same pose, same framing, same light;
- keep everything in the picture as it is - the same people, place, light and framing; no new objects, no cuts, no text.

Answer with JSON only, no other words: {"prompt": "...", "added": "the loop details you added that the person did not ask for - a short list in English, semicolons between"}`;

const LAST = `

A LAST FRAME is given (the second picture): the clip must travel from the first picture to it - describe the motion that gets there.`;

// The answer's prompt (and what the loop agent says it added) - JSON as asked, or words when it answered with words.
function _answer(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const at = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (at >= 0 && end > at) {
    try {
      const j = JSON.parse(s.slice(at, end + 1));
      if (j && typeof j.prompt === 'string' && j.prompt.trim()) {
        return { prompt: j.prompt.trim(), added: typeof j.added === 'string' ? j.added.trim().slice(0, 600) : '' };
      }
    } catch { /* read as words below */ }
  }
  return { prompt: s.replace(/^prompt\s*:\s*/i, '').trim(), added: '' };
}

const available = () => FAKE || LLM.hasAny();

async function write({ kind, model, words, images, aspect, loop, last }, { fake = false, onStage } = {}) {
  const agent = kind === 'animate' && loop ? 'loop' : 'enhancer';
  if (fake && /\?enhfail/.test(words || '')) throw new Error('a fake ' + (agent === 'loop' ? 'loop agent' : 'enhancer') + ' failure');
  if (fake) {
    return {
      prompt: '[fake' + (agent === 'loop' ? ' loop' : '') + '] ' + (words || 'a picture'), by: { label: 'Kimi K3.1 Pro (fake)', usd: 0 },
      agent, added: agent === 'loop' ? '[fake] the rain falls on and on; the camera stays still' : '',
    };
  }
  const n = (images || []).length;
  let system;
  let text;
  if (agent === 'loop') {
    system = LOOP_SYSTEM;
    text = 'The video model: ' + model + '.\nThe person\'s words: ' + (words || '(none - decide from the picture what loops well)');
  } else if (kind === 'animate') {
    system = ANIMATE_SYSTEM + (last ? LAST : '');
    text = 'The video model: ' + model + '.\nThe person\'s words: ' + (words || '(none - decide from the picture)');
  } else {
    system = IMAGE_SYSTEM;
    text = 'The image model: ' + model + '. The frame: ' + aspect + '.\n'
      + (n ? n + (n === 1 ? ' reference picture is' : ' reference pictures are') + ' attached, in order (image 1' + (n > 1 ? ' to image ' + n : '') + ').\n' : 'No reference pictures.\n')
      + 'The person\'s words: ' + (words || '(none - decide from the references)');
  }
  const seen = (images || []).map(abs => ({ type: 'image/jpeg', data: fs.readFileSync(abs).toString('base64') }));
  // The loop agent thinks harder: every element of the frame is weighed.
  const r = await LLM.ask({
    system, turns: [{ role: 'user', content: text, images: seen }], effort: agent === 'loop' ? 'medium' : 'low', maxTokens: 4000, onStage,
  });
  if (!r.ok) throw new Error(r.tried && r.tried.length ? r.tried.join('; ') : r.error);
  const a = _answer(r.raw);
  const prompt = a.prompt.slice(0, MAX_PROMPT);
  if (!prompt) throw new Error(r.by.label + ' answered nothing usable');
  return { prompt, by: r.by, agent, added: agent === 'loop' ? a.added : '' };
}

module.exports = { write, available };
