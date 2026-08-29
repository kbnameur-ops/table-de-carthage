/** Les quatre applications épinglables.
 *
 *  Une même base de code, mais quatre icônes distinctes sur l'écran
 *  d'accueil : la direction, la salle, la cuisine et les clients ne se
 *  posent pas les mêmes questions en ouvrant leur téléphone. Chacune a donc
 *  son manifeste, son nom et son point d'entrée.
 *
 *  Le nom affiché sous l'icône vient de deux endroits selon la plateforme :
 *  `short_name` du manifeste sur Android, la balise
 *  `apple-mobile-web-app-title` sur iOS. Les deux sont tenus ici, pour
 *  qu'ils ne divergent jamais.
 */

export const ESPACES = {
  client: {
    // Le client n'épingle pas un rôle, il épingle le restaurant.
    nom: 'La Table de Carthage',
    // Android tronque l'étiquette autour de douze caractères : « Table de
    // Carthage » y ressortirait coupé, « Carthage » se lit entier.
    court: 'Carthage',
    description: 'Réserver une table, commander à emporter, retrouver sa cagnotte.',
    depart: '/compte',
    portee: '/',
  },
  salon: {
    nom: 'Salon — La Table de Carthage',
    court: 'Salon',
    description: 'Le back-office du restaurant : salle, réservations, commandes, clients.',
    depart: '/salon',
    portee: '/salon',
  },
  service: {
    nom: 'Serveur — La Table de Carthage',
    court: 'Serveur',
    description: 'Prise de commande en salle, plan des tables et caisse.',
    depart: '/service',
    portee: '/service',
  },
  cuisine: {
    nom: 'Cuisine — La Table de Carthage',
    court: 'Cuisine',
    description: 'Le passe : commandes nouvelles, lues, en préparation, prêtes.',
    depart: '/cuisine',
    portee: '/cuisine',
  },
};

const ICONES = [
  { src: '/assets/img/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/assets/img/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  // Android découpe l'icône selon la forme du lanceur (cercle, goutte,
  // carré arrondi) : la version masquable réserve la marge nécessaire.
  { src: '/assets/img/icones/icone-masquable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export function manifeste(cle) {
  const e = ESPACES[cle];
  if (!e) return null;
  return {
    id: `carthage-${cle}`,
    name: e.nom,
    short_name: e.court,
    description: e.description,
    start_url: e.depart,
    scope: e.portee,
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'fr',
    dir: 'ltr',
    // Le crème du site, pour que l'écran de démarrage ne fasse pas un flash
    // blanc avant l'affichage de la première page.
    background_color: '#FAF6EC',
    theme_color: '#071A31',
    icons: ICONES,
  };
}

/** L'espace auquel appartient une URL. Sert à choisir le bon manifeste
 *  depuis les gabarits, sans que chaque route ait à le préciser. */
export function espaceDe(chemin = '/') {
  if (chemin.startsWith('/salon')) return 'salon';
  if (chemin.startsWith('/service')) return 'service';
  if (chemin.startsWith('/cuisine')) return 'cuisine';
  return 'client';
}
