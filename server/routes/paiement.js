import { Router } from 'express';
import express from 'express';
import { une, query } from '../db.js';
import { verifierCsrf, exigerClient } from '../middleware.js';
import { euros } from '../lib/money.js';
import { notifier } from '../lib/notifications.js';
import {
  paiementDisponible, paiementSimule, clePublique, evenementDepuisWebhook,
} from '../lib/paiement.js';
import {
  ouvrirPaiementCommande, ouvrirPaiementTablee, paiementVivantCommande,
  marquerAutorise, marquerEchoue, marquerPayeEtEncaisser, evenementDejaVu,
} from '../lib/reglement.js';

/** Le paiement en ligne, côté écrans.
 *
 *  Deux entrées distinctes, pour deux gestes différents :
 *   — le tunnel à emporter, où l'empreinte est exigée avant que la
 *     commande ne parte en cuisine ;
 *   — l'espace client, où l'on règle une commande déjà passée ou
 *     l'addition de la table où l'on est installé.
 *
 *  Aucun montant ne transite par le navigateur : chaque route recalcule ce
 *  qui est dû depuis les lignes en base. */
export const paiementRouter = Router();

/** ── Le webhook, monté à part ────────────────────────────────
 *
 *  Il vit dans son propre routeur parce qu'il doit recevoir le corps BRUT
 *  de la requête : la signature de Stripe porte sur ces octets exacts, et
 *  un corps analysé puis re-sérialisé par `express.json()` ne redonne pas
 *  la même chaîne. Ce routeur est donc monté AVANT les analyseurs de corps
 *  dans server/index.js — l'ordre n'est pas cosmétique, l'inverse casse la
 *  vérification de signature.
 *
 *  C'est le webhook qui fait foi, jamais le retour de navigateur : un
 *  client qui ferme son onglet juste après avoir payé doit quand même voir
 *  sa commande partir en cuisine. */
export const paiementWebhookRouter = Router();

paiementWebhookRouter.post(
  '/paiement/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    let evenement;
    try {
      evenement = await evenementDepuisWebhook(req.body, req.get('stripe-signature'));
    } catch (err) {
      // 400 : Stripe ne réessaiera pas une signature invalide, et c'est
      // bien ce qu'on veut — une requête non signée n'est pas un incident
      // réseau, c'est quelqu'un qui frappe à la porte.
      console.error('Webhook Stripe refusé :', err.message);
      return res.status(400).send('signature invalide');
    }

    try {
      if (await evenementDejaVu(evenement.id, evenement.type)) return res.json({ recu: true });

      const intention = evenement.data.object;
      switch (evenement.type) {
        // L'empreinte est posée : argent bloqué, rien de débité.
        case 'payment_intent.amount_capturable_updated':
          await surAutorisation(intention.id);
          break;
        // Débit immédiat abouti (règlement depuis l'espace client), ou
        // capture d'une empreinte confirmée par Stripe.
        case 'payment_intent.succeeded':
          await surPaiement(intention.id);
          break;
        case 'payment_intent.payment_failed':
          await marquerEchoue(intention.id, intention.last_payment_error?.message || 'refusé');
          break;
        case 'payment_intent.canceled':
          await marquerEchoue(intention.id, 'annulé');
          break;
      }
      res.json({ recu: true });
    } catch (err) {
      // 500 : Stripe réessaiera, et l'événement n'ayant pas été marqué vu
      // en cas d'échec avant traitement, la reprise est sans danger.
      console.error('Webhook Stripe — traitement en échec :', err);
      res.status(500).send('traitement en échec');
    }
  }
);

async function surAutorisation(intentionId) {
  const r = await marquerAutorise(intentionId);
  if (r.ignore || !r.paiement?.commande_id) return;
  const c = await une(
    `SELECT c.reference, c.date, c.heure, c.total_cents, cl.prenom, cl.nom, cl.telephone_saisi
       FROM commandes c JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
    [r.paiement.commande_id]
  );
  if (!c) return;
  await notifier({
    type: 'commande',
    titre: `Commande payée — ${euros(c.total_cents)}`,
    detail: `${c.prenom} ${c.nom} · empreinte prise · retrait ${c.date} ${c.heure} · ${c.telephone_saisi}`,
    lien: `/salon/commandes?date=${c.date}`,
  });
}

async function surPaiement(intentionId) {
  const r = await marquerPayeEtEncaisser(intentionId);
  if (r.ignore) return;
  await notifier({
    type: 'commande',
    titre: `Règlement en ligne — ${euros(r.paiement.montant_cents)}`,
    detail: r.paiement.commande_id ? 'Commande à emporter réglée' : 'Addition de table réglée',
    lien: r.paiement.commande_id ? '/salon/commandes' : '/salon/tables-clients',
  });
}

/** ── La page de paiement ─────────────────────────────────────
 *
 *  Accessible par la référence de commande, sans exiger de connexion : un
 *  client qui commande sans créer d'espace doit pouvoir payer. La
 *  référence est un aléa non devinable, et ne donne accès qu'à un montant
 *  et à un formulaire — jamais aux coordonnées du client. */
paiementRouter.get('/paiement/:reference', async (req, res, next) => {
  try {
    const commande = await une(
      `SELECT * FROM commandes WHERE reference = $1`, [req.params.reference]);
    if (!commande) return res.redirect('/commander');

    if (!paiementDisponible()) {
      return res.redirect(`/commander/confirmation?ref=${encodeURIComponent(commande.reference)}`);
    }
    if (commande.statut === 'encaissee') {
      return res.render('paiement-fait', pageFaite(req, res, commande, 'Cette commande est déjà réglée.'));
    }

    const r = await ouvrirPaiementCommande(commande.id, { mode: 'empreinte' });
    if (r.erreur) {
      return res.render('paiement-fait', pageFaite(req, res, commande, r.erreur));
    }
    if (r.dejaRegle) {
      return res.render('paiement-fait', pageFaite(req, res, commande,
        'Votre carte a bien été enregistrée pour cette commande.'));
    }

    const lignes = await query(
      `SELECT * FROM commande_lignes WHERE commande_id = $1`, [commande.id]);

    res.render('paiement', {
      titre: 'Régler la commande', actif: 'commander',
      commande, lignes, euros,
      montantCents: r.paiement.montant_cents,
      secretClient: r.secretClient,
      clePublique: clePublique(),
      simule: paiementSimule(),
      paiementId: r.paiement.id,
      retour: `/paiement/${encodeURIComponent(commande.reference)}/retour`,
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

function pageFaite(req, res, commande, message) {
  return {
    titre: 'Paiement', actif: 'commander', commande, message, euros,
    session: req.session, csrfToken: res.locals.csrfToken,
  };
}

/** Là où Stripe renvoie le navigateur après confirmation. On n'y décide
 *  rien : l'état fait foi côté webhook. Cet écran ne fait que dire au
 *  client où il en est. */
paiementRouter.get('/paiement/:reference/retour', async (req, res, next) => {
  try {
    const commande = await une(
      `SELECT * FROM commandes WHERE reference = $1`, [req.params.reference]);
    if (!commande) return res.redirect('/commander');

    const paiement = await paiementVivantCommande(commande.id);
    const message = !paiement
      ? "Le paiement n'a pas abouti. Vous pouvez réessayer depuis votre espace."
      : paiement.statut === 'a_confirmer'
        ? 'Paiement en cours de confirmation par votre banque. Cette page se met à jour toute seule.'
        : 'Votre carte est enregistrée. La commande part en cuisine.';

    res.render('paiement-fait', {
      ...pageFaite(req, res, commande, message),
      enAttente: paiement?.statut === 'a_confirmer',
    });
  } catch (err) { next(err); }
});

/** ── Depuis l'espace client ──────────────────────────────────── */

/** Régler une commande à emporter déjà passée. */
paiementRouter.post('/compte/commandes/:id/payer', exigerClient, verifierCsrf, async (req, res, next) => {
  try {
    const commande = await une(
      `SELECT * FROM commandes WHERE id = $1 AND client_id = $2 AND type = 'emporter'`,
      [req.params.id, req.clientId]
    );
    if (!commande) return res.redirect('/compte');
    res.redirect(`/paiement/${encodeURIComponent(commande.reference)}`);
  } catch (err) { next(err); }
});

/** Régler l'addition de la table où l'on est installé, depuis son
 *  téléphone, sans attendre que quelqu'un passe avec le terminal. */
paiementRouter.post('/compte/table/payer', exigerClient, verifierCsrf, async (req, res, next) => {
  try {
    const { tableeOuverteDuClient } = await import('../lib/tablees.js');
    const tablee = await tableeOuverteDuClient(req.clientId);
    if (!tablee) return res.redirect('/compte');

    const r = await ouvrirPaiementTablee(tablee.id);
    if (r.erreur) return res.redirect('/compte?err=' + encodeURIComponent(r.erreur));
    if (r.dejaRegle) return res.redirect('/compte?msg=' + encodeURIComponent('Addition déjà réglée.'));

    res.render('paiement', {
      titre: 'Régler l\'addition', actif: 'compte',
      commande: null, lignes: [], euros,
      montantCents: r.paiement.montant_cents,
      secretClient: r.secretClient,
      clePublique: clePublique(),
      simule: paiementSimule(),
      paiementId: r.paiement.id,
      retour: '/compte',
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** ── Simulation, en développement seulement ──────────────────
 *
 *  Sans compte Stripe, ces routes rejouent ce que le webhook ferait, pour
 *  qu'on puisse parcourir et tester tout le circuit. `paiementSimule()`
 *  exige PAIEMENT_SIMULE=1 *et* l'absence de clé Stripe : sur une
 *  installation réellement branchée, ces routes n'existent pas. */
paiementRouter.post('/paiement/simuler/:action', verifierCsrf, async (req, res, next) => {
  try {
    if (!paiementSimule()) return res.status(404).send('Introuvable');
    const p = await une(`SELECT * FROM paiements WHERE id = $1`, [req.body.paiementId]);
    if (!p) return res.status(404).send('Paiement introuvable');

    if (req.params.action === 'autoriser') await surAutorisation(p.intention_id);
    else if (req.params.action === 'payer') await surPaiement(p.intention_id);
    else if (req.params.action === 'echouer') await marquerEchoue(p.intention_id, 'simulation');

    res.redirect(req.body.retour || '/compte');
  } catch (err) { next(err); }
});
