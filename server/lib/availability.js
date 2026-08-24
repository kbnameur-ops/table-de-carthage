import { db } from '../db.js';

/** Génère les créneaux d'un service, toutes les `pas_minutes`, en excluant
 *  le dernier créneau s'il ne laisse pas au moins un pas avant la fermeture. */
export function creneauxDuService(service) {
  const [hd, md] = service.debut.split(':').map(Number);
  const [hf, mf] = service.fin.split(':').map(Number);
  const debut = hd * 60 + md;
  const fin = hf * 60 + mf;
  const creneaux = [];
  for (let t = debut; t < fin; t += service.pas_minutes) {
    creneaux.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return creneaux;
}

/** 1 = lundi ... 7 = dimanche, comme Date#getDay() ajusté (0 = dimanche). */
function jourIso(date) {
  const jour = new Date(date + 'T00:00:00Z').getUTCDay();
  return jour === 0 ? 7 : jour;
}

export function estFerme(date) {
  return !!db.prepare(`SELECT 1 FROM fermetures WHERE date = ?`).get(date);
}

/** Le service actif dont le motif de jours contient le jour de la date, ou
 *  null si le restaurant est fermé ce jour-là (pas de service, ou fermeture
 *  exceptionnelle). */
export function serviceDuJour(date) {
  if (estFerme(date)) return null;
  const jour = String(jourIso(date));
  const services = db.prepare(
    `SELECT * FROM services WHERE actif = 1 ORDER BY position, id`
  ).all();
  return services.find(s => s.jours.includes(jour)) || null;
}

/** Couverts déjà réservés et nombre de réservations (tables) prises sur un
 *  service+date+heure donnés. Les réservations annulées ne comptent pas. */
function occupation(serviceId, date, heure) {
  return db.prepare(
    `SELECT COALESCE(SUM(couverts), 0) AS couverts, COUNT(*) AS tables
     FROM reservations
     WHERE service_id = ? AND date = ? AND heure = ? AND statut NOT IN ('annulee', 'absente')`
  ).get(serviceId, date, heure);
}

/** Liste les créneaux du service du jour avec leur disponibilité, pour une
 *  taille de tablée donnée. Un créneau est disponible si la table ET les
 *  couverts restants suffisent : ce sont deux limites indépendantes. */
export function creneauxDisponibles(date, couverts) {
  const service = serviceDuJour(date);
  if (!service) return { service: null, creneaux: [] };

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const maintenant = new Date();

  const creneaux = creneauxDuService(service).map(heure => {
    const occ = occupation(service.id, date, heure);
    const placeTable = occ.tables < service.tables_total;
    const placeCouverts = occ.couverts + couverts <= service.couverts_total;

    let passe = false;
    if (date === aujourdHui) {
      const [h, m] = heure.split(':').map(Number);
      const creneauDate = new Date(maintenant);
      creneauDate.setHours(h, m, 0, 0);
      passe = creneauDate <= maintenant;
    } else if (date < aujourdHui) {
      passe = true;
    }

    return { heure, disponible: placeTable && placeCouverts && !passe };
  });

  return { service, creneaux };
}

/** Revalide un créneau au moment de la confirmation : l'affichage peut être
 *  périmé de quelques secondes entre le chargement de la page et l'envoi
 *  du formulaire, il ne faut jamais faire confiance au client sur ce point. */
export function creneauEncoreValide(date, heure, couverts) {
  const { service, creneaux } = creneauxDisponibles(date, couverts);
  if (!service) return { valide: false, service: null };
  const trouve = creneaux.find(c => c.heure === heure);
  return { valide: !!trouve?.disponible, service };
}
