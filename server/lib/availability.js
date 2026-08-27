import { une, query } from '../db.js';

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

export async function estFerme(date) {
  return !!(await une(`SELECT 1 FROM fermetures WHERE date = $1`, [date]));
}

/** Le service actif dont le motif de jours contient le jour de la date, ou
 *  null si le restaurant est fermé ce jour-là (pas de service, ou fermeture
 *  exceptionnelle). */
export async function serviceDuJour(date) {
  if (await estFerme(date)) return null;
  const jour = String(jourIso(date));
  const services = await query(
    `SELECT * FROM services WHERE actif = true ORDER BY position, id`
  );
  return services.find(s => s.jours.includes(jour)) || null;
}

/** Les tables d'un service, de la plus petite à la plus grande. L'ordre
 *  compte : l'assignation prend la première qui convient, donc la plus
 *  juste — placer deux personnes sur une table de huit gâcherait la salle. */
export async function tablesDuService(serviceId) {
  return query(
    `SELECT * FROM tables_resto WHERE service_id = $1 AND actif = true
     ORDER BY couverts, position, id`,
    [serviceId]
  );
}

/** Les identifiants des tables déjà prises sur un créneau, quelle qu'en soit
 *  la raison : une réservation encore active, ou une occupation posée à la
 *  main depuis le salon (client sans réservation, table hors service...). */
export async function tablesOccupees(date, heure) {
  const lignes = await query(
    `SELECT table_id FROM reservations
      WHERE date = $1 AND heure = $2 AND table_id IS NOT NULL
        AND statut NOT IN ('annulee', 'absente')
     UNION
     SELECT table_id FROM occupations WHERE date = $1 AND heure = $2`,
    [date, heure]
  );
  return new Set(lignes.map(l => l.table_id));
}

/** La plus petite table libre pouvant asseoir `couverts`, ou null. */
function meilleureTable(tables, occupees, couverts) {
  return tables.find(t => t.couverts >= couverts && !occupees.has(t.id)) || null;
}

/** Vrai si le créneau est déjà passé (aujourd'hui) ou la date révolue. */
function estPasse(date, heure, aujourdHui, maintenant) {
  if (date < aujourdHui) return true;
  if (date !== aujourdHui) return false;
  const [h, m] = heure.split(':').map(Number);
  const creneau = new Date(maintenant);
  creneau.setHours(h, m, 0, 0);
  return creneau <= maintenant;
}

/** Liste les créneaux du service du jour avec leur disponibilité pour une
 *  tablée donnée. Un créneau est disponible s'il reste au moins une table
 *  libre assez grande : la capacité n'est plus un total abstrait, elle
 *  découle des tables réellement configurées dans le salon. */
export async function creneauxDisponibles(date, couverts) {
  const service = await serviceDuJour(date);
  if (!service) return { service: null, creneaux: [] };

  const tables = await tablesDuService(service.id);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const maintenant = new Date();

  const creneaux = await Promise.all(creneauxDuService(service).map(async heure => {
    const occupees = await tablesOccupees(date, heure);
    const table = meilleureTable(tables, occupees, couverts);
    return {
      heure,
      disponible: !!table && !estPasse(date, heure, aujourdHui, maintenant),
      libres: tables.filter(t => !occupees.has(t.id)).length,
    };
  }));

  return { service, creneaux };
}

/** Revalide un créneau au moment de la confirmation et renvoie la table à
 *  lui attribuer : l'affichage peut être périmé de quelques secondes entre
 *  le chargement de la page et l'envoi du formulaire, il ne faut jamais
 *  faire confiance au client sur ce point. */
export async function creneauEncoreValide(date, heure, couverts) {
  const service = await serviceDuJour(date);
  if (!service) return { valide: false, service: null, table: null };

  const aujourdHui = new Date().toISOString().slice(0, 10);
  if (estPasse(date, heure, aujourdHui, new Date())) {
    return { valide: false, service, table: null };
  }
  if (!creneauxDuService(service).includes(heure)) {
    return { valide: false, service, table: null };
  }

  const tables = await tablesDuService(service.id);
  const occupees = await tablesOccupees(date, heure);
  const table = meilleureTable(tables, occupees, couverts);
  return { valide: !!table, service, table };
}

/** État de la salle sur un créneau : chaque table avec ce qui l'occupe.
 *  Alimente l'écran « Salle » du salon, où l'on coche une table occupée. */
export async function etatSalle(date, heure) {
  const service = await serviceDuJour(date);
  if (!service) return { service: null, tables: [] };

  const tables = await query(
    `SELECT * FROM tables_resto WHERE service_id = $1 ORDER BY position, id`,
    [service.id]
  );

  const reservations = await query(
    `SELECT r.table_id, r.id, r.reference, r.couverts, r.statut, c.prenom, c.nom, c.telephone_saisi
       FROM reservations r JOIN clients c ON c.id = r.client_id
      WHERE r.date = $1 AND r.heure = $2 AND r.table_id IS NOT NULL
        AND r.statut NOT IN ('annulee', 'absente')`,
    [date, heure]
  );
  const occupations = await query(
    `SELECT * FROM occupations WHERE date = $1 AND heure = $2`,
    [date, heure]
  );

  const parTable = new Map(reservations.map(r => [r.table_id, r]));
  const occParTable = new Map(occupations.map(o => [o.table_id, o]));

  return {
    service,
    tables: tables.map(t => ({
      ...t,
      reservation: parTable.get(t.id) || null,
      occupation: occParTable.get(t.id) || null,
    })),
  };
}
