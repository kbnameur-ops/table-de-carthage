import { Router } from 'express';
import { db } from '../db.js';
import { dateValide, heureValide } from '../lib/validate.js';
import { creneauEncoreValide } from '../lib/availability.js';
import { validerIdentite, trouverOuCreerClient } from '../lib/clients.js';
import { genererReference } from '../lib/reference.js';
import { verifierCsrf } from '../middleware.js';
import { enregistrerTentative, tropDeTentatives } from '../lib/auth.js';

const MAX_SOUMISSIONS_15MIN = 20;

export const reservationRouter = Router();
const aujourdHui = () => new Date().toISOString().slice(0, 10);

function formulaireVide() {
  return { erreurGenerale: null, erreurs: {}, valeurs: {}, aujourdHui: aujourdHui(), session: null };
}

reservationRouter.get('/reserver', (req, res) => {
  res.render('reservation', { ...formulaireVide(), session: req.session, csrfToken: res.locals.csrfToken });
});

reservationRouter.post('/reserver', verifierCsrf, (req, res) => {
  const b = req.body;
  const erreurs = {};

  // Limite le débit de soumission par IP : sans ça, le message « ce numéro
  // est déjà associé à un compte » (plus bas) deviendrait un oracle permettant
  // de sonder à volume illimité quels téléphones sont des clients existants,
  // et rien n'empêcherait un script de remplir la table de réservations.
  const cleDebit = `reserver:${req.ip}`;
  if (tropDeTentatives(cleDebit, MAX_SOUMISSIONS_15MIN)) {
    return res.render('reservation', {
      erreurGenerale: 'Trop de demandes depuis cette connexion. Merci de réessayer dans quelques minutes, ou de nous appeler directement.',
      erreurs: {}, valeurs: b, aujourdHui: aujourdHui(), session: req.session, csrfToken: res.locals.csrfToken,
    });
  }
  enregistrerTentative(cleDebit);

  if (!dateValide(b.date) || b.date < aujourdHui()) erreurs.date = 'Date invalide.';
  const couverts = parseInt(b.couverts, 10);
  if (!Number.isInteger(couverts) || couverts < 1 || couverts > 30) erreurs.couverts = 'Nombre de couverts invalide.';
  if (!heureValide(b.heure)) erreurs.heure = 'Merci de choisir un horaire.';

  Object.assign(erreurs, validerIdentite(b));

  // Le créneau affiché a pu se remplir entre le chargement de la page et
  // l'envoi du formulaire : on ne fait jamais confiance à l'heure soumise
  // sans la revérifier contre l'état actuel des réservations.
  let service = null;
  if (!erreurs.date && !erreurs.couverts && !erreurs.heure) {
    const v = creneauEncoreValide(b.date, b.heure, couverts);
    service = v.service;
    if (!v.valide) erreurs.heure = "Ce créneau n'est plus disponible. Merci d'en choisir un autre.";
  }

  if (Object.keys(erreurs).length) {
    return res.render('reservation', {
      erreurGenerale: null, erreurs, valeurs: b, aujourdHui: aujourdHui(),
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  }

  const { client, erreur } = trouverOuCreerClient(b);
  if (erreur === 'telephone_associe') {
    return res.render('reservation', {
      erreurGenerale: "Ce numéro de téléphone est déjà associé à un compte, mais la date de naissance ne correspond pas. Vérifiez-la, ou contactez-nous.",
      erreurs: {}, valeurs: b, aujourdHui: aujourdHui(), session: req.session, csrfToken: res.locals.csrfToken,
    });
  }

  const reference = genererReference('RES');
  db.prepare(
    `INSERT INTO reservations (reference, client_id, service_id, date, heure, couverts, motif, message)
     VALUES (?, ?, ?, ?, ?, ?, 'Réservation', ?)`
  ).run(reference, client.id, service.id, b.date, b.heure, couverts, (b.message || '').trim());

  res.redirect(`/reserver/confirmation?ref=${encodeURIComponent(reference)}`);
});

reservationRouter.get('/reserver/confirmation', (req, res) => {
  const reservation = db.prepare(`SELECT * FROM reservations WHERE reference = ?`).get(req.query.ref || '');
  if (!reservation) return res.redirect('/reserver');
  const dateLisible = new Date(reservation.date + 'T00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  res.render('reservation-confirmee', { reservation, dateLisible, session: req.session, csrfToken: res.locals.csrfToken });
});
