// HOW LONG EACH SOUND FADES IN AND OUT - UGC Studio's public/js/sound/fades.js (its phase V28.4), the owner's T6, and
// phase 6 (the owner's P4: "mixed so that it is hard to tell where one track ends and the next begins"): where two
// sound clips overlap - on ONE sound lane or on Audio 1 and Audio 2 - they cross over the overlap by themselves: the
// earlier fades out, the later in; a clip wholly inside another just mixes. The curves are EQUAL POWER (a quarter of a
// sine - the two together keep one loudness all through, no dip in the middle as straight lines had). Worked out from
// where the clips are, never stored. ONE rule for the timeline's drawing and the preview (js/timeline/, the volume)
// and the render (lib/render.js, afade with curve qsin - the same quarter sine).
//   fadesOf(project) -> Map(clipId -> { in, out })   seconds; the two never longer than the clip
//   gainAt(clip, f, t) -> 0..1                        the volume at second t of the timeline
//   AFADE_CURVE                                       ffmpeg's name of that curve

export const AFADE_CURVE = 'qsin';
const SOUND_LANES = ['a1', 'a2'];

export function fadesOf(project) {
  const out = new Map();
  const clips = [];
  for (const lane of SOUND_LANES) for (const c of (project && project.lanes && project.lanes[lane]) || []) if (c) clips.push(c);
  for (const c of clips) out.set(String(c.id), { in: 0, out: 0 });
  const sorted = clips.slice().sort((a, b) => (+a.start || 0) - (+b.start || 0));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = (+a.start || 0) + (+a.dur || 0);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = +b.start || 0;
      if (bStart >= aEnd) break;
      if (bStart + (+b.dur || 0) <= aEnd) continue;
      const over = aEnd - bStart;
      const fa = out.get(String(a.id));
      const fb = out.get(String(b.id));
      fa.out = Math.max(fa.out, over);
      fb.in = Math.max(fb.in, over);
    }
  }
  for (const c of clips) {
    const f = out.get(String(c.id));
    const dur = Math.max(0, +c.dur || 0);
    f.in = Math.min(f.in, dur);
    f.out = Math.min(f.out, dur);
    if (f.in + f.out > dur && f.in + f.out > 0) { const k = dur / (f.in + f.out); f.in *= k; f.out *= k; }
  }
  return out;
}

// A quarter of a sine: 0 -> 0, 1 -> 1; a fade out is the same curve run backwards, so sin^2 + cos^2 = 1 across.
const _curve = (x) => Math.sin(Math.max(0, Math.min(1, x)) * Math.PI / 2);

/** A sound clip's volume at time `t` of the timeline (0..1), by its fades. */
export function gainAt(clip, f, t) {
  const into = t - clip.start;
  const left = clip.start + clip.dur - t;
  let g = 1;
  if (f && f.in > 0) g = Math.min(g, _curve(into / f.in));
  if (f && f.out > 0) g = Math.min(g, _curve(left / f.out));
  return Math.max(0, Math.min(1, g));
}
