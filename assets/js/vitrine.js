/* Menu burger des pages secondaires du site vitrine (/carte, /privatisation,
   /traiteur). La page d'accueil a son propre script, main.js. */
(function () {
  const burger = document.getElementById('burger');
  const links = document.getElementById('navLinks');
  if (!burger || !links) return;
  const fermer = () => {
    links.classList.remove('is-open');
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
  };
  burger.addEventListener('click', () => {
    const ouvert = links.classList.toggle('is-open');
    burger.classList.toggle('is-open', ouvert);
    burger.setAttribute('aria-expanded', String(ouvert));
  });
  links.addEventListener('click', e => { if (e.target.closest('a')) fermer(); });

  // Visionneuse des photos de plats (page /carte)
  const grille = document.querySelector('.menu__grid');
  if (!grille) return;
  const boite = document.createElement('div');
  boite.className = 'lightbox';
  boite.setAttribute('aria-hidden', 'true');
  boite.innerHTML = '<button type="button" class="lightbox__close" aria-label="Fermer">&times;</button>' +
    '<figure class="lightbox__fig"><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(boite);
  const img = boite.querySelector('img'), legende = boite.querySelector('figcaption');
  let origine = null;
  const fermerBoite = () => {
    boite.classList.remove('is-open');
    boite.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    if (origine) origine.focus();
  };
  grille.addEventListener('click', e => {
    const bouton = e.target.closest('.dish__thumb');
    if (!bouton) return;
    origine = bouton;
    img.src = bouton.querySelector('img').src;
    img.alt = bouton.dataset.name;
    legende.textContent = bouton.dataset.name;
    boite.classList.add('is-open');
    boite.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    boite.querySelector('.lightbox__close').focus();
  });
  boite.addEventListener('click', e => {
    if (e.target === boite || e.target.closest('.lightbox__close')) fermerBoite();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && boite.classList.contains('is-open')) fermerBoite();
  });
  // Révélation des catégories : sans l'observateur de main.js, elles resteraient transparentes.
  document.querySelectorAll('.cat').forEach(c => c.classList.add('is-in'));
})();
