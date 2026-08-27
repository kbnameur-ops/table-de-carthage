import { creerSessionInvite, obtenirSession } from './lib/auth.js';
import { entete, pied, salonEntete, salonPied } from './lib/layout.js';

const COOKIE = 'sid';
const estProd = process.env.NODE_ENV === 'production';

function lireCookie(req, nom) {
  const entete = req.headers.cookie;
  if (!entete) return null;
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i === -1) continue;
    if (morceau.slice(0, i).trim() === nom) return decodeURIComponent(morceau.slice(i + 1));
  }
  return null;
}

function poserCookie(res, nom, valeur, jours) {
  const options = [
    `${nom}=${encodeURIComponent(valeur)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${jours * 86400}`,
  ];
  if (estProd) options.push('Secure');
  res.append('Set-Cookie', options.join('; '));
}

/** Attache req.session (toujours défini) et res.locals pour les vues.
 *  Toute requête, même anonyme, obtient une session pour porter son
 *  jeton CSRF. Asynchrone : la session vit désormais en Postgres. */
export async function sessionMiddleware(req, res, next) {
  try {
    let id = lireCookie(req, COOKIE);
    let session = await obtenirSession(id);
    if (!session) {
      session = await creerSessionInvite();
      poserCookie(res, COOKIE, session.id, 1);
    }
    req.session = session;
    res.locals.csrfToken = session.csrf;
    res.locals.session = session;
    next();
  } catch (err) {
    next(err);
  }
}

export function verifierCsrf(req, res, next) {
  const jeton = req.body?._csrf;
  if (!jeton || jeton !== req.session.csrf) {
    return res.status(403).render('erreur', {
      titre: 'Requête refusée',
      message: "Le formulaire a expiré. Merci de le soumettre à nouveau.",
    });
  }
  next();
}

export function exigerClient(req, res, next) {
  if (req.session.role !== 'client') {
    return res.redirect('/compte/connexion');
  }
  req.clientId = req.session.sujetId;
  next();
}

export function exigerAdmin(req, res, next) {
  if (req.session.role !== 'admin') {
    return res.redirect('/salon/connexion');
  }
  req.adminId = req.session.sujetId;
  next();
}

/** Titre d'onglet et entrée de nav active par vue publique. Défini ici
 *  plutôt que dans chaque res.render : une route qui oublie de passer
 *  `titre` produirait sinon un onglet « — La Table de Carthage ». */
const PAGES = {
  'reservation':            { titre: 'Réserver une table',   actif: 'reserver' },
  'reservation-confirmee':  { titre: 'Réservation confirmée', actif: 'reserver' },
  'commande':               { titre: 'Commander à emporter', actif: 'commander' },
  'commande-confirmee':     { titre: 'Commande confirmée',   actif: 'commander' },
  'compte-connexion':       { titre: 'Mon espace',           actif: 'compte' },
  'compte-tableau':         { titre: 'Mon espace',           actif: 'compte' },
  'salon-connexion':        { titre: 'Salon' },
  'erreur':                 { titre: 'Erreur' },
};

/** Calcule l'en-tête et le pied de page une fois pour toutes et les
 *  injecte dans les données de chaque rendu, sans toucher chaque route une
 *  par une. Les vues appellent <%- entete %> / <%- pied %> — de simples
 *  chaînes déjà rendues — plutôt que <%- include(...) %> (voir lib/layout.js
 *  pour la raison de ce choix). */
export function injecterMiseEnPage(req, res, next) {
  const rendreOriginal = res.render.bind(res);
  res.render = (vue, donnees = {}, callback) => {
    const defauts = PAGES[vue];
    if (defauts) {
      donnees.titre ??= defauts.titre;
      donnees.actif ??= defauts.actif ?? '';
    }
    if (donnees.entete === undefined) {
      if (vue.startsWith('salon/')) {
        donnees.salonEntete = salonEntete({
          titre: donnees.titre, actif: donnees.actif,
          notifs: donnees.notifs ?? res.locals.notifs ?? 0,
        });
        donnees.salonPied = salonPied({ csrfToken: donnees.csrfToken ?? res.locals.csrfToken });
      } else {
        // req.session peut être absent si sessionMiddleware a échoué avant
        // de l'attacher (ex. base injoignable) : on retombe sur un visiteur
        // anonyme plutôt que de planter le rendu de la page d'erreur elle-même.
        donnees.entete = entete({ titre: donnees.titre, session: donnees.session ?? req.session ?? { role: 'invite' }, actif: donnees.actif });
        donnees.pied = pied();
      }
    }
    rendreOriginal(vue, donnees, callback);
  };
  next();
}

/** Redirige vers la page d'où venait la requête (utile pour revenir sur les
 *  mêmes filtres après une action), en se limitant au même site : un en-tête
 *  Referer ne doit jamais servir de redirection ouverte vers un tiers. */
export function redirigerRetour(req, res, parDefaut) {
  const referer = req.get('Referer');
  if (referer) {
    try {
      const u = new URL(referer);
      if (u.hostname === req.hostname) return res.redirect(u.pathname + u.search);
    } catch { /* Referer absent ou invalide */ }
  }
  res.redirect(parDefaut);
}

/** Compte les notifications non lues pour la barre du salon. Placé en
 *  middleware plutôt que dans chaque route : le badge est présent sur
 *  toutes les pages du salon, et une route qui l'oublierait l'afficherait
 *  à zéro sans qu'on s'en aperçoive. Silencieux en cas d'erreur — un badge
 *  manquant ne doit pas empêcher d'accéder au salon.
 *
 *  L'import est dynamique pour éviter un cycle : lib/notifications.js
 *  n'importe rien d'ici, mais les routes qui l'utilisent importent ce
 *  module, et le charger au sommet créerait une dépendance croisée. */
export async function chargerNotifications(req, res, next) {
  res.locals.notifs = 0;
  if (req.session?.role !== 'admin') return next();
  try {
    const { compterNonLues } = await import('./lib/notifications.js');
    res.locals.notifs = await compterNonLues();
  } catch (err) {
    console.error('Compteur de notifications indisponible :', err.message);
  }
  next();
}
