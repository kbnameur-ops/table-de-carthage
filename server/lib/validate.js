export function emailValide(saisie) {
  return typeof saisie === 'string' &&
    saisie.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saisie.trim());
}

export function dateValide(saisie) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie)) return false;
  const d = new Date(saisie + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === saisie;
}

export function heureValide(saisie) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(saisie);
}

export function texteNonVide(saisie, max = 200) {
  return typeof saisie === 'string' && saisie.trim().length > 0 && saisie.trim().length <= max;
}

/** Un client doit avoir au moins 13 ans et être né après 1900 : filtre les
 *  fautes de frappe grossières sans être un contrôle d'âge légal strict. */
export function dateNaissanceValide(saisie) {
  if (!dateValide(saisie)) return false;
  const naissance = new Date(saisie + 'T00:00:00Z');
  const il_y_a_13_ans = new Date();
  il_y_a_13_ans.setFullYear(il_y_a_13_ans.getFullYear() - 13);
  return naissance.getFullYear() >= 1900 && naissance <= il_y_a_13_ans;
}

export function echapperHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
