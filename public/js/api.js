// The one way the page talks to the server: JSON both ways, an error in the server's own words.

export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'the server answered ' + res.status);
  return data;
}

// What the page remembers for this person: the open tab, the dividers. Never anything that must survive - a private
// window or cleared site data simply starts from the defaults.
const STORE = 'ms_layout_v1';

export function remembered() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}

export function remember(patch) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...remembered(), ...patch })); } catch { /* not kept */ }
}
