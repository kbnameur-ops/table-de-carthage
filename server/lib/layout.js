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
import { cssApp } from './version-actifs.js';
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
const fnCuisineTableau = compiler('partials/cuisine-tableau.ejs');
const fnCuisineEntete = compiler('partials/cuisine-entete.ejs');
const fnCuisinePied = compiler('partials/cuisine-pied.ejs');
const fnTeteApp = compiler('partials/tete-app.ejs');
const fnEpingler = compiler('partials/epingler.ejs');

// `cssApp` est ajouté à chaque rendu d'en-tête : aucun appelant n'a à y penser.
export const entete = donnees => fnEntete({ cssApp, ...donnees });
export const pied = donnees => fnPied(donnees ?? {});
export const salonEntete = donnees => fnSalonEntete({ cssApp, ...donnees });
export const salonPied = donnees => fnSalonPied(donnees);
export const serviceEntete = donnees => fnServiceEntete({ cssApp, ...donnees });
export const servicePied = donnees => fnServicePied(donnees);

/** Le tableau de la cuisine, rendu à part : la page complète l'incorpore au
 *  premier affichage, et le rafraîchissement automatique va chercher ce
 *  même fragment seul. Une seule source pour les deux. */
export const cuisineTableau = donnees => fnCuisineTableau(donnees);

/** L'écran de cuisine a sa propre mise en page : au passe on ne navigue
 *  pas entre des onglets de salle, on regarde ce qui est au feu. */
export const cuisineEntete = donnees => fnCuisineEntete({ cssApp, ...donnees });
export const cuisinePied = donnees => fnCuisinePied(donnees);

/** Les balises qui font d'une page une application épinglable, et l'appel
 *  à l'épingler. Rendus à part pour que les quatre mises en page partagent
 *  exactement le même code. */
export const teteApp = donnees => fnTeteApp(donnees);
export const epingler = donnees => fnEpingler(donnees);
