import { Router } from 'express';
import { une, executer, query } from '../db.js';
import { normaliserTelephone } from '../lib/phone.js';
import { dateValide } from '../lib/validate.js';
import { euros } from '../lib/money.js';
import {
  elargirSession, detruireSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from '../lib/auth.js';
import { exigerClient, verifierCsrf } from '../middleware.js';
import { notifier, quand } from '../lib/notifications.js';
import { tableeOuverteDuClient, additionDeTablee } from '../lib/tablees.js';

export const compteRouter = Router();

const LIBELLES_RESA = {
  en_attente: 'En attente', confirmee: 'Confirmée', honoree: 'Honorée',
  annulee: 'Annulée', absente: 'Non présenté',
};
const LIBELLES_CMD = {
  en_attente: 'En attente', confirmee: 'Confirmée', prete: 'Prête',
  retiree: 'Retirée', annulee: 'Annulée',
};

compteRouter.get('/compte/connexion', (req, res) => {
  if (req.session.role === 'client') return res.redirect('/compte');
  res.render('compte-connexion', { erreurGenerale: null, valeurs: {}, session: req.session, csrfToken: res.locals.csrfToken });
});

compteRouter.post('/compte/connexion', verifierCsrf, async (req, res, next) => {
  try {
    const { telephone, dateNaissance } = req.body;
    const rendreErreur = (msg) => res.render('compte-connexion', {
      erreurGenerale: msg, valeurs: req.body, session: req.session, csrfToken: res.locals.csrfToken,
    });

    if (!telephone || !dateValide(dateNaissance)) {
      return rendreErreur('Merci de renseigner un numéro de téléphone et une date de naissance valides.');
    }

    const num = normaliserTelephone(telephone);
    const cle = `client:${num}:${req.ip}`;
    if (await tropDeTentatives(cle)) {
      return rendreErreur(`Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`);
    }

    const client = await une(`SELECT * FROM clients WHERE telephone = $1`, [num]);
    if (!client || client.date_naissance !== dateNaissance) {
      await enregistrerTentative(cle);
      return rendreErreur('Numéro de téléphone ou date de naissance incorrects.');
    }

    await reinitialiserTentatives(cle);
    await elargirSession(req.session.id, 'client', client.id);
    res.redirect('/compte');
  } catch (err) { next(err); }
});

compteRouter.get('/compte', exigerClient, async (req, res, next) => {
  try {
    const client = await une(`SELECT * FROM clients WHERE id = $1`, [req.clientId]);
    if (!client) { await detruireSession(req.session.id); return res.redirect('/compte/connexion'); }

    const aujourdHui = new Date().toISOString().slice(0, 10);
    const reservationsBrutes = await query(
      `SELECT * FROM reservations WHERE client_id = $1 ORDER BY date DESC, heure DESC`, [client.id]
    );
    const reservations = reservationsBrutes.map(r => ({
      ...r,
      annulable: r.statut !== 'annulee' && r.statut !== 'honoree' && r.date >= aujourdHui,
    }));
    const commandesBrutes = await query(
      `SELECT * FROM commandes WHERE client_id = $1 ORDER BY date DESC, heure DESC`, [client.id]
    );
    // Les deux circuits ne se mélangent pas dans l'affichage : une commande
    // à emporter s'annule et se retire, une commande servie à table fait
    // partie d'une addition en cours.
    const commandes = commandesBrutes
      .filter(c => c.type !== 'sur_place')
      .map(c => ({
        ...c,
        annulable: c.statut !== 'annulee' && c.statut !== 'retiree' && c.date >= aujourdHui,
      }));

    // Si le client est attablé, son addition en cours passe devant tout le
    // reste : c'est ce qu'il vient consulter pendant le repas.
    const tablee = await tableeOuverteDuClient(client.id);
    const addition = tablee ? await additionDeTablee(tablee.id) : null;

    res.render('compte-tableau', {
      client, reservations, commandes, tablee, addition, euros,
      libellesStatutResa: LIBELLES_RESA, libellesStatutCmd: LIBELLES_CMD,
      message: req.query.msg || null,
      session: req.session, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

compteRouter.post('/compte/reservations/:id/annuler', exigerClient, verifierCsrf, async (req, res, next) => {
  try {
    // RETURNING ne renvoie une ligne que si l'annulation a bien eu lieu :
    // on ne notifie donc pas pour un identifiant qui n'appartient pas au
    // client, ou pour une réservation déjà annulée.
    const annulee = await une(
      `UPDATE reservations SET statut = 'annulee'
        WHERE id = $1 AND client_id = $2 AND statut NOT IN ('annulee','honoree')
        RETURNING reference, date, heure, couverts`,
      [req.params.id, req.clientId]
    );
    if (annulee) {
      const client = await une(`SELECT prenom, nom FROM clients WHERE id = $1`, [req.clientId]);
      await notifier({
        type: 'annulation_reservation',
        titre: `Réservation annulée — ${annulee.couverts} couvert${annulee.couverts > 1 ? 's' : ''}`,
        detail: `${client.prenom} ${client.nom} · ${quand(annulee.date, annulee.heure)} · ${annulee.reference}`,
        lien: `/salon/reservations?date=${annulee.date}`,
      });
    }
    res.redirect('/compte?msg=' + encodeURIComponent('Réservation annulée.'));
  } catch (err) { next(err); }
});

compteRouter.post('/compte/commandes/:id/annuler', exigerClient, verifierCsrf, async (req, res, next) => {
  try {
    const annulee = await une(
      `UPDATE commandes SET statut = 'annulee'
        WHERE id = $1 AND client_id = $2 AND statut NOT IN ('annulee','retiree')
        RETURNING reference, date, heure, total_cents`,
      [req.params.id, req.clientId]
    );
    if (annulee) {
      const client = await une(`SELECT prenom, nom FROM clients WHERE id = $1`, [req.clientId]);
      await notifier({
        type: 'annulation_commande',
        titre: `Commande annulée — ${euros(annulee.total_cents)}`,
        detail: `${client.prenom} ${client.nom} · retrait ${quand(annulee.date, annulee.heure)} · ${annulee.reference}`,
        lien: `/salon/commandes?date=${annulee.date}`,
      });
    }
    res.redirect('/compte?msg=' + encodeURIComponent('Commande annulée.'));
  } catch (err) { next(err); }
});

compteRouter.post('/compte/deconnexion', verifierCsrf, async (req, res, next) => {
  try {
    await detruireSession(req.session.id);
    res.clearCookie('sid');
    res.redirect('/'); // le middleware attribuera une nouvelle session invité à la requête suivante
  } catch (err) { next(err); }
});
