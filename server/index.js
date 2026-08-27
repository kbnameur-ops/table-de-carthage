import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware, injecterMiseEnPage, chargerNotifications } from './middleware.js';
import { nettoyerSessionsExpirees, nettoyerTentativesAnciennes } from './db.js';

import { api } from './routes/api.js';
import { apiCarteRouter } from './routes/api_carte.js';
import { reservationRouter } from './routes/reservation.js';
import { commandeRouter } from './routes/commande.js';
import { compteRouter } from './routes/compte.js';
import { salonRouter } from './routes/salon.js';
import { salonCarteRouter } from './routes/salon_carte.js';
import { salonServicesRouter } from './routes/salon_services.js';
import { salonSalleRouter } from './routes/salon_salle.js';
import { salonEquipeRouter } from './routes/salon_equipe.js';
import { salonReservationsRouter } from './routes/salon_reservations.js';
import { salonCommandesRouter } from './routes/salon_commandes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const racine = join(__dirname, '..');
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.disable('x-powered-by');

// ── Fichiers statiques ──────────────────────────────────────
// Le site vitrine (page d'accueil, feuille de style, animations) reste tel
// quel : seuls ses liens de réservation pointent désormais vers les tunnels.
app.use('/assets', express.static(join(racine, 'assets'), { maxAge: '1d' }));
app.use('/css', express.static(join(__dirname, 'public', 'css'), { maxAge: '1d' }));
app.use('/uploads', express.static(join(__dirname, 'public', 'uploads'), { maxAge: '1d' }));
app.get('/', (req, res) => res.sendFile(join(racine, 'index.html')));

// ── Analyse du corps des requêtes ───────────────────────────
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

// ── Session (toujours définie, même pour un visiteur anonyme) ─
// injecterMiseEnPage doit passer avant sessionMiddleware : si la session
// échoue (base injoignable, schéma pas encore appliqué...), le gestionnaire
// d'erreurs plus bas appelle quand même res.render('erreur', ...), qui a
// besoin d'entete/pied déjà injectés pour ne pas planter à son tour.
app.use(injecterMiseEnPage);
app.use(sessionMiddleware);
app.use(chargerNotifications);

// ── Routes ──────────────────────────────────────────────────
app.use('/api', api);
app.use(apiCarteRouter);
app.use(reservationRouter);
app.use(commandeRouter);
app.use(compteRouter);
app.use(salonRouter);
app.use(salonCarteRouter);
app.use(salonServicesRouter);
app.use(salonSalleRouter);
app.use(salonEquipeRouter);
app.use(salonReservationsRouter);
app.use(salonCommandesRouter);

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('erreur', {
    titre: 'Page introuvable', session: req.session, actif: '',
    message: "Cette page n'existe pas.",
  });
});

// ── Erreurs non gérées ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('erreur', {
    titre: 'Erreur', session: req.session, actif: '',
    message: "Une erreur est survenue. Merci de réessayer.",
  });
});

// Entretien périodique : sessions et tentatives expirées ne doivent pas
// s'accumuler indéfiniment dans une base censée rester petite. Sans objet
// sur Vercel : une fonction serverless ne vit pas assez longtemps pour
// qu'un setInterval s'y déclenche utilement.
if (!process.env.VERCEL) {
  setInterval(() => {
    nettoyerSessionsExpirees().catch(err => console.error('Nettoyage sessions :', err));
    nettoyerTentativesAnciennes().catch(err => console.error('Nettoyage tentatives :', err));
  }, 60 * 60 * 1000).unref();
}

// Sur Vercel, ce module est importé par api/index.js comme gestionnaire de
// fonction serverless : pas de app.listen(), la plateforme reçoit les
// requêtes directement. En local/traditionnel, on écoute normalement.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`La Table de Carthage — serveur démarré sur http://localhost:${port}`);
  });
}

export default app;
