/* ═══════════════════════════════════════════════════════════
   La Table de Carthage — interactions
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Préchargeur ─────────────────────────────────────── */
  (function preloader () {
    const el = $('#preloader');
    if (!el) return;
    $$('#preloader .preloader__text span').forEach((s, i) => {
      s.style.animationDelay = (0.9 + i * 0.045) + 's';
    });
    const hide = () => {
      el.classList.add('is-done');
      document.body.classList.remove('is-locked');
      setTimeout(() => el.remove(), 900);
    };
    document.body.classList.add('is-locked');
    window.addEventListener('load', () => setTimeout(hide, reduced ? 0 : 1900));
    setTimeout(hide, 4500); // filet de sécurité
  })();

  /* ── Année ───────────────────────────────────────────── */
  const yr = $('#year');
  if (yr) yr.textContent = new Date().getFullYear();

  /* ── Navigation ──────────────────────────────────────── */
  (function nav () {
    const bar = $('#nav'), burger = $('#burger'), links = $('#navLinks');
    const onScroll = () => bar.classList.toggle('is-stuck', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    burger.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('is-locked', open);
    });
    $$('#navLinks a').forEach(a => a.addEventListener('click', () => {
      links.classList.remove('is-open');
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-locked');
    }));
  })();

  /* ── Curseur sur-mesure ──────────────────────────────── */
  (function cursor () {
    const cur = $('#cursor');
    if (!cur || window.matchMedia('(hover: none)').matches) return;
    let x = 0, y = 0, tx = 0, ty = 0;
    window.addEventListener('mousemove', e => {
      tx = e.clientX; ty = e.clientY; cur.classList.add('is-on');
    });
    (function loop () {
      x += (tx - x) * 0.18; y += (ty - y) * 0.18;
      cur.style.transform = `translate(${x}px, ${y}px)`;
      requestAnimationFrame(loop);
    })();
    document.addEventListener('mouseover', e => {
      const hit = e.target.closest('a, button, [data-cursor], .sig, .cat');
      cur.classList.toggle('is-link', !!hit);
    });
  })();

  /* ── Révélations au défilement ───────────────────────── */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const d = en.target.dataset.delay || 0;
      setTimeout(() => en.target.classList.add('is-in'), Number(d));
      io.unobserve(en.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

  const observeReveals = () => $$('.reveal-up:not(.is-in), .cat:not(.is-in)').forEach(el => io.observe(el));

  /* ── Compteurs ───────────────────────────────────────── */
  (function counters () {
    const nums = $$('[data-count]');
    if (!nums.length) return;
    const cio = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const el = en.target, target = Number(el.dataset.count), dur = 1500;
        const t0 = performance.now();
        (function tick (now) {
          const p = Math.min((now - t0) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased).toLocaleString('fr-FR');
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
        cio.unobserve(el);
      });
    }, { threshold: 0.6 });
    nums.forEach(n => cio.observe(n));
  })();

  /* ── Inclinaison 3D légère ───────────────────────────── */
  (function tilt () {
    if (reduced || window.matchMedia('(hover: none)').matches) return;
    $$('[data-tilt]').forEach(el => {
      el.style.transformStyle = 'preserve-3d';
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateY(-6px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  })();

  /* ── Prix à la française ─────────────────────────────── */
  const euro = n => n.toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

  /* ── Rendu de la carte ───────────────────────────────── */
  (function renderMenu () {
    const grid = $('#menuGrid'), filters = $('#filters');
    if (!grid || typeof MENU === 'undefined') return;

    grid.innerHTML = MENU.map(cat => `
      <section class="cat${cat.items.some(i => i.photo) ? ' cat--photos' : ''}" data-cat="${cat.id}">
        <header class="cat__head">
          <h3>${cat.name}</h3>
          <p>${cat.tagline}</p>
        </header>
        ${cat.items.map(it => `
          <article class="dish">
            ${it.photo ? `
              <button type="button" class="dish__thumb" data-photo="${it.photo}" data-name="${it.name}"
                      aria-label="Agrandir la photo : ${it.name}">
                <img src="assets/img/plats/${it.photo}.jpg" alt="${it.name}" loading="lazy">
              </button>` : ''}
            <h4 class="dish__name">
              ${it.name}
              ${it.veg ? '<i class="veg-dot" title="Végétarien" aria-label="Végétarien"></i>' : ''}
              ${it.star ? '<span class="dish__star">Signature</span>' : ''}
            </h4>
            <span class="dish__price">${euro(it.price)}</span>
            <p class="dish__desc">${it.desc}</p>
          </article>`).join('')}
      </section>`).join('');

    const cats = [{ id: 'all', name: 'Tout' }].concat(MENU.map(c => ({ id: c.id, name: c.name })));
    filters.innerHTML = cats.map((c, i) =>
      `<button type="button" role="tab" data-filter="${c.id}" class="${i === 0 ? 'is-active' : ''}" aria-selected="${i === 0}">${c.name}</button>`
    ).join('');

    filters.addEventListener('click', e => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      $$('button', filters).forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      const f = btn.dataset.filter;
      grid.classList.toggle('is-single', f !== 'all');
      $$('.cat', grid).forEach(sec => {
        const show = f === 'all' || sec.dataset.cat === f;
        sec.classList.toggle('is-hidden', !show);
        if (show) { sec.classList.remove('is-in'); requestAnimationFrame(() => sec.classList.add('is-in')); }
      });
    });

    observeReveals();
    injectSchema();
    lightbox(grid);
  })();

  /* ── Visionneuse plein écran ─────────────────────────── */
  function lightbox (scope) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = `
      <button type="button" class="lightbox__close" aria-label="Fermer">&times;</button>
      <figure class="lightbox__fig">
        <img alt="">
        <figcaption></figcaption>
      </figure>`;
    document.body.appendChild(box);

    const img = $('img', box), cap = $('figcaption', box);
    let opener = null;

    const open = btn => {
      opener = btn;
      img.src = btn.querySelector('img').src;
      img.alt = btn.dataset.name;
      cap.textContent = btn.dataset.name;
      box.classList.add('is-open');
      box.setAttribute('aria-hidden', 'false');
      document.body.classList.add('is-locked');
      $('.lightbox__close', box).focus();
    };
    const close = () => {
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('is-locked');
      if (opener) opener.focus();
    };

    scope.addEventListener('click', e => {
      const btn = e.target.closest('.dish__thumb');
      if (btn) open(btn);
    });
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('.lightbox__close')) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && box.classList.contains('is-open')) close();
    });
  }

  /* ── Données structurées (SEO) ───────────────────────── */
  function injectSchema () {
    if (typeof MENU === 'undefined') return;
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'La Table de Carthage',
      description: "Restaurant tunisien à Puteaux : couscous, ojja, kafteji, grillades au charbon de bois et pâtisseries maison.",
      image: base + 'assets/img/logo.jpg',
      servesCuisine: ['Tunisienne', 'Méditerranéenne', 'Nord-africaine'],
      priceRange: '€€',
      currenciesAccepted: 'EUR',
      paymentAccepted: 'Espèces, Carte bancaire',
      telephone: '+33761976711',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '6 boulevard Richard Wallace',
        postalCode: '92800',
        addressLocality: 'Puteaux',
        addressRegion: 'Île-de-France',
        addressCountry: 'FR'
      },
      geo: { '@type': 'GeoCoordinates', latitude: 48.878831, longitude: 2.242182 },
      hasMap: 'https://maps.google.com/?q=6+boulevard+Richard+Wallace+92800+Puteaux',
      sameAs: [
        'https://www.instagram.com/latab_ledecarthage',
        'https://www.facebook.com/p/La-Table-de-Carthage-61583761137287/',
        'https://annuaire-entreprises.data.gouv.fr/entreprise/la-table-de-carthage-100477553'
      ],
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], opens: '12:00', closes: '23:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Sunday', opens: '12:00', closes: '22:00' }
      ],
      acceptsReservations: 'True',
      makesOffer: [
        { '@type': 'Offer', name: "Formule dîner d'affaires", description: "Menu convenu à l'avance et service cadencé pour les repas professionnels." },
        { '@type': 'Offer', name: 'Privatisation', description: "Établissement privatisé en exclusivité pour un événement, menu sur mesure." },
        { '@type': 'Offer', name: 'Traiteur', description: 'Prestation traiteur hors les murs.' }
      ],
      hasMenu: {
        '@type': 'Menu',
        hasMenuSection: MENU.map(c => ({
          '@type': 'MenuSection',
          name: c.name,
          hasMenuItem: c.items.map(i => {
            const item = {
              '@type': 'MenuItem',
              name: i.name,
              description: i.desc,
              offers: { '@type': 'Offer', price: i.price.toFixed(2), priceCurrency: 'EUR' }
            };
            if (i.photo) item.image = base + 'assets/img/plats/' + i.photo + '.jpg';
            return item;
          })
        }))
      }
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  /* ── WhatsApp ────────────────────────────────────────── */
  const WHATSAPP = '33761976711';
  const waLink = msg => 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg);
  const longDate = iso => new Date(iso + 'T00:00')
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  /* ── Formulaire → message WhatsApp prérempli ─────────── */
  (function bookForm () {
    const form = $('#bookForm'), out = $('#bookOk');
    if (!form) return;

    const date = $('#f-date');
    if (date) {
      date.min = new Date().toISOString().slice(0, 10);
      date.value = date.value || date.min;
    }

    form.addEventListener('submit', e => {
      e.preventDefault();
      $$('input, select, textarea', form).forEach(i => i.classList.add('is-touched'));

      if (!form.checkValidity()) {
        out.innerHTML = '';
        out.textContent = 'Merci de compléter les champs obligatoires.';
        out.classList.add('is-error');
        const bad = $(':invalid', form);
        if (bad) bad.focus();
        return;
      }

      const d = new FormData(form);
      const motif = d.get('motif') || 'Réservation';
      const lignes = [
        'Bonjour La Table de Carthage,',
        '',
        motif === 'Réservation'
          ? 'Je souhaite réserver une table.'
          : `Je vous contacte au sujet de : ${motif}.`,
        '',
        `Nom : ${d.get('nom')}`,
        `Téléphone : ${d.get('tel')}`,
        `Date : ${longDate(d.get('date'))}`,
        `Heure : ${d.get('heure')} (${d.get('service')})`,
        `Couverts : ${d.get('couverts')}`
      ];
      const note = (d.get('message') || '').trim();
      if (note) lignes.push('', `Précisions : ${note}`);
      lignes.push('', 'Merci !');

      const url = waLink(lignes.join('\n'));
      const win = window.open(url, '_blank', 'noopener');

      out.classList.remove('is-error');
      out.innerHTML = win
        ? `Merci ${escapeHtml(d.get('nom'))} — votre message est prêt dans WhatsApp. Envoyez-le et nous confirmons rapidement.`
        : `Votre message est prêt : <a href="${url}" target="_blank" rel="noopener">ouvrir WhatsApp</a>.`;
    });
  })();

  /* ── Boutons des formules → WhatsApp ─────────────────── */
  (function offerButtons () {
    const textes = {
      affaires: "Bonjour La Table de Carthage,\n\nJe souhaite des informations sur votre formule dîner d'affaires (menu, tarifs et disponibilités).\n\nMerci !",
      privatisation: "Bonjour La Table de Carthage,\n\nJe souhaite privatiser votre établissement pour un événement. Pouvez-vous me communiquer les conditions et un devis ?\n\nMerci !"
    };
    $$('[data-wa]').forEach(a => {
      const t = textes[a.dataset.wa];
      if (!t) return;
      a.href = waLink(t);
      a.target = '_blank';
      a.rel = 'noopener';
    });
  })();

  function escapeHtml (str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── Toile du hero : poussière d'or & constellation ──── */
  (function heroCanvas () {
    const cv = $('#heroCanvas');
    if (!cv || reduced) return;
    const ctx = cv.getContext('2d');
    let w, h, dpr, pts = [], mouse = { x: -999, y: -999 }, raf;

    function size () {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(110, (w * h) / 13000));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.6 + 0.4,
        a: Math.random() * 0.5 + 0.25
      }));
    }

    function frame () {
      ctx.clearRect(0, 0, w, h);

      // liens fins entre points proches
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;

        const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (dm < 130) { p.x += (p.x - mouse.x) / dm * 0.6; p.y += (p.y - mouse.y) / dm * 0.6; }

        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < 118) {
            ctx.globalAlpha = (1 - d / 118) * 0.13;
            ctx.strokeStyle = '#C9A961';
            ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = '#D9BE7E';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    size();
    frame();
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); size(); frame(); });
    cv.parentElement.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    cv.parentElement.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });

    // pause hors écran
    new IntersectionObserver(([en]) => {
      if (en.isIntersecting) { cancelAnimationFrame(raf); frame(); }
      else cancelAnimationFrame(raf);
    }, { threshold: 0 }).observe(cv);
  })();

  /* ── Parallaxe douce du médaillon ────────────────────── */
  (function parallax () {
    if (reduced) return;
    const els = $$('.medallion, .hero__column');
    if (!els.length) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        els.forEach(el => {
          const r = el.getBoundingClientRect();
          const off = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
          el.style.setProperty('--py', (off * -22).toFixed(2) + 'px');
          el.style.translate = '0 ' + (off * -22).toFixed(2) + 'px';
        });
        ticking = false;
      });
    }, { passive: true });
  })();

  /* ── Mentions légales ────────────────────────────────── */
  (function legal () {
    const btn = $('#legalToggle'), box = $('#legalBox');
    if (!btn || !box) return;
    btn.addEventListener('click', () => {
      const open = box.hasAttribute('hidden');
      box.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('is-open', open);
    });
  })();

  observeReveals();
})();
