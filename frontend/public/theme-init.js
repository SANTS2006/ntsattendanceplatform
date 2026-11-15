/* Applies the saved theme before first paint (no white flash in dark mode). */
(function () {
  var t = 'system';
  try { t = localStorage.getItem('ntsattend-theme') || 'system'; } catch (e) { /* storage unavailable */ }
  var dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
