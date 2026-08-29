import { une } from '../db.js';
import {
  verifierMotDePasse, elargirSession,
  enregistrerTentative, tropDeTentatives, reinitialiserTentatives, MINUTES_BLOCAGE,
} from './auth.js';

/** La connexion du personnel, partagée par la salle et la cuisine.
 *
 *  Les deux écrans ont leur propre porte d'entrée — un commis épingle
 *  « Cuisine » et doit rester dans /cuisine, sinon l'application quitte sa
 *  portée et s'ouvre dans un onglet de navigateur — mais ils vérifient le
 *  même mot de passe contre la même table. Une seule copie de cette
 *  vérification, donc : deux formulaires, un seul verrou. */
export async function connecterPersonnel(req, { identifiant, motDePasse }) {
  identifiant = (identifiant || '').trim().toLowerCase();
  motDePasse = motDePasse || '';
  if (!identifiant || !motDePasse) {
    return { erreur: 'Identifiant et mot de passe requis.', identifiant };
  }

  const cle = `serveur:${identifiant}:${req.ip}`;
  if (await tropDeTentatives(cle)) {
    return { erreur: `Trop de tentatives. Réessayez dans ${MINUTES_BLOCAGE} minutes.`, identifiant };
  }

  const employe = await une(
    `SELECT * FROM employes
      WHERE identifiant = $1 AND actif = true
        AND (acces_service = true OR acces_cuisine = true)`,
    [identifiant]
  );
  if (!employe || !employe.mot_de_passe || !verifierMotDePasse(motDePasse, employe.mot_de_passe)) {
    await enregistrerTentative(cle);
    return { erreur: 'Identifiant ou mot de passe incorrect.', identifiant };
  }

  await reinitialiserTentatives(cle);
  await elargirSession(req.session.id, 'serveur', employe.id);
  return { employe };
}

/** Où atterrit un employé qui vient de se connecter. Depuis la porte de la
 *  cuisine on reste en cuisine ; depuis celle de la salle, un commis qui n'a
 *  que le passe file au passe plutôt que sur un plan de salle où il n'a rien
 *  à faire. */
export function apresConnexion(employe, depuis = 'service') {
  if (depuis === 'cuisine' && employe.acces_cuisine) return '/cuisine';
  return employe.acces_service ? '/service' : '/cuisine';
}

/** Où renvoyer quelqu'un déjà connecté qui retombe sur une porte d'entrée,
 *  ou `null` s'il vaut mieux lui montrer le formulaire.
 *
 *  Les droits sont relus ici, et c'est tout l'intérêt : renvoyer aveuglément
 *  vers l'écran de la porte fait rebondir sans fin un commis de cuisine qui
 *  suit un lien vers la salle — la porte l'envoie au plan de salle, le plan
 *  de salle le renvoie à la porte, et le navigateur finit par abandonner. */
export async function dejaConnecte(req, depuis) {
  if (req.session.role === 'admin') return depuis === 'cuisine' ? '/cuisine' : '/service';
  if (req.session.role !== 'serveur') return null;

  const e = await une(
    `SELECT acces_service, acces_cuisine FROM employes WHERE id = $1 AND actif = true`,
    [req.session.sujetId]
  );
  // Fiche désactivée ou accès retirés depuis le salon : qu'il se reconnecte.
  if (!e) return null;
  if (depuis === 'cuisine' && e.acces_cuisine) return '/cuisine';
  if (depuis === 'service' && e.acces_service) return '/service';
  // Connecté, mais pas pour cet écran-là : on l'emmène au sien.
  if (e.acces_service) return '/service';
  if (e.acces_cuisine) return '/cuisine';
  return null;
}
