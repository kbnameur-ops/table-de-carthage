import { Router } from 'express';
import { une } from '../db.js';
import { emailValide } from '../lib/validate.js';
import { modeStripe, manquePourPaiement, cleSecreteInvalide, diagnosticCleSecrete, clePubliqueEstSecrete } from '../lib/paiement.js';
import {
  verifierMotDePasse, elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { donneAccesSalon } from '../lib/personnel.js';
import { listerNotifications, compterNonLues, marquerLue, toutMarquerLu } from '../lib/notifications.js';
import { euros } from '../lib/money.js';

export const salonRouter = Router();

salonRouter.get('/salon/connexion', async (req, res, next) => {
  try {
    if (await donneAccesSalon(req.session)) return res.redirect('/salon');
    res.render('salon-connexion', { erreurGenerale: null, valeurs: {}, csrfToken: res.locals.csrfToken });
  } catch (err) { next(err); }
});

/** Deux origines pour un accès au salon, sur un seul formulaire :
 *
 *  — un compte historique (table `admins`), identifié par e-mail ;
 *  — un membre de l'équipe à qui l'accès admin a été donné depuis sa
 *    fiche, identifié comme aux portes du service et de la cuisine — par
 *    son identifiant, avec le même mot de passe.
 *
 *  On tranche sur la forme de ce qui a été saisi : une adresse e-mail vise
 *  la première table, tout le reste vise la seconde. Les deux mènent à
 *  '/salon' de la même façon — la seule différence est la table d'où sort
 *  l'identifiant, portée par le rôle de session ('admin' ou 'serveur') et
 *  invisible ensuite pour qui visite le salon. */
salonRouter.post('/salon/connexion', verifierCsrf, async (req, res, next) => {
  try {
    const identifiant = (req.body.email || '').trim().toLowerCase();
    const motDePasse = req.body.motDePasse || '';
    const rendreErreur = (msg) => res.render('salon-connexion', {
      erreurGenerale: msg, valeurs: req.body, csrfToken: res.locals.csrfToken,
    });

    if (!identifiant || !motDePasse) return rendreErreur('Identifiants invalides.');

    const cle = `admin:${identifiant}:${req.ip}`;
    if (await tropDeTentatives(cle)) return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);

    const compte = emailValide(identifiant)
      ? { role: 'admin', ligne: await une(`SELECT * FROM admins WHERE email = $1`, [identifiant]) }
      : {
          role: 'serveur',
          ligne: await une(
            `SELECT * FROM employes WHERE identifiant = $1 AND actif = true AND acces_admin = true`,
            [identifiant]
          ),
        };

    if (!compte.ligne || !compte.ligne.mot_de_passe || !verifierMotDePasse(motDePasse, compte.ligne.mot_de_passe)) {
      await enregistrerTentative(cle);
      return rendreErreur('Identifiants invalides.');
    }

    await reinitialiserTentatives(cle);
    await elargirSession(req.session.id, compte.role, compte.ligne.id);
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
      clePaiementInvalide: cleSecreteInvalide(),
      diagnosticCle: diagnosticCleSecrete(),
      clePubliqueEstSecrete: clePubliqueEstSecrete(),
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
