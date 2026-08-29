import { Router } from 'express';
import { verifierCsrf, exigerCuisine } from '../middleware.js';
import { aujourdHui, nomTable } from '../lib/jours.js';
import { ETATS, LIBELLES, avancer, ramenerEnPreparation, tableauDuJour } from '../lib/cuisine.js';
import { cuisineTableau } from '../lib/layout.js';

/** L'écran de cuisine.
 *
 *  Il se lit à un mètre, au-dessus du piano, les mains occupées : une
 *  colonne par état, un bouton par commande, rien à faire défiler
 *  horizontalement. Il se rafraîchit tout seul — personne n'ira toucher un
 *  écran avec les doigts dans la semoule pour savoir si une commande est
 *  tombée. */

export const cuisineRouter = Router();

function donnees(req, res, tableau) {
  return {
    titre: 'Cuisine', sousTitre: 'Service du jour', actif: 'cuisine',
    qui: req.session.role === 'admin' ? 'Salon' : (res.locals.employe?.prenom || 'Cuisine'),
    // Le lien vers la salle n'a de sens que pour qui y a droit : un commis
    // n'a rien à faire sur un plan de table.
    retourService: req.session.role === 'admin' || !!res.locals.droits?.service,
    tableau, ETATS, LIBELLES, nomTable,
    csrfToken: res.locals.csrfToken,
  };
}

cuisineRouter.get('/cuisine', exigerCuisine, async (req, res, next) => {
  try {
    const d = donnees(req, res, await tableauDuJour(aujourdHui()));
    res.render('cuisine', { ...d, tableauHtml: cuisineTableau(d) });
  } catch (err) { next(err); }
});

/** Le tableau seul, sans mise en page : c'est ce que va chercher le
 *  rafraîchissement automatique pour remplacer le contenu sans recharger la
 *  page. Un rechargement complet ferait sauter le défilement et clignoter
 *  l'écran toutes les quinze secondes. */
cuisineRouter.get('/cuisine/tableau', exigerCuisine, async (req, res, next) => {
  try {
    const d = donnees(req, res, await tableauDuJour(aujourdHui()));
    res.type('html').send(cuisineTableau(d));
  } catch (err) { next(err); }
});

cuisineRouter.post('/cuisine/:id/avancer', exigerCuisine, verifierCsrf, async (req, res, next) => {
  try {
    await avancer(req.params.id, req.body.vers);
    res.redirect('/cuisine');
  } catch (err) { next(err); }
});

/** Le plat est retombé : il repart au feu. */
cuisineRouter.post('/cuisine/:id/retour', exigerCuisine, verifierCsrf, async (req, res, next) => {
  try {
    await ramenerEnPreparation(req.params.id);
    res.redirect('/cuisine');
  } catch (err) { next(err); }
});
