import { Router } from 'express';
import { db } from '../db.js';

export const apiCarteRouter = Router();

/** La carte publique du site vitrine (accueil) est désormais pilotée par
 *  cette route plutôt que par le fichier statique assets/js/menu-data.js :
 *  une modification faite dans le salon doit être visible par les clients
 *  sans redéploiement. menu-data.js ne sert plus qu'à l'amorçage initial de
 *  la base (server/seed.js) et à l'export autonome (build.mjs). */
apiCarteRouter.get('/api/carte', (req, res) => {
  const categories = db.prepare(`SELECT * FROM categories WHERE visible = 1 ORDER BY position`).all();
  const plats = db.prepare(`SELECT * FROM plats WHERE visible = 1 ORDER BY position`).all();

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
          photo: p.photo || undefined, // nom de fichier complet, servi sous /uploads/plats/
        })),
    }))
    .filter(cat => cat.items.length > 0);

  res.set('Cache-Control', 'public, max-age=60');
  res.json(menu);
});
