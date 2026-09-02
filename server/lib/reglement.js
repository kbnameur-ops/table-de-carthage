import { une, query, executer, transaction } from '../db.js';
import {
  creerIntention, recupererSecret, capturer, liberer, paiementDisponible,
  creerClientStripe, definirEnregistrement,
} from './paiement.js';
import { encaisserCommande, encaisserTablee } from './encaissement.js';
import { additionDeTablee } from './tablees.js';

/** Le règlement : ce qui relie une intention de paiement Stripe à une
 *  commande ou à une addition, et ce qui se passe quand elle aboutit.
 *
 *  `lib/paiement.js` parle à Stripe et ne sait rien du restaurant ;
 *  `lib/encaissement.js` connaît la cagnotte et la fidélité mais rien de
 *  Stripe. Ce fichier est la charnière, et c'est le seul endroit où les
 *  deux se rencontrent — pour qu'il n'existe qu'un seul chemin entre « la
 *  carte a été débitée » et « la commande est encaissée ».
 */

/** L'identifiant de la fiche Stripe du client, créée à la première
 *  tentative de paiement puis réutilisée.
 *
 *  Sans elle, la case « enregistrer ma carte » ne peut pas être honorée :
 *  Stripe ne conserve un moyen de paiement que rattaché à un client. En
 *  recréer une à chaque commande éparpillerait les cartes enregistrées
 *  entre plusieurs fiches, et le client ne retrouverait jamais la sienne.
 *
 *  Une panne de ce côté ne doit pas empêcher de payer : on rend `null`, le
 *  paiement se fait sans fiche, et la carte n'est simplement pas
 *  enregistrable cette fois-ci. */
export async function ficheStripeDuClient(clientId) {
  if (!clientId) return null;
  const client = await une(`SELECT * FROM clients WHERE id = $1`, [clientId]);
  if (!client) return null;
  if (client.stripe_client_id) return client.stripe_client_id;

  try {
    const id = await creerClientStripe({
      prenom: client.prenom, nom: client.nom, email: client.email,
      telephone: client.telephone_saisi || client.telephone, clientId: client.id,
    });
    // Une écriture concurrente a pu poser la sienne entre-temps : la
    // condition garde la première et jette la seconde plutôt que de violer
    // l'index unique.
    const pose = await une(
      `UPDATE clients SET stripe_client_id = $1
        WHERE id = $2 AND stripe_client_id IS NULL RETURNING stripe_client_id`,
      [id, client.id]
    );
    if (pose) return pose.stripe_client_id;
    const relu = await une(`SELECT stripe_client_id FROM clients WHERE id = $1`, [client.id]);
    return relu?.stripe_client_id ?? null;
  } catch {
    return null;
  }
}

/** Le client demande (ou ne demande plus) que sa carte soit gardée pour la
 *  prochaine fois. Appelé juste avant la confirmation, avec ce qui est
 *  coché à l'écran à cet instant.
 *
 *  Seul un paiement encore en attente de confirmation se laisse modifier :
 *  une fois la carte débitée, la question ne se pose plus. */
export async function choisirEnregistrementCarte(paiementId, enregistrer, { clientId = null } = {}) {
  const p = await une(`SELECT * FROM paiements WHERE id = $1`, [paiementId]);
  if (!p) return { erreur: 'Paiement introuvable.' };
  if (clientId !== null && p.client_id !== clientId) return { erreur: 'Paiement introuvable.' };
  if (p.statut !== 'a_confirmer') return { erreur: 'Ce paiement est déjà traité.' };

  await definirEnregistrement(p.intention_id, enregistrer);
  await executer(`UPDATE paiements SET carte_enregistree = $1 WHERE id = $2`,
    [!!enregistrer, paiementId]);
  return { enregistrer: !!enregistrer };
}

/** Ce qu'une commande à emporter réclame encore. Recalculé depuis les
 *  lignes, jamais lu depuis le navigateur. */
export async function resteAPayerCommande(commandeId) {
  const c = await une(`SELECT * FROM commandes WHERE id = $1`, [commandeId]);
  if (!c) return { erreur: 'Commande introuvable.' };
  if (c.statut === 'annulee') return { erreur: 'Cette commande est annulée.' };
  if (c.statut === 'encaissee') return { erreur: 'Cette commande est déjà réglée.' };
  return { commande: c, montantCents: c.total_cents - c.remise_cagnotte_cents };
}

/** Le paiement encore vivant sur une commande, s'il y en a un. */
export async function paiementVivantCommande(commandeId) {
  return une(
    `SELECT * FROM paiements
      WHERE commande_id = $1 AND statut IN ('a_confirmer','autorise','capture')`,
    [commandeId]
  ) ?? null;
}

export async function paiementVivantTablee(tableeId) {
  return une(
    `SELECT * FROM paiements
      WHERE tablee_id = $1 AND statut IN ('a_confirmer','autorise','capture')`,
    [tableeId]
  ) ?? null;
}

/** Ouvre — ou retrouve — le paiement d'une commande à emporter.
 *
 *  Retrouver plutôt que recréer est la moitié du travail : un client qui
 *  recharge la page de paiement, ou qui y revient depuis son espace, doit
 *  retomber sur la même empreinte. En créer une seconde bloquerait deux
 *  fois le montant sur sa carte. */
export async function ouvrirPaiementCommande(commandeId, { mode = 'empreinte' } = {}) {
  if (!paiementDisponible()) return { erreur: 'Le paiement en ligne n\'est pas activé.' };

  const reste = await resteAPayerCommande(commandeId);
  if (reste.erreur) return reste;
  if (reste.montantCents <= 0) return { erreur: 'Il n\'y a rien à régler sur cette commande.' };

  const existant = await paiementVivantCommande(commandeId);
  if (existant) {
    // Une empreinte déjà autorisée n'a pas à être repayée.
    if (existant.statut !== 'a_confirmer') return { paiement: existant, dejaRegle: true };
    if (existant.montant_cents === reste.montantCents && existant.intention_id) {
      return { paiement: existant, secretClient: await recupererSecret(existant.intention_id) };
    }
    // Le montant a changé (cagnotte posée entre-temps) : l'ancienne
    // intention ne vaut plus rien, on la laisse tomber et on repart.
    await executer(
      `UPDATE paiements SET statut = 'echoue', echec_motif = 'montant obsolète' WHERE id = $1`,
      [existant.id]
    );
  }

  const intention = await creerIntention({
    montantCents: reste.montantCents, mode,
    cle: `cmd-${commandeId}-${reste.montantCents}-${mode}`,
    description: `Commande ${reste.commande.reference} — La Table de Carthage`,
    metadonnees: { commande_id: String(commandeId), reference: reste.commande.reference },
    clientStripeId: await ficheStripeDuClient(reste.commande.client_id),
  });

  const paiement = await une(
    `INSERT INTO paiements (client_id, commande_id, montant_cents, mode, intention_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [reste.commande.client_id, commandeId, reste.montantCents, mode, intention.id]
  );
  return { paiement, secretClient: intention.secretClient };
}

/** Ouvre — ou retrouve — le paiement d'une addition de table. Toujours en
 *  débit immédiat : le client règle ce qu'il a consommé, il n'y a rien à
 *  arbitrer plus tard. */
export async function ouvrirPaiementTablee(tableeId) {
  if (!paiementDisponible()) return { erreur: 'Le paiement en ligne n\'est pas activé.' };

  const tablee = await une(`SELECT * FROM tablees WHERE id = $1`, [tableeId]);
  if (!tablee) return { erreur: 'Addition introuvable.' };
  if (tablee.statut === 'fermee') return { erreur: 'Cette addition est déjà réglée.' };

  const addition = await additionDeTablee(tableeId);
  if (!addition.total) return { erreur: 'Il n\'y a rien à régler sur cette table.' };

  const existant = await paiementVivantTablee(tableeId);
  if (existant) {
    if (existant.statut !== 'a_confirmer') return { paiement: existant, dejaRegle: true };
    if (existant.montant_cents === addition.total) {
      return { paiement: existant, secretClient: await recupererSecret(existant.intention_id) };
    }
    // Le repas a continué depuis : le montant a bougé, on repart à neuf.
    await executer(
      `UPDATE paiements SET statut = 'echoue', echec_motif = 'addition modifiée' WHERE id = $1`,
      [existant.id]
    );
  }

  const intention = await creerIntention({
    montantCents: addition.total, mode: 'immediat',
    cle: `tab-${tableeId}-${addition.total}`,
    description: `Addition table — La Table de Carthage`,
    metadonnees: { tablee_id: String(tableeId) },
    clientStripeId: await ficheStripeDuClient(tablee.client_id),
  });

  const paiement = await une(
    `INSERT INTO paiements (client_id, tablee_id, montant_cents, mode, intention_id)
     VALUES ($1, $2, $3, 'immediat', $4) RETURNING *`,
    [tablee.client_id, tableeId, addition.total, intention.id]
  );
  return { paiement, secretClient: intention.secretClient };
}

/** L'empreinte est autorisée : l'argent est bloqué, rien n'est encore
 *  débité. La commande peut partir en cuisine — c'est ici, et seulement
 *  ici, qu'elle quitte 'a_payer'. */
export async function marquerAutorise(intentionId) {
  return transaction(async (t) => {
    const p = await t.une(
      `UPDATE paiements SET statut = 'autorise', autorise_le = now()
        WHERE intention_id = $1 AND statut = 'a_confirmer' RETURNING *`,
      [intentionId]
    );
    if (!p) return { ignore: true }; // événement déjà traité, ou paiement inconnu

    if (p.commande_id) {
      await t.executer(
        `UPDATE commandes SET statut = 'en_attente' WHERE id = $1 AND statut = 'a_payer'`,
        [p.commande_id]
      );
    }
    return { paiement: p };
  });
}

/** Le paiement a échoué (carte refusée, authentification abandonnée). La
 *  commande reste 'a_payer' : elle n'ira pas en cuisine, et le client peut
 *  retenter depuis son espace sans que rien ne soit perdu. */
export async function marquerEchoue(intentionId, motif = '') {
  const p = await une(
    `UPDATE paiements SET statut = 'echoue', echec_motif = $2
      WHERE intention_id = $1 AND statut IN ('a_confirmer','autorise') RETURNING *`,
    [intentionId, String(motif).slice(0, 300)]
  );
  return p ? { paiement: p } : { ignore: true };
}

/** Débite (tout ou partie de) l'empreinte, puis encaisse.
 *
 *  L'ordre compte et n'est pas réversible : Stripe est appelé d'abord, la
 *  base ensuite. Si l'encaissement échouait après un débit réussi, on
 *  laisse le paiement en 'capture' sans marquer la commande encaissée —
 *  la caisse voit alors « payé, à encaisser » et peut réessayer. Marquer
 *  l'inverse (encaissée sans avoir pris l'argent) serait bien pire. */
export async function capturerEtEncaisser(paiementId, { remiseCents = 0 } = {}) {
  const p = await une(`SELECT * FROM paiements WHERE id = $1`, [paiementId]);
  if (!p) return { erreur: 'Paiement introuvable.' };
  if (p.statut === 'capture') return { erreur: 'Ce paiement est déjà débité.' };
  if (p.statut !== 'autorise') return { erreur: 'Ce paiement n\'est pas autorisé.' };

  const aDebiter = Math.max(0, p.montant_cents - Math.max(0, remiseCents));
  if (aDebiter === 0) {
    // La cagnotte couvre tout : on rend l'empreinte plutôt que de débiter
    // zéro, ce que Stripe refuserait de toute façon.
    await liberer(p.intention_id);
    await executer(
      `UPDATE paiements SET statut = 'libere', libere_le = now() WHERE id = $1`, [p.id]);
  } else {
    const r = await capturer(p.intention_id, aDebiter);
    await executer(
      `UPDATE paiements SET statut = 'capture', capture_cents = $2, capture_le = now()
        WHERE id = $1`,
      [p.id, r.capture_cents ?? aDebiter]
    );
  }

  const enc = p.commande_id
    ? await encaisserCommande(p.commande_id, { remiseCents })
    : await encaisserTablee(p.tablee_id, { remiseCents });

  return { paiement: await une(`SELECT * FROM paiements WHERE id = $1`, [p.id]), encaissement: enc };
}

/** Rend l'empreinte sans rien débiter, et annule la commande : c'est le
 *  geste commercial sur une commande que personne n'est venu chercher. */
export async function libererPaiement(paiementId, { annulerCommande = true } = {}) {
  const p = await une(`SELECT * FROM paiements WHERE id = $1`, [paiementId]);
  if (!p) return { erreur: 'Paiement introuvable.' };
  if (p.statut === 'capture') return { erreur: 'Ce paiement est déjà débité : il faut le rembourser depuis Stripe.' };
  if (p.statut === 'libere') return { erreur: 'Cette empreinte est déjà libérée.' };

  await liberer(p.intention_id);
  await executer(
    `UPDATE paiements SET statut = 'libere', libere_le = now() WHERE id = $1`, [p.id]);

  if (annulerCommande && p.commande_id) {
    await executer(
      `UPDATE commandes SET statut = 'annulee' WHERE id = $1 AND statut NOT IN ('encaissee','annulee')`,
      [p.commande_id]
    );
  }
  return { paiement: await une(`SELECT * FROM paiements WHERE id = $1`, [p.id]) };
}

/** Un débit immédiat a réussi (règlement depuis l'espace client) : il n'y
 *  a rien à arbitrer, on encaisse dans la foulée. */
export async function marquerPayeEtEncaisser(intentionId) {
  const p = await une(
    `UPDATE paiements SET statut = 'capture', capture_cents = montant_cents, capture_le = now()
      WHERE intention_id = $1 AND statut IN ('a_confirmer','autorise') RETURNING *`,
    [intentionId]
  );
  if (!p) return { ignore: true };

  const enc = p.commande_id
    ? await encaisserCommande(p.commande_id, { remiseCents: 0 })
    : await encaisserTablee(p.tablee_id, { remiseCents: 0 });
  return { paiement: p, encaissement: enc };
}

/** Vrai si cet événement Stripe a déjà été traité. Stripe réémet un
 *  webhook jusqu'à recevoir un 2xx, et peut le livrer deux fois même
 *  ensuite : sans ce garde-fou, un même paiement créditerait deux fois la
 *  cagnotte du client. */
export async function evenementDejaVu(id, type) {
  const pose = await une(
    `INSERT INTO paiement_evenements (id, type) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, type]
  );
  return !pose;
}

/** Les empreintes autorisées qui approchent de leur expiration. Une
 *  autorisation Stripe tombe d'elle-même au bout d'environ sept jours :
 *  passé ce délai, l'argent n'est plus réservé et la commande impayée. */
export async function empreintesQuiExpirent(joursRestants = 2) {
  return query(
    `SELECT p.*, c.reference, c.date, c.heure, cl.prenom, cl.nom, cl.telephone_saisi
       FROM paiements p
       JOIN commandes c ON c.id = p.commande_id
       JOIN clients cl ON cl.id = p.client_id
      WHERE p.statut = 'autorise' AND p.mode = 'empreinte'
        AND p.autorise_le < now() - make_interval(days => 7 - $1)
      ORDER BY p.autorise_le`,
    [joursRestants]
  );
}
