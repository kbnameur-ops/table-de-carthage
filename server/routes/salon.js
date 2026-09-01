import { Router } from 'express';
import { une } from '../db.js';
import { emailValide } from '../lib/validate.js';
import { modeStripe, manquePourPaiement } from '../lib/paiement.js';
import {
  verifierMotDePasse, elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { listerNotifications, compterNonLues, marquerLue, toutMarquerLu } from '../lib/notifications.js';
import { euros } from '../lib/money.js';

export const salonRouter = Router();

salonRouter.get('/salon/connexion', (req, res) => {
  if (req.session.role === 'admin') return res.redirect('/salon');
  res.render('salon-connexion', { erreurGenerale: null, valeurs: {}, csrfToken: res.locals.csrfToken });
});

salonRouter.post('/salon/connexion', verifierCsrf, async (req, res, next) => {
  try {
    const { email, motDePasse } = req.body;
    const rendreErreur = (msg) => res.render('salon-connexion', {
      erreurGenerale: msg, valeurs: req.body, csrfToken: res.locals.csrfToken,
    });

    if (!emailValide(email) || !motDePasse) return rendreErreur('Identifiants invalides.');

    const cle = `admin:${email}:${req.ip}`;
    if (await tropDeTentatives(cle)) return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);

    const admin = await une(`SELECT * FROM admins WHERE email = $1`, [email.trim().toLowerCase()]);
    if (!admin || !verifierMotDePasse(motDePasse, admin.mot_de_passe)) {
      await enregistrerTentative(cle);
      return rendreErreur('Identifiants invalides.');
    }

    await reinitialiserTentatives(cle);
    await elargirSession(req.session.id, 'admin', admin.id);
    res.redirect('/salon');
  } catch (err) { next(err); }
});

salonRouter.post('/salon/deconnexion', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await detruireSession(req.session.id);
    res.clearCookie('sid');
    res.redirect('/salon/connexion');
  } catch (err) { next(err); }
});

salonRouter.get('/salon', exigerAdmin, async (req, res, next) => {
  try {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const resaAujourdhui = await une(
      `SELECT COALESCE(SUM(couverts),0)::int AS couverts, COUNT(*)::int AS n FROM reservations
       WHERE date = $1 AND statut NOT IN ('annulee','absente')`, [aujourdHui]
    );
    const resaAttente = await une(
      `SELECT COUNT(*)::int AS n FROM reservations WHERE statut = 'en_attente' AND date >= $1`, [aujourdHui]
    );
    const cmdAujourdhui = await une(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_cents),0)::int AS total FROM commandes
       WHERE date = $1 AND statut NOT IN ('annulee','a_payer')`, [aujourdHui]
    );
    const cmdAttente = await une(
      `SELECT COUNT(*)::int AS n FROM commandes WHERE statut = 'en_attente' AND date >= $1`, [aujourdHui]
    );

    res.render('salon/dashboard', {
      titre: 'Tableau de bord', actif: 'dashboard',
      resaAujourdhui, resaAttente, cmdAujourdhui, cmdAttente,
      aujourdHui, euros,
      // Savoir si les cartes sont acceptées, et dans quel mode : sans cette
      // ligne, « les cartes de mes clients sont refusées » et « je suis
      // encore en mode test » se ressemblent trop.
      modePaiement: modeStripe(), manquePaiement: manquePourPaiement(),
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

// ── Notifications ──────────────────────────────────────────
salonRouter.get('/salon/notifications', exigerAdmin, async (req, res, next) => {
  try {
    res.render('salon/notifications', {
      titre: 'Notifications', actif: 'notifications',
      notifications: await listerNotifications(),
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** Sondée par la barre du salon pour rafraîchir le badge sans recharger la
 *  page : c'est ce qui donne l'impression que la notification « arrive ». */
salonRouter.get('/salon/api/notifications', exigerAdmin, async (req, res, next) => {
  try {
    res.json({ n: await compterNonLues() });
  } catch (err) { next(err); }
});

salonRouter.post('/salon/notifications/:id/lue', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await marquerLue(req.params.id);
    redirigerRetour(req, res, '/salon/notifications');
  } catch (err) { next(err); }
});

salonRouter.post('/salon/notifications/tout-lu', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await toutMarquerLu();
    redirigerRetour(req, res, '/salon/notifications');
  } catch (err) { next(err); }
});
