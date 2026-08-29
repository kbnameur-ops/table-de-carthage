import { Router } from 'express';
import { query, une, transaction } from '../db.js';
import { verifierCsrf, exigerService } from '../middleware.js';
import {
  verifierMotDePasse, elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { clientParTelephone, creerClientAuComptoir } from '../lib/clients.js';
import { euros, versCents } from '../lib/money.js';
import { genererReference } from '../lib/reference.js';
import { aujourdHui, nomTable } from '../lib/jours.js';
import { serviceDuJour } from '../lib/availability.js';
import { notifier } from '../lib/notifications.js';
import { ouvrirOuRejoindreTablee, additionDeTablee, tableeOuverteSurTable } from '../lib/tablees.js';
import { encaisserCommande, encaisserTablee } from '../lib/encaissement.js';

/** L'interface de prise de commande, pour le personnel de salle.
 *
 *  Elle se tient d'une main, sur un téléphone ou une tablette, debout entre
 *  deux tables : d'où des cibles larges, trois onglets seulement, et aucun
 *  écran qui demande de faire défiler pour trouver le bouton qui valide.
 *
 *  Le client s'y désigne par son numéro de téléphone, jamais par une date de
 *  naissance : personne ne demande ça à quelqu'un qui attend son plat. */

export const serviceRouter = Router();

const maintenant = () => new Date().toTimeString().slice(0, 5);

// ── Connexion ──────────────────────────────────────────────
serviceRouter.get('/service/connexion', (req, res) => {
  if (req.session.role === 'serveur' || req.session.role === 'admin') return res.redirect('/service');
  res.render('service-connexion', {
    titre: 'Prise de commande', erreurGenerale: null, valeurs: {},
    session: req.session, actif: '', csrfToken: res.locals.csrfToken,
  });
});

serviceRouter.post('/service/connexion', verifierCsrf, async (req, res, next) => {
  try {
    const identifiant = (req.body.identifiant || '').trim().toLowerCase();
    const motDePasse = req.body.motDePasse || '';
    const rendreErreur = (msg) => res.render('service-connexion', {
      titre: 'Prise de commande', erreurGenerale: msg, valeurs: { identifiant },
      session: req.session, actif: '', csrfToken: res.locals.csrfToken,
    });
    if (!identifiant || !motDePasse) return rendreErreur('Identifiant et mot de passe requis.');

    const cle = `serveur:${identifiant}:${req.ip}`;
    if (await tropDeTentatives(cle)) {
      return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);
    }

    const employe = await une(
      `SELECT * FROM employes WHERE identifiant = $1 AND acces_service = true AND actif = true`,
      [identifiant]
    );
    if (!employe || !employe.mot_de_passe || !verifierMotDePasse(motDePasse, employe.mot_de_passe)) {
      await enregistrerTentative(cle);
      return rendreErreur('Identifiant ou mot de passe incorrect.');
    }

    await reinitialiserTentatives(cle);
    await elargirSession(req.session.id, 'serveur', employe.id);
    res.redirect('/service');
  } catch (err) { next(err); }
});

serviceRouter.post('/service/deconnexion', verifierCsrf, async (req, res, next) => {
  try {
    await detruireSession(req.session.id);
    res.clearCookie('sid');
    res.redirect('/service/connexion');
  } catch (err) { next(err); }
});

/** Qui est aux commandes, affiché en haut à droite : sur une tablette
 *  partagée, savoir sous quel compte on saisit évite les quiproquos. */
async function quiSert(req) {
  if (req.session.role === 'admin') return 'Salon';
  const e = await une(`SELECT prenom FROM employes WHERE id = $1`, [req.session.sujetId]);
  return e?.prenom || 'Service';
}

// ── Le plan de salle ───────────────────────────────────────
serviceRouter.get('/service', exigerService, async (req, res, next) => {
  try {
    const date = aujourdHui();
    const service = await serviceDuJour(date);
    const tables = service
      ? await query(
          `SELECT * FROM tables_resto WHERE service_id = $1 AND actif = true ORDER BY position, id`,
          [service.id]
        )
      : [];

    const ouvertes = await query(
      `SELECT tb.*, c.prenom, c.nom AS client_nom, c.telephone_saisi,
              COALESCE(s.total, 0)::int AS total
         FROM tablees tb
         JOIN clients c ON c.id = tb.client_id
         LEFT JOIN (
           SELECT tablee_id, SUM(total_cents)::int AS total
             FROM commandes WHERE statut != 'annulee' GROUP BY tablee_id
         ) s ON s.tablee_id = tb.id
        WHERE tb.statut = 'ouverte'`
    );
    const parTable = new Map(ouvertes.map(t => [t.table_id, t]));

    res.render('service/salle', {
      titre: 'Salle', sousTitre: service ? service.nom : 'Fermé aujourd’hui',
      actif: 'salle', qui: await quiSert(req),
      service, euros, nomTable,
      tables: tables.map(t => ({ ...t, tablee: parTable.get(t.id) || null })),
      ouvertesHorsService: ouvertes.filter(o => !tables.some(t => t.id === o.table_id)),
      info: req.query.info || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** La carte servie en salle. Le drapeau `a_emporter` ne filtre rien ici :
 *  un plat peut être servi à table sans être proposé à l'emporter. */
async function carteComplete() {
  const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
  const plats = await query(`SELECT * FROM plats WHERE visible = true ORDER BY position`);
  return categories
    .map(c => ({ ...c, plats: plats.filter(p => p.categorie_id === c.id) }))
    .filter(c => c.plats.length > 0);
}

/** Relit le panier contre la base : les prix affichés sur la tablette
 *  peuvent dater d'avant un changement de carte. */
async function lirePanier(body) {
  const plats = await query(`SELECT * FROM plats WHERE visible = true`);
  const lignes = [];
  for (const plat of plats) {
    const qte = parseInt(body[`qte_${plat.id}`], 10);
    if (!Number.isInteger(qte) || qte <= 0) continue;
    lignes.push({ plat_id: plat.id, nom: plat.nom, prix_cents: plat.prix_cents, quantite: Math.min(qte, 50) });
  }
  if (!lignes.length) return { erreur: 'Sélectionnez au moins un plat.' };
  return { lignes, total: lignes.reduce((s, l) => s + l.prix_cents * l.quantite, 0) };
}

async function enregistrerCommande(t, { reference, clientId, type, tableeId, date, heure, total, message }) {
  return t.une(
    `INSERT INTO commandes (reference, client_id, type, tablee_id, date, heure, total_cents, message, statut)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmee') RETURNING *`,
    [reference, clientId, type, tableeId, date, heure, total, message]
  );
}

// ── Une table ──────────────────────────────────────────────
async function pageTable(req, res, table, extra = {}) {
  const tablee = await tableeOuverteSurTable(table.id);
  const addition = tablee ? await additionDeTablee(tablee.id) : { commandes: [], total: 0 };
  const client = tablee
    ? await une(`SELECT * FROM clients WHERE id = $1`, [tablee.client_id])
    : null;
  return {
    titre: nomTable(table.nom), sousTitre: `${table.couverts} couverts`,
    actif: 'salle', qui: await quiSert(req),
    table, tablee, addition, client, euros,
    categories: await carteComplete(),
    erreur: null, info: null, valeurs: {},
    csrfToken: res.locals.csrfToken,
    ...extra,
  };
}

serviceRouter.get('/service/table/:id', exigerService, async (req, res, next) => {
  try {
    const table = await une(`SELECT * FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/service');
    res.render('service/table', await pageTable(req, res, table, {
      info: req.query.info || null, erreur: req.query.erreur || null,
    }));
  } catch (err) { next(err); }
});

/** Installe un client à la table, désigné par son numéro. S'il est inconnu,
 *  un prénom suffit à lui ouvrir un compte : il complétera lui-même son
 *  espace plus tard, sur le même numéro, et retrouvera son historique. */
serviceRouter.post('/service/table/:id/client', exigerService, verifierCsrf, async (req, res, next) => {
  try {
    const table = await une(`SELECT * FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/service');

    const telephone = (req.body.telephone || '').trim();
    let client = await clientParTelephone(telephone);
    if (!client) {
      if (!(req.body.prenom || '').trim()) {
        return res.render('service/table', await pageTable(req, res, table, {
          valeurs: req.body,
          info: "Ce numéro n'est pas connu. Ajoutez un prénom pour créer la fiche.",
        }));
      }
      const cree = await creerClientAuComptoir({
        telephone, prenom: req.body.prenom, nom: req.body.nom, email: req.body.email,
      });
      if (cree.erreur) {
        return res.render('service/table', await pageTable(req, res, table, {
          valeurs: req.body, erreur: cree.erreur,
        }));
      }
      client = cree.client;
    }

    const { tablee, erreur } = await ouvrirOuRejoindreTablee(table.id, client.id);
    if (erreur === 'table_occupee') {
      return res.render('service/table', await pageTable(req, res, table, {
        valeurs: req.body,
        erreur: `Cette table est déjà ouverte au nom de ${tablee.prenom}. Encaissez-la avant d'installer quelqu'un d'autre.`,
      }));
    }
    res.redirect(`/service/table/${table.id}?info=` + encodeURIComponent(`${client.prenom} installé·e.`));
  } catch (err) { next(err); }
});

serviceRouter.post('/service/table/:id/commande', exigerService, verifierCsrf, async (req, res, next) => {
  try {
    const table = await une(`SELECT * FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/service');

    const tablee = await tableeOuverteSurTable(table.id);
    if (!tablee) {
      return res.render('service/table', await pageTable(req, res, table, {
        erreur: "Installez d'abord un client à cette table.",
      }));
    }
    const panier = await lirePanier(req.body);
    if (panier.erreur) {
      return res.render('service/table', await pageTable(req, res, table, { erreur: panier.erreur }));
    }

    const reference = genererReference('SUR');
    await transaction(async (t) => {
      const commande = await enregistrerCommande(t, {
        reference, clientId: tablee.client_id, type: 'sur_place', tableeId: tablee.id,
        date: aujourdHui(), heure: maintenant(), total: panier.total,
        message: (req.body.message || '').trim(),
      });
      for (const l of panier.lignes) {
        await t.executer(
          `INSERT INTO commande_lignes (commande_id, plat_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4, $5)`,
          [commande.id, l.plat_id, l.nom, l.prix_cents, l.quantite]
        );
      }
    });

    const nb = panier.lignes.reduce((n, l) => n + l.quantite, 0);
    await notifier({
      type: 'commande',
      titre: `${nomTable(table.nom)} — ${euros(panier.total)}`,
      detail: `${tablee.prenom} · ${nb} article${nb > 1 ? 's' : ''} · saisie en salle`,
      lien: '/salon/tables-clients',
    });

    res.redirect(`/service/table/${table.id}?info=` + encodeURIComponent('Commande envoyée en cuisine.'));
  } catch (err) { next(err); }
});

serviceRouter.post('/service/table/:id/encaisser', exigerService, verifierCsrf, async (req, res, next) => {
  try {
    const table = await une(`SELECT * FROM tables_resto WHERE id = $1`, [req.params.id]);
    if (!table) return res.redirect('/service');
    const tablee = await tableeOuverteSurTable(table.id);
    if (!tablee) return res.redirect(`/service/table/${table.id}`);

    const remise = req.body.cagnotte ? (versCents(req.body.cagnotte) ?? 0) : 0;
    const resultat = await encaisserTablee(tablee.id, { remiseCents: remise });
    if (resultat.erreur) {
      return res.redirect(`/service/table/${table.id}?erreur=` + encodeURIComponent(resultat.erreur));
    }
    const dit = [`Encaissé ${euros(resultat.aPayer)}`];
    if (resultat.remise) dit.push(`dont ${euros(resultat.remise)} de cagnotte`);
    if (resultat.gain) dit.push(`+${euros(resultat.gain)} de fidélité`);
    res.redirect('/service?info=' + encodeURIComponent(dit.join(' · ')));
  } catch (err) { next(err); }
});

// ── À emporter ─────────────────────────────────────────────
async function pageEmporter(req, res, extra = {}) {
  return {
    titre: 'À emporter', sousTitre: 'Commande détachée de toute table',
    actif: 'emporter', qui: await quiSert(req),
    categories: await carteComplete(), euros,
    client: null, erreur: null, info: null, valeurs: {},
    csrfToken: res.locals.csrfToken,
    ...extra,
  };
}

serviceRouter.get('/service/emporter', exigerService, async (req, res, next) => {
  try {
    res.render('service/emporter', await pageEmporter(req, res, {
      info: req.query.info || null,
    }));
  } catch (err) { next(err); }
});

serviceRouter.post('/service/emporter', exigerService, verifierCsrf, async (req, res, next) => {
  try {
    const telephone = (req.body.telephone || '').trim();
    let client = await clientParTelephone(telephone);

    // Étape 1 : identifier. Chercher un numéro ne doit rien envoyer en
    // cuisine, sinon un serveur qui vérifie un compte crée une commande.
    if (req.body.action === 'chercher') {
      return res.render('service/emporter', await pageEmporter(req, res, {
        client, valeurs: req.body,
        info: client ? null : "Numéro inconnu. Ajoutez un prénom pour créer la fiche.",
      }));
    }

    if (!client) {
      if (!(req.body.prenom || '').trim()) {
        return res.render('service/emporter', await pageEmporter(req, res, {
          valeurs: req.body, erreur: 'Indiquez le numéro du client, et un prénom si le numéro est inconnu.',
        }));
      }
      const cree = await creerClientAuComptoir({
        telephone, prenom: req.body.prenom, nom: req.body.nom, email: req.body.email,
      });
      if (cree.erreur) {
        return res.render('service/emporter', await pageEmporter(req, res, {
          valeurs: req.body, erreur: cree.erreur,
        }));
      }
      client = cree.client;
    }

    const panier = await lirePanier(req.body);
    if (panier.erreur) {
      return res.render('service/emporter', await pageEmporter(req, res, {
        client, valeurs: req.body, erreur: panier.erreur,
      }));
    }

    const reference = genererReference('EMP');
    await transaction(async (t) => {
      const commande = await enregistrerCommande(t, {
        reference, clientId: client.id, type: 'emporter', tableeId: null,
        date: aujourdHui(), heure: (req.body.heure || maintenant()).slice(0, 5),
        total: panier.total, message: (req.body.message || '').trim(),
      });
      for (const l of panier.lignes) {
        await t.executer(
          `INSERT INTO commande_lignes (commande_id, plat_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4, $5)`,
          [commande.id, l.plat_id, l.nom, l.prix_cents, l.quantite]
        );
      }
    });

    await notifier({
      type: 'commande',
      titre: `À emporter — ${euros(panier.total)}`,
      detail: `${client.prenom} ${client.nom} · saisie au comptoir · ${reference}`,
      lien: `/salon/commandes?date=${aujourdHui()}`,
    });

    res.redirect('/service/caisse?tel=' + encodeURIComponent(client.telephone_saisi)
      + '&info=' + encodeURIComponent(`Commande ${reference} enregistrée.`));
  } catch (err) { next(err); }
});

// ── La caisse ──────────────────────────────────────────────
/** Un numéro de téléphone, et tout ce qui reste à encaisser pour cette
 *  personne : c'est exactement le geste du comptoir. */
serviceRouter.get('/service/caisse', exigerService, async (req, res, next) => {
  try {
    const telephone = (req.query.tel || '').trim();
    const client = telephone ? await clientParTelephone(telephone) : null;
    const commandes = client
      ? await query(
          `SELECT * FROM commandes
            WHERE client_id = $1 AND type = 'emporter' AND statut NOT IN ('annulee','encaissee')
            ORDER BY date, heure`,
          [client.id]
        )
      : [];

    res.render('service/caisse', {
      titre: 'Caisse', sousTitre: 'Encaisser à emporter',
      actif: 'caisse', qui: await quiSert(req),
      telephone, client, commandes, euros,
      cherche: telephone !== '',
      info: req.query.info || null, erreur: req.query.erreur || null,
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

serviceRouter.post('/service/caisse/:id/encaisser', exigerService, verifierCsrf, async (req, res, next) => {
  try {
    const remise = req.body.cagnotte ? (versCents(req.body.cagnotte) ?? 0) : 0;
    const resultat = await encaisserCommande(req.params.id, { remiseCents: remise });
    const retour = '/service/caisse?tel=' + encodeURIComponent(req.body.telephone || '');
    if (resultat.erreur) return res.redirect(retour + '&erreur=' + encodeURIComponent(resultat.erreur));

    const dit = [`Encaissé ${euros(resultat.aPayer)}`];
    if (resultat.remise) dit.push(`dont ${euros(resultat.remise)} de cagnotte`);
    if (resultat.gain) dit.push(`+${euros(resultat.gain)} de fidélité`);
    res.redirect(retour + '&info=' + encodeURIComponent(dit.join(' · ')));
  } catch (err) { next(err); }
});
