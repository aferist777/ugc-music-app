// Who Space plays (phase 4): the timeline or the library's player - whichever was used last (a press inside it).

let owner = 'library';

document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('#timeline')) owner = 'timeline';
  else if (t.closest('#library') || t.closest('.mu-recent')) owner = 'library';
}, true);

export const spaceOwner = () => owner;
export const setSpaceOwner = (o) => { owner = o; };
