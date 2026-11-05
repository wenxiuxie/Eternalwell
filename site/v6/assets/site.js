// Menu, scroll reveals, smooth scrolling, and the services photo preview
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  var nav = document.querySelector('.nav');
  var btn = nav && nav.querySelector('.menu-btn');
  function setOpen(open) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
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
