import { query, une, transaction } from '../db.js';
import { normaliserTelephone } from './phone.js';

/** La cagnotte de fidélité.
 *
 *  Deux règles la gouvernent, et tout le reste en découle :
 *
 *  1. On gagne un pourcentage de ce qu'on a réellement payé. « Réellement »
 *     exclut la part réglée avec la cagnotte elle-même — sans quoi un solde
 *     se régénérerait à chaque passage et ne s'épuiserait jamais.
 *  2. Un gain et un seul par commande, garanti par un index unique partiel
 *     plutôt que par une vérification en JavaScript : deux encaissements
 *     simultanés de la même commande passeraient sinon tous les deux le test
 *     avant que l'un d'eux n'écrive.
 *
 *  Le solde vit dans clients.cagnotte_cents, tenu dans la même transaction
 *  que le mouvement. Le CHECK (>= 0) de la colonne est la seule protection
 *  fiable contre le découvert : lire le solde puis décider en JavaScript
 *  laisserait passer deux transferts concurrents.
 */

const TAUX_PAR_DEFAUT = 10;

export async function tauxFidelite() {
  const r = await une(`SELECT valeur FROM reglages WHERE cle = 'fidelite_taux_pourcent'`);
  const n = parseInt(r?.valeur ?? '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : TAUX_PAR_DEFAUT;
}

/** Le gain pour un montant payé. Arrondi vers le bas : mieux vaut devoir un
 *  centime au client que le contraire, et l'arrondi ne doit pas dépendre du
 *  découpage d'une addition en plusieurs commandes. */
export function gainPour(montantPayeCents, taux) {
  return Math.floor((montantPayeCents * taux) / 100);
}

export async function soldeDe(clientId) {
  const r = await une(`SELECT cagnotte_cents FROM clients WHERE id = $1`, [clientId]);
  return r?.cagnotte_cents ?? 0;
}

export async function mouvementsDe(clientId, limite = 50) {
  return query(
    `SELECT m.*, c.prenom AS contre_prenom, c.nom AS contre_nom,
            cmd.reference AS commande_reference
       FROM fidelite_mouvements m
       LEFT JOIN clients c ON c.id = m.contrepartie_id
       LEFT JOIN commandes cmd ON cmd.id = m.commande_id
      WHERE m.client_id = $1
      ORDER BY m.cree_le DESC, m.id DESC
      LIMIT $2`,
    [clientId, limite]
  );
}

/** Écrit un mouvement et déplace le solde, sur la connexion fournie : tous
 *  les appelants sont déjà dans une transaction, c'est le seul moyen que le
 *  mouvement et le solde ne divergent jamais. */
async function bouger(t, { clientId, delta, type, commandeId = null, contrepartieId = null, libelle = '' }) {
  await t.executer(
    `INSERT INTO fidelite_mouvements (client_id, delta_cents, type, commande_id, contrepartie_id, libelle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clientId, delta, type, commandeId, contrepartieId, libelle]
  );
  await t.executer(
    `UPDATE clients SET cagnotte_cents = cagnotte_cents + $1 WHERE id = $2`,
    [delta, clientId]
  );
}

/** Crédite le gain d'une commande encaissée. Rejouable : si le gain existe
 *  déjà, l'index unique fait échouer l'insertion et on repart sans rien
 *  changer. Renvoie le nombre de centimes crédités (0 si déjà fait). */
export async function crediterGain(t, commande, taux) {
  const paye = Math.max(0, commande.total_cents - (commande.remise_cagnotte_cents || 0));
  const gain = gainPour(paye, taux);
  if (gain <= 0) return 0;

  const dejaCredite = await t.une(
    `SELECT 1 FROM fidelite_mouvements WHERE commande_id = $1 AND type = 'gain'`,
    [commande.id]
  );
  if (dejaCredite) return 0;

  await bouger(t, {
    clientId: commande.client_id, delta: gain, type: 'gain',
    commandeId: commande.id, libelle: `${taux} % de la commande ${commande.reference}`,
  });
  return gain;
}

/** Débite la cagnotte pour payer une partie d'une commande. Le montant est
 *  plafonné au solde et au total : c'est une remise, pas une avance. */
export async function depenser(t, { clientId, commande, montant }) {
  const solde = (await t.une(`SELECT cagnotte_cents FROM clients WHERE id = $1 FOR UPDATE`, [clientId]))
    ?.cagnotte_cents ?? 0;
  const remise = Math.max(0, Math.min(montant, solde, commande.total_cents));
  if (remise <= 0) return 0;

  await bouger(t, {
    clientId, delta: -remise, type: 'depense',
    commandeId: commande.id, libelle: `Réglé sur la commande ${commande.reference}`,
  });
  await t.executer(`UPDATE commandes SET remise_cagnotte_cents = $1 WHERE id = $2`, [remise, commande.id]);
  return remise;
}

/** Envoie des points d'un client à un autre, désigné par son téléphone.
 *
 *  C'est ce qui évite que chacun paie sa part juste pour toucher sa cagnotte :
 *  une personne règle l'addition, gagne pour tout le monde, et redistribue.
 */
export async function transferer({ deClientId, versTelephone, montantCents, motCle = '' }) {
  if (!Number.isInteger(montantCents) || montantCents <= 0) {
    return { erreur: 'Indiquez un montant à envoyer.' };
  }
  const numero = normaliserTelephone(versTelephone || '');
  if (!numero) return { erreur: 'Indiquez le numéro de téléphone du destinataire.' };

  const destinataire = await une(`SELECT id, prenom, nom FROM clients WHERE telephone = $1`, [numero]);
  if (!destinataire) {
    return { erreur: "Aucun compte à ce numéro. La personne doit d'abord créer son espace client." };
  }
  if (destinataire.id === deClientId) {
    return { erreur: 'Vous ne pouvez pas vous envoyer des points à vous-même.' };
  }

  try {
    return await transaction(async (t) => {
      // Verrou pris sur l'émetteur avant d'écrire : deux envois lancés en
      // même temps depuis deux onglets se sérialisent ici plutôt que de
      // vider la cagnotte deux fois.
      const expediteur = await t.une(
        `SELECT id, prenom, nom, cagnotte_cents FROM clients WHERE id = $1 FOR UPDATE`, [deClientId]
      );
      if (!expediteur) return { erreur: 'Compte introuvable.' };
      if (expediteur.cagnotte_cents < montantCents) {
        return { erreur: 'Votre cagnotte ne couvre pas ce montant.' };
      }

      const versQui = `${destinataire.prenom} ${destinataire.nom}`.trim();
      const deQui = `${expediteur.prenom} ${expediteur.nom}`.trim();
      await bouger(t, {
        clientId: expediteur.id, delta: -montantCents, type: 'transfert_envoye',
        contrepartieId: destinataire.id, libelle: motCle ? `Envoyé à ${versQui} · ${motCle}` : `Envoyé à ${versQui}`,
      });
      await bouger(t, {
        clientId: destinataire.id, delta: montantCents, type: 'transfert_recu',
        contrepartieId: expediteur.id, libelle: motCle ? `Reçu de ${deQui} · ${motCle}` : `Reçu de ${deQui}`,
      });
      return { destinataire };
    });
  } catch (err) {
    // Le CHECK de la colonne a refusé le découvert : la vérification plus
    // haut a été doublée par une écriture concurrente.
    if (err.code === '23514') return { erreur: 'Votre cagnotte ne couvre pas ce montant.' };
    throw err;
  }
}

/** Correction manuelle depuis le salon : geste commercial, erreur de caisse. */
export async function ajuster({ clientId, deltaCents, libelle }) {
  if (!Number.isInteger(deltaCents) || deltaCents === 0) return { erreur: 'Montant invalide.' };
  try {
    await transaction(async (t) => {
      await t.une(`SELECT 1 FROM clients WHERE id = $1 FOR UPDATE`, [clientId]);
      await bouger(t, { clientId, delta: deltaCents, type: 'ajustement', libelle: libelle || 'Ajustement' });
    });
    return {};
  } catch (err) {
    if (err.code === '23514') return { erreur: 'La cagnotte ne peut pas devenir négative.' };
    throw err;
  }
}
