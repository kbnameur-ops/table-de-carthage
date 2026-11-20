/** Manipulation des dates métier, toujours en texte ISO 'YYYY-MM-DD'.
 *  Les calculs passent par l'UTC : additionner 24 h à une Date locale
 *  saute ou répète un jour aux changements d'heure, ce qui ferait
 *  disparaître une journée du carnet deux fois par an. */

/* ── L'heure de la salle ───────────────────────────────────────────────
   Le serveur (Vercel) tourne en UTC : une ou deux heures de moins qu'à
   Puteaux selon la saison. Tout ce qui répond à « quel jour sommes-nous ? »
   ou « quelle heure est-il ? » pour le restaurant passe donc par ici, en
   heure de Paris. Sans quoi, à 21 h 15, le site proposait encore un retrait
   à 20 h 30, et à 0 h 30 il croyait être la veille. */
const FUSEAU = 'Europe/Paris';
const formatParis = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function partiesParis(instant = new Date()) {
  return Object.fromEntries(formatParis.formatToParts(instant).map(p => [p.type, p.value]));
}

/** La date du jour à Paris, 'YYYY-MM-DD'. */
export function aujourdHui(instant = new Date()) {
  const p = partiesParis(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** L'heure qu'il est à Paris, 'HH:MM'. */
export function heureParis(instant = new Date()) {
  const p = partiesParis(instant);
  return `${p.hour}:${p.minute}`;
}

/** Vrai si le créneau (date 'YYYY-MM-DD', heure 'HH:MM', heure de Paris)
 *  est déjà commencé ou passé. Les deux formats se comparent comme du
 *  texte, sans passer par un objet Date et son fuseau.
 *
 *  `margeMinutes` avance l'horloge d'autant : avec 30, un créneau qui
 *  commence dans moins de 30 minutes compte comme passé — c'est le délai de
 *  préparation d'une commande à emporter. Passer par un instant décalé (et
 *  non par une addition sur 'HH:MM') gère tout seul le passage de minuit. */
export function creneauPasse(date, heure, instant = new Date(), margeMinutes = 0) {
  const creneau = `${date} ${heure}`;
  const cle = d => `${aujourdHui(d)} ${heureParis(d)}`;
  if (creneau <= cle(instant)) return true;          // commencé ou passé
  if (!margeMinutes) return false;
  // « Au moins 30 minutes » : un créneau pile 30 minutes après reste valable.
  return creneau < cle(new Date(instant.getTime() + margeMinutes * 60000));
}

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

/** La date en toutes lettres, année comprise : « vendredi 3 octobre 2026 ».
 *  Pour une soirée annoncée des mois à l'avance, « vendredi 3 octobre » sans
 *  l'année laisserait un doute que personne n'a envie d'avoir en réservant. */
export function dateLongue(date) {
  return new Date(date + 'T00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
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
