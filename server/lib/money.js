/** Un montant ne doit jamais transiter en flottant : 0.1 + 0.2 ne fait pas 0.3.
 *  On travaille en centimes (entiers) partout, et on ne convertit en euros
 *  qu'à l'affichage. */

export function euros(cents) {
  return (cents / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }) + ' €';
}

/** Accepte "16,50", "16.50", "16" ou un nombre ; rejette tout le reste. */
export function versCents(saisie) {
  const texte = String(saisie).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(texte)) return null;
  return Math.round(parseFloat(texte) * 100);
}
