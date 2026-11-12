// Messages in the top-right corner (UGC Studio's rule): an error stays until its ✕ (five at most, a repeat counts ×2);
// calm news goes by itself. Never an alert().

let host = null;

function _host() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'notices';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  return host;
}

function _make(text, kind) {
  const h = _host();
  for (const n of h.children) {
    if (n.dataset.text === text && n.dataset.kind === kind) {
      const c = (+n.dataset.count || 1) + 1;
      n.dataset.count = c;
      n.querySelector('.notice-count').textContent = '×' + c;
      return n;
    }
  }
  const n = document.createElement('div');
  n.className = 'notice is-' + kind;
  n.dataset.text = text;
  n.dataset.kind = kind;
  const t = document.createElement('span');
  t.className = 'notice-text';
  t.textContent = text;
  const c = document.createElement('span');
  c.className = 'notice-count';
  const x = document.createElement('button');
  x.className = 'notice-x';
  x.title = 'Close';
  x.textContent = '✕';
  x.addEventListener('click', () => n.remove());
  n.append(t, c, x);
  h.append(n);
  while (h.querySelectorAll('.notice.is-error').length > 5) h.querySelector('.notice.is-error').remove();
  return n;
}

export function showError(text) {
  _make(String(text || 'Something went wrong.'), 'error');
}

export function showToast(text) {
  const n = _make(String(text), 'info');
  clearTimeout(n._t);
  n._t = setTimeout(() => n.remove(), 3500);
}
