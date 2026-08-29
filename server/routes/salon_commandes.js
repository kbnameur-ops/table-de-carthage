import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros, versCents } from '../lib/money.js';
import { encaisserCommande } from '../lib/encaissement.js';
import { jourVoisin, aujourdHui, libelleJour } from '../lib/jours.js';

export const salonCommandesRouter = Router();

// 'encaissee' n'est pas dans cette liste : on n'y arrive pas en changeant un
// menu déroulant, mais par l'action « encaisser », qui bouge aussi la
// cagnotte. Le laisser sélectionnable créerait des commandes payées sans
// gain de fidélité.
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
      `SELECT cmd.*, c.prenom, c.nom, c.telephone_saisi, c.email, c.cagnotte_cents
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
      info: req.query.info || null, erreur: req.query.erreur || null,
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

/** Encaisser une commande à emporter : déduit la cagnotte si le client s'en
 *  sert, marque la commande payée, crédite la fidélité. */
salonCommandesRouter.post('/salon/commandes/:id/encaisser', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const remise = req.body.cagnotte ? (versCents(req.body.cagnotte) ?? 0) : 0;
    const r = await encaisserCommande(req.params.id, { remiseCents: remise });
    if (r.erreur) {
      return redirigerRetour(req, res, '/salon/commandes?erreur=' + encodeURIComponent(r.erreur));
    }
    redirigerRetour(req, res, '/salon/commandes');
  } catch (err) { next(err); }
});
