import { Router } from 'express';
import multer from 'multer';
import { query, une, executer, transaction } from '../db.js';
import { exigerAdmin, verifierCsrf } from '../middleware.js';
import { versCents, euros } from '../lib/money.js';
import { texteNonVide } from '../lib/validate.js';
import { slugifier, nomFichierUnique } from '../lib/slug.js';
import { enregistrerPhotoPlat, supprimerPhotoPlat } from '../lib/image.js';

export const salonCarteRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

async function chargerCarteComplete() {
  const categories = await query(`SELECT * FROM categories ORDER BY position`);
  const plats = await query(`SELECT * FROM plats ORDER BY position`);
  return categories.map(cat => ({ ...cat, plats: plats.filter(p => p.categorie_id === cat.id) }));
}

async function slugCategorieUnique(nom, ignorerId = null) {
  const base = slugifier(nom);
  let slug = base, i = 2;
  while (true) {
    const existe = await une(`SELECT id FROM categories WHERE slug = $1 AND id != $2`, [slug, ignorerId ?? -1]);
    if (!existe) return slug;
    slug = `${base}-${i++}`;
  }
}

// ── Vue d'ensemble ──────────────────────────────────────────
salonCarteRouter.get('/salon/carte', exigerAdmin, async (req, res, next) => {
  try {
    res.render('salon/carte', {
      titre: 'La carte', actif: 'carte', categories: await chargerCarteComplete(), euros,
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

// ── Catégories ──────────────────────────────────────────────
salonCarteRouter.get('/salon/carte/categories/nouvelle', exigerAdmin, (req, res) => {
  res.render('salon/categorie-form', {
    titre: 'Nouvelle catégorie', actif: 'carte', categorie: null, csrfToken: res.locals.csrfToken,
  });
});

salonCarteRouter.get('/salon/carte/categories/:id/modifier', exigerAdmin, async (req, res, next) => {
  try {
    const categorie = await une(`SELECT * FROM categories WHERE id = $1`, [req.params.id]);
    if (!categorie) return res.redirect('/salon/carte');
    res.render('salon/categorie-form', {
      titre: 'Modifier la catégorie', actif: 'carte', categorie, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/categories', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { nom, accroche } = req.body;
    if (!texteNonVide(nom, 60)) return res.redirect('/salon/carte/categories/nouvelle?erreur=' + encodeURIComponent('Nom requis.'));
    const { p: position } = await une(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories`);
    await executer(
      `INSERT INTO categories (slug, nom, accroche, position) VALUES ($1, $2, $3, $4)`,
      [await slugCategorieUnique(nom), nom.trim(), (accroche || '').trim(), position]
    );
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/categories/:id', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { nom, accroche, visible } = req.body;
    if (!texteNonVide(nom, 60)) return res.redirect(`/salon/carte/categories/${req.params.id}/modifier?erreur=` + encodeURIComponent('Nom requis.'));
    await executer(
      `UPDATE categories SET nom = $1, accroche = $2, visible = $3 WHERE id = $4`,
      [nom.trim(), (accroche || '').trim(), !!visible, req.params.id]
    );
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/categories/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const plats = await query(`SELECT photo FROM plats WHERE categorie_id = $1`, [req.params.id]);
    await executer(`DELETE FROM categories WHERE id = $1`, [req.params.id]); // cascade sur les plats
    Promise.all(plats.map(p => supprimerPhotoPlat(p.photo))).catch(() => {});
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/categories/:id/position', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const cats = await query(`SELECT id, position FROM categories ORDER BY position`);
    const i = cats.findIndex(c => c.id === Number(req.params.id));
    const j = req.body.sens === 'monter' ? i - 1 : i + 1;
    if (i > -1 && j > -1 && j < cats.length) {
      await transaction(async (t) => {
        await t.executer(`UPDATE categories SET position = $1 WHERE id = $2`, [cats[j].position, cats[i].id]);
        await t.executer(`UPDATE categories SET position = $1 WHERE id = $2`, [cats[i].position, cats[j].id]);
      });
    }
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

// ── Plats ─────────────────────────────────────────────────
salonCarteRouter.get('/salon/carte/plats/nouveau', exigerAdmin, async (req, res, next) => {
  try {
    const categories = await query(`SELECT id, nom FROM categories ORDER BY position`);
    res.render('salon/plat-form', {
      titre: 'Nouveau plat', actif: 'carte', plat: null, categories,
      categorieId: Number(req.query.categorie) || categories[0]?.id,
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonCarteRouter.get('/salon/carte/plats/:id/modifier', exigerAdmin, async (req, res, next) => {
  try {
    const plat = await une(`SELECT * FROM plats WHERE id = $1`, [req.params.id]);
    if (!plat) return res.redirect('/salon/carte');
    const categories = await query(`SELECT id, nom FROM categories ORDER BY position`);
    res.render('salon/plat-form', {
      titre: 'Modifier le plat', actif: 'carte', plat, categories, categorieId: plat.categorie_id,
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

async function validerChampsPlat(body) {
  const erreurs = [];
  if (!texteNonVide(body.nom, 80)) erreurs.push('Nom requis.');
  if (!texteNonVide(body.description, 400)) erreurs.push('Description requise.');
  if (versCents(body.prix) === null) erreurs.push('Prix invalide (exemple : 16,50).');
  if (!await une(`SELECT 1 FROM categories WHERE id = $1`, [body.categorieId])) erreurs.push('Catégorie invalide.');
  return erreurs;
}

// multer doit tourner avant verifierCsrf : c'est le seul middleware capable
// d'analyser un corps multipart/form-data, seul format possible avec un
// champ fichier. Sans lui, req.body est vide et le jeton _csrf jamais lu.
salonCarteRouter.post('/salon/carte/plats', exigerAdmin, upload.single('photo'), verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = await validerChampsPlat(req.body);
    if (erreurs.length) {
      return res.redirect(`/salon/carte/plats/nouveau?categorie=${req.body.categorieId}&erreur=` + encodeURIComponent(erreurs.join(' ')));
    }
    let photo = null;
    if (req.file) {
      try {
        photo = await enregistrerPhotoPlat(req.file.buffer, nomFichierUnique(req.body.nom));
      } catch {
        return res.redirect(`/salon/carte/plats/nouveau?categorie=${req.body.categorieId}&erreur=` + encodeURIComponent("Photo illisible : merci d'essayer un autre fichier."));
      }
    }
    const { p: position } = await une(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM plats WHERE categorie_id = $1`, [req.body.categorieId]);
    await executer(
      `INSERT INTO plats (categorie_id, nom, description, prix_cents, photo, vegetarien, signature, a_emporter, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.body.categorieId, req.body.nom.trim(), req.body.description.trim(), versCents(req.body.prix),
        photo, !!req.body.vegetarien, !!req.body.signature, !!req.body.aEmporter, position,
      ]
    );
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/plats/:id', exigerAdmin, upload.single('photo'), verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = await validerChampsPlat(req.body);
    if (erreurs.length) {
      return res.redirect(`/salon/carte/plats/${req.params.id}/modifier?erreur=` + encodeURIComponent(erreurs.join(' ')));
    }
    const existant = await une(`SELECT photo FROM plats WHERE id = $1`, [req.params.id]);
    if (!existant) return res.redirect('/salon/carte');

    let photo = existant.photo;
    if (req.file) {
      let nouveau;
      try {
        nouveau = await enregistrerPhotoPlat(req.file.buffer, nomFichierUnique(req.body.nom));
      } catch {
        return res.redirect(`/salon/carte/plats/${req.params.id}/modifier?erreur=` + encodeURIComponent("Photo illisible : merci d'essayer un autre fichier."));
      }
      await supprimerPhotoPlat(existant.photo);
      photo = nouveau;
    } else if (req.body.supprimerPhoto) {
      await supprimerPhotoPlat(existant.photo);
      photo = null;
    }

    await executer(
      `UPDATE plats SET categorie_id = $1, nom = $2, description = $3, prix_cents = $4, photo = $5,
       vegetarien = $6, signature = $7, a_emporter = $8, visible = $9 WHERE id = $10`,
      [
        req.body.categorieId, req.body.nom.trim(), req.body.description.trim(), versCents(req.body.prix), photo,
        !!req.body.vegetarien, !!req.body.signature, !!req.body.aEmporter, !!req.body.visible,
        req.params.id,
      ]
    );
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/plats/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const plat = await une(`SELECT photo FROM plats WHERE id = $1`, [req.params.id]);
    await executer(`DELETE FROM plats WHERE id = $1`, [req.params.id]);
    if (plat) await supprimerPhotoPlat(plat.photo);
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

salonCarteRouter.post('/salon/carte/plats/:id/position', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const plat = await une(`SELECT * FROM plats WHERE id = $1`, [req.params.id]);
    if (!plat) return res.redirect('/salon/carte');
    const freres = await query(`SELECT id, position FROM plats WHERE categorie_id = $1 ORDER BY position`, [plat.categorie_id]);
    const i = freres.findIndex(p => p.id === plat.id);
    const j = req.body.sens === 'monter' ? i - 1 : i + 1;
    if (j > -1 && j < freres.length) {
      await transaction(async (t) => {
        await t.executer(`UPDATE plats SET position = $1 WHERE id = $2`, [freres[j].position, freres[i].id]);
        await t.executer(`UPDATE plats SET position = $1 WHERE id = $2`, [freres[i].position, freres[j].id]);
      });
    }
    res.redirect('/salon/carte');
  } catch (err) { next(err); }
});

// Multer signale les fichiers trop lourds ou d'un mauvais type par une
// exception : on la transforme en redirection lisible plutôt qu'en 500.
salonCarteRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    const retour = req.body?.categorieId
      ? `/salon/carte/plats/nouveau?categorie=${req.body.categorieId}`
      : '/salon/carte';
    return res.redirect(retour + '&erreur=' + encodeURIComponent('Photo refusée (8 Mo max, JPEG/PNG/WebP).'));
  }
  next(err);
});
