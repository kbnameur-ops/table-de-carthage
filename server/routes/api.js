import { Router } from 'express';
import { creneauxDisponibles, serviceDuJour, creneauxDuService } from '../lib/availability.js';
import { dateValide } from '../lib/validate.js';
import { aujourdHui, creneauPasse } from '../lib/jours.js';

export const api = Router();

api.get('/disponibilites', async (req, res, next) => {
  try {
    const { date, couverts } = req.query;
    const n = parseInt(couverts, 10);
    if (!dateValide(date) || !Number.isInteger(n) || n < 1 || n > 30) {
      return res.status(400).json({ erreur: 'Paramètres invalides' });
    }
    const { service, creneaux } = await creneauxDisponibles(date, n);
    res.json({ service: service ? { id: service.id, nom: service.nom } : null, creneaux });
  } catch (err) { next(err); }
});

/** Les créneaux de retrait suivent les horaires d'ouverture, sans contrainte
 *  de couverts ni de tables : une commande à emporter n'occupe pas de place. */
api.get('/horaires-retrait', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!dateValide(date)) return res.status(400).json({ erreur: 'Date invalide' });
    const service = await serviceDuJour(date);
    if (!service) return res.json({ creneaux: [], ferme: true });

    // Heure de Paris, pas celle du serveur (UTC) : voir lib/jours.js. Le
    // délai de préparation du service écarte les créneaux trop proches.
    const delai = service.delai_retrait_minutes ?? 0;
    const creneaux = date < aujourdHui()
      ? []
      : creneauxDuService(service).filter(h => !creneauPasse(date, h, new Date(), delai));
    res.json({ creneaux, delai });
  } catch (err) { next(err); }
});
