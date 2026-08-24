import { Router } from 'express';
import { db } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';

export const salonReservationsRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'honoree', 'annulee', 'absente'];

salonReservationsRouter.get('/salon/reservations', exigerAdmin, (req, res) => {
  const date = dateValide(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

  let sql = `
    SELECT r.*, c.prenom, c.nom, c.telephone_saisi, c.email
    FROM reservations r JOIN clients c ON c.id = r.client_id
    WHERE r.date = ?`;
  const params = [date];
  if (statut) { sql += ` AND r.statut = ?`; params.push(statut); }
  sql += ` ORDER BY r.heure`;

  const reservations = db.prepare(sql).all(...params);
  const total = reservations
    .filter(r => !['annulee', 'absente'].includes(r.statut))
    .reduce((s, r) => s + r.couverts, 0);

  res.render('salon/reservations', {
    titre: 'Réservations', actif: 'reservations',
    reservations, date, statut, total, statuts: STATUTS,
    csrfToken: res.locals.csrfToken,
  });
});

salonReservationsRouter.post('/salon/reservations/:id/statut', exigerAdmin, verifierCsrf, (req, res) => {
  if (STATUTS.includes(req.body.statut)) {
    db.prepare(`UPDATE reservations SET statut = ? WHERE id = ?`).run(req.body.statut, req.params.id);
  }
  redirigerRetour(req, res, '/salon/reservations');
});
