// The theme before the page is drawn (a plain script in <head>, so a light page never flashes dark): the one kept for
// this person, dark when none. The top strip's button changes it (js/main.js).
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('ms_theme') === 'light' ? 'light' : 'dark'; } catch (_) { /* not kept */ }
  document.documentElement.setAttribute('data-theme', t);
}());
