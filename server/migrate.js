/** Applique le schéma Postgres (idempotent). À lancer une fois après avoir
 *  provisionné la base (Vercel Postgres/Neon en production, ou un Postgres
 *  local en développement) : `npm run migrate`. */
import { appliquerSchema, pool } from './db.js';

appliquerSchema()
  .then(() => { console.log('✓ Schéma appliqué.'); return pool.end(); })
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
