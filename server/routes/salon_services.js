import { Router } from 'express';
import { query, une, executer } from '../db.js';
import { exigerAdmin, verifierCsrf } from '../middleware.js';
import { heureValide, dateValide, texteNonVide } from '../lib/validate.js';
import { creerTables, supprimerTable, additionsParTable } from '../lib/tables.js';

export const salonServicesRouter = Router();

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

async function chargerServicesAvecJours() {
  // La capacité affichée est calculée depuis les tables réellement
  // configurées, pas depuis un total saisi à la main.
  const services = await query(
    `SELECT s.*,
            COALESCE(t.nb, 0)::int       AS nb_tables,
            COALESCE(t.couverts, 0)::int AS nb_couverts
       FROM services s
       LEFT JOIN (
         SELECT service_id, COUNT(*) AS nb, SUM(couverts) AS couverts
           FROM tables_resto WHERE actif = true GROUP BY service_id
       ) t ON t.service_id = s.id
      ORDER BY s.position`
  );
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
  const pas = parseInt(body.pasMinutes, 10);
  if (!Number.isInteger(pas) || pas < 5 || pas > 240) erreurs.push('Le pas entre créneaux doit être entre 5 et 240 minutes.');
  return erreurs;
}

salonServicesRouter.post('/salon/services', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerService(req.body);
    if (erreurs.length) return res.redirect('/salon/services/nouveau?erreur=' + encodeURIComponent(erreurs.join(' ')));
    const { p: position } = await une(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services`);
    await executer(
      `INSERT INTO services (nom, jours, debut, fin, pas_minutes, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
        parseInt(req.body.pasMinutes, 10), position,
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
      `UPDATE services SET nom = $1, jours = $2, debut = $3, fin = $4, pas_minutes = $5, actif = $6 WHERE id = $7`,
      [
        req.body.nom.trim(), joursDepuisCases(req.body), req.body.debut, req.body.fin,
        parseInt(req.body.pasMinutes, 10), !!req.body.actif, req.params.id,
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

// ── Les tables d'un service ────────────────────────────────
salonServicesRouter.get('/salon/services/:id/tables', exigerAdmin, async (req, res, next) => {
  try {
    const service = await une(`SELECT * FROM services WHERE id = $1`, [req.params.id]);
    if (!service) return res.redirect('/salon/services');
    const tables = await query(
      `SELECT * FROM tables_resto WHERE service_id = $1 ORDER BY position, id`, [service.id]
    );
    const total = tables.filter(t => t.actif).reduce((s, t) => s + t.couverts, 0);
    res.render('salon/tables', {
      titre: `Tables — ${service.nom}`, actif: 'services', service, tables, total,
      // Combien d'additions chaque table porte : une table qui a servi ne
      // se supprime pas, et l'écran doit le dire avant le clic, pas après.
      additions: await additionsParTable(service.id),
      erreur: req.query.erreur || null, info: req.query.info || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

function validerTable(body) {
  const erreurs = [];
  if (!texteNonVide(body.nom, 40)) erreurs.push('Nom de table requis.');
  const couverts = parseInt(body.couverts, 10);
  if (!Number.isInteger(couverts) || couverts < 1 || couverts > 30) erreurs.push('Nombre de couverts invalide (1 à 30).');
  return erreurs;
}

salonServicesRouter.post('/salon/services/:id/tables', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const retour = `/salon/services/${req.params.id}/tables`;
    const erreurs = validerTable(req.body);
    if (erreurs.length) return res.redirect(`${retour}?erreur=` + encodeURIComponent(erreurs.join(' ')));

    const service = await une(`SELECT id FROM services WHERE id = $1`, [req.params.id]);
    if (!service) return res.redirect('/salon/services');

    await creerTables(service.id, {
      nom: req.body.nom.trim(),
      couverts: parseInt(req.body.couverts, 10),
      nombre: req.body.nombre,
    });
    res.redirect(retour);
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/tables/:id', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const table = await une(`SELECT service_id FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/salon/services');
    const retour = `/salon/services/${table.service_id}/tables`;
    const erreurs = validerTable(req.body);
    if (erreurs.length) return res.redirect(`${retour}?erreur=` + encodeURIComponent(erreurs.join(' ')));
    await executer(
      `UPDATE tables_resto SET nom = $1, couverts = $2, actif = $3 WHERE id = $4`,
      [req.body.nom.trim(), parseInt(req.body.couverts, 10), !!req.body.actif, req.params.id]
    );
    res.redirect(retour);
  } catch (err) { next(err); }
});

salonServicesRouter.post('/salon/tables/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const table = await une(`SELECT service_id FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/salon/services');
    const retour = `/salon/services/${table.service_id}/tables`;

    const { erreur } = await supprimerTable(req.params.id);
    if (erreur) return res.redirect(`${retour}?erreur=` + encodeURIComponent(erreur));
    res.redirect(`${retour}?info=` + encodeURIComponent('Table supprimée.'));
  } catch (err) { next(err); }
});
