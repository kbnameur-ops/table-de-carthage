import { une, query, executer, transaction } from '../db.js';
import { genererReference } from './reference.js';
import { aujourdHui } from './jours.js';

/** Les événements : soirées à thème, concerts, dîners de fête.
 *
 *  Un événement n'est pas un plat. On ne le commande pas, on y prend une
 *  place — d'où une date, un nombre de places, un prix par personne, et un
 *  paiement au moment de la réservation. C'est aussi pourquoi il vit dans
 *  ses propres tables plutôt que dans une catégorie de la carte.
 *
 *  ── Ce qui compte vraiment ici : les places ──
 *  Vendre deux fois la dernière place d'une soirée est la seule faute
 *  qu'on ne peut pas rattraper. Le décompte se fait donc dans une
 *  transaction qui verrouille l'événement, et jamais depuis un nombre lu à
 *  l'écran.
 */

/** Une réservation attend son paiement : sa place est retenue, mais pas
 *  pour toujours. Au-delà de ce délai, un panier abandonné à l'écran de
 *  carte bancaire rend sa place à la vente — sinon une soirée se
 *  retrouverait complète sans avoir rien vendu. */
const MINUTES_DE_RETENUE = 30;

const VIVANTES = `(statut = 'confirmee' OR statut = 'honoree'
                   OR (statut = 'a_payer' AND cree_le > now() - interval '${MINUTES_DE_RETENUE} minutes'))`;

/** Les événements à venir, visibles, dans l'ordre choisi au salon puis par
 *  date. Chacun porte ses photos et ses places restantes : la page
 *  publique n'a plus qu'à afficher. */
export async function evenementsPublics() {
  const evenements = await query(
    `SELECT e.*,
            COALESCE(r.vendues, 0)::int AS places_vendues
       FROM evenements e
       LEFT JOIN (
         SELECT evenement_id, SUM(places) AS vendues
           FROM evenement_reservations
          WHERE ${VIVANTES}
          GROUP BY evenement_id
       ) r ON r.evenement_id = e.id
      WHERE e.visible = true AND e.date >= $1
      ORDER BY e.position, e.date, e.heure`,
    [aujourdHui()]
  );
  if (!evenements.length) return [];

  const photos = await query(
    `SELECT * FROM evenement_photos WHERE evenement_id = ANY($1) ORDER BY position, id`,
    [evenements.map(e => e.id)]
  );
  return evenements.map(e => ({
    ...e,
    photos: photos.filter(p => p.evenement_id === e.id),
    placesRestantes: Math.max(0, e.places - e.places_vendues),
  }));
}

/** Un événement par son adresse publique. Rend aussi ceux qui ne sont pas
 *  visibles : c'est ainsi que le salon prévisualise une soirée avant de
 *  l'annoncer. Au contrôle d'appel de décider quoi en faire. */
export async function evenementParSlug(slug) {
  const e = await une(`SELECT * FROM evenements WHERE slug = $1`, [slug]);
  if (!e) return null;
  const photos = await query(
    `SELECT * FROM evenement_photos WHERE evenement_id = $1 ORDER BY position, id`, [e.id]);
  const { restantes } = await placesRestantes(e.id);
  return { ...e, photos, placesRestantes: restantes, estPasse: e.date < aujourdHui() };
}

/** Ce qu'il reste à vendre, recalculé depuis les réservations. */
export async function placesRestantes(evenementId, t = null) {
  const executeur = t || { une };
  const e = await executeur.une(`SELECT places FROM evenements WHERE id = $1`, [evenementId]);
  if (!e) return { erreur: 'Événement introuvable.' };
  const { vendues } = await executeur.une(
    `SELECT COALESCE(SUM(places), 0)::int AS vendues
       FROM evenement_reservations
      WHERE evenement_id = $1 AND ${VIVANTES}`,
    [evenementId]
  );
  return { restantes: Math.max(0, e.places - vendues), vendues, total: e.places };
}

/** Prend des places, ou explique pourquoi c'est impossible.
 *
 *  Tout se joue dans la transaction : l'événement est verrouillé le temps
 *  de recompter et d'écrire. Deux clients qui cliquent sur la dernière
 *  place à la même seconde se sérialisent ici — le second lit le décompte
 *  APRÈS l'écriture du premier, et se voit refuser sa place au lieu de la
 *  vendre une deuxième fois.
 *
 *  Le montant n'est jamais lu depuis le navigateur : il est recalculé à
 *  partir du prix en base, faute de quoi une soirée à 45 € se paierait
 *  1 centime. */
export async function reserverPlaces(evenementId, clientId, placesDemandees) {
  const n = parseInt(placesDemandees, 10);
  if (!Number.isInteger(n) || n < 1) return { erreur: 'Nombre de places invalide.' };
  if (n > 20) return { erreur: 'Au-delà de 20 places, appelez-nous : nous organiserons cela avec vous.' };

  return transaction(async (t) => {
    const e = await t.une(`SELECT * FROM evenements WHERE id = $1 FOR UPDATE`, [evenementId]);
    if (!e) return { erreur: 'Événement introuvable.' };
    if (!e.visible) return { erreur: 'Cet événement n\'est pas ouvert à la réservation.' };
    if (e.date < aujourdHui()) return { erreur: 'Cet événement est passé.' };

    const { restantes } = await placesRestantes(evenementId, t);
    if (restantes <= 0) return { erreur: 'Cette soirée est complète.' };
    if (n > restantes) {
      return { erreur: `Il ne reste que ${restantes} place${restantes > 1 ? 's' : ''}.` };
    }

    const reservation = await t.une(
      `INSERT INTO evenement_reservations (reference, evenement_id, client_id, places, total_cents, statut)
       VALUES ($1, $2, $3, $4, $5, 'a_payer') RETURNING *`,
      [genererReference('EVT'), evenementId, clientId, n, e.prix_cents * n]
    );
    return { reservation, evenement: e };
  });
}

/** La place est payée : elle est acquise. */
export async function confirmerReservation(reservationId) {
  return une(
    `UPDATE evenement_reservations SET statut = 'confirmee'
      WHERE id = $1 AND statut = 'a_payer' RETURNING *`,
    [reservationId]
  );
}

export async function annulerReservation(reservationId, clientId = null) {
  const r = await une(`SELECT * FROM evenement_reservations WHERE id = $1`, [reservationId]);
  if (!r) return { erreur: 'Réservation introuvable.' };
  if (clientId !== null && r.client_id !== clientId) return { erreur: 'Réservation introuvable.' };
  if (r.statut === 'annulee') return { erreur: 'Cette réservation est déjà annulée.' };
  if (r.statut === 'honoree') return { erreur: 'Cette soirée a déjà eu lieu.' };

  await executer(`UPDATE evenement_reservations SET statut = 'annulee' WHERE id = $1`, [reservationId]);
  return { reservation: { ...r, statut: 'annulee' } };
}

/** Les réservations d'un événement, pour le salon. */
export async function reservationsDe(evenementId) {
  return query(
    `SELECT r.*, c.prenom, c.nom, c.telephone_saisi, c.email
       FROM evenement_reservations r
       JOIN clients c ON c.id = r.client_id
      WHERE r.evenement_id = $1
      ORDER BY r.cree_le DESC`,
    [evenementId]
  );
}

/** Les réservations d'un client, pour son espace. */
export async function reservationsDuClient(clientId) {
  return query(
    `SELECT r.*, e.titre, e.slug, e.date, e.heure
       FROM evenement_reservations r
       JOIN evenements e ON e.id = r.evenement_id
      WHERE r.client_id = $1
      ORDER BY e.date DESC`,
    [clientId]
  );
}

/** Tous les événements pour le salon, passés compris, avec leur décompte. */
export async function evenementsDuSalon() {
  return query(
    `SELECT e.*,
            COALESCE(r.vendues, 0)::int    AS places_vendues,
            COALESCE(r.encaisse, 0)::int   AS encaisse_cents,
            COALESCE(p.nb_photos, 0)::int  AS nb_photos
       FROM evenements e
       LEFT JOIN (
         SELECT evenement_id,
                SUM(places) FILTER (WHERE statut IN ('confirmee','honoree'))      AS vendues,
                SUM(total_cents) FILTER (WHERE statut IN ('confirmee','honoree')) AS encaisse
           FROM evenement_reservations GROUP BY evenement_id
       ) r ON r.evenement_id = e.id
       LEFT JOIN (
         SELECT evenement_id, COUNT(*) AS nb_photos FROM evenement_photos GROUP BY evenement_id
       ) p ON p.evenement_id = e.id
      ORDER BY e.date DESC, e.heure DESC`
  );
}

/** Ce qui empêche de supprimer un événement, ou `null`.
 *
 *  Même règle que pour une table qui a servi : une soirée qui a vendu des
 *  places porte des ventes, et les effacer emporterait de l'argent
 *  encaissé. On la rend invisible, on ne l'efface pas. */
export async function obstacleASuppression(evenementId) {
  const { n } = await une(
    `SELECT COUNT(*)::int AS n FROM evenement_reservations
      WHERE evenement_id = $1 AND statut IN ('confirmee','honoree')`,
    [evenementId]
  );
  if (n > 0) {
    return `Cette soirée a vendu ${n} réservation${n > 1 ? 's' : ''}.`
      + ' La supprimer effacerait ces ventes de votre caisse. Décochez « Visible » :'
      + ' elle disparaît du site, et les réservations restent consultables.';
  }
  return null;
}

/** Le texte long, découpé en paragraphes. Une ligne vide sépare, comme on
 *  l'écrit naturellement dans un champ de saisie. */
export function paragraphes(texte) {
  return String(texte || '')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}
