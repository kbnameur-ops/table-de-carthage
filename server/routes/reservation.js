import { Router } from 'express';
import { executer, une } from '../db.js';
import { dateValide, heureValide } from '../lib/validate.js';
import { creneauEncoreValide } from '../lib/availability.js';
import { validerIdentite, trouverOuCreerClient } from '../lib/clients.js';
import { genererReference } from '../lib/reference.js';
import { verifierCsrf } from '../middleware.js';
import { enregistrerTentative, tropDeTentatives } from '../lib/auth.js';
import { notifier, quand } from '../lib/notifications.js';
import { clientDeSession, connecterDepuisTunnel, quitterIdentite } from '../lib/tunnel-identite.js';

const MAX_SOUMISSIONS_15MIN = 20;

export const reservationRouter = Router();
const aujourdHui = () => new Date().toISOString().slice(0, 10);

/** Données communes à tous les rendus du formulaire, connecté ou non. */
async function pageReservation(req, res, extra = {}) {
  return {
    erreurGenerale: null, erreurs: {}, valeurs: {}, erreurConnexion: null,
    aujourdHui: aujourdHui(),
    client: await clientDeSession(req.session),
    session: req.session, csrfToken: res.locals.csrfToken,
    ...extra,
  };
}

reservationRouter.get('/reserver', async (req, res, next) => {
  try {
    res.render('reservation', await pageReservation(req, res));
  } catch (err) { next(err); }
});

reservationRouter.post('/reserver', verifierCsrf, async (req, res, next) => {
  try {
    const b = req.body;
    const erreurs = {};

    // Se reconnaître ou changer de compte ne valide pas la réservation :
    // on réaffiche le formulaire, date et créneau déjà choisis intacts.
    if (b.action === 'connexion') {
      const { erreur } = await connecterDepuisTunnel(b, req.session, req.ip);
      return res.render('reservation', await pageReservation(req, res, { valeurs: b, erreurConnexion: erreur || null }));
    }
    if (b.action === 'changer') {
      await quitterIdentite(req.session);
      return res.render('reservation', await pageReservation(req, res, { valeurs: b }));
    }

    // Limite le débit de soumission par IP : sans ça, le message « ce numéro
    // est déjà associé à un compte » (plus bas) deviendrait un oracle permettant
    // de sonder à volume illimité quels téléphones sont des clients existants,
    // et rien n'empêcherait un script de remplir la table de réservations.
    const cleDebit = `reserver:${req.ip}`;
    if (await tropDeTentatives(cleDebit, MAX_SOUMISSIONS_15MIN)) {
      return res.render('reservation', await pageReservation(req, res, {
        valeurs: b,
        erreurGenerale: 'Trop de demandes depuis cette connexion. Merci de réessayer dans quelques minutes, ou de nous appeler directement.',
      }));
    }
    await enregistrerTentative(cleDebit);

    if (!dateValide(b.date) || b.date < aujourdHui()) erreurs.date = 'Date invalide.';
    const couverts = parseInt(b.couverts, 10);
    if (!Number.isInteger(couverts) || couverts < 1 || couverts > 30) erreurs.couverts = 'Nombre de couverts invalide.';
    if (!heureValide(b.heure)) erreurs.heure = 'Merci de choisir un horaire.';

    // Un client connecté est déjà identifié : on ignore les champs
    // d'identité éventuellement soumis, sinon on pourrait réserver au nom
    // de quelqu'un d'autre en forgeant la requête.
    const clientConnecte = await clientDeSession(req.session);
    if (!clientConnecte) Object.assign(erreurs, validerIdentite(b));

    // Le créneau affiché a pu se remplir entre le chargement de la page et
    // l'envoi du formulaire : on ne fait jamais confiance à l'heure soumise
    // sans la revérifier contre l'état actuel des réservations.
    let service = null, table = null;
    if (!erreurs.date && !erreurs.couverts && !erreurs.heure) {
      const v = await creneauEncoreValide(b.date, b.heure, couverts);
      service = v.service;
      table = v.table;
      if (!v.valide) erreurs.heure = "Ce créneau n'est plus disponible. Merci d'en choisir un autre.";
    }

    if (Object.keys(erreurs).length) {
      return res.render('reservation', await pageReservation(req, res, { erreurs, valeurs: b }));
    }

    let client = clientConnecte;
    if (!client) {
      const trouve = await trouverOuCreerClient(b);
      if (trouve.erreur === 'telephone_associe') {
        return res.render('reservation', await pageReservation(req, res, {
          valeurs: b,
          erreurGenerale: "Ce numéro de téléphone est déjà associé à un compte. Connectez-vous ci-dessus avec votre date de naissance, ou contactez-nous.",
        }));
      }
      client = trouve.client;
    }

    const reference = genererReference('RES');
    await executer(
      `INSERT INTO reservations (reference, client_id, service_id, table_id, date, heure, couverts, motif, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Réservation', $8)`,
      [reference, client.id, service.id, table.id, b.date, b.heure, couverts, (b.message || '').trim()]
    );

    await notifier({
      type: 'reservation',
      titre: `Nouvelle réservation — ${couverts} couvert${couverts > 1 ? 's' : ''}`,
      detail: `${client.prenom} ${client.nom} · ${quand(b.date, b.heure)} · table ${table.nom} · ${client.telephone_saisi}`,
      lien: `/salon/reservations?date=${b.date}`,
    });

    res.redirect(`/reserver/confirmation?ref=${encodeURIComponent(reference)}`);
  } catch (err) { next(err); }
});

reservationRouter.get('/reserver/confirmation', async (req, res, next) => {
  try {
    const reservation = await une(`SELECT * FROM reservations WHERE reference = $1`, [req.query.ref || '']);
    if (!reservation) return res.redirect('/reserver');
    const dateLisible = new Date(reservation.date + 'T00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    res.render('reservation-confirmee', { reservation, dateLisible, session: req.session, csrfToken: res.locals.csrfToken });
  } catch (err) { next(err); }
});
