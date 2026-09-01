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

/** Comme `libelleJour`, mais assez court pour tenir dans une colonne de
 *  tableau sur un téléphone : « aujourd'hui », « demain », sinon
 *  « 1 sept. ». L'année n'apparaît que si ce n'est pas l'année en cours —
 *  la préciser tous les jours de l'année ne renseigne personne, l'omettre
 *  sur une commande de l'an dernier induirait en erreur.
 *
 *  Une date ISO brute (« 2026-09-01 ») n'a rien à faire sous les yeux d'un
 *  client : c'est notre format de stockage, pas sa façon de lire un jour. */
export function libelleJourCourt(date) {
  const ajd = aujourdHui();
  if (date === ajd) return "aujourd'hui";
  if (date === jourVoisin(ajd, 1)) return 'demain';
  if (date === jourVoisin(ajd, -1)) return 'hier';
  const options = { day: 'numeric', month: 'short' };
  if (date.slice(0, 4) !== ajd.slice(0, 4)) options.year = 'numeric';
  return new Date(date + 'T00:00').toLocaleDateString('fr-FR', options);
}

/** Préfixe « Table » seulement si le nom ne le porte pas déjà : le salon
 *  nomme ses tables comme il veut (« Duo 1 », « Table 3 », « Terrasse A »),
 *  et « Table Table 3 » ferait négligé sur un QR collé en salle. */
export function nomTable(nom) {
  if (!nom) return 'Table';
  return /^table\b/i.test(nom.trim()) ? nom : `Table ${nom}`;
}
