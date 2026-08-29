import { Router } from 'express';
import QRCode from 'qrcode';
import { query, une, transaction } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros, versCents } from '../lib/money.js';
import { encaisserTablee } from '../lib/encaissement.js';
import { clientParTelephone, creerClientAuComptoir } from '../lib/clients.js';
import { genererReference } from '../lib/reference.js';
import { aujourdHui, jourVoisin, libelleJour, nomTable as nomTableLisible } from '../lib/jours.js';
import {
  tableesDuJour, additionDeTablee, fermerTablee, ouvrirOuRejoindreTablee,
} from '../lib/tablees.js';

export const salonTablesClientsRouter = Router();

/** L'adresse encodée dans le QR. Déduite de la requête pour que les codes
 *  imprimés depuis la production pointent vers la production, et ceux
 *  imprimés en local vers le poste local. */
function baseDuSite(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ── Les tables occupées, avec leur addition ────────────────
salonTablesClientsRouter.get('/salon/tables-clients', exigerAdmin, async (req, res, next) => {
  try {
    const date = dateValide(req.query.date) ? req.query.date : aujourdHui();
    const tablees = await tableesDuJour(date);
    const ouvertes = tablees.filter(t => t.statut === 'ouverte');

    res.render('salon/tables-clients', {
      titre: 'Tables clients', actif: 'tables-clients',
      date, tablees, euros,
      resume: {
        ouvertes: ouvertes.length,
        enCours: ouvertes.reduce((s, t) => s + t.total, 0),
        journee: tablees.reduce((s, t) => s + t.total, 0),
      },
      tablesLibres: await query(
        `SELECT t.id, t.nom, t.couverts, s.nom AS service_nom
           FROM tables_resto t JOIN services s ON s.id = t.service_id
          WHERE t.actif = true
            AND NOT EXISTS (SELECT 1 FROM tablees tb WHERE tb.table_id = t.id AND tb.statut = 'ouverte')
          ORDER BY s.position, t.position, t.id`
      ),
      veille: jourVoisin(date, -1), lendemain: jourVoisin(date, 1),
      aujourdHui: aujourdHui(), libelle: libelleJour(date),
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

// ── Le détail d'une tablée : l'addition, ligne par ligne ───
salonTablesClientsRouter.get('/salon/tables-clients/:id', exigerAdmin, async (req, res, next) => {
  try {
    const tablee = await une(
      `SELECT tb.*, t.nom AS table_nom, t.couverts AS table_couverts,
              c.id AS cid, c.prenom, c.nom AS client_nom, c.telephone_saisi, c.email,
              c.cagnotte_cents,
              r.reference AS reservation_reference
         FROM tablees tb
         JOIN tables_resto t ON t.id = tb.table_id
         JOIN clients c ON c.id = tb.client_id
         LEFT JOIN reservations r ON r.id = tb.reservation_id
        WHERE tb.id = $1`,
      [req.params.id]
    );
    if (!tablee) return res.redirect('/salon/tables-clients');

    const addition = await additionDeTablee(tablee.id);
    const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
    const plats = await query(`SELECT * FROM plats WHERE visible = true ORDER BY position`);

    res.render('salon/tablee', {
      titre: nomTableLisible(tablee.table_nom), actif: 'tables-clients',
      tablee, addition, euros,
      carte: categories
        .map(c => ({ ...c, plats: plats.filter(p => p.categorie_id === c.id) }))
        .filter(c => c.plats.length > 0),
      erreur: req.query.erreur || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** Ajoute une commande à une tablée depuis le salon : c'est le cas du
 *  serveur qui prend la commande au carnet, ou de la caisse. */
salonTablesClientsRouter.post('/salon/tables-clients/:id/commande', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const tablee = await une(`SELECT * FROM tablees WHERE id = $1 AND statut = 'ouverte'`, [req.params.id]);
    if (!tablee) return res.redirect('/salon/tables-clients');
    const retour = `/salon/tables-clients/${tablee.id}`;

    const plats = await query(`SELECT * FROM plats WHERE visible = true`);
    const lignes = [];
    for (const plat of plats) {
      const qte = parseInt(req.body[`qte_${plat.id}`], 10);
      if (!Number.isInteger(qte) || qte <= 0) continue;
      lignes.push({ plat_id: plat.id, nom: plat.nom, prix_cents: plat.prix_cents, quantite: Math.min(qte, 50) });
    }
    if (!lignes.length) {
      return res.redirect(`${retour}?erreur=` + encodeURIComponent('Sélectionnez au moins un plat.'));
    }

    const total = lignes.reduce((s, l) => s + l.prix_cents * l.quantite, 0);
    const reference = genererReference('SUR');
    await transaction(async (t) => {
      const cmd = await t.une(
        `INSERT INTO commandes (reference, client_id, type, tablee_id, date, heure, total_cents, message, statut)
         VALUES ($1, $2, 'sur_place', $3, $4, $5, $6, $7, 'confirmee') RETURNING id`,
        [
          reference, tablee.client_id, tablee.id, aujourdHui(),
          new Date().toTimeString().slice(0, 5), total, (req.body.message || '').trim(),
        ]
      );
      for (const l of lignes) {
        await t.executer(
          `INSERT INTO commande_lignes (commande_id, plat_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4, $5)`,
          [cmd.id, l.plat_id, l.nom, l.prix_cents, l.quantite]
        );
      }
    });
    res.redirect(retour);
  } catch (err) { next(err); }
});

/** Encaisser une tablée, c'est-à-dire la seule opération qui la termine :
 *  elle déduit la cagnotte si le client s'en sert, marque les commandes
 *  payées, crédite la fidélité et libère la table. */
salonTablesClientsRouter.post('/salon/tables-clients/:id/encaisser', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const remise = req.body.cagnotte ? (versCents(req.body.cagnotte) ?? 0) : 0;
    const r = await encaisserTablee(req.params.id, { remiseCents: remise });
    const retour = `/salon/tables-clients/${req.params.id}`;
    if (r.erreur) return res.redirect(retour + '?erreur=' + encodeURIComponent(r.erreur));
    res.redirect('/salon/tables-clients');
  } catch (err) { next(err); }
});

/** Fermer sans encaisser : une table ouverte par erreur, un client parti
 *  sans consommer. Ne crédite rien, puisque rien n'a été payé. */
salonTablesClientsRouter.post('/salon/tables-clients/:id/fermer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await fermerTablee(req.params.id);
    redirigerRetour(req, res, '/salon/tables-clients');
  } catch (err) { next(err); }
});

/** Ouvre une tablée depuis le salon, pour un client déjà connu : le cas
 *  du serveur qui installe quelqu'un qui n'a pas scanné le QR. */
salonTablesClientsRouter.post('/salon/tables-clients/ouvrir', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { tableId, clientId, telephone } = req.body;
    const table = await une(`SELECT id FROM tables_resto WHERE id = $1`, [tableId]);
    if (!table) return redirigerRetour(req, res, '/salon/tables-clients');

    // Le numéro de téléphone prime : c'est l'identifiant que le personnel a
    // sous la main. L'identifiant interne reste accepté pour les liens
    // ouverts depuis une fiche client.
    let client = telephone ? await clientParTelephone(telephone) : null;
    if (!client && telephone && (req.body.prenom || '').trim()) {
      const cree = await creerClientAuComptoir({
        telephone, prenom: req.body.prenom, nom: req.body.nom, email: req.body.email,
      });
      client = cree.client || null;
    }
    if (!client && clientId) client = await une(`SELECT id FROM clients WHERE id = $1`, [clientId]);
    if (!client) return redirigerRetour(req, res, '/salon/tables-clients');

    const { tablee, erreur } = await ouvrirOuRejoindreTablee(table.id, client.id);
    if (erreur) return redirigerRetour(req, res, '/salon/tables-clients');
    res.redirect(`/salon/tables-clients/${tablee.id}`);
  } catch (err) { next(err); }
});

// ── Les QR à imprimer et coller sur les tables ─────────────
salonTablesClientsRouter.get('/salon/services/:id/qr', exigerAdmin, async (req, res, next) => {
  try {
    const service = await une(`SELECT * FROM services WHERE id = $1`, [req.params.id]);
    if (!service) return res.redirect('/salon/services');

    const tables = await query(
      `SELECT * FROM tables_resto WHERE service_id = $1 AND actif = true ORDER BY position, id`,
      [service.id]
    );
    const base = baseDuSite(req);

    // QR rendus en SVG plutôt qu'en image : ils restent nets à n'importe
    // quelle taille d'impression, et rien n'est à héberger.
    const codes = await Promise.all(tables.map(async t => ({
      ...t,
      url: `${base}/table/${t.code_qr}`,
      svg: await QRCode.toString(`${base}/table/${t.code_qr}`, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      }),
    })));

    res.render('salon/qr-tables', {
      titre: `QR — ${service.nom}`, actif: 'services', service, codes,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});
