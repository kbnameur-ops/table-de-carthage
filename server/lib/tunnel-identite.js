import { une } from '../db.js';
import { normaliserTelephone } from './phone.js';
import { dateValide } from './validate.js';
import {
  elargirSession, enregistrerTentative, tropDeTentatives,
  reinitialiserTentatives, MINUTES_BLOCAGE,
} from './auth.js';

/** Identification dans les tunnels de réservation et de commande.
 *
 *  Un client qui a déjà commandé n'a aucune raison de retaper son nom, son
 *  e-mail et sa date de naissance à chaque fois : on lui propose d'abord de
 *  se reconnaître avec téléphone + date de naissance. La connexion se fait
 *  sur place, sans quitter la page — `elargirSession` conserve l'identifiant
 *  de session et son jeton CSRF, donc le panier et le créneau déjà choisis
 *  survivent à l'opération. */

/** Le client rattaché à la session, ou null si visiteur anonyme. */
export async function clientDeSession(session) {
  if (session?.role !== 'client' || !session.sujetId) return null;
  return (await une(`SELECT * FROM clients WHERE id = $1`, [session.sujetId])) || null;
}

/** Connecte depuis un tunnel. Même protection que /compte/connexion : sans
 *  limitation, ce formulaire deviendrait un second point d'entrée pour
 *  éprouver des couples téléphone / date de naissance. */
export async function connecterDepuisTunnel({ telephone, dateNaissance }, session, ip) {
  if (!telephone || !dateValide(dateNaissance)) {
    return { erreur: 'Renseignez un numéro de téléphone et une date de naissance valides.' };
  }

  const numero = normaliserTelephone(telephone);
  const cle = `client:${numero}:${ip}`;
  if (await tropDeTentatives(cle)) {
    return { erreur: `Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.` };
  }

  const client = await une(`SELECT * FROM clients WHERE telephone = $1`, [numero]);
  if (!client || client.date_naissance !== dateNaissance) {
    await enregistrerTentative(cle);
    return { erreur: "Aucun compte ne correspond à ce numéro et cette date de naissance." };
  }

  await reinitialiserTentatives(cle);
  await elargirSession(session.id, 'client', client.id);
  session.role = 'client';
  session.sujetId = client.id;
  return { client };
}

/** Repasse la session en visiteur anonyme (« ce n'est pas moi »), sans
 *  détruire la ligne : le jeton CSRF du formulaire en cours reste valable. */
export async function quitterIdentite(session) {
  await elargirSession(session.id, 'invite', null);
  session.role = 'invite';
  session.sujetId = null;
}
