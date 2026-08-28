import { Router } from 'express';
import { query, une, transaction } from '../db.js';
import { verifierCsrf } from '../middleware.js';
import { validerIdentite, trouverOuCreerClient } from '../lib/clients.js';
import { clientDeSession, connecterDepuisTunnel, quitterIdentite } from '../lib/tunnel-identite.js';
import { genererReference } from '../lib/reference.js';
import { euros } from '../lib/money.js';
import { nomTable as nomTableLisible } from '../lib/jours.js';
import { notifier } from '../lib/notifications.js';
import {
  tableParCode, ouvrirOuRejoindreTablee, tableeOuverteSurTable, additionDeTablee,
} from '../lib/tablees.js';

export const tableRouter = Router();

const aujourdHui = () => new Date().toISOString().slice(0, 10);
const maintenant = () => new Date().toTimeString().slice(0, 5);

/** La carte servie sur place. Contrairement au tunnel à emporter, le
 *  drapeau `a_emporter` ne filtre rien ici : un plat peut très bien être
 *  servi en salle sans être proposé à l'emporter. */
async function chargerCarteSurPlace() {
  const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
  const plats = await query(`SELECT * FROM plats WHERE visible = true ORDER BY position`);
  return categories
    .map(cat => ({ ...cat, plats: plats.filter(p => p.categorie_id === cat.id) }))
    .filter(cat => cat.plats.length > 0);
}

/** Revalide le panier contre la base : les prix affichés sur le téléphone
 *  du client peuvent dater, seuls ceux de la base font foi. */
async function validerPanier(body) {
  const plats = await query(`SELECT * FROM plats WHERE visible = true`);
  const lignes = [];
  for (const plat of plats) {
    const brut = body[`qte_${plat.id}`];
    const qte = parseInt(brut, 10);
    if (!brut || Number.isNaN(qte) || qte <= 0) continue;
    if (qte > 20) return { erreur: 'Quantité trop élevée pour un plat.' };
    lignes.push({ plat_id: plat.id, nom: plat.nom, prix_cents: plat.prix_cents, quantite: qte });
  }
  if (!lignes.length) return { erreur: 'Votre commande est vide.' };
  return { lignes, total: lignes.reduce((s, l) => s + l.prix_cents * l.quantite, 0) };
}

async function pageTable(req, res, table, extra = {}) {
  const client = await clientDeSession(req.session);
  const tablee = await tableeOuverteSurTable(table.id);
  const addition = tablee ? await additionDeTablee(tablee.id) : { commandes: [], total: 0 };
  return {
    titre: nomTableLisible(table.nom), table, client, tablee, addition,
    envoye: req.query.envoye === '1',
    categories: await chargerCarteSurPlace(), euros,
    erreurGenerale: null, erreurs: {}, erreurConnexion: null, valeurs: {},
    session: req.session, csrfToken: res.locals.csrfToken,
    ...extra,
  };
}

/** Le QR collé sur la table mène ici. */
tableRouter.get('/table/:code', async (req, res, next) => {
  try {
    const table = await tableParCode(req.params.code);
    if (!table) {
      return res.status(404).render('erreur', {
        titre: 'Table inconnue', session: req.session, actif: '',
        message: "Ce QR code ne correspond à aucune table. Demandez à un serveur.",
      });
    }
    res.render('table', await pageTable(req, res, table));
  } catch (err) { next(err); }
});

tableRouter.post('/table/:code', verifierCsrf, async (req, res, next) => {
  try {
    const table = await tableParCode(req.params.code);
    if (!table) return res.redirect('/');
    const b = req.body;

    // ── S'identifier, sans quitter la page ──────────────────
    if (b.action === 'connexion') {
      const { erreur } = await connecterDepuisTunnel(b, req.session, req.ip);
      return res.render('table', await pageTable(req, res, table, { valeurs: b, erreurConnexion: erreur || null }));
    }
    if (b.action === 'changer') {
      await quitterIdentite(req.session);
      return res.render('table', await pageTable(req, res, table, { valeurs: b }));
    }

    // ── Créer son compte depuis la table ────────────────────
    let client = await clientDeSession(req.session);
    if (!client) {
      const erreurs = validerIdentite(b);
      if (Object.keys(erreurs).length) {
        return res.render('table', await pageTable(req, res, table, { erreurs, valeurs: b }));
      }
      const trouve = await trouverOuCreerClient(b);
      if (trouve.erreur === 'telephone_associe') {
        return res.render('table', await pageTable(req, res, table, {
          valeurs: b,
          erreurGenerale: "Ce numéro est déjà associé à un compte. Reconnaissez-vous ci-dessus avec votre date de naissance.",
        }));
      }
      client = trouve.client;
      await connecterDepuisTunnel(
        { telephone: client.telephone_saisi, dateNaissance: client.date_naissance },
        req.session, req.ip
      );
    }

    // ── S'installer à la table ──────────────────────────────
    const { tablee, erreur } = await ouvrirOuRejoindreTablee(table.id, client.id);
    if (erreur === 'table_occupee') {
      return res.render('table', await pageTable(req, res, table, {
        valeurs: b,
        erreurGenerale: `Cette table est déjà ouverte au nom de ${tablee.prenom}. Demandez à un serveur si ce n'est pas votre table.`,
      }));
    }

    // S'identifier seul n'envoie rien en cuisine : le client compose sa
    // commande, puis la valide explicitement.
    if (b.action !== 'commander') {
      return res.render('table', await pageTable(req, res, table, { valeurs: b }));
    }

    const panier = await validerPanier(b);
    if (panier.erreur) {
      return res.render('table', await pageTable(req, res, table, {
        valeurs: b, erreurs: { panier: panier.erreur },
      }));
    }

    const reference = genererReference('SUR');
    await transaction(async (t) => {
      const commande = await t.une(
        `INSERT INTO commandes (reference, client_id, type, tablee_id, date, heure, total_cents, message)
         VALUES ($1, $2, 'sur_place', $3, $4, $5, $6, $7) RETURNING id`,
        [reference, client.id, tablee.id, aujourdHui(), maintenant(), panier.total, (b.message || '').trim()]
      );
      for (const l of panier.lignes) {
        await t.executer(
          `INSERT INTO commande_lignes (commande_id, plat_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4, $5)`,
          [commande.id, l.plat_id, l.nom, l.prix_cents, l.quantite]
        );
      }
    });

    const nbPlats = panier.lignes.reduce((n, l) => n + l.quantite, 0);
    await notifier({
      type: 'commande',
      titre: `Table ${table.nom} — ${euros(panier.total)}`,
      detail: `${client.prenom} ${client.nom} · ${nbPlats} article${nbPlats > 1 ? 's' : ''} · commande sur place`,
      lien: `/salon/tables-clients`,
    });

    res.redirect(`/table/${req.params.code}?envoye=1`);
  } catch (err) { next(err); }
});
