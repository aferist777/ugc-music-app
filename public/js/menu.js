// The right button's menu. An item with `really` asks by a second press (the owner's B3, as UGC Studio did): the first
// press turns it into "Really? …", the second does it.
//   openMenu(x, y, [{ label, act, really?, danger?, disabled? } | { sep: true }])

import { pushLayer } from './layers.js';

let current = null;

function closeMenu() {
  if (!current) return;
  const c = current;
  current = null;
  c.el.remove();
  c.pop();
  document.removeEventListener('pointerdown', c.away, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
}

export function openMenu(x, y, items) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) continue;
    if (it.sep) {
      el.append(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-item' + (it.danger ? ' is-danger' : '');
    b.setAttribute('role', 'menuitem');
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => {
      if (it.really && !b.classList.contains('is-really')) {
        b.classList.add('is-really');
        b.textContent = typeof it.really === 'string' ? it.really : 'Really? ' + it.label;
        return;
      }
      closeMenu();
      it.act();
    });
    el.append(b);
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  const away = (e) => { if (!el.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', away, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  current = { el, away, pop: pushLayer(closeMenu) };
}
