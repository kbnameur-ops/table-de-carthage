import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
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

function chargerCarteComplete() {
  const categories = db.prepare(`SELECT * FROM categories ORDER BY position`).all();
  const plats = db.prepare(`SELECT * FROM plats ORDER BY position`).all();
  return categories.map(cat => ({ ...cat, plats: plats.filter(p => p.categorie_id === cat.id) }));
}

function slugCategorieUnique(nom, ignorerId = null) {
  const base = slugifier(nom);
  let slug = base, i = 2;
  while (true) {
    const existe = db.prepare(`SELECT id FROM categories WHERE slug = ? AND id != ?`).get(slug, ignorerId ?? -1);
    if (!existe) return slug;
    slug = `${base}-${i++}`;
  }
}

// ── Vue d'ensemble ──────────────────────────────────────────
salonCarteRouter.get('/salon/carte', exigerAdmin, (req, res) => {
  res.render('salon/carte', {
    titre: 'La carte', actif: 'carte', categories: chargerCarteComplete(), euros,
    erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
  });
});

// ── Catégories ──────────────────────────────────────────────
salonCarteRouter.get('/salon/carte/categories/nouvelle', exigerAdmin, (req, res) => {
  res.render('salon/categorie-form', {
    titre: 'Nouvelle catégorie', actif: 'carte', categorie: null, csrfToken: res.locals.csrfToken,
  });
});

salonCarteRouter.get('/salon/carte/categories/:id/modifier', exigerAdmin, (req, res) => {
  const categorie = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  if (!categorie) return res.redirect('/salon/carte');
  res.render('salon/categorie-form', {
    titre: 'Modifier la catégorie', actif: 'carte', categorie, csrfToken: res.locals.csrfToken,
  });
});

salonCarteRouter.post('/salon/carte/categories', exigerAdmin, verifierCsrf, (req, res) => {
  const { nom, accroche } = req.body;
  if (!texteNonVide(nom, 60)) return res.redirect('/salon/carte/categories/nouvelle?erreur=' + encodeURIComponent('Nom requis.'));
  const position = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories`).get().p;
  db.prepare(`INSERT INTO categories (slug, nom, accroche, position) VALUES (?, ?, ?, ?)`)
    .run(slugCategorieUnique(nom), nom.trim(), (accroche || '').trim(), position);
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/categories/:id', exigerAdmin, verifierCsrf, (req, res) => {
  const { nom, accroche, visible } = req.body;
  if (!texteNonVide(nom, 60)) return res.redirect(`/salon/carte/categories/${req.params.id}/modifier?erreur=` + encodeURIComponent('Nom requis.'));
  db.prepare(`UPDATE categories SET nom = ?, accroche = ?, visible = ? WHERE id = ?`)
    .run(nom.trim(), (accroche || '').trim(), visible ? 1 : 0, req.params.id);
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/categories/:id/supprimer', exigerAdmin, verifierCsrf, (req, res) => {
  const plats = db.prepare(`SELECT photo FROM plats WHERE categorie_id = ?`).all(req.params.id);
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(req.params.id); // cascade sur les plats
  Promise.all(plats.map(p => supprimerPhotoPlat(p.photo))).catch(() => {});
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/categories/:id/position', exigerAdmin, verifierCsrf, (req, res) => {
  const cats = db.prepare(`SELECT id, position FROM categories ORDER BY position`).all();
  const i = cats.findIndex(c => c.id === Number(req.params.id));
  const j = req.body.sens === 'monter' ? i - 1 : i + 1;
  if (i > -1 && j > -1 && j < cats.length) {
    const maj = db.prepare(`UPDATE categories SET position = ? WHERE id = ?`);
    db.transaction(() => {
      maj.run(cats[j].position, cats[i].id);
      maj.run(cats[i].position, cats[j].id);
    })();
  }
  res.redirect('/salon/carte');
});

// ── Plats ─────────────────────────────────────────────────
salonCarteRouter.get('/salon/carte/plats/nouveau', exigerAdmin, (req, res) => {
  const categories = db.prepare(`SELECT id, nom FROM categories ORDER BY position`).all();
  res.render('salon/plat-form', {
    titre: 'Nouveau plat', actif: 'carte', plat: null, categories,
    categorieId: Number(req.query.categorie) || categories[0]?.id,
    erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
  });
});

salonCarteRouter.get('/salon/carte/plats/:id/modifier', exigerAdmin, (req, res) => {
  const plat = db.prepare(`SELECT * FROM plats WHERE id = ?`).get(req.params.id);
  if (!plat) return res.redirect('/salon/carte');
  const categories = db.prepare(`SELECT id, nom FROM categories ORDER BY position`).all();
  res.render('salon/plat-form', {
    titre: 'Modifier le plat', actif: 'carte', plat, categories, categorieId: plat.categorie_id,
    erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
  });
});

function validerChampsPlat(body) {
  const erreurs = [];
  if (!texteNonVide(body.nom, 80)) erreurs.push('Nom requis.');
  if (!texteNonVide(body.description, 400)) erreurs.push('Description requise.');
  if (versCents(body.prix) === null) erreurs.push('Prix invalide (exemple : 16,50).');
  if (!db.prepare(`SELECT 1 FROM categories WHERE id = ?`).get(body.categorieId)) erreurs.push('Catégorie invalide.');
  return erreurs;
}

// multer doit tourner avant verifierCsrf : c'est le seul middleware capable
// d'analyser un corps multipart/form-data, seul format possible avec un
// champ fichier. Sans lui, req.body est vide et le jeton _csrf jamais lu.
salonCarteRouter.post('/salon/carte/plats', exigerAdmin, upload.single('photo'), verifierCsrf, async (req, res) => {
  const erreurs = validerChampsPlat(req.body);
  if (erreurs.length) {
    return res.redirect(`/salon/carte/plats/nouveau?categorie=${req.body.categorieId}&erreur=` + encodeURIComponent(erreurs.join(' ')));
  }
  let nomPhoto = null;
  if (req.file) {
    nomPhoto = nomFichierUnique(req.body.nom);
    try {
      await enregistrerPhotoPlat(req.file.buffer, nomPhoto);
    } catch {
      return res.redirect(`/salon/carte/plats/nouveau?categorie=${req.body.categorieId}&erreur=` + encodeURIComponent("Photo illisible : merci d'essayer un autre fichier."));
    }
  }
  const position = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM plats WHERE categorie_id = ?`).get(req.body.categorieId).p;
  db.prepare(
    `INSERT INTO plats (categorie_id, nom, description, prix_cents, photo, vegetarien, signature, a_emporter, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.body.categorieId, req.body.nom.trim(), req.body.description.trim(), versCents(req.body.prix),
    nomPhoto, req.body.vegetarien ? 1 : 0, req.body.signature ? 1 : 0, req.body.aEmporter ? 1 : 0, position
  );
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/plats/:id', exigerAdmin, upload.single('photo'), verifierCsrf, async (req, res) => {
  const erreurs = validerChampsPlat(req.body);
  if (erreurs.length) {
    return res.redirect(`/salon/carte/plats/${req.params.id}/modifier?erreur=` + encodeURIComponent(erreurs.join(' ')));
  }
  const existant = db.prepare(`SELECT photo FROM plats WHERE id = ?`).get(req.params.id);
  if (!existant) return res.redirect('/salon/carte');

  let nomPhoto = existant.photo;
  if (req.file) {
    const nouveau = nomFichierUnique(req.body.nom);
    try {
      await enregistrerPhotoPlat(req.file.buffer, nouveau);
    } catch {
      return res.redirect(`/salon/carte/plats/${req.params.id}/modifier?erreur=` + encodeURIComponent("Photo illisible : merci d'essayer un autre fichier."));
    }
    await supprimerPhotoPlat(existant.photo);
    nomPhoto = nouveau;
  } else if (req.body.supprimerPhoto) {
    await supprimerPhotoPlat(existant.photo);
    nomPhoto = null;
  }

  db.prepare(
    `UPDATE plats SET categorie_id = ?, nom = ?, description = ?, prix_cents = ?, photo = ?,
     vegetarien = ?, signature = ?, a_emporter = ?, visible = ? WHERE id = ?`
  ).run(
    req.body.categorieId, req.body.nom.trim(), req.body.description.trim(), versCents(req.body.prix), nomPhoto,
    req.body.vegetarien ? 1 : 0, req.body.signature ? 1 : 0, req.body.aEmporter ? 1 : 0, req.body.visible ? 1 : 0,
    req.params.id
  );
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/plats/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res) => {
  const plat = db.prepare(`SELECT photo FROM plats WHERE id = ?`).get(req.params.id);
  db.prepare(`DELETE FROM plats WHERE id = ?`).run(req.params.id);
  if (plat) await supprimerPhotoPlat(plat.photo);
  res.redirect('/salon/carte');
});

salonCarteRouter.post('/salon/carte/plats/:id/position', exigerAdmin, verifierCsrf, (req, res) => {
  const plat = db.prepare(`SELECT * FROM plats WHERE id = ?`).get(req.params.id);
  if (!plat) return res.redirect('/salon/carte');
  const freres = db.prepare(`SELECT id, position FROM plats WHERE categorie_id = ? ORDER BY position`).all(plat.categorie_id);
  const i = freres.findIndex(p => p.id === plat.id);
  const j = req.body.sens === 'monter' ? i - 1 : i + 1;
  if (j > -1 && j < freres.length) {
    const maj = db.prepare(`UPDATE plats SET position = ? WHERE id = ?`);
    db.transaction(() => {
      maj.run(freres[j].position, freres[i].id);
      maj.run(freres[i].position, freres[j].id);
    })();
  }
  res.redirect('/salon/carte');
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
