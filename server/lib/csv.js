/** Fabrique un CSV pensé pour s'ouvrir en double-clic dans Excel en
 *  français : séparateur point-virgule (la virgule sert de décimale côté
 *  français), et un BOM UTF-8 en tête — sans lui, Excel lit les accents
 *  comme du latin-1 et « décaissée » devient « dÃ©caissÃ©e ». */

const SEPARATEUR = ';';
const BOM = '﻿';

/** Un caractère en tête de cellule (=, +, -, @) est lu par Excel comme le
 *  début d'une formule. Rien dans ce projet ne laisse un client écrire
 *  directement dans un champ exporté, mais l'échapper ne coûte rien et
 *  évite qu'un nom d'employé mal choisi ne devienne une formule au
 *  prochain export. */
function cellule(valeur) {
  if (valeur === null || valeur === undefined) return '';
  let s = String(valeur);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[";\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** `lignes` : tableau d'objets. `colonnes` : [{ cle, titre }] dans l'ordre
 *  voulu — l'ordre des clés d'un objet JS n'est pas un contrat, l'appelant
 *  doit le dire explicitement. */
export function versCsv(colonnes, lignes) {
  const entete = colonnes.map(c => cellule(c.titre)).join(SEPARATEUR);
  const corps = lignes.map(l => colonnes.map(c => cellule(l[c.cle])).join(SEPARATEUR));
  return BOM + [entete, ...corps].join('\r\n') + '\r\n';
}

/** Centimes vers un nombre décimal à la française (virgule), pour une
 *  colonne qu'Excel doit pouvoir sommer sans retraitement. */
export function nombreCsv(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}
