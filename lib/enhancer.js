'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PICTURES' PROMPT ENHANCER (phase 5, the owner's i6, 2026-11-13): "an agent that sees well what is in the pictures,
// relates it to what the person wants, adds to it - and sends it to be made at once; the model for it is Gemini 3.8".
// Gemini 3.8 Flash on kie.ai (lib/llm.js `see`) is handed the person's words and the pictures by their kie links - the
// references of a picture, the start (and last) frame of a clip - and writes ONE English prompt for the chosen model.
// Nothing waits for a look: the press goes on with what it wrote. It did not answer - the press stops in words before
// any money (lib/visual.js). MUSIC_FAKE=1 - "[fake] <the words>", nothing asked.
//   write({ kind: 'image'|'animate', model, words, images, aspect, loop, last }) -> { prompt, by }
// ════════════════════════════════════════════════════════════════════════════

const LLM = require('./llm');

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

const LOOP = `

THIS CLIP LOOPS: its last frame is the same picture as its first. The motion must be cyclic and come back exactly to the starting pose and framing at the end - breathing, swaying, a drifting light, a slow move that returns; the camera stays still or makes a small move that comes back. Nothing may leave the frame for good or change for good.`;

const LAST = `

A LAST FRAME is given (the second picture): the clip must travel from the first picture to it - describe the motion that gets there.`;

function _prompt(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const at = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (at >= 0 && end > at) {
    try {
      const j = JSON.parse(s.slice(at, end + 1));
      if (j && typeof j.prompt === 'string' && j.prompt.trim()) return j.prompt.trim();
    } catch { /* read as words below */ }
  }
  return s.replace(/^prompt\s*:\s*/i, '').trim();
}

async function write({ kind, model, words, images, aspect, loop, last }, { fake = false, onStage } = {}) {
  if (fake) return { prompt: '[fake] ' + (words || 'a picture'), by: { label: 'Gemini 3.8 Flash (fake)', usd: 0 } };
  const n = (images || []).length;
  let system;
  let text;
  if (kind === 'animate') {
    system = ANIMATE_SYSTEM + (loop ? LOOP : last ? LAST : '');
    text = 'The video model: ' + model + '.\nThe person\'s words: ' + (words || '(none - decide from the picture)');
  } else {
    system = IMAGE_SYSTEM;
    text = 'The image model: ' + model + '. The frame: ' + aspect + '.\n'
      + (n ? n + (n === 1 ? ' reference picture is' : ' reference pictures are') + ' attached, in order (image 1' + (n > 1 ? ' to image ' + n : '') + ').\n' : 'No reference pictures.\n')
      + 'The person\'s words: ' + (words || '(none - decide from the references)');
  }
  const r = await LLM.see({ system, text, images, effort: 'low', onStage });
  if (!r.ok) throw new Error(r.error);
  const prompt = _prompt(r.raw).slice(0, MAX_PROMPT);
  if (!prompt) throw new Error('Gemini answered nothing usable');
  return { prompt, by: r.by };
}

module.exports = { write };
