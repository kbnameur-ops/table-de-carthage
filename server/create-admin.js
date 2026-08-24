/** Crée ou met à jour un compte du salon.
 *  Usage : node server/create-admin.js "email@exemple.fr" "mot de passe" "Nom affiché"
 *  Pas de création via le site : le premier compte s'obtient en ligne de
 *  commande, sur la machine qui héberge le service — c'est la garantie
 *  qu'un tiers ne peut pas s'auto-inscrire comme administrateur. */
import { db } from './db.js';
import { hacherMotDePasse } from './lib/auth.js';
import { emailValide } from './lib/validate.js';

const [, , email, motDePasse, nom = ''] = process.argv;

if (!email || !motDePasse) {
  console.error('Usage : node server/create-admin.js "email@exemple.fr" "mot de passe" ["Nom affiché"]');
  process.exit(1);
}
if (!emailValide(email)) {
  console.error(`Adresse invalide : ${email}`);
  process.exit(1);
}
if (motDePasse.length < 10) {
  console.error('Le mot de passe doit faire au moins 10 caractères.');
  process.exit(1);
}

const empreinte = hacherMotDePasse(motDePasse);
const existant = db.prepare(`SELECT id FROM admins WHERE email = ?`).get(email);

if (existant) {
  db.prepare(`UPDATE admins SET mot_de_passe = ?, nom = ? WHERE id = ?`).run(empreinte, nom, existant.id);
  console.log(`✓ Mot de passe mis à jour pour ${email}`);
} else {
  db.prepare(`INSERT INTO admins (email, mot_de_passe, nom) VALUES (?, ?, ?)`).run(email, empreinte, nom);
  console.log(`✓ Compte créé pour ${email}`);
}
