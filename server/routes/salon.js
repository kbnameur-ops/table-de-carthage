import { Router } from 'express';
import { db } from '../db.js';
import { emailValide } from '../lib/validate.js';
import {
  verifierMotDePasse, elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { exigerAdmin, verifierCsrf } from '../middleware.js';
import { euros } from '../lib/money.js';

export const salonRouter = Router();

salonRouter.get('/salon/connexion', (req, res) => {
  if (req.session.role === 'admin') return res.redirect('/salon');
  res.render('salon-connexion', { erreurGenerale: null, valeurs: {}, csrfToken: res.locals.csrfToken });
});

salonRouter.post('/salon/connexion', verifierCsrf, (req, res) => {
  const { email, motDePasse } = req.body;
  const rendreErreur = (msg) => res.render('salon-connexion', {
    erreurGenerale: msg, valeurs: req.body, csrfToken: res.locals.csrfToken,
  });

  if (!emailValide(email) || !motDePasse) return rendreErreur('Identifiants invalides.');

  const cle = `admin:${email}:${req.ip}`;
  if (tropDeTentatives(cle)) return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);

  const admin = db.prepare(`SELECT * FROM admins WHERE email = ?`).get(email.trim().toLowerCase());
  if (!admin || !verifierMotDePasse(motDePasse, admin.mot_de_passe)) {
    enregistrerTentative(cle);
    return rendreErreur('Identifiants invalides.');
  }

  reinitialiserTentatives(cle);
  elargirSession(req.session.id, 'admin', admin.id);
  res.redirect('/salon');
});

salonRouter.post('/salon/deconnexion', exigerAdmin, verifierCsrf, (req, res) => {
  detruireSession(req.session.id);
  res.clearCookie('sid');
  res.redirect('/salon/connexion');
});

salonRouter.get('/salon', exigerAdmin, (req, res) => {
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const resaAujourdhui = db.prepare(
    `SELECT COALESCE(SUM(couverts),0) AS couverts, COUNT(*) AS n FROM reservations
     WHERE date = ? AND statut NOT IN ('annulee','absente')`
  ).get(aujourdHui);
  const resaAttente = db.prepare(
    `SELECT COUNT(*) AS n FROM reservations WHERE statut = 'en_attente' AND date >= ?`
  ).get(aujourdHui);
  const cmdAujourdhui = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total FROM commandes
     WHERE date = ? AND statut != 'annulee'`
  ).get(aujourdHui);
  const cmdAttente = db.prepare(
    `SELECT COUNT(*) AS n FROM commandes WHERE statut = 'en_attente' AND date >= ?`
  ).get(aujourdHui);

  res.render('salon/dashboard', {
    titre: 'Tableau de bord', actif: 'dashboard',
    resaAujourdhui, resaAttente, cmdAujourdhui, cmdAttente,
    euros,
    csrfToken: res.locals.csrfToken,
  });
});
