/** Analyse et prévision : compter ce qui s'est vendu, par jour, par
 *  serveur, par plat — et poser les regroupements (jour de semaine, mois,
 *  saison) dont une prévision de quantités a besoin plus tard.
 *
 *  Deux nombres ne veulent pas dire la même chose, et le confondre fausse
 *  toute décision prise dessus :
 *   - le CHIFFRE D'AFFAIRES ne compte que les commandes 'encaissee' : c'est
 *     de l'argent réellement encaissé, net de ce que la cagnotte a couvert.
 *   - le VOLUME (commandes, plats) compte tout sauf 'annulee' et
 *     'a_payer' : une commande confirmée mais pas encore encaissée reflète
 *     une vraie demande, et c'est la demande qu'une prévision cherche à
 *     anticiper. Une commande restée 'a_payer', elle, est un panier
 *     abandonné à l'écran de paiement : la compter gonflerait la demande
 *     d'achats qui n'ont jamais eu lieu.
 *
 *  Le climat et la météo ne sont pas dans cette base : les rapprocher
 *  d'un chiffre de vente demande une source externe, à joindre après coup
 *  sur les dates du CSV exporté. La saison, elle, est déductible du
 *  calendrier seul, et sert de premier repère en attendant mieux. */

import { query, une } from '../db.js';
import { dateValide } from './validate.js';
import { aujourdHui, jourVoisin } from './jours.js';

export const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const SAISONS = ['Hiver', 'Printemps', 'Été', 'Automne'];

// Bornes en jours des périodes prêtes à l'emploi. 'personnalise' n'y figure
// pas : c'est le repli quand aucune ne correspond, géré à part.
const PERIODES = { '7j': 7, '30j': 30, '90j': 90, '365j': 365 };

// Au-delà, une requête mal formée ferait tourner un agrégat sur toute
// l'histoire du restaurant depuis une simple faute de saisie dans l'URL.
const RECUL_MAX_JOURS = 366;

/** Nettoie et borne une période reçue de l'écran (ou d'une URL forgée).
 *  Ne fait jamais planter : une date absente ou invalide retombe sur les
 *  30 derniers jours plutôt que de renvoyer une erreur pour ce qui reste,
 *  la plupart du temps, une simple visite de la page sans filtre. */
export function normaliserPeriode({ debut, fin, periode } = {}) {
  const ajd = aujourdHui();

  if (periode && periode !== 'personnalise' && PERIODES[periode]) {
    return { debut: jourVoisin(ajd, -(PERIODES[periode] - 1)), fin: ajd, periode };
  }

  let f = dateValide(fin) ? fin : ajd;
  let d = dateValide(debut) ? debut : jourVoisin(f, -29);
  if (d > f) [d, f] = [f, d];
  const plafond = jourVoisin(f, -RECUL_MAX_JOURS);
  if (d < plafond) d = plafond;

  return { debut: d, fin: f, periode: 'personnalise' };
}

/** Chaque date ISO de `debut` à `fin` inclus, dans l'ordre. Sert à ce
 *  qu'un jour sans aucune commande apparaisse quand même à zéro plutôt que
 *  de disparaître du tableau — un dimanche fermé est une donnée, pas un
 *  trou. */
export function joursDeLaPeriode(debut, fin) {
  const jours = [];
  for (let d = debut; d <= fin; d = jourVoisin(d, 1)) jours.push(d);
  return jours;
}

/** 1 (lundi) à 7 (dimanche), sans dépendre du fuseau du serveur : le texte
 *  ISO 'YYYY-MM-DD' se lit directement, comme partout ailleurs dans le
 *  projet. */
export function jourSemaineDe(date) {
  return new Date(date + 'T00:00:00Z').getUTCDay() || 7;
}

const MOIS_SAISON = { 12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3 };

export function saisonDe(date) {
  return SAISONS[MOIS_SAISON[Number(date.slice(5, 7))]];
}

/** Les indicateurs de synthèse d'une période : de quoi remplir les tuiles
 *  en haut de l'écran d'un coup d'œil. */
export async function indicateurs(debut, fin) {
  const c = await une(
    `SELECT
       COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer'))::int                              AS nb_commandes,
       COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer') AND type = 'emporter')::int        AS nb_emporter,
       COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer') AND type = 'sur_place')::int       AS nb_sur_place,
       COUNT(*) FILTER (WHERE statut = 'encaissee')::int                             AS nb_encaissees,
       COALESCE(SUM(total_cents - remise_cagnotte_cents)
                FILTER (WHERE statut = 'encaissee'), 0)::int                         AS ca_cents,
       COALESCE(SUM(remise_cagnotte_cents) FILTER (WHERE statut = 'encaissee'), 0)::int AS cagnotte_cents
     FROM commandes WHERE date BETWEEN $1 AND $2`,
    [debut, fin]
  );
  const p = await une(
    `SELECT COALESCE(SUM(cl.quantite), 0)::int AS nb_plats
       FROM commande_lignes cl JOIN commandes c ON c.id = cl.commande_id
      WHERE c.date BETWEEN $1 AND $2 AND c.statut NOT IN ('annulee','a_payer')`,
    [debut, fin]
  );
  return {
    ...c, nbPlats: p.nb_plats,
    panierMoyenCents: c.nb_encaissees ? Math.round(c.ca_cents / c.nb_encaissees) : 0,
  };
}

/** Le chiffre d'affaires jour par jour, complété des jours sans commande.
 *  C'est la vue de base : tout le reste (jour de semaine, mois, saison) en
 *  est une simple façon de regrouper les mêmes lignes. */
export async function caParJour(debut, fin) {
  const lignes = await query(
    `SELECT date,
            COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer'))::int                   AS nb_commandes,
            COALESCE(SUM(total_cents - remise_cagnotte_cents)
                     FILTER (WHERE statut = 'encaissee'), 0)::int              AS ca_cents
       FROM commandes WHERE date BETWEEN $1 AND $2
      GROUP BY date`,
    [debut, fin]
  );
  const parDate = new Map(lignes.map(l => [l.date, l]));
  return joursDeLaPeriode(debut, fin).map(date => {
    const l = parDate.get(date);
    return {
      date, jourSemaine: JOURS_SEMAINE[jourSemaineDe(date) - 1],
      nbCommandes: l?.nb_commandes ?? 0, caCents: l?.ca_cents ?? 0,
    };
  });
}

/** Les plats les plus demandés sur la période. Regroupés par nom plutôt
 *  que par plat_id : le nom est recopié sur chaque ligne à la commande, il
 *  reste donc juste même si le plat a depuis été renommé ou retiré de la
 *  carte — group par id perdrait ces lignes-là. */
export async function platsVendus(debut, fin, limite = 20) {
  return query(
    `SELECT cl.nom,
            SUM(cl.quantite)::int               AS quantite,
            SUM(cl.quantite * cl.prix_cents)::int AS ca_cents
       FROM commande_lignes cl JOIN commandes c ON c.id = cl.commande_id
      WHERE c.date BETWEEN $1 AND $2 AND c.statut NOT IN ('annulee','a_payer')
      GROUP BY cl.nom
      ORDER BY quantite DESC, ca_cents DESC
      LIMIT $3`,
    [debut, fin, limite]
  );
}

const SANS_SERVEUR = 'Sans serveur (client)';

/** Le chiffre d'affaires par serveur, jour par jour. Une commande passée
 *  par le client lui-même (tunnel à emporter, QR de table) n'a personne à
 *  créditer : elle rejoint un repère « Sans serveur », pour que la somme
 *  des lignes retombe exactement sur le total du jour. */
export async function caParServeurEtJour(debut, fin) {
  return query(
    `SELECT date, COALESCE(pris_par_nom, $3) AS serveur,
            COUNT(*)::int                                                     AS nb_commandes,
            COALESCE(SUM(total_cents - remise_cagnotte_cents)
                     FILTER (WHERE statut = 'encaissee'), 0)::int             AS ca_cents
       FROM commandes
      WHERE date BETWEEN $1 AND $2 AND statut NOT IN ('annulee','a_payer')
      GROUP BY date, serveur
      ORDER BY date, serveur`,
    [debut, fin, SANS_SERVEUR]
  );
}

/** La même chose, mais résumée sur toute la période plutôt que jour par
 *  jour : c'est la vue qui répond à « qui vend le plus », sans avoir à
 *  additionner soi-même une grille de trente colonnes. */
export async function caParServeur(debut, fin) {
  const lignes = await caParServeurEtJour(debut, fin);
  const parServeur = new Map();
  for (const l of lignes) {
    const cur = parServeur.get(l.serveur) ?? { serveur: l.serveur, nbCommandes: 0, caCents: 0 };
    cur.nbCommandes += l.nb_commandes;
    cur.caCents += l.ca_cents;
    parServeur.set(l.serveur, cur);
  }
  return [...parServeur.values()].sort((a, b) => b.caCents - a.caCents);
}

/** Met en grille jours × serveurs, pour un affichage compact. `serveurs`
 *  est trié par CA décroissant : la colonne la plus utile arrive en
 *  premier. Ne sert que sur des périodes courtes — au-delà, mieux vaut
 *  l'export CSV qu'un tableau de trois cents colonnes. */
export function pivoterServeurEtJour(lignes, jours) {
  const serveurs = [...new Set(lignes.map(l => l.serveur))].sort((a, b) => {
    const somme = (s) => lignes.filter(l => l.serveur === s).reduce((n, l) => n + l.ca_cents, 0);
    return somme(b) - somme(a);
  });
  const parCle = new Map(lignes.map(l => [`${l.date} ${l.serveur}`, l]));
  const grille = jours.map(date => ({
    date,
    parServeur: serveurs.map(s => parCle.get(`${date} ${s}`)?.ca_cents ?? 0),
  }));
  return { serveurs, grille };
}

/** Moyennes par jour de la semaine : le premier repère pour une prévision
 *  — « le vendredi, en moyenne, on sert X kaftaji de plus qu'un mardi ».
 *
 *  Le nombre de jours au dénominateur vient du calendrier de la période,
 *  pas d'un COUNT(DISTINCT date) sur les commandes : un jour sans aucune
 *  commande — un lundi de fermeture, par exemple — doit tirer la moyenne
 *  vers le bas, pas disparaître du calcul comme s'il n'avait jamais existé. */
export async function caParJourSemaine(debut, fin) {
  const lignes = await query(
    `SELECT EXTRACT(ISODOW FROM date::date)::int                              AS jour_semaine,
            COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer'))::int                  AS nb_commandes,
            COALESCE(SUM(total_cents - remise_cagnotte_cents)
                     FILTER (WHERE statut = 'encaissee'), 0)::int             AS ca_cents
       FROM commandes WHERE date BETWEEN $1 AND $2
      GROUP BY jour_semaine`,
    [debut, fin]
  );
  const parJour = new Map(lignes.map(l => [l.jour_semaine, l]));

  const nbCalendrier = [0, 0, 0, 0, 0, 0, 0];
  for (const date of joursDeLaPeriode(debut, fin)) nbCalendrier[jourSemaineDe(date) - 1]++;

  return JOURS_SEMAINE.map((nom, i) => {
    const l = parJour.get(i + 1);
    const nbJours = nbCalendrier[i];
    return {
      jourSemaine: nom, nbJoursObserves: nbJours,
      caMoyenCents: nbJours ? Math.round((l?.ca_cents ?? 0) / nbJours) : 0,
      commandesMoyennes: nbJours ? Math.round(((l?.nb_commandes ?? 0) / nbJours) * 10) / 10 : 0,
    };
  });
}

/** Un point par mois calendaire couvert par la période — y compris un mois
 *  qui n'a vu aucune commande, pour la même raison qu'au jour de semaine :
 *  un mois muet est une observation, pas une absence de ligne. */
export async function caParMois(debut, fin) {
  const lignes = await query(
    `SELECT LEFT(date, 7)                                                     AS mois,
            COUNT(*) FILTER (WHERE statut NOT IN ('annulee','a_payer'))::int                  AS nb_commandes,
            COALESCE(SUM(total_cents - remise_cagnotte_cents)
                     FILTER (WHERE statut = 'encaissee'), 0)::int             AS ca_cents
       FROM commandes WHERE date BETWEEN $1 AND $2
      GROUP BY mois`,
    [debut, fin]
  );
  const parMois = new Map(lignes.map(l => [l.mois, l]));

  const nbCalendrier = new Map();
  for (const date of joursDeLaPeriode(debut, fin)) {
    const mois = date.slice(0, 7);
    nbCalendrier.set(mois, (nbCalendrier.get(mois) ?? 0) + 1);
  }

  return [...nbCalendrier.keys()].sort().map(mois => ({
    mois, nb_jours: nbCalendrier.get(mois),
    nb_commandes: parMois.get(mois)?.nb_commandes ?? 0,
    ca_cents: parMois.get(mois)?.ca_cents ?? 0,
  }));
}

/** Un point par saison calendaire (déc-jan-fév = hiver, etc.), calculée en
 *  JavaScript sur les mêmes lignes que `caParMois` : Postgres n'a pas de
 *  notion de saison, et la faire deux fois différemment serait une source
 *  d'écart pour rien. */
export async function caParSaison(debut, fin) {
  const parMois = await caParMois(debut, fin);
  const parSaison = new Map(SAISONS.map(s => [s, { saison: s, nbJours: 0, nbCommandes: 0, caCents: 0 }]));
  for (const m of parMois) {
    const cur = parSaison.get(saisonDe(m.mois + '-01'));
    cur.nbJours += m.nb_jours;
    cur.nbCommandes += Number(m.nb_commandes);
    cur.caCents += m.ca_cents;
  }
  return SAISONS.map(s => parSaison.get(s));
}

/** Une ligne par plat commandé sur la période, pour l'export brut : c'est
 *  la donnée la plus fine que la base tienne, celle qu'un tableur ou un
 *  notebook peut ensuite recombiner à sa façon — y compris en la
 *  rapprochant d'une source météo externe par la colonne date. */
export async function lignesDetaillees(debut, fin) {
  return query(
    `SELECT c.date, c.heure, c.type, c.statut,
            COALESCE(c.pris_par_nom, $3) AS serveur,
            cl.nom AS plat, cl.quantite, cl.prix_cents, c.reference
       FROM commande_lignes cl JOIN commandes c ON c.id = cl.commande_id
      WHERE c.date BETWEEN $1 AND $2
      ORDER BY c.date, c.heure, c.id`,
    [debut, fin, SANS_SERVEUR]
  );
}
