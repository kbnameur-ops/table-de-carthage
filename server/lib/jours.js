/** Manipulation des dates métier, toujours en texte ISO 'YYYY-MM-DD'.
 *  Les calculs passent par l'UTC : additionner 24 h à une Date locale
 *  saute ou répète un jour aux changements d'heure, ce qui ferait
 *  disparaître une journée du carnet deux fois par an. */

export const aujourdHui = () => new Date().toISOString().slice(0, 10);

/** Le jour à `decalage` jours d'écart ('2026-08-31', +1) -> '2026-09-01'. */
export function jourVoisin(date, decalage) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
}

/** « aujourd'hui », « demain », « hier », sinon « mardi 1 septembre ». */
export function libelleJour(date) {
  const ajd = aujourdHui();
  if (date === ajd) return "aujourd'hui";
  if (date === jourVoisin(ajd, 1)) return 'demain';
  if (date === jourVoisin(ajd, -1)) return 'hier';
  return new Date(date + 'T00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** Préfixe « Table » seulement si le nom ne le porte pas déjà : le salon
 *  nomme ses tables comme il veut (« Duo 1 », « Table 3 », « Terrasse A »),
 *  et « Table Table 3 » ferait négligé sur un QR collé en salle. */
export function nomTable(nom) {
  if (!nom) return 'Table';
  return /^table\b/i.test(nom.trim()) ? nom : `Table ${nom}`;
}
