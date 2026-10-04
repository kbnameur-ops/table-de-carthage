import { Router } from 'express';
import { carteVisible } from '../lib/carte.js';

export const apiCarteRouter = Router();

/** La carte publique du site vitrine (accueil) est désormais pilotée par
 *  cette route plutôt que par le fichier statique assets/js/menu-data.js :
 *  une modification faite dans le salon doit être visible par les clients
 *  sans redéploiement. menu-data.js ne sert plus qu'à l'amorçage initial de
 *  la base (server/seed.js) et à l'export autonome (build.mjs). */
apiCarteRouter.get('/api/carte', async (req, res, next) => {
  try {
    const menu = await carteVisible();

    res.set('Cache-Control', 'public, max-age=60');
    res.json(menu);
  } catch (err) { next(err); }
});
