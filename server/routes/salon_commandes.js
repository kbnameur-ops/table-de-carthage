import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros } from '../lib/money.js';

export const salonCommandesRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'prete', 'retiree', 'annulee'];

salonCommandesRouter.get('/salon/commandes', exigerAdmin, async (req, res, next) => {
  try {
    const date = dateValide(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

    let sql = `
      SELECT cmd.*, c.prenom, c.nom, c.telephone_saisi, c.email
      FROM commandes cmd JOIN clients c ON c.id = cmd.client_id
      WHERE cmd.date = $1`;
    const params = [date];
    if (statut) { sql += ` AND cmd.statut = $2`; params.push(statut); }
    sql += ` ORDER BY cmd.heure`;

    const commandesBrutes = await query(sql, params);
    const commandes = [];
    for (const c of commandesBrutes) {
      const lignes = await query(`SELECT * FROM commande_lignes WHERE commande_id = $1`, [c.id]);
      commandes.push({ ...c, lignes });
    }
    const total = commandes.filter(c => c.statut !== 'annulee').reduce((s, c) => s + c.total_cents, 0);

    res.render('salon/commandes', {
      titre: 'Commandes à emporter', actif: 'commandes',
      commandes, date, statut, total, statuts: STATUTS, euros,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonCommandesRouter.post('/salon/commandes/:id/statut', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    if (STATUTS.includes(req.body.statut)) {
      await executer(`UPDATE commandes SET statut = $1 WHERE id = $2`, [req.body.statut, req.params.id]);
    }
    redirigerRetour(req, res, '/salon/commandes');
  } catch (err) { next(err); }
});
