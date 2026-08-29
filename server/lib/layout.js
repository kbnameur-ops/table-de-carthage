/** Rend l'en-tête et le pied de page en dehors du moteur de gabarits, plutôt
 *  que via <%- include(...) %> à l'exécution.
 *
 *  Pourquoi : sur ce projet, un gabarit qui combine un <%- include(...) %>
 *  avec une boucle .forEach() contenant elle-même un <% if %> déclenche de
 *  façon reproductible une erreur « include is not a function » dès que la
 *  boucle itère au moins une fois — mais seulement dans certaines
 *  combinaisons de contenu autour de l'appel, pas dans d'autres (constaté
 *  sur EJS 3.1.10 / Node 22.22.2). Tout pointe vers une interaction entre le
 *  `with(locals)` généré par EJS et les fermetures créées par les callbacks
 *  de forEach, plutôt qu'une erreur dans nos gabarits : les mêmes blocs,
 *  une fois isolés dans un fichier minimal, s'exécutent sans problème.
 *  Plutôt que de dépendre d'un mécanisme aussi fragile, l'en-tête et le pied
 *  sont compilés une fois au démarrage et appelés comme de simples
 *  fonctions JavaScript : aucun `include()` ne subsiste dans les gabarits. */
import ejs from 'ejs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VUES = join(__dirname, '..', 'views');

function compiler(nomFichier) {
  const chemin = join(VUES, nomFichier);
  return ejs.compile(readFileSync(chemin, 'utf8'), { filename: chemin });
}

const fnEntete = compiler('partials/entete.ejs');
const fnPied = compiler('partials/pied.ejs');
const fnSalonEntete = compiler('partials/salon-entete.ejs');
const fnSalonPied = compiler('partials/salon-pied.ejs');
const fnServiceEntete = compiler('partials/service-entete.ejs');
const fnServicePied = compiler('partials/service-pied.ejs');

export const entete = donnees => fnEntete(donnees);
export const pied = () => fnPied({});
export const salonEntete = donnees => fnSalonEntete(donnees);
export const salonPied = donnees => fnSalonPied(donnees);
export const serviceEntete = donnees => fnServiceEntete(donnees);
export const servicePied = donnees => fnServicePied(donnees);
