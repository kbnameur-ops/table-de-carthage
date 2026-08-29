import { une, executer } from '../db.js';
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

export async function trouverOuCreerClient(champs) {
  const telephone = normaliserTelephone(champs.telephone);
  const existant = await une(`SELECT * FROM clients WHERE telephone = $1`, [telephone]);

  if (existant) {
    // Un compte ouvert au comptoir par un serveur n'a pas de date de
    // naissance : personne ne l'a encore revendiqué. La première personne
    // qui crée son espace sur ce numéro en prend possession et récupère son
    // historique — sans quoi ces comptes resteraient inaccessibles à vie.
    if (!existant.date_naissance) {
      await executer(`UPDATE clients SET date_naissance = $1 WHERE id = $2`,
        [champs.dateNaissance, existant.id]);
      existant.date_naissance = champs.dateNaissance;
    } else if (existant.date_naissance !== champs.dateNaissance) {
      return { erreur: 'telephone_associe' };
    }
    // Le nom ou l'e-mail a pu changer (mariage, faute de frappe corrigée) :
    // on les met à jour, l'identité reste ancrée sur téléphone + naissance.
    await executer(
      `UPDATE clients SET prenom = $1, nom = $2, email = $3 WHERE id = $4`,
      [champs.prenom.trim(), champs.nom.trim(), champs.email.trim(), existant.id]
    );
    return { client: { ...existant, prenom: champs.prenom.trim(), nom: champs.nom.trim(), email: champs.email.trim() } };
  }

  const cree = await une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [champs.prenom.trim(), champs.nom.trim(), champs.email.trim(), telephone, champs.telephone.trim(), champs.dateNaissance]
  );
  return { client: cree };
}

/** Retrouve un client par son numéro, quelle que soit la façon dont il est
 *  tapé. C'est l'identifiant qui sert en salle et à la caisse : un serveur
 *  ne va pas demander une date de naissance devant la file d'attente. */
export async function clientParTelephone(saisie) {
  const numero = normaliserTelephone(saisie || '');
  if (!numero || numero.length < 6) return null;
  return (await une(`SELECT * FROM clients WHERE telephone = $1`, [numero])) || null;
}

/** Crée le client minimal qu'un serveur peut saisir au vol : un numéro et
 *  un prénom suffisent. La date de naissance reste vide tant que la
 *  personne n'a pas ouvert son espace — elle ne sert qu'à se reconnecter,
 *  et l'exiger au comptoir bloquerait la prise de commande.
 *
 *  Un compte sans date de naissance ne peut pas être pris en main depuis
 *  le site : le client devra la renseigner en créant son espace, sur ce
 *  même numéro, ce qui le rattachera à son historique. */
export async function creerClientAuComptoir({ telephone, prenom, nom = '', email = '' }) {
  const numero = normaliserTelephone(telephone || '');
  if (!telephoneValide(numero)) return { erreur: 'Numéro de téléphone invalide.' };
  if (!texteNonVide(prenom, 80)) return { erreur: 'Indiquez au moins un prénom.' };

  const existant = await une(`SELECT * FROM clients WHERE telephone = $1`, [numero]);
  if (existant) return { client: existant };

  const cree = await une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ($1, $2, $3, $4, $5, '') RETURNING *`,
    [prenom.trim(), (nom || '').trim(), (email || '').trim(), numero, String(telephone).trim()]
  );
  return { client: cree };
}
