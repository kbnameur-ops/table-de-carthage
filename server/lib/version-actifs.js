import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Une empreinte du contenu de la feuille de style, à coller en query string.
 *
 *  Sans elle, un navigateur qui a vu le site garde son app.css pendant les
 *  24 heures du max-age : une correction de mise en page reste invisible
 *  jusqu'au lendemain, et le symptôme est déroutant — une partie des styles
 *  s'applique (ceux de l'ancien fichier), l'autre pas. L'URL changeant à
 *  chaque modification, le cache long redevient un avantage sans coût.
 *
 *  Calculée une fois au chargement du module : le fichier ne change pas en
 *  cours d'exécution, et une fonction serverless redémarre à chaque
 *  déploiement. */
function empreinte(chemin) {
  try {
    return createHash('sha1').update(readFileSync(chemin)).digest('hex').slice(0, 10);
  } catch {
    // Un actif illisible ne doit pas empêcher la page de se rendre : on
    // retombe sur une URL sans version, quitte à perdre l'anti-cache.
    return '';
  }
}

const v = empreinte(join(__dirname, '..', 'public', 'css', 'app.css'));

/** L'URL de la feuille de style de l'application, version comprise. */
export const cssApp = v ? `/css/app.css?v=${v}` : '/css/app.css';
