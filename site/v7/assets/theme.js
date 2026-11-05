// Runs in <head> before the page paints: applies the saved palette and home hero effect,
// so the page never flashes the wrong colors. Defaults: palette "noir", hero "show".
// (The choice is only selectable from the preview panel; at launch, set the defaults here.)
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var THEMES = ['noir', 'stone', 'navy', 'sage', 'clay', 'teal', 'sky'];
  var HEROES = ['show', 'lab', 'curve', 'aurora', 'particles', 'photo'];
  var theme = 'noir', hero = 'show';
  try {
    var t = localStorage.getItem('ew-theme'), h = localStorage.getItem('ew-hero');
    if (THEMES.indexOf(t) > -1) theme = t;
    if (HEROES.indexOf(h) > -1) hero = h;
  } catch (e) { /* storage blocked: use defaults */ }
  // A link like ?theme=navy&hero=photo opens the page with that look (handy for sending to the doctor)
  var q = new URLSearchParams(location.search);
  if (THEMES.indexOf(q.get('theme')) > -1) { theme = q.get('theme'); try { localStorage.setItem('ew-theme', theme); } catch (e) { /* ignore */ } }
  if (HEROES.indexOf(q.get('hero')) > -1) { hero = q.get('hero'); try { localStorage.setItem('ew-hero', hero); } catch (e) { /* ignore */ } }
  root.dataset.theme = theme;
  root.dataset.hero = hero;
})();
