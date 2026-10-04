/** Tout ce qui sert au référencement : URL canoniques, balises meta,
 *  données structurées, robots.txt, sitemap. Rassemblé ici pour que la page
 *  d'accueil, /carte et les pages dédiées disent la même chose du restaurant. */

/** Adresse publique du site. Surchargeable (SITE_URL) pour un aperçu ou un
 *  autre domaine ; sans variable, le domaine de production. */
export const SITE = (process.env.SITE_URL || 'https://table-de-carthage.com').replace(/\/+$/, '');
export const NOM = 'La Table de Carthage';
export const TELEPHONE = '+33761976711';

export const DESCRIPTION_ACCUEIL =
  'Restaurant tunisien à Puteaux, près de La Défense : couscous, ojja, kafteji, grillades et pâtisseries maison. Sur place, à emporter, livraison. Ouvert 7j/7.';

export const urlAbsolue = chemin => SITE + (chemin.startsWith('/') ? chemin : '/' + chemin);

const IMAGE_PARTAGE = '/assets/img/salle-hero.jpg';

// ── Pages à ne pas référencer ────────────────────────────────
// Espaces de travail, comptes, paiements, QR de table, confirmations : rien
// de ceci n'a sa place dans un moteur de recherche. La liste est ici, en un
// seul endroit, pour le robots.txt comme pour l'en-tête X-Robots-Tag.
const PREFIXES_PRIVES = ['salon', 'service', 'cuisine', 'compte', 'paiement', 'table', 'api', 'manifeste'];
const RE_PRIVE = new RegExp(`^/(${PREFIXES_PRIVES.join('|')})(/|$)|/confirmation/?$|^/evenements/reglement/`);

export const estPrive = chemin => RE_PRIVE.test(chemin);

/** Corps du robots.txt. */
export function robotsTxt() {
  return [
    'User-agent: *',
    ...PREFIXES_PRIVES.map(p => `Disallow: /${p}/`),
    'Disallow: /reserver/confirmation',
    'Disallow: /commander/confirmation',
    'Allow: /',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');
}

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

/** Balises <head> de référencement d'une page. `chemin` sert à la fois de
 *  canonique et d'og:url : sans paramètres, pour que /reserver?x=1 et
 *  /reserver ne soient pas deux pages. */
export function metaTags({ description, chemin = '/', noindex = false, image = IMAGE_PARTAGE, titre, type = 'website' }) {
  const url = urlAbsolue(chemin);
  const img = urlAbsolue(image);
  const lignes = [];
  if (description) lignes.push(`<meta name="description" content="${esc(description)}">`);
  lignes.push(noindex
    ? '<meta name="robots" content="noindex, nofollow">'
    : '<meta name="robots" content="index, follow, max-image-preview:large">');
  if (!noindex) {
    lignes.push(`<link rel="canonical" href="${url}">`);
    lignes.push(
      `<meta property="og:site_name" content="${NOM}">`,
      `<meta property="og:locale" content="fr_FR">`,
      `<meta property="og:type" content="${type}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${img}">`,
      `<meta property="og:image:width" content="1400">`,
      `<meta property="og:image:height" content="840">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:image" content="${img}">`,
    );
    if (titre) lignes.push(`<meta property="og:title" content="${esc(titre)}">`, `<meta name="twitter:title" content="${esc(titre)}">`);
    if (description) lignes.push(`<meta property="og:description" content="${esc(description)}">`, `<meta name="twitter:description" content="${esc(description)}">`);
  }
  return lignes.join('\n');
}

/** Un bloc JSON-LD. `<` est échappé : une description contenant « </script> »
 *  ne doit pas fermer la balise. */
export const scriptJsonLd = donnees =>
  `<script type="application/ld+json">${JSON.stringify(donnees).replace(/</g, '\\u003c')}</script>`;

// ── Carte rendue côté serveur ────────────────────────────────
const CHEMIN_PLATS = '/assets/img/plats/';

/** Largeurs autorisées par l'optimiseur d'images de Vercel : doivent
 *  correspondre à `images.sizes` dans vercel.json. */
export const LARGEURS_IMAGES = [256, 640];

/** Les photos téléversées depuis le salon sont des JPG de 1000 px sur
 *  Vercel Blob ; affichées en vignette de 74 px, elles pesaient chacune
 *  100 à 200 Ko. Sur Vercel, on les fait passer par l'optimiseur
 *  (/_vercel/image) qui les redimensionne et les sert en WebP. Ailleurs
 *  (développement), l'URL d'origine est rendue telle quelle. */
export function imageOptimisee(url, largeur) {
  if (!process.env.VERCEL || !/^https:\/\//.test(url)) return url;
  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${largeur}&q=75`;
}

const estLocalSeed = photo => !/^https?:\/\//.test(photo) && !photo.startsWith('/');

/** Adresse d'une photo de plat : une URL Blob ou un chemin /uploads/... est
 *  utilisable telle quelle ; un simple nom vient de la carte d'amorçage. */
export function cheminPhoto(photo) {
  return estLocalSeed(photo) ? `${CHEMIN_PLATS}${photo}.jpg` : photo;
}

export const euro = n =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

function htmlVignette(photo, nom) {
  const src = estLocalSeed(photo) ? cheminPhoto(photo) : imageOptimisee(cheminPhoto(photo), 256);
  const img = `<img src="${esc(src)}" alt="${esc(nom)}" width="160" height="160" loading="lazy" decoding="async">`;
  // Les photos de la carte d'amorçage ont une vignette WebP ; celles
  // téléversées depuis le salon restent telles quelles.
  return estLocalSeed(photo)
    ? `<picture><source type="image/webp" srcset="${CHEMIN_PLATS}${esc(photo)}-160.webp">${img}</picture>`
    : img;
}

/** Même balisage que celui que dessinait main.js : le style et la
 *  visionneuse n'ont pas à savoir d'où vient la carte. */
export function htmlCarte(menu) {
  return menu.map(cat => `
      <section class="cat${cat.items.some(i => i.photo) ? ' cat--photos' : ''}" data-cat="${esc(cat.id)}">
        <header class="cat__head">
          <h3>${esc(cat.name)}</h3>
          <p>${esc(cat.tagline)}</p>
        </header>
        ${cat.items.map(it => `
          <article class="dish">
            ${it.photo ? `
              <button type="button" class="dish__thumb" data-photo="${esc(it.photo)}" data-full="${esc(imageOptimisee(cheminPhoto(it.photo), 640))}" data-name="${esc(it.name)}"
                      aria-label="Agrandir la photo : ${esc(it.name)}">
                ${htmlVignette(it.photo, it.name)}
              </button>` : ''}
            <h4 class="dish__name">
              ${esc(it.name)}
              ${it.veg ? '<i class="veg-dot" role="img" title="Végétarien" aria-label="Végétarien"></i>' : ''}
              ${it.star ? '<span class="dish__star">Signature</span>' : ''}
            </h4>
            <span class="dish__price">${euro(it.price)}</span>
            <p class="dish__desc">${esc(it.desc)}</p>
          </article>`).join('')}
      </section>`).join('');
}

export function htmlFiltres(menu) {
  return [{ id: 'all', name: 'Tout' }, ...menu.map(c => ({ id: c.id, name: c.name }))]
    .map((c, i) =>
      `<button type="button" role="tab" data-filter="${esc(c.id)}" class="${i === 0 ? 'is-active' : ''}" aria-selected="${i === 0}">${esc(c.name)}</button>`)
    .join('');
}

// ── Données structurées ──────────────────────────────────────
const ADRESSE = {
  '@type': 'PostalAddress',
  streetAddress: '6 boulevard Richard Wallace',
  postalCode: '92800',
  addressLocality: 'Puteaux',
  addressRegion: 'Île-de-France',
  addressCountry: 'FR',
};

const imageSchema = photo => {
  const c = cheminPhoto(photo);
  return /^https?:\/\//.test(c) ? c : urlAbsolue(c);
};

function sectionsMenu(menu) {
  return menu.map(c => ({
    '@type': 'MenuSection',
    name: c.name,
    description: c.tagline,
    hasMenuItem: c.items.map(i => {
      const item = {
        '@type': 'MenuItem',
        name: i.name,
        description: i.desc,
        offers: { '@type': 'Offer', price: i.price.toFixed(2), priceCurrency: 'EUR' },
      };
      if (i.veg) item.suitableForDiet = 'https://schema.org/VegetarianDiet';
      if (i.photo) item.image = imageSchema(i.photo);
      return item;
    }),
  }));
}

/** La fiche Restaurant, identique d'une page à l'autre : le @id permet aux
 *  pages secondaires de s'y référer sans la répéter. */
export function jsonLdRestaurant(menu = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${SITE}/#restaurant`,
    name: NOM,
    url: `${SITE}/`,
    description: "Restaurant tunisien à Puteaux, près de La Défense : couscous, ojja, kafteji, grillades au charbon de bois et pâtisseries maison.",
    logo: urlAbsolue('/assets/img/logo.jpg'),
    image: ['/assets/img/salle-hero.jpg', '/assets/img/facade.jpg', '/assets/img/salle.jpg', '/assets/img/logo.jpg'].map(urlAbsolue),
    servesCuisine: ['Tunisienne', 'Méditerranéenne', 'Nord-africaine'],
    priceRange: '€€',
    currenciesAccepted: 'EUR',
    paymentAccepted: 'Espèces, Carte bancaire',
    telephone: TELEPHONE,
    address: ADRESSE,
    geo: { '@type': 'GeoCoordinates', latitude: 48.878831, longitude: 2.242182 },
    hasMap: 'https://maps.google.com/?q=6+boulevard+Richard+Wallace+92800+Puteaux',
    sameAs: [
      'https://www.instagram.com/latab_ledecarthage',
      'https://www.facebook.com/p/La-Table-de-Carthage-61583761137287/',
      'https://share.google/F2eC15UbPln65rvK2',
      'https://annuaire-entreprises.data.gouv.fr/entreprise/la-table-de-carthage-100477553',
    ],
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '12:00', closes: '23:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Sunday', opens: '12:00', closes: '22:00' },
    ],
    acceptsReservations: true,
    potentialAction: {
      '@type': 'ReserveAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/reserver`, inLanguage: 'fr', actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform'] },
      result: { '@type': 'Reservation', name: 'Réserver une table' },
    },
    makesOffer: [
      { '@type': 'Offer', name: "Formule dîner d'affaires", url: `${SITE}/privatisation#affaires`, description: "Menu convenu à l'avance et service cadencé pour les repas professionnels." },
      { '@type': 'Offer', name: 'Privatisation', url: `${SITE}/privatisation`, description: "Établissement privatisé en exclusivité pour un événement, menu sur mesure." },
      { '@type': 'Offer', name: 'Traiteur', url: `${SITE}/traiteur`, description: 'Prestation traiteur hors les murs.' },
    ],
    hasMenu: menu.length
      ? { '@type': 'Menu', name: `Carte de ${NOM}`, url: `${SITE}/carte`, inLanguage: 'fr', hasMenuSection: sectionsMenu(menu) }
      : { '@type': 'Menu', name: `Carte de ${NOM}`, url: `${SITE}/carte` },
  };
}

/** Fil d'Ariane d'une page secondaire. */
export const jsonLdFilAriane = elements => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: elements.map(([nom, chemin], i) => ({
    '@type': 'ListItem', position: i + 1, name: nom, item: urlAbsolue(chemin),
  })),
});

/** Une page secondaire, rattachée au restaurant par son @id. */
export const jsonLdPage = ({ nom, description, chemin }) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: nom,
  description,
  url: urlAbsolue(chemin),
  inLanguage: 'fr',
  isPartOf: { '@type': 'WebSite', name: NOM, url: `${SITE}/` },
  about: { '@id': `${SITE}/#restaurant` },
});

export { sectionsMenu };

// ── Sitemap ──────────────────────────────────────────────────
export function sitemapXml(entrees) {
  const corps = entrees.map(({ chemin, priorite, frequence, date }) => `  <url>
    <loc>${esc(urlAbsolue(chemin))}</loc>${date ? `\n    <lastmod>${date}</lastmod>` : ''}
    <changefreq>${frequence || 'monthly'}</changefreq>
    <priority>${priorite ?? '0.5'}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${corps}\n</urlset>\n`;
}
