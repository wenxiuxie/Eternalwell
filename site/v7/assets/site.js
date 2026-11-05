// Menu, scroll reveals, smooth scrolling, and the services photo preview
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  var nav = document.querySelector('.nav');
  var btn = nav && nav.querySelector('.menu-btn');
  function setOpen(open) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    var zh = /^zh/.test(document.documentElement.lang);
    btn.setAttribute('aria-label', open ? (zh ? '关闭菜单' : 'Close menu') : (zh ? '打开菜单' : 'Open menu'));
  }
  if (btn) {
    btn.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
    nav.querySelectorAll('.nav-links a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  // Reveal on scroll
  var items = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  // Smooth scrolling
  if (window.Lenis && !reduce) {
    var lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
    var raf = function (t) { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href*="#"]');
      if (!a) return;
      var url = new URL(a.href, location.href);
      if (url.pathname !== location.pathname || !url.hash) return;
      var target = document.querySelector(url.hash);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -96 });
      history.pushState(null, '', url.hash);
    });
  }

  // Preview panel: switch palette and home hero effect (saved in this browser; see theme.js)
  var root = document.documentElement;
  function syncPanel() {
    document.querySelectorAll('[data-set-theme]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.setTheme === root.dataset.theme)); });
    document.querySelectorAll('[data-set-hero]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.setHero === root.dataset.hero)); });
  }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-set-theme], [data-set-hero]');
    if (!b) return;
    if (b.dataset.setTheme) { root.dataset.theme = b.dataset.setTheme; save('ew-theme', b.dataset.setTheme); }
    if (b.dataset.setHero) { root.dataset.hero = b.dataset.setHero; save('ew-hero', b.dataset.setHero); }
    syncPanel();
    window.dispatchEvent(new CustomEvent('ew-look'));
  });
  // Another tab (or the booking frame) changed it
  window.addEventListener('storage', function (e) {
    if (e.key === 'ew-theme' && e.newValue) root.dataset.theme = e.newValue;
    if (e.key === 'ew-hero' && e.newValue) root.dataset.hero = e.newValue;
    syncPanel();
    window.dispatchEvent(new CustomEvent('ew-look'));
  });
  syncPanel();

  // Flowing gradient: the light pools move to whichever side of the screen is empty
  var aurora = document.querySelector('.aurora');
  var scenes = document.querySelectorAll('[data-scene]');
  if (aurora && scenes.length && 'IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        aurora.style.setProperty('--side', String(Number(e.target.dataset.side) || 1));
        // The section rail follows along (the particle script does this itself in particle mode)
        if (root.dataset.hero !== 'particles') {
          var idx = Array.prototype.indexOf.call(scenes, e.target);
          document.querySelectorAll('.rail a').forEach(function (a, i) { a.classList.toggle('on', i === idx); });
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    scenes.forEach(function (sc) { so.observe(sc); });
  }

  // Services: a photo preview follows the cursor over each row
  var preview = document.querySelector('.preview');
  if (preview && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var label = preview.querySelector('.ph-label');
    document.querySelectorAll('[data-photo]').forEach(function (row) {
      row.addEventListener('pointerenter', function () { label.textContent = 'Photo · ' + row.dataset.photo; preview.classList.add('on'); });
      row.addEventListener('pointerleave', function () { preview.classList.remove('on'); });
    });
    window.addEventListener('pointermove', function (e) {
      preview.style.setProperty('--x', e.clientX + 'px');
      preview.style.setProperty('--y', e.clientY + 'px');
    }, { passive: true });
  }
})();

// Home slideshow (four services): tabs, autoplay with pause, keyboard arrows, swipe.
// Autoplay stops while the pointer or keyboard focus is inside, and never runs with reduced motion.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var zh = /^zh/.test(document.documentElement.lang);
  var DUR = 6500;
  document.querySelectorAll('[data-show]').forEach(function (show) {
    var tabs = Array.prototype.slice.call(show.querySelectorAll('[role="tab"]'));
    var slides = Array.prototype.slice.call(show.querySelectorAll('.show-slide'));
    var pauseBtn = show.querySelector('.show-pause');
    var idx = 0, timer = null, playing = !reduce, holding = false;
    show.style.setProperty('--show-dur', DUR / 1000 + 's');

    function go(i, focus) {
      idx = (i + slides.length) % slides.length;
      tabs.forEach(function (t, k) {
        t.setAttribute('aria-selected', String(k === idx));
        t.tabIndex = k === idx ? 0 : -1;
      });
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === idx); });
      if (focus) tabs[idx].focus();
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      tabs.forEach(function (t) { t.classList.remove('run'); });
      // only advance while visible on screen, playing, and not being looked at closely
      if (!playing || holding || document.documentElement.dataset.hero !== 'show') return;
      void tabs[idx].offsetWidth; // restart the progress animation
      tabs[idx].classList.add('run');
      timer = setTimeout(function () { go(idx + 1); }, DUR);
    }
    function setPlaying(p) {
      playing = p;
      pauseBtn.classList.toggle('paused', !p);
      pauseBtn.setAttribute('aria-label', p ? (zh ? '暂停轮播' : 'Pause slideshow') : (zh ? '播放轮播' : 'Play slideshow'));
      schedule();
    }

    tabs.forEach(function (t, k) {
      t.addEventListener('click', function () { go(k); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1, true); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1, true); }
        if (e.key === 'Home') { e.preventDefault(); go(0, true); }
        if (e.key === 'End') { e.preventDefault(); go(slides.length - 1, true); }
      });
    });
    pauseBtn.addEventListener('click', function () { setPlaying(!playing); });
    show.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { holding = true; schedule(); } });
    show.addEventListener('pointerleave', function () { holding = false; schedule(); });
    show.addEventListener('focusin', function () { holding = true; schedule(); });
    show.addEventListener('focusout', function (e) { if (!show.contains(e.relatedTarget)) { holding = false; schedule(); } });

    var x0 = null;
    var stage = show.querySelector('.show-stage');
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    // Pause when the hero scrolls out of view
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        var vis = en[0].isIntersecting;
        if (!vis) { clearTimeout(timer); tabs.forEach(function (t) { t.classList.remove('run'); }); } else schedule();
      }, { threshold: 0.2 }).observe(show);
    }
    window.addEventListener('ew-look', schedule);
    // #show-2 … #show-4 opens that slide (shareable link)
    var m = /^#show-(\d)$/.exec(location.hash);
    if (m && slides[m[1] - 1]) go(m[1] - 1);
    setPlaying(playing);
  });
})();
