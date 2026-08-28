import { Router } from 'express';
import { query, une, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { euros } from '../lib/money.js';
import { normaliserTelephone } from '../lib/phone.js';

export const salonClientsRouter = Router();

// ── Le fichier client ──────────────────────────────────────
salonClientsRouter.get('/salon/clients', exigerAdmin, async (req, res, next) => {
  try {
    const recherche = (req.query.q || '').trim();

    // La recherche porte aussi sur le téléphone normalisé : on tape « 06 12 »
    // ou « 0612 » et on retrouve le même client dans les deux cas.
    const params = [];
    let filtre = '';
    if (recherche) {
      const motif = `%${recherche.toLowerCase()}%`;
      const motifTel = `%${normaliserTelephone(recherche)}%`;
      params.push(motif, motifTel);
      filtre = `WHERE lower(c.prenom) LIKE $1 OR lower(c.nom) LIKE $1
                   OR lower(c.email) LIKE $1 OR c.telephone LIKE $2`;
    }

    const clients = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM reservations r WHERE r.client_id = c.id) AS nb_resa,
              (SELECT COUNT(*)::int FROM commandes cm WHERE cm.client_id = c.id) AS nb_cmd,
              (SELECT COALESCE(SUM(cm.total_cents), 0)::int FROM commandes cm
                WHERE cm.client_id = c.id AND cm.statut != 'annulee') AS total_depense
         FROM clients c
         ${filtre}
        ORDER BY c.cree_le DESC
        LIMIT 200`,
      params
    );

    res.render('salon/clients', {
      titre: 'Clients', actif: 'clients', clients, recherche, euros,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

// ── La fiche d'un client ───────────────────────────────────
salonClientsRouter.get('/salon/clients/:id', exigerAdmin, async (req, res, next) => {
  try {
    const client = await une(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
    if (!client) return res.redirect('/salon/clients');

    const reservations = await query(
      `SELECT r.*, t.nom AS table_nom
         FROM reservations r LEFT JOIN tables_resto t ON t.id = r.table_id
        WHERE r.client_id = $1 ORDER BY r.date DESC, r.heure DESC LIMIT 50`,
      [client.id]
    );
    const commandes = await query(
      `SELECT cm.*, tb.id AS tid, t.nom AS table_nom
         FROM commandes cm
         LEFT JOIN tablees tb ON tb.id = cm.tablee_id
         LEFT JOIN tables_resto t ON t.id = tb.table_id
        WHERE cm.client_id = $1 ORDER BY cm.date DESC, cm.heure DESC LIMIT 50`,
      [client.id]
    );
    const tablees = await query(
      `SELECT tb.*, t.nom AS table_nom,
              (SELECT COALESCE(SUM(cm.total_cents),0)::int FROM commandes cm
                WHERE cm.tablee_id = tb.id AND cm.statut != 'annulee') AS total
         FROM tablees tb JOIN tables_resto t ON t.id = tb.table_id
        WHERE tb.client_id = $1 ORDER BY tb.ouverte_le DESC LIMIT 30`,
      [client.id]
    );

    res.render('salon/client', {
      titre: `${client.prenom} ${client.nom}`, actif: 'clients',
      client, reservations, commandes, tablees, euros,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** Les notes du salon sur un client (allergies, habitudes, incident).
 *  Le reste de la fiche vient de ce que le client a saisi lui-même : on ne
 *  le modifie pas depuis ici, sinon il ne se reconnaîtrait plus. */
salonClientsRouter.post('/salon/clients/:id/notes', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(
      `UPDATE clients SET notes = $1 WHERE id = $2`,
      [(req.body.notes || '').trim().slice(0, 1000), req.params.id]
    );
    redirigerRetour(req, res, `/salon/clients/${req.params.id}`);
  } catch (err) { next(err); }
});
