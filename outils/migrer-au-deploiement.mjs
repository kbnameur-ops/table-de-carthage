/** Applique le schéma à chaque déploiement Vercel.
 *
 *  Sans ça, chaque migration demandait de retrouver la chaîne de connexion
 *  et de la coller à la main : une étape qu'on oublie, et qu'on ne
 *  découvre oubliée qu'au premier client tombé sur une colonne manquante.
 *  Le schéma est idempotent — tout y est en CREATE ... IF NOT EXISTS ou en
 *  ALTER ... ADD COLUMN IF NOT EXISTS — donc le rejouer à chaque
 *  déploiement ne coûte qu'une poignée de millisecondes et ne peut rien
 *  défaire.
 *
 *  Trois issues, et une seule fait échouer le build :
 *
 *  — Aucune base configurée : on passe. Les déploiements de
 *    prévisualisation n'en ont pas toujours une, et refuser de construire
 *    pour ça bloquerait le travail sans rien protéger.
 *
 *  — Le schéma s'applique : le déploiement continue, la base est à jour
 *    avant que la moindre requête n'arrive.
 *
 *  — La migration échoue : le build échoue avec elle. C'est délibéré.
 *    Mettre en ligne du code qui attend une colonne absente donne un site
 *    cassé pour de vrai ; un déploiement refusé se relance.
 */

const chaine = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!chaine) {
  console.log('↷ Aucune base configurée (POSTGRES_URL / DATABASE_URL) : migration ignorée.');
  process.exit(0);
}

// Un build ne doit pas pendre sur une base injoignable : au-delà de cette
// limite on échoue franchement plutôt que d'attendre le délai du
// constructeur, qui se compte en minutes.
const LIMITE_MS = 60_000;
const minuterie = setTimeout(() => {
  console.error(`✗ La migration dépasse ${LIMITE_MS / 1000} s : base injoignable ?`);
  process.exit(1);
}, LIMITE_MS);

try {
  const { appliquerSchema, pool } = await import('../server/db.js');
  await appliquerSchema();
  await pool.end();
  clearTimeout(minuterie);
  console.log('✓ Schéma appliqué avant le déploiement.');
  process.exit(0);
} catch (err) {
  clearTimeout(minuterie);
  console.error('✗ Migration échouée — déploiement interrompu.');
  console.error(err?.message || err);
  process.exit(1);
}
