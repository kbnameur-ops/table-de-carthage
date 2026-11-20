import { Router } from 'express';
import { euros } from '../lib/money.js';
import { dateLongue } from '../lib/jours.js';
import { verifierCsrf } from '../middleware.js';
import { validerIdentite, trouverOuCreerClient } from '../lib/clients.js';
import { enregistrerTentative, tropDeTentatives } from '../lib/auth.js';
import { notifier, quand } from '../lib/notifications.js';
import { clientDeSession, connecterDepuisTunnel, quitterIdentite } from '../lib/tunnel-identite.js';
import { evenementParSlug, reserverPlaces, paragraphes, prixParPersonne } from '../lib/evenements.js';
import { envoyerEmail, emailConfirmationEvenement, emailNotificationInterne, contactInterne } from '../lib/email.js';
import { paiementDisponible } from '../lib/paiement.js';
import { ouvrirPaiementEvenement } from '../lib/reglement.js';

const MAX_SOUMISSIONS_15MIN = 20;

export const evenementsRouter = Router();

async function pageEvenement(req, res, evenement, extra = {}) {
  return {
    titre: evenement.titre, actif: '',
    evenement, paragraphes: paragraphes(evenement.texte),
    euros, dateLongue,
    erreurGenerale: null, erreurs: {}, valeurs: {}, erreurConnexion: null,
    client: await clientDeSession(req.session),
    session: req.session, csrfToken: res.locals.csrfToken,
    ...extra,
  };
}

/** La page d'une soirée : ses photos, son récit, et de quoi y prendre
 *  place. Une soirée non visible reste consultable par son adresse — c'est
 *  ainsi que le salon la relit avant de l'annoncer — mais la réservation y
 *  est refusée. */
evenementsRouter.get('/evenements/:slug', async (req, res, next) => {
  try {
    const evenement = await evenementParSlug(req.params.slug);
    if (!evenement) {
      return res.status(404).render('erreur', {
        titre: 'Soirée introuvable', session: req.session, actif: '',
        message: "Cette soirée n'existe pas, ou n'est plus annoncée.",
      });
    }
    res.render('evenement', await pageEvenement(req, res, evenement));
  } catch (err) { next(err); }
});

/** Prendre des places. Le montant n'est jamais lu depuis le formulaire :
 *  il est recalculé depuis le prix en base au moment de la réservation. */
evenementsRouter.post('/evenements/:slug/reserver', verifierCsrf, async (req, res, next) => {
  try {
    const evenement = await evenementParSlug(req.params.slug);
    if (!evenement) return res.redirect('/');
    const b = req.body;

    // Se reconnaître ou changer de compte ne réserve rien : on réaffiche la
    // page, le nombre de places conservé.
    if (b.action === 'connexion') {
      const { erreur } = await connecterDepuisTunnel(b, req.session, req.ip);
      return res.render('evenement', await pageEvenement(req, res, evenement,
        { valeurs: b, erreurConnexion: erreur || null }));
    }
    if (b.action === 'changer') {
      await quitterIdentite(req.session);
      return res.render('evenement', await pageEvenement(req, res, evenement, { valeurs: b }));
    }

    const cleDebit = `evenement:${req.ip}`;
    if (await tropDeTentatives(cleDebit, MAX_SOUMISSIONS_15MIN)) {
      return res.render('evenement', await pageEvenement(req, res, evenement, {
        valeurs: b,
        erreurGenerale: 'Trop de demandes depuis cette connexion. Merci de réessayer dans quelques minutes, ou de nous appeler.',
      }));
    }
    await enregistrerTentative(cleDebit);

    const erreurs = {};
    const clientConnecte = await clientDeSession(req.session);
    if (!clientConnecte) Object.assign(erreurs, validerIdentite(b));

    const places = parseInt(b.places, 10);
    if (!Number.isInteger(places) || places < 1) erreurs.places = 'Indiquez au moins une place.';

    if (Object.keys(erreurs).length) {
      return res.render('evenement', await pageEvenement(req, res, evenement, { erreurs, valeurs: b }));
    }

    let client = clientConnecte;
    if (!client) {
      const trouve = await trouverOuCreerClient(b);
      if (trouve.erreur === 'telephone_associe') {
        return res.render('evenement', await pageEvenement(req, res, evenement, {
          valeurs: b,
          erreurGenerale: "Ce numéro de téléphone est déjà associé à un compte. Connectez-vous ci-dessus avec votre date de naissance.",
        }));
      }
      client = trouve.client;
    }

    // C'est ici, et seulement ici, que les places sont décomptées — dans une
    // transaction qui verrouille la soirée.
    const r = await reserverPlaces(evenement.id, client.id, places);
    if (r.erreur) {
      const relu = await evenementParSlug(req.params.slug);
      return res.render('evenement', await pageEvenement(req, res, relu, {
        valeurs: b, erreurGenerale: r.erreur,
      }));
    }

    // Rien à payer en ligne — soirée « à la carte », gratuite, ou Stripe
    // pas branché : la place est retenue et se règle sur place. Le site ne
    // doit pas devenir un cul-de-sac le jour où Stripe dort. Le salon et le
    // client sont prévenus ici, puisqu'aucun webhook de paiement ne le fera.
    if (!prixParPersonne(evenement) || !paiementDisponible()) {
      const montant = evenement.prix_texte || euros(r.reservation.total_cents);
      const titreNotif = `Réservation d'événement — ${evenement.titre}`;
      const detailNotif = `${client.prenom} ${client.nom} · ${places} place${places > 1 ? 's' : ''} · ${quand(evenement.date, evenement.heure)} · ${montant} · à régler sur place · ${client.telephone_saisi}`;
      const lienNotif = `/salon/evenements/${evenement.id}`;
      await notifier({ type: 'reservation', titre: titreNotif, detail: detailNotif, lien: lienNotif });
      await Promise.allSettled([
        envoyerEmail({ a: contactInterne(), ...emailNotificationInterne({ titre: titreNotif, detail: detailNotif, lien: lienNotif }) }),
        client.email
          ? envoyerEmail({
              a: client.email,
              ...emailConfirmationEvenement({
                client, reference: r.reservation.reference, titre: evenement.titre,
                dateLisible: dateLongue(evenement.date), heure: evenement.heure,
                places, tarif: montant,
              }),
            })
          : Promise.resolve(),
      ]);
      return res.redirect(`/evenements/${evenement.slug}/confirmation?ref=${encodeURIComponent(r.reservation.reference)}`);
    }

    res.redirect(`/evenements/reglement/${encodeURIComponent(r.reservation.reference)}`);
  } catch (err) { next(err); }
});

/** L'écran de paiement d'une place. Le même que pour une commande : mêmes
 *  portefeuilles, même formulaire de carte, même case d'enregistrement. */
evenementsRouter.get('/evenements/reglement/:reference', async (req, res, next) => {
  try {
    const { une } = await import('../db.js');
    const resa = await une(
      `SELECT r.*, e.titre, e.slug, e.date, e.heure, e.prix_texte FROM evenement_reservations r
         JOIN evenements e ON e.id = r.evenement_id
        WHERE r.reference = $1`, [req.params.reference]);
    if (!resa) return res.redirect('/');

    if (!paiementDisponible() || resa.statut !== 'a_payer') {
      return res.redirect(`/evenements/${resa.slug}/confirmation?ref=${encodeURIComponent(resa.reference)}`);
    }

    const r = await ouvrirPaiementEvenement(resa.id);
    if (r.erreur || r.dejaRegle) {
      return res.redirect(`/evenements/${resa.slug}/confirmation?ref=${encodeURIComponent(resa.reference)}`);
    }

    const { clePublique, paiementSimule } = await import('../lib/paiement.js');
    res.render('paiement', {
      titre: 'Régler ma place', actif: '',
      commande: null,
      lignes: [{ nom: `${resa.titre} — ${dateLongue(resa.date)}`, prix_cents: Math.round(resa.total_cents / resa.places), quantite: resa.places }],
      euros,
      montantCents: r.paiement.montant_cents,
      secretClient: r.secretClient,
      clePublique: clePublique(),
      simule: paiementSimule(),
      paiementId: r.paiement.id,
      retour: `/evenements/${resa.slug}/confirmation?ref=${encodeURIComponent(resa.reference)}`,
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

evenementsRouter.get('/evenements/:slug/confirmation', async (req, res, next) => {
  try {
    const { une } = await import('../db.js');
    const resa = await une(
      `SELECT r.*, e.titre, e.slug, e.date, e.heure, e.prix_texte FROM evenement_reservations r
         JOIN evenements e ON e.id = r.evenement_id
        WHERE r.reference = $1`, [req.query.ref || '']);
    if (!resa) return res.redirect(`/evenements/${req.params.slug}`);

    res.render('evenement-confirmation', {
      titre: 'Place réservée', actif: '',
      resa, euros, dateLongue,
      // Tant que le webhook n'a pas confirmé, la place reste 'a_payer' : on
      // le dit plutôt que d'annoncer une place acquise qui ne l'est pas.
      enAttente: resa.statut === 'a_payer' && paiementDisponible(),
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});
