import { Router } from 'express';
import { creneauxDisponibles, serviceDuJour, creneauxDuService } from '../lib/availability.js';
import { dateValide } from '../lib/validate.js';

export const api = Router();

api.get('/disponibilites', (req, res) => {
  const { date, couverts } = req.query;
  const n = parseInt(couverts, 10);
  if (!dateValide(date) || !Number.isInteger(n) || n < 1 || n > 30) {
    return res.status(400).json({ erreur: 'Paramètres invalides' });
  }
  const { service, creneaux } = creneauxDisponibles(date, n);
  res.json({ service: service ? { id: service.id, nom: service.nom } : null, creneaux });
});

/** Les créneaux de retrait suivent les horaires d'ouverture, sans contrainte
 *  de couverts ni de tables : une commande à emporter n'occupe pas de place. */
api.get('/horaires-retrait', (req, res) => {
  const { date } = req.query;
  if (!dateValide(date)) return res.status(400).json({ erreur: 'Date invalide' });
  const service = serviceDuJour(date);
  if (!service) return res.json({ creneaux: [] });

  const aujourdHui = new Date().toISOString().slice(0, 10);
  let creneaux = creneauxDuService(service);
  if (date === aujourdHui) {
    const maintenant = new Date();
    creneaux = creneaux.filter(h => {
      const [hh, mm] = h.split(':').map(Number);
      const t = new Date(); t.setHours(hh, mm, 0, 0);
      return t > maintenant;
    });
  } else if (date < aujourdHui) {
    creneaux = [];
  }
  res.json({ creneaux });
});
