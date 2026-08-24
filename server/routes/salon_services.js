import { Router } from 'express';
import { db } from '../db.js';
import { exigerAdmin, verifierCsrf } from '../middleware.js';
import { heureValide, dateValide, texteNonVide } from '../lib/validate.js';

export const salonServicesRouter = Router();

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function chargerServicesAvecJours() {
  return db.prepare(`SELECT * FROM services ORDER BY position`).all().map(s => ({
    ...s,
    joursLabel: JOURS.filter((_, i) => s.jours.includes(String(i + 1))).join(', '),
  }));
}

salonServicesRouter.get('/salon/services', exigerAdmin, (req, res) => {
  const fermetures = db.prepare(`SELECT * FROM fermetures WHERE date >= date('now') ORDER BY date`).all();
  res.render('salon/services', {
    titre: 'Services & capacité', actif: 'services',
    services: chargerServicesAvecJours(), fermetures, jours: JOURS,
    erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
  });
});

salonServicesRouter.get('/salon/services/nouveau', exigerAdmin, (req, res) => {
  res.render('salon/service-form', { titre: 'Nouveau service', actif: 'services', service: null, jours: JOURS, csrfToken: res.locals.csrfToken });
});

salonServicesRouter.get('/salon/services/:id/modifier', exigerAdmin, (req, res) => {
  const service = db.prepare(`SELECT * FROM services WHERE id = ?`).get(req.params.id);
  if (!service) return res.redirect('/salon/services');
  res.render('salon/service-form', { titre: 'Modifier le service', actif: 'services', service, jours: JOURS, csrfToken: res.locals.csrfToken });
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

salonServicesRouter.post('/salon/services', exigerAdmin, verifierCsrf, (req, res) => {
  const erreurs = validerService(req.body);
  if (erreurs.length) return res.redirect('/salon/services/nouveau?erreur=' + encodeURIComponent(erreurs.join(' ')));
  const position = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services`).get().p;
  db.prepare(
    `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, pas_minutes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
    parseInt(req.body.tablesTotal, 10), parseInt(req.body.couvertsTotal, 10), parseInt(req.body.pasMinutes, 10), position
  );
  res.redirect('/salon/services');
});

salonServicesRouter.post('/salon/services/:id', exigerAdmin, verifierCsrf, (req, res) => {
  const erreurs = validerService(req.body);
  if (erreurs.length) return res.redirect(`/salon/services/${req.params.id}/modifier?erreur=` + encodeURIComponent(erreurs.join(' ')));
  db.prepare(
    `UPDATE services SET nom = ?, jours = ?, debut = ?, fin = ?, tables_total = ?, couverts_total = ?,
     pas_minutes = ?, actif = ? WHERE id = ?`
  ).run(
    req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
    parseInt(req.body.tablesTotal, 10), parseInt(req.body.couvertsTotal, 10), parseInt(req.body.pasMinutes, 10),
    req.body.actif ? 1 : 0, req.params.id
  );
  res.redirect('/salon/services');
});

salonServicesRouter.post('/salon/services/:id/supprimer', exigerAdmin, verifierCsrf, (req, res) => {
  db.prepare(`DELETE FROM services WHERE id = ?`).run(req.params.id);
  res.redirect('/salon/services');
});

salonServicesRouter.post('/salon/fermetures', exigerAdmin, verifierCsrf, (req, res) => {
  const { date, motif } = req.body;
  if (!dateValide(date)) return res.redirect('/salon/services?erreur=' + encodeURIComponent('Date invalide.'));
  db.prepare(
    `INSERT INTO fermetures (date, motif) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET motif = excluded.motif`
  ).run(date, (motif || '').trim());
  res.redirect('/salon/services');
});

salonServicesRouter.post('/salon/fermetures/:id/supprimer', exigerAdmin, verifierCsrf, (req, res) => {
  db.prepare(`DELETE FROM fermetures WHERE id = ?`).run(req.params.id);
  res.redirect('/salon/services');
});
