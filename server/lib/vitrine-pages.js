/** Les pages secondaires du site vitrine : la carte, la privatisation, le
 *  traiteur. Chacune répond à une recherche précise (« traiteur tunisien
 *  Puteaux », « privatiser un restaurant La Défense ») que l'ancre d'une page
 *  unique ne pouvait pas porter. Le texte ne dit que ce que la maison propose
 *  déjà sur l'accueil : pas de tarif ni de capacité inventés. */
import { esc, htmlCarte, SITE } from './seo.js';

const WHATSAPP = '33761976711';
const wa = msg => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;

const LIEN_WA_AFFAIRES = wa("Bonjour La Table de Carthage,\n\nJe souhaite des informations sur votre formule dîner d'affaires (menu, tarifs et disponibilités).\n\nMerci !");
const LIEN_WA_PRIVATISATION = wa("Bonjour La Table de Carthage,\n\nJe souhaite privatiser votre établissement pour un événement. Pouvez-vous me communiquer les conditions et un devis ?\n\nMerci !");
const LIEN_WA_TRAITEUR = wa("Bonjour La Table de Carthage,\n\nJe souhaite un devis pour une prestation traiteur (date, nombre de personnes et lieu à préciser).\n\nMerci !");

const entete = (surtitre, titre, intro) => `
  <header class="vp-hero">
    <div class="wrap">
      <p class="eyebrow">${esc(surtitre)}</p>
      <h1 class="vp-title">${titre}</h1>
      <p class="vp-intro">${intro}</p>
    </div>
  </header>`;

const bouton = (href, texte, externe = false) =>
  `<a class="btn btn--gold" href="${href}"${externe ? ' target="_blank" rel="noopener"' : ''}><span>${texte}</span></a>`;

const liens = `
  <p class="vp-links">
    <a href="/reserver">Réserver une table</a> ·
    <a href="/commander">Commander à emporter</a> ·
    <a href="/carte">La carte</a> ·
    <a href="/privatisation">Privatisation</a> ·
    <a href="/traiteur">Traiteur</a> ·
    <a href="/#reserver">Adresse et horaires</a>
  </p>`;

/** La carte : même balisage et mêmes styles que sur l'accueil. */
export function pageCarte(menu) {
  const corps = menu.length
    ? `<div class="menu__grid">${htmlCarte(menu)}</div>`
    : '<p class="vp-vide">La carte est en cours de mise à jour. Contactez-nous au 07 61 97 67 11.</p>';
  return `
  ${entete('La carte',
    'La carte du restaurant tunisien à Puteaux',
    "Couscous, ojja, kafteji, mloukhia, grillades au charbon de bois, poisson du jour et pâtisseries tunisiennes : tous nos plats sont préparés à la commande. Prix nets, service compris.")}
  <section class="menu vp-carte">
    <div class="wrap">
      <h2 class="sr-only">Plats, prix et photos</h2>
      ${corps}
      <p class="menu__note">
        Une allergie, un régime particulier ? Prévenez-nous : la cuisine s'adapte.
        <span class="nowrap">Plats végétariens signalés par <i class="veg-dot" aria-hidden="true"></i>.</span>
      </p>
      <p class="vp-cta">
        ${bouton('/commander', 'Commander à emporter')}
        ${bouton('/reserver', 'Réserver une table')}
      </p>
    </div>
  </section>
  <section class="vp-bloc"><div class="wrap vp-prose">
    <h2 class="h2">Une cuisine tunisienne de tradition, à deux pas de La Défense</h2>
    <p>La Table de Carthage sert la cuisine que l'on prépare en Tunisie, sans la traduire ni l'adoucir :
    couscous à l'agneau, au poulet, au merguez ou végétarien, ojja au merguez ou aux fruits de mer,
    kafteji, mloukhia mijotée pendant des heures, kamounia, grillades saisies à la commande et poisson grillé du jour.</p>
    <p>La maison est située au 6 boulevard Richard Wallace, à Puteaux (Front de Seine). Vous pouvez
    déjeuner ou dîner sur place, en salle ou en terrasse, emporter votre commande ou nous confier
    un événement : voir la <a href="/privatisation">privatisation</a> et le <a href="/traiteur">service traiteur</a>.</p>
    ${liens}
  </div></section>`;
}

export function pagePrivatisation() {
  return `
  ${entete('Recevoir',
    'Privatiser un restaurant tunisien à Puteaux, près de La Défense',
    "Anniversaire, fiançailles, repas de famille, séminaire ou dîner d'affaires : nous fermons au public et la maison devient la vôtre, le temps d'un service ou d'une soirée.")}
  <section class="vp-bloc"><div class="wrap">
    <div class="offers__grid">
      <article class="offer" id="privatisation">
        <h2>Privatisation de la salle</h2>
        <p class="offer__lead">La salle entière, pour votre événement.</p>
        <p>Le restaurant est privatisé en exclusivité, midi ou soir, pour un service ou une soirée complète.
        Le menu est construit avec vous, de la formule unique servie à l'assiette au grand buffet de spécialités tunisiennes.</p>
        <ul class="offer__list">
          <li>Salle privatisée en exclusivité, midi ou soir</li>
          <li>Menu sur mesure, du service à l'assiette au grand buffet</li>
          <li>Prestation traiteur possible hors les murs</li>
          <li>Devis établi après échange sur votre projet</li>
        </ul>
        ${bouton(LIEN_WA_PRIVATISATION, 'Demander un devis', true)}
      </article>
      <article class="offer" id="affaires">
        <h2>Formule dîner d'affaires</h2>
        <p class="offer__lead">Une table où l'on parle sérieusement.</p>
        <p>Pensée pour les rendez-vous professionnels du quartier d'affaires : un menu arrêté à l'avance,
        un service rythmé pour tenir votre créneau, et une table placée à l'écart du passage.
        Vous savez à l'avance ce que vous mangez, ce que vous payez et à quelle heure vous ressortez.</p>
        <ul class="offer__list">
          <li>Menu convenu en amont, sans carte à arbitrer sur place</li>
          <li>Service cadencé pour un déjeuner ou un dîner en temps maîtrisé</li>
          <li>Note unique, facture au nom de la société</li>
          <li>À deux pas de La Défense et du Front de Seine</li>
        </ul>
        ${bouton(LIEN_WA_AFFAIRES, 'Demander la formule', true)}
      </article>
    </div>
  </div></section>
  <section class="vp-bloc vp-bloc--creme"><div class="wrap vp-prose">
    <h2 class="h2">Comment ça se passe</h2>
    <ol class="vp-steps">
      <li><b>Vous nous écrivez</b> par WhatsApp ou par téléphone au <a href="tel:+33761976711">07 61 97 67 11</a> : date, nombre de convives, type d'événement.</li>
      <li><b>Nous construisons le menu</b> avec vous, à partir des plats de la <a href="/carte">carte</a> ou d'un buffet de spécialités.</li>
      <li><b>Vous recevez un devis</b> établi après échange sur votre projet.</li>
    </ol>
    <p>Réponse la plus rapide par <a href="https://wa.me/33761976711" target="_blank" rel="noopener">WhatsApp</a>.
    Pour un repas hors les murs, voir notre <a href="/traiteur">service traiteur</a>.</p>
    ${liens}
  </div></section>`;
}

export function pageTraiteur() {
  return `
  ${entete('Traiteur',
    'Traiteur tunisien à Puteaux et dans les Hauts-de-Seine',
    "Les plats de La Table de Carthage hors les murs : couscous, ojja, grillades et pâtisseries tunisiennes pour vos repas de famille, événements et réceptions d'entreprise.")}
  <section class="vp-bloc"><div class="wrap vp-prose">
    <h2 class="h2">Une prestation traiteur sur mesure</h2>
    <p>Nous préparons pour vous la cuisine tunisienne de la maison : la semoule et le bouillon du couscous,
    les grillades, les ojja, les spécialités mijotées et les pâtisseries tunisiennes. Le menu est composé avec vous
    selon la date, le nombre de personnes et le lieu de votre réception.</p>
    <ul class="offer__list">
      <li>Prestation hors les murs, pour particuliers et entreprises</li>
      <li>Menu composé à partir de la <a href="/carte">carte</a> ou d'un buffet de spécialités tunisiennes</li>
      <li>Devis établi après échange sur votre projet</li>
    </ul>
    <p class="vp-cta">${bouton(LIEN_WA_TRAITEUR, 'Demander un devis traiteur', true)}</p>
    <p>Vous préférez recevoir chez nous ? La salle peut être <a href="/privatisation">privatisée</a> pour votre événement.
    Pour un repas d'affaires, la <a href="/privatisation#affaires">formule dîner d'affaires</a> garantit un service cadencé.</p>
    <p>Contact : <a href="tel:+33761976711">07 61 97 67 11</a> — La Table de Carthage, 6 boulevard Richard Wallace, 92800 Puteaux.</p>
    ${liens}
  </div></section>`;
}

/** Définition des pages : chemin, titre, description, contenu. */
export function definitionsPages(menu) {
  return [
    {
      chemin: '/carte',
      titre: 'La carte — Restaurant tunisien à Puteaux | La Table de Carthage',
      nom: 'La carte',
      description: "La carte de La Table de Carthage, restaurant tunisien à Puteaux : couscous, ojja, kafteji, mloukhia, grillades et pâtisseries maison. Sur place ou à emporter.",
      contenu: pageCarte(menu),
      avecMenu: true,
    },
    {
      chemin: '/privatisation',
      titre: 'Privatiser un restaurant à Puteaux (La Défense) | La Table de Carthage',
      nom: 'Privatisation',
      description: "Privatisez La Table de Carthage à Puteaux, près de La Défense : anniversaire, repas de famille, séminaire ou dîner d'affaires. Menu tunisien sur mesure, devis rapide.",
      contenu: pagePrivatisation(),
    },
    {
      chemin: '/traiteur',
      titre: 'Traiteur tunisien à Puteaux (92) | La Table de Carthage',
      nom: 'Traiteur',
      description: "Traiteur tunisien à Puteaux et dans les Hauts-de-Seine : couscous, ojja, grillades et pâtisseries pour vos repas de famille et réceptions. Devis sur mesure.",
      contenu: pageTraiteur(),
    },
  ];
}

export const urlCarte = `${SITE}/carte`;
