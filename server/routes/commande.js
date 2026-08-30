import { Router } from 'express';
import { query, une, transaction } from '../db.js';
import { dateValide } from '../lib/validate.js';
import { serviceDuJour, creneauxDuService } from '../lib/availability.js';
import { validerIdentite, trouverOuCreerClient } from '../lib/clients.js';
import { genererReference } from '../lib/reference.js';
import { euros } from '../lib/money.js';
import { verifierCsrf } from '../middleware.js';
import { enregistrerTentative, tropDeTentatives } from '../lib/auth.js';
import { notifier, quand } from '../lib/notifications.js';
import { paiementDisponible } from '../lib/paiement.js';
import { clientDeSession, connecterDepuisTunnel, quitterIdentite } from '../lib/tunnel-identite.js';

const MAX_SOUMISSIONS_15MIN = 20;

export const commandeRouter = Router();
const aujourdHui = () => new Date().toISOString().slice(0, 10);

async function chargerCarte() {
  const categories = await query(`SELECT * FROM categories WHERE visible = true ORDER BY position`);
  const plats = await query(`SELECT * FROM plats WHERE visible = true AND a_emporter = true ORDER BY position`);
  return categories
    .map(cat => ({ ...cat, plats: plats.filter(p => p.categorie_id === cat.id) }))
    .filter(cat => cat.plats.length > 0);
}

/** Revalide entièrement le panier côté serveur : quantités, existence et
 *  disponibilité des plats, prix recalculé depuis la base (jamais depuis
 *  ce que le client a soumis). */
async function validerPanier(body) {
  const plats = await query(`SELECT * FROM plats WHERE visible = true AND a_emporter = true`);
  const lignes = [];
  for (const plat of plats) {
    const brut = body[`qte_${plat.id}`];
    const qte = parseInt(brut, 10);
    if (!brut || Number.isNaN(qte) || qte <= 0) continue;
    if (qte > 20) return { erreur: 'Quantité trop élevée pour un plat.' };
    lignes.push({ plat_id: plat.id, nom: plat.nom, prix_cents: plat.prix_cents, quantite: qte });
  }
  if (!lignes.length) return { erreur: 'Votre panier est vide.' };
  const total = lignes.reduce((s, l) => s + l.prix_cents * l.quantite, 0);
  return { lignes, total };
}

/** Les quantités déjà saisies, extraites du corps de la requête, pour que
 *  le panier survive à un réaffichage (erreur, connexion, changement de
 *  compte) sans que le client ait à le recomposer. */
function quantitesSoumises(body) {
  return Object.fromEntries(
    Object.entries(body)
      .filter(([k]) => k.startsWith('qte_'))
      .map(([k, v]) => [k.slice(4), v])
  );
}

async function pageCommande(req, res, extra = {}) {
  const valeurs = extra.valeurs ? { ...extra.valeurs, quantites: quantitesSoumises(extra.valeurs) } : {};
  return {
    categories: await chargerCarte(), euros,
    erreurGenerale: null, erreurs: {}, erreurConnexion: null,
    aujourdHui: aujourdHui(),
    client: await clientDeSession(req.session),
    session: req.session, csrfToken: res.locals.csrfToken,
    ...extra,
    valeurs,
  };
}

commandeRouter.get('/commander', async (req, res, next) => {
  try {
    res.render('commande', await pageCommande(req, res));
  } catch (err) { next(err); }
});

commandeRouter.post('/commander', verifierCsrf, async (req, res, next) => {
  try {
    const b = req.body;
    const erreurs = {};

    // Se reconnaître ou changer de compte ne valide pas la commande : on
    // réaffiche la page, panier et heure de retrait conservés.
    if (b.action === 'connexion') {
      const { erreur } = await connecterDepuisTunnel(b, req.session, req.ip);
      return res.render('commande', await pageCommande(req, res, { valeurs: b, erreurConnexion: erreur || null }));
    }
    if (b.action === 'changer') {
      await quitterIdentite(req.session);
      return res.render('commande', await pageCommande(req, res, { valeurs: b }));
    }

    // Même limite de débit que /reserver, et pour les mêmes raisons.
    const cleDebit = `commander:${req.ip}`;
    if (await tropDeTentatives(cleDebit, MAX_SOUMISSIONS_15MIN)) {
      return res.render('commande', await pageCommande(req, res, {
        valeurs: b,
        erreurGenerale: 'Trop de demandes depuis cette connexion. Merci de réessayer dans quelques minutes, ou de nous appeler directement.',
      }));
    }
    await enregistrerTentative(cleDebit);

    if (!dateValide(b.date) || b.date < aujourdHui()) erreurs.date = 'Date invalide.';

    let service = null;
    if (!erreurs.date) {
      service = await serviceDuJour(b.date);
      if (!service) {
        erreurs.date = 'Le restaurant est fermé ce jour-là.';
      } else {
        const creneaux = creneauxDuService(service);
        if (!creneaux.includes(b.heure)) erreurs.heure = 'Horaire de retrait invalide.';
        if (b.date === aujourdHui() && !erreurs.heure) {
          const [hh, mm] = b.heure.split(':').map(Number);
          const t = new Date(); t.setHours(hh, mm, 0, 0);
          if (t <= new Date()) erreurs.heure = 'Cet horaire est déjà passé.';
        }
      }
    }

    // Comme sur /reserver : un client connecté est déjà identifié, ses
    // champs d'identité ne sont ni demandés ni relus.
    const clientConnecte = await clientDeSession(req.session);
    if (!clientConnecte) Object.assign(erreurs, validerIdentite(b));

    const panier = await validerPanier(b);
    if (panier.erreur) erreurs.panier = panier.erreur;

    if (Object.keys(erreurs).length) {
      return res.render('commande', await pageCommande(req, res, { erreurs, valeurs: b }));
    }

    let client = clientConnecte;
    if (!client) {
      const trouve = await trouverOuCreerClient(b);
      if (trouve.erreur === 'telephone_associe') {
        return res.render('commande', await pageCommande(req, res, {
          valeurs: b,
          erreurGenerale: "Ce numéro de téléphone est déjà associé à un compte. Connectez-vous ci-dessus avec votre date de naissance, ou contactez-nous.",
        }));
      }
      client = trouve.client;
    }

    const reference = genererReference('CMD');
    // Tant que le paiement en ligne n'est pas activé, rien ne change : la
    // commande part directement en cuisine comme avant. Une fois les clés
    // Stripe posées, elle attend son empreinte en 'a_payer' — statut que la
    // cuisine ignore — et n'en sort qu'une fois la carte enregistrée.
    const aRegler = paiementDisponible();
    await transaction(async (t) => {
      const commande = await t.une(
        `INSERT INTO commandes (reference, client_id, date, heure, total_cents, message, statut)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [reference, client.id, b.date, b.heure, panier.total, (b.message || '').trim(),
         aRegler ? 'a_payer' : 'en_attente']
      );
      for (const l of panier.lignes) {
        await t.executer(
          `INSERT INTO commande_lignes (commande_id, plat_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4, $5)`,
          [commande.id, l.plat_id, l.nom, l.prix_cents, l.quantite]
        );
      }
    });

    // Une commande pas encore payée ne réveille personne au salon : la
    // notification part du webhook, quand l'empreinte est prise. Sans quoi
    // chaque panier abandonné à l'écran de paiement sonnerait en cuisine.
    if (!aRegler) {
      const nbPlats = panier.lignes.reduce((n, l) => n + l.quantite, 0);
      await notifier({
        type: 'commande',
        titre: `Nouvelle commande — ${euros(panier.total)}`,
        detail: `${client.prenom} ${client.nom} · retrait ${quand(b.date, b.heure)} · ${nbPlats} article${nbPlats > 1 ? 's' : ''} · ${client.telephone_saisi}`,
        lien: `/salon/commandes?date=${b.date}`,
      });
    }

    res.redirect(aRegler
      ? `/paiement/${encodeURIComponent(reference)}`
      : `/commander/confirmation?ref=${encodeURIComponent(reference)}`);
  } catch (err) { next(err); }
});

commandeRouter.get('/commander/confirmation', async (req, res, next) => {
  try {
    const commande = await une(`SELECT * FROM commandes WHERE reference = $1`, [req.query.ref || '']);
    if (!commande) return res.redirect('/commander');
    const lignes = await query(`SELECT * FROM commande_lignes WHERE commande_id = $1`, [commande.id]);
    const dateLisible = new Date(commande.date + 'T00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    res.render('commande-confirmee', { commande, lignes, dateLisible, euros, session: req.session, csrfToken: res.locals.csrfToken });
  } catch (err) { next(err); }
});
