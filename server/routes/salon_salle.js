import { Router } from 'express';
import { une, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide, heureValide } from '../lib/validate.js';
import { etatSalle, creneauxDuService, serviceDuJour } from '../lib/availability.js';

export const salonSalleRouter = Router();

const aujourdHui = () => new Date().toISOString().slice(0, 10);

/** Le créneau le plus proche de l'heure courante, pour que l'écran s'ouvre
 *  déjà sur le service en cours plutôt que sur le premier créneau du midi. */
function creneauParDefaut(creneaux, date) {
  if (!creneaux.length) return null;
  if (date !== aujourdHui()) return creneaux[0];
  const maintenant = new Date();
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  const enCours = creneaux.filter(h => {
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm <= minutes;
  });
  return enCours.length ? enCours[enCours.length - 1] : creneaux[0];
}

salonSalleRouter.get('/salon/salle', exigerAdmin, async (req, res, next) => {
  try {
    const date = dateValide(req.query.date) ? req.query.date : aujourdHui();
    const service = await serviceDuJour(date);
    const creneaux = service ? creneauxDuService(service) : [];
    const heure = heureValide(req.query.heure) && creneaux.includes(req.query.heure)
      ? req.query.heure
      : creneauParDefaut(creneaux, date);

    const salle = heure ? await etatSalle(date, heure) : { service, tables: [] };
    const actives = salle.tables.filter(t => t.actif);
    const occupees = actives.filter(t => t.reservation || t.occupation);
    const couvertsAssis = occupees.reduce(
      (s, t) => s + (t.reservation?.couverts ?? t.occupation?.couverts ?? 0), 0
    );

    res.render('salon/salle', {
      titre: 'Salle', actif: 'salle',
      date, heure, creneaux, service, tables: salle.tables,
      resume: {
        tables: actives.length,
        occupees: occupees.length,
        libres: actives.length - occupees.length,
        couverts: couvertsAssis,
        places: actives.reduce((s, t) => s + t.couverts, 0),
      },
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** Coche une table occupée sur un créneau. Refuse si une réservation y est
 *  déjà placée : le salon ne doit pas pouvoir masquer un client attendu. */
salonSalleRouter.post('/salon/salle/:tableId/occuper', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { date, heure } = req.body;
    if (!dateValide(date) || !heureValide(heure)) return redirigerRetour(req, res, '/salon/salle');

    const prise = await une(
      `SELECT 1 FROM reservations
        WHERE table_id = $1 AND date = $2 AND heure = $3 AND statut NOT IN ('annulee','absente')`,
      [req.params.tableId, date, heure]
    );
    if (prise) return redirigerRetour(req, res, '/salon/salle');

    const couverts = Math.min(Math.max(parseInt(req.body.couverts, 10) || 0, 0), 30);
    await executer(
      `INSERT INTO occupations (table_id, date, heure, couverts, note) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_id, date, heure) DO UPDATE SET couverts = excluded.couverts, note = excluded.note`,
      [req.params.tableId, date, heure, couverts, (req.body.note || '').trim().slice(0, 120)]
    );
    redirigerRetour(req, res, '/salon/salle');
  } catch (err) { next(err); }
});

salonSalleRouter.post('/salon/salle/:tableId/liberer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { date, heure } = req.body;
    if (!dateValide(date) || !heureValide(heure)) return redirigerRetour(req, res, '/salon/salle');
    await executer(
      `DELETE FROM occupations WHERE table_id = $1 AND date = $2 AND heure = $3`,
      [req.params.tableId, date, heure]
    );
    redirigerRetour(req, res, '/salon/salle');
  } catch (err) { next(err); }
});
