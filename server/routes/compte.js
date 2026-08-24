import { Router } from 'express';
import { db } from '../db.js';
import { normaliserTelephone } from '../lib/phone.js';
import { dateValide } from '../lib/validate.js';
import { euros } from '../lib/money.js';
import {
  elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { exigerClient, verifierCsrf } from '../middleware.js';

export const compteRouter = Router();

const LIBELLES_RESA = {
  en_attente: 'En attente', confirmee: 'Confirmée', honoree: 'Honorée',
  annulee: 'Annulée', absente: 'Non présenté',
};
const LIBELLES_CMD = {
  en_attente: 'En attente', confirmee: 'Confirmée', prete: 'Prête',
  retiree: 'Retirée', annulee: 'Annulée',
};

compteRouter.get('/compte/connexion', (req, res) => {
  if (req.session.role === 'client') return res.redirect('/compte');
  res.render('compte-connexion', { erreurGenerale: null, valeurs: {}, session: req.session, csrfToken: res.locals.csrfToken });
});

compteRouter.post('/compte/connexion', verifierCsrf, (req, res) => {
  const { telephone, dateNaissance } = req.body;
  const rendreErreur = (msg) => res.render('compte-connexion', {
    erreurGenerale: msg, valeurs: req.body, session: req.session, csrfToken: res.locals.csrfToken,
  });

  if (!telephone || !dateValide(dateNaissance)) {
    return rendreErreur('Merci de renseigner un numéro de téléphone et une date de naissance valides.');
  }

  const num = normaliserTelephone(telephone);
  const cle = `client:${num}:${req.ip}`;
  if (tropDeTentatives(cle)) {
    return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);
  }

  const client = db.prepare(`SELECT * FROM clients WHERE telephone = ?`).get(num);
  if (!client || client.date_naissance !== dateNaissance) {
    enregistrerTentative(cle);
    return rendreErreur('Numéro de téléphone ou date de naissance incorrects.');
  }

  reinitialiserTentatives(cle);
  elargirSession(req.session.id, 'client', client.id);
  res.redirect('/compte');
});

compteRouter.get('/compte', exigerClient, (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.clientId);
  if (!client) { detruireSession(req.session.id); return res.redirect('/compte/connexion'); }

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const reservations = db.prepare(
    `SELECT * FROM reservations WHERE client_id = ? ORDER BY date DESC, heure DESC`
  ).all(client.id).map(r => ({
    ...r,
    annulable: r.statut !== 'annulee' && r.statut !== 'honoree' && r.date >= aujourdHui,
  }));
  const commandes = db.prepare(
    `SELECT * FROM commandes WHERE client_id = ? ORDER BY date DESC, heure DESC`
  ).all(client.id).map(c => ({
    ...c,
    annulable: c.statut !== 'annulee' && c.statut !== 'retiree' && c.date >= aujourdHui,
  }));

  res.render('compte-tableau', {
    client, reservations, commandes, euros,
    libellesStatutResa: LIBELLES_RESA, libellesStatutCmd: LIBELLES_CMD,
    message: req.query.msg || null,
    session: req.session, csrfToken: res.locals.csrfToken,
  });
});

compteRouter.post('/compte/reservations/:id/annuler', exigerClient, verifierCsrf, (req, res) => {
  db.prepare(
    `UPDATE reservations SET statut = 'annulee' WHERE id = ? AND client_id = ? AND statut NOT IN ('annulee','honoree')`
  ).run(req.params.id, req.clientId);
  res.redirect('/compte?msg=' + encodeURIComponent('Réservation annulée.'));
});

compteRouter.post('/compte/commandes/:id/annuler', exigerClient, verifierCsrf, (req, res) => {
  db.prepare(
    `UPDATE commandes SET statut = 'annulee' WHERE id = ? AND client_id = ? AND statut NOT IN ('annulee','retiree')`
  ).run(req.params.id, req.clientId);
  res.redirect('/compte?msg=' + encodeURIComponent('Commande annulée.'));
});

compteRouter.post('/compte/deconnexion', verifierCsrf, (req, res) => {
  detruireSession(req.session.id);
  res.clearCookie('sid');
  res.redirect('/'); // le middleware attribuera une nouvelle session invité à la requête suivante
});
