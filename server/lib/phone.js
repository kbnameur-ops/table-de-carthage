/** Normalise un numéro français pour en faire une clé stable :
 *  "06 12 34 56 78", "0612345678" et "+33 6 12 34 56 78" doivent
 *  tous désigner le même client. On ne garde que les chiffres, et
 *  un 0 initial est réécrit en 33. */
export function normaliserTelephone(saisie) {
  const chiffres = String(saisie).replace(/\D/g, '');
  if (chiffres.startsWith('0') && chiffres.length === 10) {
    return '33' + chiffres.slice(1);
  }
  if (chiffres.startsWith('33') && chiffres.length === 11) {
    return chiffres;
  }
  return chiffres;
}

export function telephoneValide(saisie) {
  const n = normaliserTelephone(saisie);
  return /^33[1-9]\d{8}$/.test(n);
}
