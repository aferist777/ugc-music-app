// The keyboard belongs to the topmost window (UGC Studio's rule): every menu, dialog and viewer puts itself on this stack
// and takes itself off again; Escape reaches only the top one; a page's own keys ask `blocked()` first and never fire
// while the person types in a field.

const stack = [];

/** Puts a layer on top; returns the function that takes it off. */
export function pushLayer(onEscape) {
  const layer = { onEscape };
  stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** True while a menu, a dialog or a viewer is open. */
function layerOpen() {
  return stack.length > 0;
}

/** True when a key press belongs to a field (or contenteditable), not to the page. */
function typing(e) {
  const t = e && e.target;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** A page's shortcut may act: no layer over it and nobody typing. */
export function blocked(e) {
  return layerOpen() || typing(e);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  e.preventDefault();
  e.stopPropagation();
  stack[stack.length - 1].onEscape();
}, true);
