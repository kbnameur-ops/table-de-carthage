import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware, injecterMiseEnPage, chargerNotifications } from './middleware.js';
import { nettoyerSessionsExpirees, nettoyerTentativesAnciennes } from './db.js';
import { sectionSoirees } from './lib/layout.js';

import { api } from './routes/api.js';
import { apiCarteRouter } from './routes/api_carte.js';
import { manifesteRouter } from './routes/manifeste.js';
import { evenementsRouter } from './routes/evenements.js';
import { reservationRouter } from './routes/reservation.js';
import { commandeRouter } from './routes/commande.js';
import { paiementRouter, paiementWebhookRouter } from './routes/paiement.js';
import { compteRouter } from './routes/compte.js';
import { tableRouter } from './routes/table.js';
import { serviceRouter } from './routes/service.js';
import { cuisineRouter } from './routes/cuisine.js';
import { salonRouter } from './routes/salon.js';
import { salonCarteRouter } from './routes/salon_carte.js';
import { salonEvenementsRouter } from './routes/salon_evenements.js';
import { salonServicesRouter } from './routes/salon_services.js';
import { salonSalleRouter } from './routes/salon_salle.js';
import { salonEquipeRouter } from './routes/salon_equipe.js';
import { salonTablesClientsRouter } from './routes/salon_tables_clients.js';
import { salonClientsRouter } from './routes/salon_clients.js';
import { salonReservationsRouter } from './routes/salon_reservations.js';
import { salonCommandesRouter } from './routes/salon_commandes.js';
import { salonAnalyseRouter } from './routes/salon_analyse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const racine = join(__dirname, '..');
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.disable('x-powered-by');

// Derrière le proxy de Vercel, sans ce réglage, Express voit l'adresse du
// proxy et non celle du visiteur : TOUS les clients partagent alors une
// seule et même IP. Deux conséquences, toutes deux fâcheuses :
//
//   — les limites de débit portent sur l'IP (20 commandes par quart
//     d'heure). Partagée, la vingt-et-unième commande du service bloque
//     tout le monde, y compris ceux qui n'ont rien fait ;
//   — `req.protocol` répond 'http', si bien que les QR imprimés portaient
//     une adresse en http:// — collée sur une table pour des années, et
//     qui n'atteint le site qu'au prix d'une redirection.
//
// Un seul saut de confiance : celui de Vercel, qui réécrit lui-même
// l'en-tête. En développement on garde l'adresse de la socket, il n'y a
// pas de proxy à croire.
if (process.env.VERCEL) app.set('trust proxy', 1);

// ── Fichiers statiques ──────────────────────────────────────
// Le site vitrine (page d'accueil, feuille de style, animations) reste tel
// quel : seuls ses liens de réservation pointent désormais vers les tunnels.
/** Le site vitrine référence sa feuille de style par un chemin fixe, sans
 *  version : un cache d'un jour y rendrait toute correction invisible
 *  jusqu'au lendemain. Feuilles de style et scripts sont donc revalidés à
 *  chaque visite — un 304 coûte quelques centaines d'octets — tandis que
 *  les images, elles, gardent leur cache long. */
function cacheSelonLeType(res, chemin) {
  if (/\.(css|js)$/.test(chemin)) res.setHeader('Cache-Control', 'no-cache');
}
app.use('/assets', express.static(join(racine, 'assets'), {
  maxAge: '1d', setHeaders: cacheSelonLeType,
}));
// L'application, elle, référence app.css avec une empreinte de contenu
// (lib/version-actifs.js) : l'URL change à chaque modification, donc le
// cache long est ici sans danger et sans revalidation.
app.use('/css', express.static(join(__dirname, 'public', 'css'), { maxAge: '7d' }));
app.use('/uploads', express.static(join(__dirname, 'public', 'uploads'), { maxAge: '1d' }));
// ── La page d'accueil ───────────────────────────────────────
// Elle reste un fichier statique, écrit à la main : c'est sa force, et on
// ne va pas la transformer en gabarit pour une seule section. Les soirées
// y sont simplement injectées à la place du repère `<!--SOIREES-->`, juste
// avant la carte.
//
// Rendu côté serveur, et non chargé après coup comme la carte : cette
// section est en haut de page. Un contenu qui apparaîtrait une seconde
// plus tard ferait sauter la mise en page sous les yeux du visiteur.
//
// Le fichier est lu une fois au démarrage — le relire à chaque visite
// coûterait un accès disque pour un contenu qui ne change qu'au
// déploiement.
//
// Attention, piège de plateforme : Vercel sert les fichiers du dépôt AVANT
// de consulter les réécritures. Avec un simple `rewrites`, « / » tombait
// donc sur le index.html brut du dépôt et cette route n'était jamais
// appelée — le repère restait visible dans la page livrée et aucune soirée
// n'apparaissait, alors que tout fonctionnait en local. D'où le `routes`
// de vercel.json, qui envoie « / » à la fonction avant le `handle:
// filesystem`.
const REPERE_SOIREES = '<!--SOIREES-->';
const pageAccueil = readFileSync(join(racine, 'index.html'), 'utf8');

// Un ancien signet, ou un lien écrit à la main, peut viser « /index.html ».
// Tant que la page était un fichier, Vercel la servait ; maintenant qu'elle
// passe par l'application, il faut le dire, sans quoi c'est une page
// introuvable.
app.get('/index.html', (req, res) => res.redirect(301, '/'));

app.get('/', async (req, res, next) => {
  try {
    const { evenementsPublics } = await import('./lib/evenements.js');
    const { dateLongue } = await import('./lib/jours.js');
    const { euros } = await import('./lib/money.js');

    const evenements = await evenementsPublics();
    const section = sectionSoirees({ evenements, dateLongue, euros });
    // Pas de cache au bord, et c'est délibéré. Une minute de s-maxage
    // suffisait à ce qu'une soirée publiée au salon n'apparaisse pas sur
    // le site : le restaurant voit sa propre page inchangée, conclut que
    // ça n'a pas marché, et recommence. Une page qui ment pendant une
    // minute coûte plus cher que l'aller-retour vers la base qu'elle
    // économise — la requête est petite, indexée, et le trafic d'un
    // restaurant de quartier ne la rend jamais coûteuse.
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(pageAccueil.replace(REPERE_SOIREES, section));
  } catch (err) { next(err); }
});

// ── Le webhook Stripe, avant tout analyseur de corps ────────
// Sa signature porte sur les octets bruts de la requête : passer après
// express.json() la rendrait invalide, puisqu'un corps analysé puis
// re-sérialisé ne redonne pas la même chaîne. Ce montage précoce n'est pas
// une préférence de style, c'est la condition pour que Stripe soit cru.
app.use(paiementWebhookRouter);

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
app.use(manifesteRouter);
app.use(reservationRouter);
app.use(commandeRouter);
app.use(evenementsRouter);
app.use(paiementRouter);
app.use(compteRouter);
app.use(tableRouter);
app.use(serviceRouter);
app.use(cuisineRouter);
app.use(salonRouter);
app.use(salonCarteRouter);
app.use(salonEvenementsRouter);
app.use(salonServicesRouter);
app.use(salonSalleRouter);
app.use(salonEquipeRouter);
app.use(salonTablesClientsRouter);
app.use(salonClientsRouter);
app.use(salonReservationsRouter);
app.use(salonCommandesRouter);
app.use(salonAnalyseRouter);

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
