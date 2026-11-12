// The journal as the page follows it (phase 3): one reading of /api/music/jobs shared by the Music tab's Recent and the
// Jobs window; read every 2 s while anything is being made, otherwise only when asked. A press that finishes says so to
// the library (`ms:library-changed`) so its folder shows the new tracks.

import { api } from '../api.js';

let jobs = [];
let timer = 0;
const subs = new Set();
const known = new Map(); // id -> state, to see what has just finished

function _emit() {
  for (const fn of subs) { try { fn(jobs); } catch (e) { console.error(e); } }
}

export function subscribe(fn) {
  subs.add(fn);
  fn(jobs);
  return () => subs.delete(fn);
}

export function current() {
  return jobs;
}

export async function refresh() {
  clearTimeout(timer);
  try {
    jobs = (await api('/api/music/jobs?limit=60')).jobs || [];
  } catch { /* the next reading tries again */ }
  let landed = false;
  for (const j of jobs) {
    const was = known.get(j.id);
    if (was === 'pending' && j.state !== 'pending' && j.kind !== 'lyrics' && j.results && j.results.length) landed = true;
    known.set(j.id, j.state);
  }
  if (landed) window.dispatchEvent(new CustomEvent('ms:library-changed'));
  _emit();
  if (jobs.some(j => j.state === 'pending')) timer = setTimeout(refresh, 2000);
}

/** A record the page just made or changed: shown at once, then followed. */
export function put(job) {
  jobs = [job].concat(jobs.filter(j => j.id !== job.id));
  known.set(job.id, job.state);
  _emit();
  clearTimeout(timer);
  timer = setTimeout(refresh, 1200);
}

export function drop(id) {
  jobs = jobs.filter(j => j.id !== id);
  _emit();
}
