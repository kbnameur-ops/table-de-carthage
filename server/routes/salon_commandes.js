import { Router } from 'express';
import { query, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide } from '../lib/validate.js';
import { euros, versCents } from '../lib/money.js';
import { encaisserCommande } from '../lib/encaissement.js';
import { jourVoisin, aujourdHui, libelleJour } from '../lib/jours.js';
import { capturerEtEncaisser, libererPaiement } from '../lib/reglement.js';
import { paiementDisponible } from '../lib/paiement.js';

export const salonCommandesRouter = Router();

// 'encaissee' n'est pas dans cette liste : on n'y arrive pas en changeant un
// menu déroulant, mais par l'action « encaisser », qui bouge aussi la
// cagnotte. Le laisser sélectionnable créerait des commandes payées sans
// gain de fidélité.
const STATUTS = ['en_attente', 'confirmee', 'prete', 'retiree', 'annulee'];
// 'a_payer' n'y figure pas non plus : on n'y entre pas depuis un menu, et
// on n'en sort qu'en réglant. Le forcer à la main enverrait en cuisine une
// commande dont personne n'a la carte.

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

    // Le paiement en face de chaque commande : c'est ce qui permet à la
    // caisse de savoir si une empreinte attend d'être débitée ou libérée.
    const paiements = ids.length
      ? await query(
          `SELECT * FROM paiements WHERE commande_id = ANY($1::int[])
            AND statut IN ('a_confirmer','autorise','capture')`, [ids])
      : [];
    const parPaiement = new Map(paiements.map(p => [p.commande_id, p]));

    const commandes = commandesBrutes.map(c => ({
      ...c, lignes: parCommande.get(c.id) || [], paiement: parPaiement.get(c.id) || null,
    }));
    // 'a_payer' est exclu comme 'annulee' : une commande dont la carte n'a
    // jamais été validée est un panier abandonné, l'additionner ferait
    // afficher au salon un chiffre d'affaires qui n'existe pas.
    const total = commandes
      .filter(c => c.statut !== 'annulee' && c.statut !== 'a_payer')
      .reduce((s, c) => s + c.total_cents, 0);

    res.render('salon/commandes', {
      titre: 'Commandes à emporter', actif: 'commandes',
      commandes, date, aVenir, statut, total, statuts: STATUTS, euros,
      paiementActif: paiementDisponible(),
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

/** Débiter l'empreinte d'une commande retirée. La cagnotte se déduit ici
 *  comme au comptoir : on capture le montant autorisé moins ce que les
 *  points couvrent, et Stripe rend la différence au client. */
salonCommandesRouter.post('/salon/paiements/:id/capturer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const remise = req.body.cagnotte ? (versCents(req.body.cagnotte) ?? 0) : 0;
    const r = await capturerEtEncaisser(req.params.id, { remiseCents: remise });
    if (r.erreur) {
      return redirigerRetour(req, res, '/salon/commandes?erreur=' + encodeURIComponent(r.erreur));
    }
    redirigerRetour(req, res, '/salon/commandes?info=' + encodeURIComponent('Empreinte débitée.'));
  } catch (err) { next(err); }
});

/** Rendre l'empreinte sans rien débiter : le geste commercial sur une
 *  commande que personne n'est venu chercher. La commande est annulée dans
 *  la foulée — elle n'a été ni retirée, ni payée. */
salonCommandesRouter.post('/salon/paiements/:id/liberer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const r = await libererPaiement(req.params.id);
    if (r.erreur) {
      return redirigerRetour(req, res, '/salon/commandes?erreur=' + encodeURIComponent(r.erreur));
    }
    redirigerRetour(req, res, '/salon/commandes?info=' + encodeURIComponent('Empreinte libérée, rien n\'a été débité.'));
  } catch (err) { next(err); }
});
