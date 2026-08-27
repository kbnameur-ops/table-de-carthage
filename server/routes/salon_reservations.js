import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { jourVoisin, aujourdHui, libelleJour } from '../lib/jours.js';

export const salonReservationsRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'honoree', 'annulee', 'absente'];

salonReservationsRouter.get('/salon/reservations', exigerAdmin, async (req, res, next) => {
  try {
    // `date=a-venir` regarde tout ce qui reste à traiter, quelle que soit la
    // date : c'est ce que vise le tableau de bord en pointant les réservations
    // en attente, qui ne sont pas toutes pour aujourd'hui.
    const aVenir = req.query.date === 'a-venir';
    const date = aVenir ? null : (dateValide(req.query.date) ? req.query.date : aujourdHui());
    const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

    const conditions = [];
    const params = [];
    if (aVenir) { params.push(aujourdHui()); conditions.push(`r.date >= $${params.length}`); }
    else { params.push(date); conditions.push(`r.date = $${params.length}`); }
    if (statut) { params.push(statut); conditions.push(`r.statut = $${params.length}`); }

    const reservations = await query(
      `SELECT r.*, c.prenom, c.nom, c.telephone_saisi, c.email, t.nom AS table_nom
         FROM reservations r
         JOIN clients c ON c.id = r.client_id
         LEFT JOIN tables_resto t ON t.id = r.table_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.date, r.heure`,
      params
    );

    const total = reservations
      .filter(r => !['annulee', 'absente'].includes(r.statut))
      .reduce((s, r) => s + r.couverts, 0);

    res.render('salon/reservations', {
      titre: 'Réservations', actif: 'reservations',
      reservations, date, aVenir, statut, total, statuts: STATUTS,
      veille: date ? jourVoisin(date, -1) : null,
      lendemain: date ? jourVoisin(date, 1) : null,
      aujourdHui: aujourdHui(),
      libelle: date ? libelleJour(date) : 'Tout ce qui vient',
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
