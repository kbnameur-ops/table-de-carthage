import { Router } from 'express';
import { exigerAdmin } from '../middleware.js';
import { euros } from '../lib/money.js';
import {
  normaliserPeriode, joursDeLaPeriode, indicateurs, caParJour, platsVendus,
  caParServeur, caParServeurEtJour, pivoterServeurEtJour,
  caParJourSemaine, caParMois, caParSaison, lignesDetaillees,
} from '../lib/analyse.js';
import { versCsv, nombreCsv } from '../lib/csv.js';

/** L'écran d'analyse : compteurs du moment, et la matière première d'une
 *  future prévision (jour de semaine, mois, saison). Un chapitre de plus
 *  que le reste du salon, mais le même principe — chaque agrégat vient de
 *  lib/analyse.js, la route ne fait qu'assembler et mettre en page.
 *
 *  Au-delà de 31 jours, la grille jour × serveur cède la place à un
 *  renvoi vers l'export CSV : au-delà, elle deviendrait un tableau à
 *  soixante colonnes, illisible à l'écran quand un tableur le digère très
 *  bien. */
export const salonAnalyseRouter = Router();

const NOM_PERIODE = { '7j': '7 derniers jours', '30j': '30 derniers jours', '90j': '90 derniers jours', '365j': 'Douze derniers mois', personnalise: 'Période personnalisée' };
const MAX_GRILLE_JOURS = 31;

/** La géométrie du graphique en barres du CA par jour, calculée ici plutôt
 *  que dans le gabarit : une vue ne doit pas faire d'arithmétique, elle
 *  affiche des nombres déjà prêts. Une étiquette de date tous les
 *  `pasEtiquette` jours seulement — en écrire une sous chacune des 365
 *  barres d'une année les ferait toutes se chevaucher. */
function graphiqueJournalier(parJour, caMax) {
  const LARGEUR = 900, HAUTEUR = 130, MARGE_BAS = 20;
  const largeurBarre = LARGEUR / Math.max(1, parJour.length);
  const pasEtiquette = Math.max(1, Math.ceil(parJour.length / 12));
  const barres = parJour.map((j, i) => {
    const hauteur = Math.round((j.caCents / caMax) * (HAUTEUR - MARGE_BAS));
    return {
      ...j, x: i * largeurBarre, largeur: Math.max(1, largeurBarre - 1),
      y: HAUTEUR - MARGE_BAS - hauteur, hauteur,
      etiquette: i % pasEtiquette === 0 ? j.date.slice(5).replace('-', '/') : null,
    };
  });
  return { barres, largeur: LARGEUR, hauteur: HAUTEUR };
}

salonAnalyseRouter.get('/salon/analyse', exigerAdmin, async (req, res, next) => {
  try {
    const { debut, fin, periode } = normaliserPeriode(req.query);
    const jours = joursDeLaPeriode(debut, fin);

    const [kpis, parJour, plats, serveurs] = await Promise.all([
      indicateurs(debut, fin),
      caParJour(debut, fin),
      platsVendus(debut, fin, 15),
      caParServeur(debut, fin),
    ]);

    const grilleServeurs = jours.length <= MAX_GRILLE_JOURS
      ? pivoterServeurEtJour(await caParServeurEtJour(debut, fin), jours)
      : null;

    const [semaine, mois, saison] = await Promise.all([
      caParJourSemaine(debut, fin), caParMois(debut, fin), caParSaison(debut, fin),
    ]);

    const caMax = Math.max(1, ...parJour.map(j => j.caCents));
    const graphique = graphiqueJournalier(parJour, caMax);
    const platsMax = Math.max(1, ...plats.map(p => p.quantite));
    const serveursMax = Math.max(1, ...serveurs.map(s => s.caCents));

    res.render('salon/analyse', {
      titre: 'Analyse', actif: 'analyse',
      debut, fin, periode, nomPeriode: NOM_PERIODE[periode],
      kpis, parJour, plats, platsMax, serveurs, serveursMax, grilleServeurs,
      semaine, mois, saison, graphique, euros,
    });
  } catch (err) { next(err); }
});

function nomFichier(jeu, debut, fin) {
  return `carthage-${jeu}-${debut}_${fin}.csv`;
}

function envoyerCsv(res, jeu, debut, fin, colonnes, lignes) {
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${nomFichier(jeu, debut, fin)}"`);
  res.send(versCsv(colonnes, lignes));
}

salonAnalyseRouter.get('/salon/analyse/export/jours.csv', exigerAdmin, async (req, res, next) => {
  try {
    const { debut, fin } = normaliserPeriode(req.query);
    const lignes = await caParJour(debut, fin);
    envoyerCsv(res, 'jours', debut, fin, [
      { cle: 'date', titre: 'Date' },
      { cle: 'jourSemaine', titre: 'Jour' },
      { cle: 'nbCommandes', titre: 'Commandes' },
      { cle: 'ca_eur', titre: "Chiffre d'affaires (€)" },
    ], lignes.map(l => ({ ...l, ca_eur: nombreCsv(l.caCents) })));
  } catch (err) { next(err); }
});

salonAnalyseRouter.get('/salon/analyse/export/plats.csv', exigerAdmin, async (req, res, next) => {
  try {
    const { debut, fin } = normaliserPeriode(req.query);
    const lignes = await platsVendus(debut, fin, 1000);
    envoyerCsv(res, 'plats', debut, fin, [
      { cle: 'nom', titre: 'Plat' },
      { cle: 'quantite', titre: 'Quantité vendue' },
      { cle: 'ca_eur', titre: "Chiffre d'affaires (€)" },
    ], lignes.map(l => ({ ...l, ca_eur: nombreCsv(l.ca_cents) })));
  } catch (err) { next(err); }
});

salonAnalyseRouter.get('/salon/analyse/export/serveurs.csv', exigerAdmin, async (req, res, next) => {
  try {
    const { debut, fin } = normaliserPeriode(req.query);
    const lignes = await caParServeurEtJour(debut, fin);
    envoyerCsv(res, 'serveurs', debut, fin, [
      { cle: 'date', titre: 'Date' },
      { cle: 'serveur', titre: 'Serveur' },
      { cle: 'nb_commandes', titre: 'Commandes' },
      { cle: 'ca_eur', titre: "Chiffre d'affaires (€)" },
    ], lignes.map(l => ({ ...l, ca_eur: nombreCsv(l.ca_cents) })));
  } catch (err) { next(err); }
});

/** L'export le plus fin : une ligne par plat commandé. C'est celui qu'un
 *  tableur ou un notebook peut recombiner à volonté — y compris en le
 *  rapprochant après coup d'une source météo externe par la colonne date,
 *  ce que cette base ne tient pas elle-même. */
salonAnalyseRouter.get('/salon/analyse/export/commandes.csv', exigerAdmin, async (req, res, next) => {
  try {
    const { debut, fin } = normaliserPeriode(req.query);
    const lignes = await lignesDetaillees(debut, fin);
    envoyerCsv(res, 'commandes', debut, fin, [
      { cle: 'date', titre: 'Date' },
      { cle: 'heure', titre: 'Heure' },
      { cle: 'type', titre: 'Type' },
      { cle: 'statut', titre: 'Statut' },
      { cle: 'serveur', titre: 'Serveur' },
      { cle: 'plat', titre: 'Plat' },
      { cle: 'quantite', titre: 'Quantité' },
      { cle: 'prix_unitaire_eur', titre: 'Prix unitaire (€)' },
      { cle: 'montant_eur', titre: 'Montant (€)' },
      { cle: 'reference', titre: 'Référence commande' },
    ], lignes.map(l => ({
      ...l,
      prix_unitaire_eur: nombreCsv(l.prix_cents),
      montant_eur: nombreCsv(l.prix_cents * l.quantite),
    })));
  } catch (err) { next(err); }
});
