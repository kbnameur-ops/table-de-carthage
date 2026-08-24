import { db } from './db.js';
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
 *  jeton CSRF. */
export function sessionMiddleware(req, res, next) {
  let id = lireCookie(req, COOKIE);
  let session = obtenirSession(id);
  if (!session) {
    session = creerSessionInvite();
    poserCookie(res, COOKIE, session.id, 1);
  }
  req.session = session;
  res.locals.csrfToken = session.csrf;
  res.locals.session = session;
  next();
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

/** Calcule l'en-tête et le pied de page une fois pour toutes et les
 *  injecte dans les données de chaque rendu, sans toucher chaque route une
 *  par une. Les vues appellent <%- entete %> / <%- pied %> — de simples
 *  chaînes déjà rendues — plutôt que <%- include(...) %> (voir lib/layout.js
 *  pour la raison de ce choix). */
export function injecterMiseEnPage(req, res, next) {
  const rendreOriginal = res.render.bind(res);
  res.render = (vue, donnees = {}, callback) => {
    if (donnees.entete === undefined) {
      if (vue.startsWith('salon/')) {
        donnees.salonEntete = salonEntete({ titre: donnees.titre, actif: donnees.actif });
        donnees.salonPied = salonPied({ csrfToken: donnees.csrfToken ?? res.locals.csrfToken });
      } else {
        donnees.entete = entete({ titre: donnees.titre, session: donnees.session ?? req.session, actif: donnees.actif });
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

export function chargerReglages() {
  const lignes = db.prepare(`SELECT cle, valeur FROM reglages`).all();
  return Object.fromEntries(lignes.map(l => [l.cle, l.valeur]));
}
