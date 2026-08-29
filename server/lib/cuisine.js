import { query, une, executer } from '../db.js';

/** Le cycle de vie d'une commande vu de la cuisine.
 *
 *  Avant, une commande restait « confirmée » de son enregistrement à sa
 *  sortie : la salle n'avait aucun moyen de savoir si la cuisine l'avait
 *  seulement lue. Quatre états suffisent à répondre à la seule question
 *  qu'on se pose au passe — où en est ce plat ?
 */

export const ETATS = ['confirmee', 'vue', 'en_preparation', 'prete'];

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
  const anterieurs = ETATS.slice(0, rang);
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
    [date, ETATS]
  );
  if (!commandes.length) return { commandes: [], parEtat: Object.fromEntries(ETATS.map(e => [e, []])) };

  const lignes = await query(
    `SELECT commande_id, nom, quantite FROM commande_lignes
      WHERE commande_id = ANY($1::int[]) ORDER BY id`,
    [commandes.map(c => c.id)]
  );
  const parCommande = new Map(commandes.map(c => [c.id, []]));
  for (const l of lignes) parCommande.get(l.commande_id)?.push(l);

  const maintenant = Date.now();
  const enrichies = commandes.map(c => {
    const depuis = c.statut === 'prete' ? c.prete_le
      : c.statut === 'en_preparation' ? c.preparation_le
      : c.cree_le;
    return {
      ...c,
      lignes: parCommande.get(c.id) || [],
      minutes: Math.max(0, Math.round((maintenant - new Date(depuis ?? c.cree_le).getTime()) / 60000)),
      suivant: suivant(c.statut),
    };
  });

  return {
    commandes: enrichies,
    parEtat: Object.fromEntries(ETATS.map(e => [e, enrichies.filter(c => c.statut === e)])),
  };
}
