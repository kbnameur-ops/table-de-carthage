import { query, une, executer } from '../db.js';

/** Enregistre un événement à signaler au salon. Volontairement tolérante :
 *  si l'écriture échoue, on ne fait pas échouer la réservation ou la
 *  commande du client pour autant — une notification manquante est un
 *  désagrément, une commande perdue est une faute. */
export async function notifier({ type, titre, detail = '', lien = '/salon' }) {
  try {
    await executer(
      `INSERT INTO notifications (type, titre, detail, lien) VALUES ($1, $2, $3, $4)`,
      [type, titre, detail, lien]
    );
  } catch (err) {
    console.error('Notification non enregistrée :', err.message);
  }
}

export async function compterNonLues() {
  const r = await une(`SELECT COUNT(*)::int AS n FROM notifications WHERE lue = false`);
  return r?.n ?? 0;
}

export async function listerNotifications(limite = 60) {
  return query(
    `SELECT * FROM notifications ORDER BY cree_le DESC LIMIT $1`, [limite]
  );
}

export async function marquerLue(id) {
  await executer(`UPDATE notifications SET lue = true WHERE id = $1`, [id]);
}

export async function toutMarquerLu() {
  await executer(`UPDATE notifications SET lue = true WHERE lue = false`);
}

/** Formate une date/heure métier ('2026-09-01', '20:00') en texte court
 *  lisible dans une notification : « mar. 1 sept. à 20:00 ». */
export function quand(date, heure) {
  const lisible = new Date(date + 'T00:00').toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  return `${lisible} à ${heure}`;
}
