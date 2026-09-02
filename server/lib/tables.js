import { randomBytes } from 'node:crypto';
import { une, query, executer } from '../db.js';

/** Les tables de la salle : création, suppression, et la règle qui décide
 *  laquelle des deux est possible.
 *
 *  Une table n'est pas qu'une ligne de configuration : c'est aussi ce à quoi
 *  s'accrochent les additions déjà encaissées. La supprimer emporterait les
 *  tablées par cascade, et avec elles le lien entre une commande et le
 *  couvert qui l'a passée — une commande sur place sans tablée est d'ailleurs
 *  refusée par la base. D'où la distinction faite ici entre retirer une table
 *  qui n'a jamais servi et retirer une table qui a une histoire. */

/** Le code du QR collé sur la table. Aléatoire et non devinable : avec le
 *  seul identifiant de la table, n'importe qui ouvrirait une tablée sur une
 *  table qu'il n'occupe pas. Même format que celui posé par la migration,
 *  seize caractères hexadécimaux. */
export function codeQr() {
  return randomBytes(8).toString('hex');
}

const echapperRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Les noms à donner à `combien` nouvelles tables, sans jamais reprendre un
 *  nom déjà porté dans cette salle.
 *
 *  La numérotation continue la série existante au lieu de repartir de 1.
 *  Sans ça, ajouter trois tables puis dix autres donnait deux « Table 1 » et
 *  deux « Table 2 » : le serveur qui lit « Table 1 » sur son écran ne peut
 *  pas savoir de laquelle il s'agit, et les deux QR imprimés sont
 *  indiscernables une fois collés. Une erreur qui ne se rattrape qu'en
 *  décollant les autocollants.
 *
 *  Une table seule garde le nom tel quel tant qu'il est libre : « Terrasse »
 *  ne doit pas devenir « Terrasse 1 » sans raison. */
export async function nomsLibres(serviceId, base, combien) {
  const existants = (await query(
    `SELECT nom FROM tables_resto WHERE service_id = $1`, [serviceId]
  )).map(t => t.nom);
  const pris = new Set(existants);

  if (combien === 1 && !pris.has(base)) return [base];

  const motif = new RegExp(`^${echapperRegex(base)} (\\d+)$`);
  let suivant = existants.reduce((max, n) => {
    const m = n.match(motif);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0) + 1;

  const noms = [];
  while (noms.length < combien) {
    const candidat = `${base} ${suivant++}`;
    if (!pris.has(candidat)) { noms.push(candidat); pris.add(candidat); }
  }
  return noms;
}

/** Les noms portés par plus d'une table dans cette salle. Des doublons
 *  créés avant que la numérotation ne continue la série existante restent
 *  en base : personne ne peut les corriger sans savoir qu'ils sont là. */
export async function nomsEnDoublon(serviceId) {
  return (await query(
    `SELECT nom, COUNT(*)::int AS n FROM tables_resto
      WHERE service_id = $1 GROUP BY nom HAVING COUNT(*) > 1 ORDER BY nom`,
    [serviceId]
  ));
}

/** Crée `nombre` tables à la suite. Une salle se configure par lots —
 *  « six tables de 4 » — plutôt qu'une par une. */
export async function creerTables(serviceId, { nom, couverts, nombre = 1 }) {
  const combien = Math.min(Math.max(parseInt(nombre, 10) || 1, 1), 40);
  const { p: depart } = await une(
    `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tables_resto WHERE service_id = $1`,
    [serviceId]
  );
  const noms = await nomsLibres(serviceId, nom, combien);

  const creees = [];
  for (let i = 0; i < combien; i++) {
    creees.push(await une(
      `INSERT INTO tables_resto (service_id, nom, couverts, position, code_qr)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [serviceId, noms[i], couverts, depart + i, codeQr()]
    ));
  }
  return creees;
}

/** Ce qui empêche de supprimer une table, ou `null` si elle part sans
 *  laisser de trou. */
export async function obstacleASuppression(tableId) {
  const ouverte = await une(
    `SELECT id FROM tablees WHERE table_id = $1 AND statut = 'ouverte' LIMIT 1`, [tableId]);
  if (ouverte) {
    return 'Des clients y sont installés en ce moment. Encaissez ou fermez la tablée avant de retirer la table.';
  }
  const { n } = await une(
    `SELECT COUNT(*)::int AS n FROM tablees WHERE table_id = $1`, [tableId]);
  if (n > 0) {
    return `Cette table porte ${n} addition${n > 1 ? 's' : ''} déjà servie${n > 1 ? 's' : ''}.`
      + ' La supprimer effacerait cet historique de caisse. Décochez « En service » :'
      + ' elle disparaît du plan de salle, des réservations et de la planche de QR,'
      + ' et les additions passées restent consultables.';
  }
  return null;
}

/** Supprime la table si elle n'a jamais servi. Renvoie `{ erreur }` sinon :
 *  c'est un refus explicable à l'écran, pas une exception. */
export async function supprimerTable(tableId) {
  const table = await une(`SELECT * FROM tables_resto WHERE id = $1`, [tableId]);
  if (!table) return { erreur: 'Table introuvable.' };

  const obstacle = await obstacleASuppression(tableId);
  if (obstacle) return { erreur: obstacle, table };

  // Les réservations déjà placées dessus perdent leur placement
  // (ON DELETE SET NULL) mais restent honorées : on ne supprime jamais la
  // réservation d'un client en réorganisant la salle.
  await executer(`DELETE FROM tables_resto WHERE id = $1`, [tableId]);
  return { table };
}

/** Le nombre d'additions portées par chaque table d'un service, pour
 *  expliquer à l'écran laquelle peut encore être supprimée. */
export async function additionsParTable(serviceId) {
  const lignes = await query(
    `SELECT t.id, COUNT(tb.id)::int AS n
       FROM tables_resto t
       LEFT JOIN tablees tb ON tb.table_id = t.id
      WHERE t.service_id = $1
      GROUP BY t.id`,
    [serviceId]
  );
  return Object.fromEntries(lignes.map(l => [l.id, l.n]));
}
