import { query, une, executer } from '../db.js';

/** Le cycle de vie d'une commande vu de la cuisine.
 *
 *  Avant, une commande restait « confirmée » de son enregistrement à sa
 *  sortie : la salle n'avait aucun moyen de savoir si la cuisine l'avait
 *  seulement lue. Quatre états suffisent à répondre à la seule question
 *  qu'on se pose au passe — où en est ce plat ?
 */

/** Les quatre colonnes du passe.
 *
 *  'confirmee' porte la colonne « Nouvelle », mais elle n'est pas seule à y
 *  tomber : une commande passée par un client — QR de table ou tunnel à
 *  emporter — arrive en 'en_attente', l'état qui dit « reçue, pas encore
 *  traitée par la maison ». Les deux veulent dire la même chose au piano,
 *  et n'en distinguer qu'une revenait à ne jamais montrer les commandes des
 *  clients. */
export const ETATS = ['confirmee', 'vue', 'en_preparation', 'prete'];

/** Les statuts qu'une colonne accepte. Seule la première en couvre deux. */
export const STATUTS_DE = {
  confirmee: ['en_attente', 'confirmee'],
  vue: ['vue'],
  en_preparation: ['en_preparation'],
  prete: ['prete'],
};

/** Tous les statuts visibles au passe, à plat. */
export const STATUTS_AU_PASSE = ETATS.flatMap(e => STATUTS_DE[e]);

/** La colonne d'un statut. */
export function colonneDe(statut) {
  return ETATS.find(e => STATUTS_DE[e].includes(statut)) ?? null;
}

export const LIBELLES = {
  en_attente: 'En attente',
  confirmee: 'Nouvelle',
  vue: 'Lue',
  en_preparation: 'En préparation',
  prete: 'Prête',
  retiree: 'Retirée',
  encaissee: 'Payée',
  annulee: 'Annulée',
};

/** L'horodatage que pose chaque passage. Ils servent à afficher un temps
 *  d'attente qui a du sens : au passe, ce qui compte n'est pas l'âge de la
 *  commande mais depuis combien de temps elle est au feu, ou prête et non
 *  servie. */
const HORODATAGE = { vue: 'vue_le', en_preparation: 'preparation_le', prete: 'prete_le' };

/** L'état suivant, ou null si la commande est déjà prête. */
export function suivant(statut) {
  const i = ETATS.indexOf(statut);
  return i === -1 || i === ETATS.length - 1 ? null : ETATS[i + 1];
}

/** Fait avancer une commande.
 *
 *  Le mouvement ne va que vers l'avant : deux écrans de cuisine ouverts sur
 *  le même passe se doublent forcément, et un « lue » arrivé en retard ne
 *  doit pas faire reculer une commande déjà au feu. La condition porte sur
 *  la position dans ETATS, pas sur une simple égalité, pour que le cas soit
 *  tranché par la base et non par ce qu'un écran croyait savoir.
 */
export async function avancer(commandeId, vers) {
  if (!ETATS.includes(vers)) return { erreur: 'État inconnu.' };
  const rang = ETATS.indexOf(vers);
  // Les statuts acceptés en entrée, et non les seules colonnes : une
  // commande client part de 'en_attente', qui doit pouvoir avancer comme
  // 'confirmee'.
  const anterieurs = ETATS.slice(0, rang).flatMap(e => STATUTS_DE[e]);
  const colonne = HORODATAGE[vers];

  const maj = await une(
    `UPDATE commandes
        SET statut = $1${colonne ? `, ${colonne} = COALESCE(${colonne}, now())` : ''}
      WHERE id = $2 AND statut = ANY($3::text[])
      RETURNING id, reference, statut`,
    [vers, commandeId, anterieurs]
  );
  if (!maj) return { erreur: 'Cette commande a déjà avancé.' };
  return { commande: maj };
}

/** Ramène une commande prête au feu : le plat est retombé, il repart. */
export async function ramenerEnPreparation(commandeId) {
  await executer(
    `UPDATE commandes SET statut = 'en_preparation', prete_le = NULL
      WHERE id = $1 AND statut = 'prete'`,
    [commandeId]
  );
}

/** L'heure de Paris en minutes depuis minuit.
 *
 *  Le serveur tourne en UTC ; les heures de retrait sont écrites à l'heure
 *  de la salle. Comparer les deux sans conversion décalerait le compte à
 *  rebours de deux heures l'été. */
function minutesDuJourAParis() {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parties = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, p.value]));
  return Number(parties.hour) * 60 + Number(parties.minute);
}

/** 'HH:MM' en minutes depuis minuit. */
function minutesDeLHeure(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

/** Le degré d'urgence d'un ticket, sur lequel se règle sa couleur.
 *
 *  En salle : le temps passé dans l'état en cours. À emporter : la
 *  proximité de l'heure de retrait. */
function urgenceDe(type, attente, avantRetrait) {
  if (type === 'emporter') {
    if (avantRetrait === null) return 'calme';
    if (avantRetrait <= 0) return 'tardif';      // l'heure est passée
    if (avantRetrait <= 20) return 'long';       // il faut s'y mettre
    return 'calme';
  }
  if (attente >= 20) return 'tardif';
  if (attente >= 10) return 'long';
  return 'calme';
}

/** Le tableau de la cuisine : tout ce qui est en cours aujourd'hui.
 *
 *  Les commandes payées, retirées ou annulées n'y figurent pas — elles ne
 *  concernent plus le piano. */
export async function tableauDuJour(date) {
  const commandes = await query(
    `SELECT cmd.id, cmd.reference, cmd.type, cmd.statut, cmd.heure, cmd.message,
            cmd.cree_le, cmd.vue_le, cmd.preparation_le, cmd.prete_le,
            c.prenom, c.nom AS client_nom, c.telephone_saisi,
            t.nom AS table_nom
       FROM commandes cmd
       JOIN clients c ON c.id = cmd.client_id
       LEFT JOIN tablees tb ON tb.id = cmd.tablee_id
       LEFT JOIN tables_resto t ON t.id = tb.table_id
      WHERE cmd.date = $1 AND cmd.statut = ANY($2::text[])
      ORDER BY cmd.cree_le`,
    [date, STATUTS_AU_PASSE]
  );
  if (!commandes.length) {
    return { commandes: [], parEtat: Object.fromEntries(ETATS.map(e => [e, []])) };
  }

  const lignes = await query(
    `SELECT commande_id, nom, quantite FROM commande_lignes
      WHERE commande_id = ANY($1::int[]) ORDER BY id`,
    [commandes.map(c => c.id)]
  );
  const parCommande = new Map(commandes.map(c => [c.id, []]));
  for (const l of lignes) parCommande.get(l.commande_id)?.push(l);

  const maintenant = Date.now();
  const minutesMaintenant = minutesDuJourAParis();

  const enrichies = commandes.map(c => {
    const depuis = c.statut === 'prete' ? c.prete_le
      : c.statut === 'en_preparation' ? c.preparation_le
      : c.cree_le;
    const colonne = colonneDe(c.statut);
    const attente = Math.max(0, Math.round((maintenant - new Date(depuis ?? c.cree_le).getTime()) / 60000));

    // Les deux circuits ne se mesurent pas de la même façon. Une commande
    // en salle est urgente parce qu'elle attend depuis longtemps ; une
    // commande à emporter l'est parce que l'heure de retrait approche.
    // Afficher son ancienneté n'apprendrait rien — un client qui commande
    // le matin pour le soir afficherait « 512 min » sans que rien ne presse.
    const avantRetrait = c.type === 'emporter'
      ? minutesDeLHeure(c.heure) - minutesMaintenant
      : null;

    return {
      ...c,
      colonne,
      lignes: parCommande.get(c.id) || [],
      minutes: attente,
      avantRetrait,
      urgence: urgenceDe(c.type, attente, avantRetrait),
      suivant: suivant(colonne),
    };
  });

  return {
    commandes: enrichies,
    parEtat: Object.fromEntries(ETATS.map(e => [e, enrichies.filter(c => c.colonne === e)])),
  };
}
