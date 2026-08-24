import { Router } from 'express';
import { db } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros } from '../lib/money.js';

export const salonCommandesRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'prete', 'retiree', 'annulee'];

salonCommandesRouter.get('/salon/commandes', exigerAdmin, (req, res) => {
  const date = dateValide(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

  let sql = `
    SELECT cmd.*, c.prenom, c.nom, c.telephone_saisi, c.email
    FROM commandes cmd JOIN clients c ON c.id = cmd.client_id
    WHERE cmd.date = ?`;
  const params = [date];
  if (statut) { sql += ` AND cmd.statut = ?`; params.push(statut); }
  sql += ` ORDER BY cmd.heure`;

  const commandes = db.prepare(sql).all(...params).map(c => ({
    ...c,
    lignes: db.prepare(`SELECT * FROM commande_lignes WHERE commande_id = ?`).all(c.id),
  }));
  const total = commandes.filter(c => c.statut !== 'annulee').reduce((s, c) => s + c.total_cents, 0);

  res.render('salon/commandes', {
    titre: 'Commandes à emporter', actif: 'commandes',
    commandes, date, statut, total, statuts: STATUTS, euros,
    csrfToken: res.locals.csrfToken,
  });
});

salonCommandesRouter.post('/salon/commandes/:id/statut', exigerAdmin, verifierCsrf, (req, res) => {
  if (STATUTS.includes(req.body.statut)) {
    db.prepare(`UPDATE commandes SET statut = ? WHERE id = ?`).run(req.body.statut, req.params.id);
  }
  redirigerRetour(req, res, '/salon/commandes');
});
