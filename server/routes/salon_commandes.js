import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros } from '../lib/money.js';
import { jourVoisin, aujourdHui, libelleJour } from '../lib/jours.js';

export const salonCommandesRouter = Router();

const STATUTS = ['en_attente', 'confirmee', 'prete', 'retiree', 'annulee'];

salonCommandesRouter.get('/salon/commandes', exigerAdmin, async (req, res, next) => {
  try {
    const aVenir = req.query.date === 'a-venir';
    const date = aVenir ? null : (dateValide(req.query.date) ? req.query.date : aujourdHui());
    const statut = STATUTS.includes(req.query.statut) ? req.query.statut : null;

    const conditions = [];
    const params = [];
    if (aVenir) { params.push(aujourdHui()); conditions.push(`cmd.date >= $${params.length}`); }
    else { params.push(date); conditions.push(`cmd.date = $${params.length}`); }
    if (statut) { params.push(statut); conditions.push(`cmd.statut = $${params.length}`); }

    const commandesBrutes = await query(
      `SELECT cmd.*, c.prenom, c.nom, c.telephone_saisi, c.email
         FROM commandes cmd JOIN clients c ON c.id = cmd.client_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY cmd.date, cmd.heure`,
      params
    );

    // Les lignes en une seule requête plutôt qu'une par commande : sur une
    // journée chargée, la boucle produisait autant d'allers-retours réseau
    // que de commandes, ce qui se sent depuis une fonction serverless.
    const ids = commandesBrutes.map(c => c.id);
    const lignes = ids.length
      ? await query(`SELECT * FROM commande_lignes WHERE commande_id = ANY($1::int[])`, [ids])
      : [];
    const parCommande = new Map(ids.map(id => [id, []]));
    for (const l of lignes) parCommande.get(l.commande_id)?.push(l);

    const commandes = commandesBrutes.map(c => ({ ...c, lignes: parCommande.get(c.id) || [] }));
    const total = commandes.filter(c => c.statut !== 'annulee').reduce((s, c) => s + c.total_cents, 0);

    res.render('salon/commandes', {
      titre: 'Commandes à emporter', actif: 'commandes',
      commandes, date, aVenir, statut, total, statuts: STATUTS, euros,
      veille: date ? jourVoisin(date, -1) : null,
      lendemain: date ? jourVoisin(date, 1) : null,
      aujourdHui: aujourdHui(),
      libelle: date ? libelleJour(date) : 'Tout ce qui vient',
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
