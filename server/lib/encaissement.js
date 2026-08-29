import { une, query, transaction } from '../db.js';
import { crediterGain, depenser, tauxFidelite } from './fidelite.js';

/** L'encaissement, c'est-à-dire le seul moment où de l'argent change de
 *  main. Il fait trois choses indissociables, donc toutes dans la même
 *  transaction : déduire la cagnotte si le client s'en sert, marquer la
 *  commande payée, créditer le gain de fidélité.
 *
 *  Les deux circuits y arrivent par des chemins différents — une commande à
 *  emporter s'encaisse seule, une tablée s'encaisse d'un bloc — mais
 *  aboutissent au même état : des commandes 'encaissee' et un gain par
 *  commande.
 */

/** Encaisse une commande à emporter. */
export async function encaisserCommande(commandeId, { remiseCents = 0 } = {}) {
  const taux = await tauxFidelite();
  return transaction(async (t) => {
    const commande = await t.une(
      `SELECT * FROM commandes WHERE id = $1 AND type = 'emporter' FOR UPDATE`, [commandeId]
    );
    if (!commande) return { erreur: 'Commande introuvable.' };
    if (commande.statut === 'annulee') return { erreur: 'Cette commande est annulée.' };
    if (commande.statut === 'encaissee') return { erreur: 'Cette commande est déjà encaissée.' };

    const remise = remiseCents > 0
      ? await depenser(t, { clientId: commande.client_id, commande, montant: remiseCents })
      : 0;

    const paye = { ...commande, remise_cagnotte_cents: remise };
    await t.executer(`UPDATE commandes SET statut = 'encaissee' WHERE id = $1`, [commande.id]);
    const gain = await crediterGain(t, paye, taux);

    return { commande: paye, remise, gain, aPayer: commande.total_cents - remise };
  });
}

/** Encaisse une tablée entière et la ferme.
 *
 *  La remise s'étale sur les commandes de l'addition, dans l'ordre où elles
 *  ont été passées : chacune porte alors ce qu'elle a réellement coûté, et
 *  le gain se calcule commande par commande. L'arrondi vers le bas se fait
 *  donc par commande — au pire quelques centimes de moins qu'un calcul sur
 *  le total, ce qui vaut mieux qu'un gain impossible à rattacher.
 */
export async function encaisserTablee(tableeId, { remiseCents = 0 } = {}) {
  const taux = await tauxFidelite();
  return transaction(async (t) => {
    const tablee = await t.une(`SELECT * FROM tablees WHERE id = $1 FOR UPDATE`, [tableeId]);
    if (!tablee) return { erreur: 'Tablée introuvable.' };
    if (tablee.statut === 'fermee') return { erreur: 'Cette tablée est déjà encaissée.' };

    const commandes = await t.query(
      `SELECT * FROM commandes WHERE tablee_id = $1 AND statut != 'annulee' ORDER BY cree_le, id`,
      [tableeId]
    );
    if (!commandes.length) {
      await t.executer(
        `UPDATE tablees SET statut = 'fermee', fermee_le = now() WHERE id = $1`, [tableeId]
      );
      return { total: 0, remise: 0, gain: 0, aPayer: 0 };
    }

    const total = commandes.reduce((s, c) => s + c.total_cents, 0);
    let reste = Math.max(0, Math.min(remiseCents, total));
    let remiseTotale = 0, gainTotal = 0;

    for (const commande of commandes) {
      const part = Math.min(reste, commande.total_cents);
      const remise = part > 0
        ? await depenser(t, { clientId: commande.client_id, commande, montant: part })
        : 0;
      reste -= remise;
      remiseTotale += remise;

      await t.executer(`UPDATE commandes SET statut = 'encaissee' WHERE id = $1`, [commande.id]);
      gainTotal += await crediterGain(t, { ...commande, remise_cagnotte_cents: remise }, taux);
    }

    await t.executer(
      `UPDATE tablees SET statut = 'fermee', fermee_le = now() WHERE id = $1`, [tableeId]
    );
    return { total, remise: remiseTotale, gain: gainTotal, aPayer: total - remiseTotale };
  });
}

/** Ce que la cagnotte du client peut couvrir sur un montant donné. Sert à
 *  proposer une valeur par défaut à la caisse plutôt qu'à la faire calculer
 *  de tête pendant qu'une file se forme. */
export async function cagnotteMobilisable(clientId, montantCents) {
  const r = await une(`SELECT cagnotte_cents FROM clients WHERE id = $1`, [clientId]);
  return Math.max(0, Math.min(r?.cagnotte_cents ?? 0, montantCents));
}

/** Les commandes à emporter d'un client encore à encaisser, pour la caisse. */
export async function commandesAEncaisser(clientId) {
  return query(
    `SELECT * FROM commandes
      WHERE client_id = $1 AND type = 'emporter' AND statut NOT IN ('annulee','encaissee')
      ORDER BY date, heure`,
    [clientId]
  );
}
