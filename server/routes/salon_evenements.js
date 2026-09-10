import { Router } from 'express';
import multer from 'multer';
import { une, query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide, heureValide, texteNonVide } from '../lib/validate.js';
import { euros, versCents } from '../lib/money.js';
import { dateLongue } from '../lib/jours.js';
import { slugifier, nomFichierUnique } from '../lib/slug.js';
import { enregistrerPhoto, supprimerPhoto } from '../lib/image.js';
import {
  evenementsDuSalon, evenementParSlug, reservationsDe,
  obstacleASuppression, placesRestantes,
} from '../lib/evenements.js';

export const salonEvenementsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

function validerEvenement(b) {
  const erreurs = [];
  if (!texteNonVide(b.titre, 120)) erreurs.push('Titre requis.');
  if (!dateValide(b.date)) erreurs.push('Date invalide.');
  if (!heureValide(b.heure)) erreurs.push('Heure invalide.');
  if (versCents(b.prix) === null) erreurs.push('Prix invalide (exemple : 45 ou 45,50).');
  const places = parseInt(b.places, 10);
  if (!Number.isInteger(places) || places < 1 || places > 500) erreurs.push('Nombre de places invalide (1 à 500).');
  return erreurs;
}

// ── La liste ────────────────────────────────────────────────
salonEvenementsRouter.get('/salon/evenements', exigerAdmin, async (req, res, next) => {
  try {
    res.render('salon/evenements', {
      titre: 'Soirées', actif: 'evenements',
      evenements: await evenementsDuSalon(),
      euros, dateLongue,
      erreur: req.query.erreur || null, info: req.query.info || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonEvenementsRouter.post('/salon/evenements', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerEvenement(req.body);
    if (erreurs.length) {
      return res.redirect('/salon/evenements?erreur=' + encodeURIComponent(erreurs.join(' ')));
    }
    const titre = req.body.titre.trim();
    // Un slug déjà pris ferait échouer l'insertion sur la contrainte
    // d'unicité : on le rend libre plutôt que de renvoyer une erreur pour
    // deux soirées qui portent légitimement le même nom d'une année sur
    // l'autre.
    const base = slugifier(titre) || 'soiree';
    let slug = base;
    for (let i = 2; await une(`SELECT id FROM evenements WHERE slug = $1`, [slug]); i++) slug = `${base}-${i}`;

    const e = await une(
      `INSERT INTO evenements (slug, titre, accroche, texte, date, heure, prix_cents, places, visible, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,0) RETURNING id`,
      [slug, titre, (req.body.accroche || '').trim(), (req.body.texte || '').trim(),
       req.body.date, req.body.heure, versCents(req.body.prix), parseInt(req.body.places, 10)]
    );
    res.redirect(`/salon/evenements/${e.id}`);
  } catch (err) { next(err); }
});

// ── La fiche d'une soirée ───────────────────────────────────
salonEvenementsRouter.get('/salon/evenements/:id', exigerAdmin, async (req, res, next) => {
  try {
    const e = await une(`SELECT * FROM evenements WHERE id = $1`, [req.params.id]);
    if (!e) return res.redirect('/salon/evenements');
    const photos = await query(
      `SELECT * FROM evenement_photos WHERE evenement_id = $1 ORDER BY position, id`, [e.id]);
    const compte = await placesRestantes(e.id);

    res.render('salon/evenement', {
      titre: e.titre, actif: 'evenements',
      evenement: e, photos, compte,
      reservations: await reservationsDe(e.id),
      obstacle: await obstacleASuppression(e.id),
      euros, dateLongue,
      erreur: req.query.erreur || null, info: req.query.info || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonEvenementsRouter.post('/salon/evenements/:id', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const retour = `/salon/evenements/${req.params.id}`;
    const erreurs = validerEvenement(req.body);
    if (erreurs.length) return res.redirect(`${retour}?erreur=` + encodeURIComponent(erreurs.join(' ')));

    // Réduire la capacité en dessous de ce qui est déjà vendu ferait
    // apparaître une soirée en surréservation, sans que rien ne le signale.
    const places = parseInt(req.body.places, 10);
    const { vendues } = await placesRestantes(req.params.id);
    if (places < vendues) {
      return res.redirect(`${retour}?erreur=` + encodeURIComponent(
        `${vendues} places sont déjà vendues : la capacité ne peut pas descendre en dessous.`));
    }

    await executer(
      `UPDATE evenements SET titre=$1, accroche=$2, texte=$3, date=$4, heure=$5,
              prix_cents=$6, places=$7, visible=$8, position=$9
        WHERE id=$10`,
      [req.body.titre.trim(), (req.body.accroche || '').trim(), (req.body.texte || '').trim(),
       req.body.date, req.body.heure, versCents(req.body.prix), places,
       req.body.visible === '1', parseInt(req.body.position, 10) || 0, req.params.id]
    );
    res.redirect(`${retour}?info=` + encodeURIComponent('Soirée enregistrée.'));
  } catch (err) { next(err); }
});

salonEvenementsRouter.post('/salon/evenements/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const obstacle = await obstacleASuppression(req.params.id);
    if (obstacle) {
      return res.redirect(`/salon/evenements/${req.params.id}?erreur=` + encodeURIComponent(obstacle));
    }
    const photos = await query(`SELECT url FROM evenement_photos WHERE evenement_id = $1`, [req.params.id]);
    await executer(`DELETE FROM evenement_reservations WHERE evenement_id = $1`, [req.params.id]);
    await executer(`DELETE FROM evenements WHERE id = $1`, [req.params.id]);
    // Les fichiers après la base : une photo orpheline se remarque moins
    // qu'une fiche qui pointe vers une image effacée.
    for (const p of photos) await supprimerPhoto(p.url);
    res.redirect('/salon/evenements?info=' + encodeURIComponent('Soirée supprimée.'));
  } catch (err) { next(err); }
});

// ── Les photos ──────────────────────────────────────────────
// multer avant verifierCsrf : c'est lui qui sait lire un corps multipart,
// et le jeton n'existe pas encore dans req.body avant son passage.
salonEvenementsRouter.post('/salon/evenements/:id/photos', exigerAdmin,
  upload.array('photos', 12), verifierCsrf, async (req, res, next) => {
  try {
    const retour = `/salon/evenements/${req.params.id}`;
    const e = await une(`SELECT id, slug FROM evenements WHERE id = $1`, [req.params.id]);
    if (!e) return res.redirect('/salon/evenements');
    if (!req.files?.length) {
      return res.redirect(`${retour}?erreur=` + encodeURIComponent('Aucune photo reçue (formats acceptés : JPEG, PNG, WebP, 8 Mo maximum).'));
    }

    const { p } = await une(
      `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM evenement_photos WHERE evenement_id = $1`, [e.id]);
    let position = p;
    for (const f of req.files) {
      const url = await enregistrerPhoto(f.buffer, nomFichierUnique(e.slug), 'evenements');
      await executer(
        `INSERT INTO evenement_photos (evenement_id, url, legende, position) VALUES ($1,$2,'',$3)`,
        [e.id, url, position++]);
    }
    res.redirect(`${retour}?info=` + encodeURIComponent(
      `${req.files.length} photo${req.files.length > 1 ? 's' : ''} ajoutée${req.files.length > 1 ? 's' : ''}.`));
  } catch (err) { next(err); }
});

salonEvenementsRouter.post('/salon/photos/:id/legende', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const photo = await une(`SELECT * FROM evenement_photos WHERE id = $1`, [req.params.id]);
    if (!photo) return res.redirect('/salon/evenements');
    await executer(`UPDATE evenement_photos SET legende = $1, position = $2 WHERE id = $3`,
      [(req.body.legende || '').trim().slice(0, 120), parseInt(req.body.position, 10) || 0, photo.id]);
    redirigerRetour(req, res, `/salon/evenements/${photo.evenement_id}`);
  } catch (err) { next(err); }
});

salonEvenementsRouter.post('/salon/photos/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const photo = await une(`SELECT * FROM evenement_photos WHERE id = $1`, [req.params.id]);
    if (!photo) return res.redirect('/salon/evenements');
    await executer(`DELETE FROM evenement_photos WHERE id = $1`, [photo.id]);
    await supprimerPhoto(photo.url);
    redirigerRetour(req, res, `/salon/evenements/${photo.evenement_id}`);
  } catch (err) { next(err); }
});

/** Un fichier trop lourd ou d'un format refusé ne doit pas rendre une page
 *  d'erreur nue : le salon revient sur sa fiche avec une explication. */
salonEvenementsRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    const id = req.params?.id;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Photo trop lourde : 8 Mo maximum.'
      : 'Envoi refusé. Formats acceptés : JPEG, PNG, WebP.';
    return res.redirect(`/salon/evenements${id ? '/' + id : ''}?erreur=` + encodeURIComponent(message));
  }
  next(err);
});
