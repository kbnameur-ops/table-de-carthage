/** Connexion Postgres (Vercel Postgres / Neon en production, un serveur
 *  local ordinaire en développement). Un seul pool, réutilisé entre les
 *  invocations d'une même instance de fonction serverless — le recréer à
 *  chaque requête épuiserait vite les connexions disponibles côté base. */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const chaineConnexion =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:devlocal@127.0.0.1:5432/table_de_carthage';

// Neon/Vercel Postgres exigent TLS ; un Postgres local de développement n'en
// a pas besoin (et peut ne pas savoir servir de certificat). Le comportement
// se règle donc sur l'hôte visé, pas sur NODE_ENV : on peut très bien tester
// contre une base Neon distante en développement.
const versUnHoteDistant = /neon\.tech|vercel-storage\.com/.test(chaineConnexion);

export const pool = new pg.Pool({
  connectionString: chaineConnexion,
  ssl: versUnHoteDistant ? { rejectUnauthorized: true } : false,
  max: process.env.VERCEL ? 1 : 10, // une fonction serverless ne sert qu'une requête à la fois
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur une connexion Postgres inactive :', err);
});

/** Requête générique : retourne les lignes. */
export async function query(texte, parametres = []) {
  const { rows } = await pool.query(texte, parametres);
  return rows;
}

/** Une seule ligne (ou undefined). */
export async function une(texte, parametres = []) {
  const { rows } = await pool.query(texte, parametres);
  return rows[0];
}

/** Exécute sans avoir besoin du résultat (UPDATE/DELETE/INSERT sans RETURNING). */
export async function executer(texte, parametres = []) {
  await pool.query(texte, parametres);
}

/** Exécute plusieurs opérations dans une même transaction. `fn` reçoit un
 *  client dédié exposant les mêmes query/une/executer, à utiliser à la
 *  place des exports du module pour que tout passe par la même connexion. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const enveloppe = {
      query: async (t, p = []) => (await client.query(t, p)).rows,
      une: async (t, p = []) => (await client.query(t, p)).rows[0],
      executer: async (t, p = []) => { await client.query(t, p); },
    };
    const resultat = await fn(enveloppe);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Applique le schéma (idempotent : CREATE TABLE/INDEX IF NOT EXISTS). À
 *  appeler explicitement (au déploiement, ou via `npm run migrate`) plutôt
 *  qu'à chaque démarrage : une fonction serverless démarre à chaque requête
 *  froide, il serait coûteux et inutile de revérifier le schéma à chaque
 *  fois. */
export async function appliquerSchema() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

export async function nettoyerSessionsExpirees() {
  await executer(`DELETE FROM sessions WHERE expire_le < now()`);
}

export async function nettoyerTentativesAnciennes() {
  await executer(`DELETE FROM tentatives WHERE le < now() - interval '1 day'`);
}
