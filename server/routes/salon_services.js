import { Router } from 'express';
import { query, une, executer } from '../db.js';
import { exigerAdmin, verifierCsrf } from '../middleware.js';
import { heureValide, dateValide, texteNonVide } from '../lib/validate.js';

export const salonServicesRouter = Router();

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

async function chargerServicesAvecJours() {
  const services = await query(`SELECT * FROM services ORDER BY position`);
  return services.map(s => ({
    ...s,
    joursLabel: JOURS.filter((_, i) => s.jours.includes(String(i + 1))).join(', '),
  }));
}

salonServicesRouter.get('/salon/services', exigerAdmin, async (req, res, next) => {
  try {
    const fermetures = await query(`SELECT * FROM fermetures WHERE date >= to_char(CURRENT_DATE, 'YYYY-MM-DD') ORDER BY date`);
    res.render('salon/services', {
      titre: 'Services & capacité', actif: 'services',
      services: await chargerServicesAvecJours(), fermetures, jours: JOURS,
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonServicesRouter.get('/salon/services/nouveau', exigerAdmin, (req, res) => {
  res.render('salon/service-form', { titre: 'Nouveau service', actif: 'services', service: null, jours: JOURS, csrfToken: res.locals.csrfToken });
});

salonServicesRouter.get('/salon/services/:id/modifier', exigerAdmin, async (req, res, next) => {
  try {
    const service = await une(`SELECT * FROM services WHERE id = $1`, [req.params.id]);
    if (!service) return res.redirect('/salon/services');
    res.render('salon/service-form', { titre: 'Modifier le service', actif: 'services', service, jours: JOURS, csrfToken: res.locals.csrfToken });
  } catch (err) { next(err); }
});

function joursDepuisCases(body) {
  return JOURS.map((_, i) => body[`jour${i + 1}`] ? String(i + 1) : '').join('');
}

function validerService(body) {
  const erreurs = [];
  if (!texteNonVide(body.nom, 60)) erreurs.push('Nom requis.');
  if (!joursDepuisCases(body)) erreurs.push('Cochez au moins un jour.');
  if (!heureValide(body.debut) || !heureValide(body.fin) || body.debut >= body.fin) erreurs.push('Horaires invalides.');
  const tables = parseInt(body.tablesTotal, 10), couverts = parseInt(body.couvertsTotal, 10), pas = parseInt(body.pasMinutes, 10);
  if (!Number.isInteger(tables) || tables < 0) erreurs.push('Nombre de tables invalide.');
  if (!Number.isInteger(couverts) || couverts < 0) erreurs.push('Nombre de couverts invalide.');
  if (!Number.isInteger(pas) || pas < 5 || pas > 240) erreurs.push('Le pas entre créneaux doit être entre 5 et 240 minutes.');
  return erreurs;
}

salonServicesRouter.post('/salon/services', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerService(req.body);
    if (erreurs.length) return res.redirect('/salon/services/nouveau?erreur=' + encodeURIComponent(erreurs.join(' ')));
    const { p: position } = await une(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services`);
    await executer(
      `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, pas_minutes, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
        parseInt(req.body.tablesTotal, 10), parseInt(req.body.couvertsTotal, 10), parseInt(req.body.pasMinutes, 10), position,
      ]
    );
    res.redirect('/salon/services');
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/services/:id', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerService(req.body);
    if (erreurs.length) return res.redirect(`/salon/services/${req.params.id}/modifier?erreur=` + encodeURIComponent(erreurs.join(' ')));
    await executer(
      `UPDATE services SET nom = $1, jours = $2, debut = $3, fin = $4, tables_total = $5, couverts_total = $6,
       pas_minutes = $7, actif = $8 WHERE id = $9`,
      [
        req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
        parseInt(req.body.tablesTotal, 10), parseInt(req.body.couvertsTotal, 10), parseInt(req.body.pasMinutes, 10),
        !!req.body.actif, req.params.id,
      ]
    );
    res.redirect('/salon/services');
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/services/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(`DELETE FROM services WHERE id = $1`, [req.params.id]);
    res.redirect('/salon/services');
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/fermetures', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { date, motif } = req.body;
    if (!dateValide(date)) return res.redirect('/salon/services?erreur=' + encodeURIComponent('Date invalide.'));
    await executer(
      `INSERT INTO fermetures (date, motif) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET motif = excluded.motif`,
      [date, (motif || '').trim()]
    );
    res.redirect('/salon/services');
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/fermetures/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(`DELETE FROM fermetures WHERE id = $1`, [req.params.id]);
    res.redirect('/salon/services');
  } catch (err) { next(err); }
});
