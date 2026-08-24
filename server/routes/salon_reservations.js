import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';

export const salonReservationsRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'honoree', 'annulee', 'absente'];

salonReservationsRouter.get('/salon/reservations', exigerAdmin, async (req, res, next) => {
  try {
    const date = dateValide(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

    let sql = `
      SELECT r.*, c.prenom, c.nom, c.telephone_saisi, c.email
      FROM reservations r JOIN clients c ON c.id = r.client_id
      WHERE r.date = $1`;
    const params = [date];
    if (statut) { sql += ` AND r.statut = $2`; params.push(statut); }
    sql += ` ORDER BY r.heure`;

    const reservations = await query(sql, params);
    const total = reservations
      .filter(r => !['annulee', 'absente'].includes(r.statut))
      .reduce((s, r) => s + r.couverts, 0);

    res.render('salon/reservations', {
      titre: 'Réservations', actif: 'reservations',
      reservations, date, statut, total, statuts: STATUTS,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonReservationsRouter.post('/salon/reservations/:id/statut', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    if (STATUTS.includes(req.body.statut)) {
      await executer(`UPDATE reservations SET statut = $1 WHERE id = $2`, [req.body.statut, req.params.id]);
    }
    redirigerRetour(req, res, '/salon/reservations');
  } catch (err) { next(err); }
});
