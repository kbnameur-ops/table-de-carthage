import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query, une, executer } from '../db.js';

const DUREE_SESSION_JOURS = 30;
const DUREE_INVITE_JOURS = 1;

// ── Mots de passe (salon) ────────────────────────────────────
export function hacherMotDePasse(motDePasse) {
  const sel = randomBytes(16);
  const empreinte = scryptSync(motDePasse, sel, 64);
  return `${sel.toString('hex')}:${empreinte.toString('hex')}`;
}

export function verifierMotDePasse(motDePasse, stocke) {
  const [selHex, empreinteHex] = stocke.split(':');
  if (!selHex || !empreinteHex) return false;
  const sel = Buffer.from(selHex, 'hex');
  const attendue = Buffer.from(empreinteHex, 'hex');
  const calculee = scryptSync(motDePasse, sel, 64);
  return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
}

// ── Sessions ──────────────────────────────────────────────
// Une ligne par navigateur dès la première requête (role='invite'), pour
// que même un visiteur anonyme dispose d'un jeton CSRF sur les formulaires
// de réservation et de commande.
function nouvelleExpiration(jours) {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return d;
}

export async function creerSessionInvite() {
  const id = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  await executer(
    `INSERT INTO sessions (id, role, sujet_id, csrf_token, expire_le) VALUES ($1, 'invite', NULL, $2, $3)`,
    [id, csrf, nouvelleExpiration(DUREE_INVITE_JOURS)]
  );
  return { id, role: 'invite', sujetId: null, csrf };
}

export async function obtenirSession(id) {
  if (!id) return null;
  const ligne = await une(
    `SELECT id, role, sujet_id AS "sujetId", csrf_token AS csrf, expire_le AS "expireLe"
     FROM sessions WHERE id = $1`,
    [id]
  );
  if (!ligne) return null;
  if (new Date(ligne.expireLe) < new Date()) {
    await executer(`DELETE FROM sessions WHERE id = $1`, [id]);
    return null;
  }
  return ligne;
}

/** Fait passer une session d'invité à client ou admin, en conservant son
 *  identifiant et son jeton CSRF : les formulaires déjà affichés restent
 *  valables après la connexion. */
export async function elargirSession(id, role, sujetId) {
  await executer(
    `UPDATE sessions SET role = $1, sujet_id = $2, expire_le = $3 WHERE id = $4`,
    [role, sujetId, nouvelleExpiration(DUREE_SESSION_JOURS), id]
  );
}

export async function detruireSession(id) {
  await executer(`DELETE FROM sessions WHERE id = $1`, [id]);
}

// ── Anti-force brute et anti-abus ───────────────────────────
// Réutilisé pour deux besoins différents : bloquer les essais de connexion
// (seuil strict, 5 en 15 min) et limiter le débit des tunnels publics de
// réservation/commande, où une soumission n'est pas un « échec » mais où un
// script pourrait sinon les spammer sans aucune limite, ou sonder quels
// numéros de téléphone sont déjà des clients (voir routes/reservation.js et
// routes/commande.js : le message « ce numéro est déjà associé » ne doit
// pas devenir un oracle à volume illimité).
const FENETRE_MINUTES = 15;
const MAX_TENTATIVES = 5;

export async function enregistrerTentative(cle) {
  await executer(`INSERT INTO tentatives (cle) VALUES ($1)`, [cle]);
}

export async function tropDeTentatives(cle, maxTentatives = MAX_TENTATIVES, fenetreMinutes = FENETRE_MINUTES) {
  const ligne = await une(
    `SELECT COUNT(*)::int AS n FROM tentatives WHERE cle = $1 AND le > now() - ($2 || ' minutes')::interval`,
    [cle, fenetreMinutes]
  );
  return ligne.n >= maxTentatives;
}

export async function reinitialiserTentatives(cle) {
  await executer(`DELETE FROM tentatives WHERE cle = $1`, [cle]);
}

export const MINUTES_BLOCAGE = FENETRE_MINUTES;
