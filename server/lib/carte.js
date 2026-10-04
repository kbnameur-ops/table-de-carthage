import { query } from '../db.js';

/** La carte publique, telle que le site la montre : catégories visibles,
 *  plats visibles, prix en euros. Partagée par /api/carte (le JS du site) et
 *  par le rendu serveur (accueil, /carte, données structurées), pour que les
 *  trois ne puissent pas diverger. */
export async function carteVisible() {
  const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
  const plats = await query(`SELECT * FROM plats WHERE visible = true ORDER BY position`);

  return categories
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
}
