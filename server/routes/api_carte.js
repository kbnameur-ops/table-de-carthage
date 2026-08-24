import { Router } from 'express';
import { query } from '../db.js';

export const apiCarteRouter = Router();

/** La carte publique du site vitrine (accueil) est désormais pilotée par
 *  cette route plutôt que par le fichier statique assets/js/menu-data.js :
 *  une modification faite dans le salon doit être visible par les clients
 *  sans redéploiement. menu-data.js ne sert plus qu'à l'amorçage initial de
 *  la base (server/seed.js) et à l'export autonome (build.mjs). */
apiCarteRouter.get('/api/carte', async (req, res, next) => {
  try {
    const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
    const plats = await query(`SELECT * FROM plats WHERE visible = true ORDER BY position`);

    const menu = categories
      .map(cat => ({
        id: cat.slug,
        name: cat.nom,
        tagline: cat.accroche,
        items: plats
          .filter(p => p.categorie_id === cat.id)
          .map(p => ({
            name: p.nom,
            desc: p.description,
            price: p.prix_cents / 100,
            veg: !!p.vegetarien,
            star: !!p.signature,
            photo: p.photo || undefined, // URL Vercel Blob ou chemin local /uploads/plats/...
          })),
      }))
      .filter(cat => cat.items.length > 0);

    res.set('Cache-Control', 'public, max-age=60');
    res.json(menu);
  } catch (err) { next(err); }
});
