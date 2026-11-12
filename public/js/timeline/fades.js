// HOW LONG EACH SOUND FADES IN AND OUT - UGC Studio's public/js/sound/fades.js (its phase V28.4), the owner's T6: where
// two tracks overlap on one sound lane they cross over the overlap by themselves - the earlier fades out, the later in;
// one track wholly inside another just mixes; tracks on different lanes just mix. Worked out from where the clips are,
// never stored. ONE rule for the preview (js/timeline/preview.js, the volume) and the render (lib/render.js, afade).
//   fadesOf(project) -> Map(clipId -> { in, out })   seconds; the two never longer than the clip

export function fadesOf(project) {
  const out = new Map();
  for (const lane of ['a1', 'a2']) {
    const clips = ((project && project.lanes && project.lanes[lane]) || []).filter(Boolean);
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
  }
  return out;
}

/** A sound clip's volume at time `t` of the timeline (0..1), by its fades. */
export function gainAt(clip, f, t) {
  const into = t - clip.start;
  const left = clip.start + clip.dur - t;
  let g = 1;
  if (f && f.in > 0) g = Math.min(g, into / f.in);
  if (f && f.out > 0) g = Math.min(g, left / f.out);
  return Math.max(0, Math.min(1, g));
}
