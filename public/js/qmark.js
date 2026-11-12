// The "?" of a parameter (UGC Studio's js/sound/qmark.js, the owner's V60 there): a small "?" right of a name; the
// pointer resting on it opens a bubble - what the parameter is and how to use it; a press on it opens it too (touch) and
// never folds, ticks or chooses what it sits in.

let bubble = null;

function _close() {
  if (bubble) { bubble.remove(); bubble = null; }
}

function _open(q, text) {
  _close();
  bubble = document.createElement('div');
  bubble.className = 'qm-bubble';
  for (const para of String(typeof text === 'function' ? text() : text).split('\n')) {
    const p = document.createElement('p');
    p.textContent = para;
    bubble.append(p);
  }
  document.body.append(bubble);
  const r = q.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2));
  const above = r.top - b.height - 8;
  bubble.style.left = left + 'px';
  bubble.style.top = (above > 8 ? above : r.bottom + 8) + 'px';
}

export function qmark(text) {
  const q = document.createElement('span');
  q.className = 'qm';
  q.textContent = '?';
  q.setAttribute('aria-label', typeof text === 'string' ? text : 'help');
  q.addEventListener('mouseenter', () => _open(q, text));
  q.addEventListener('mouseleave', _close);
  q.addEventListener('mousedown', (e) => e.stopPropagation());
  q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (bubble) _close(); else _open(q, text); });
  return q;
}

/** The "?" at the end of `node`; `node` back. */
export function withQ(node, text) {
  if (node && text) node.append(qmark(text));
  return node;
}

window.addEventListener('scroll', _close, true);
window.addEventListener('blur', _close);
