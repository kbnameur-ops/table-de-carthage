import { db } from '../db.js';
import { normaliserTelephone, telephoneValide } from './phone.js';
import { emailValide, dateNaissanceValide, texteNonVide } from './validate.js';

/** Valide un formulaire d'identification (nom, prénom, e-mail, téléphone,
 *  date de naissance), puis retrouve le client existant par téléphone ou
 *  en crée un nouveau. Si le téléphone est déjà connu mais que la date de
 *  naissance ne correspond pas, refuse : sinon n'importe qui connaissant
 *  le numéro d'un client pourrait rattacher des commandes à son compte. */
export function validerIdentite(champs) {
  const erreurs = {};
  if (!texteNonVide(champs.prenom, 80)) erreurs.prenom = 'Prénom requis.';
  if (!texteNonVide(champs.nom, 80)) erreurs.nom = 'Nom requis.';
  if (!emailValide(champs.email)) erreurs.email = 'E-mail invalide.';
  if (!telephoneValide(champs.telephone)) erreurs.telephone = 'Numéro de téléphone invalide.';
  if (!dateNaissanceValide(champs.dateNaissance)) erreurs.dateNaissance = 'Date de naissance invalide.';
  return erreurs;
}

export function trouverOuCreerClient(champs) {
  const telephone = normaliserTelephone(champs.telephone);
  const existant = db.prepare(`SELECT * FROM clients WHERE telephone = ?`).get(telephone);

  if (existant) {
    if (existant.date_naissance !== champs.dateNaissance) {
      return { erreur: 'telephone_associe' };
    }
    // Le nom ou l'e-mail a pu changer (mariage, faute de frappe corrigée) :
    // on les met à jour, l'identité reste ancrée sur téléphone + naissance.
    db.prepare(
      `UPDATE clients SET prenom = ?, nom = ?, email = ? WHERE id = ?`
    ).run(champs.prenom.trim(), champs.nom.trim(), champs.email.trim(), existant.id);
    return { client: { ...existant, prenom: champs.prenom.trim(), nom: champs.nom.trim(), email: champs.email.trim() } };
  }

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(champs.prenom.trim(), champs.nom.trim(), champs.email.trim(), telephone, champs.telephone.trim(), champs.dateNaissance);

  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(lastInsertRowid);
  return { client };
}
