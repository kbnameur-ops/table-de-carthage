/** Reprend le contenu de assets/js/menu-data.js (source de vérité du site
 *  statique) pour peupler la base au premier démarrage, et copie les
 *  photos existantes vers le stockage de l'application dynamique (Vercel
 *  Blob si BLOB_READ_WRITE_TOKEN est défini, sinon disque local).
 *  Sans effet si la base contient déjà des catégories, sauf avec --force. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { une, executer, transaction } from './db.js';
import { versCents } from './lib/money.js';
import { enregistrerPhotoPlat } from './lib/image.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const racine = join(__dirname, '..');

function chargerMenuStatique() {
  const code = readFileSync(join(racine, 'assets/js/menu-data.js'), 'utf8');
  // Fichier maison, non exposé aux utilisateurs : l'évaluer directement
  // évite d'écrire un second parseur pour ce qui reste du JSON étendu.
  const fn = new Function(`${code}\nreturn MENU;`);
  return fn();
}

async function dejaSemee() {
  const { n } = await une(`SELECT COUNT(*)::int AS n FROM categories`);
  return n > 0;
}

async function copierPhoto(nomPhoto) {
  if (!nomPhoto) return null;
  const source = join(racine, 'assets/img/plats', `${nomPhoto}.jpg`);
  if (!existsSync(source)) {
    console.warn(`  ⚠ photo introuvable : ${nomPhoto}.jpg`);
    return null;
  }
  const buffer = readFileSync(source);
  try {
    return await enregistrerPhotoPlat(buffer, `${nomPhoto}.jpg`);
  } catch (err) {
    // Une photo qui échoue à l'upload (réseau, store injoignable...) ne
    // doit pas faire échouer — et donc annuler — tout l'import de la carte :
    // le plat est créé sans photo, ajoutable depuis le salon ensuite.
    console.warn(`  ⚠ échec de l'upload pour ${nomPhoto}.jpg : ${err.message}`);
    return null;
  }
}

async function semerCarte(t) {
  const menu = chargerMenuStatique();
  let totalPlats = 0;
  for (let iCat = 0; iCat < menu.length; iCat++) {
    const cat = menu[iCat];
    const { id: catId } = await t.une(
      `INSERT INTO categories (slug, nom, accroche, position) VALUES ($1, $2, $3, $4) RETURNING id`,
      [cat.id, cat.name, cat.tagline, iCat]
    );
    for (let iPlat = 0; iPlat < cat.items.length; iPlat++) {
      const plat = cat.items[iPlat];
      const photo = await copierPhoto(plat.photo);
      await t.executer(
        `INSERT INTO plats (categorie_id, nom, description, prix_cents, photo, vegetarien, signature, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [catId, plat.name, plat.desc, versCents(plat.price), photo, !!plat.veg, !!plat.star, iPlat]
      );
      totalPlats++;
    }
  }
  console.log(`✓ ${menu.length} catégories, ${totalPlats} plats importés`);
}

async function semerServices(t) {
  // Horaires réels du restaurant ; la capacité (tables/couverts) est un
  // point de départ à ajuster dans le salon — /salon/services.
  await t.executer(
    `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, pas_minutes, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['Semaine (lundi–samedi)', '123456', '12:00', '23:00', 12, 48, 30, 0]
  );
  await t.executer(
    `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, pas_minutes, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['Dimanche', '7', '12:00', '22:00', 12, 48, 30, 1]
  );
  console.log('✓ 2 services créés avec une capacité de départ (12 tables, 48 couverts) — à ajuster dans le salon');
}

async function semerReglages(t) {
  const reglages = [
    ['nom_restaurant', 'La Table de Carthage'],
    ['telephone', '+33761976711'],
    ['adresse', '6 boulevard Richard Wallace, 92800 Puteaux'],
  ];
  for (const [cle, valeur] of reglages) {
    await t.executer(
      `INSERT INTO reglages (cle, valeur) VALUES ($1, $2)
       ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur`,
      [cle, valeur]
    );
  }
  console.log('✓ réglages généraux enregistrés');
}

async function main() {
  const force = process.argv.includes('--force');
  if (await dejaSemee() && !force) {
    console.log('La base contient déjà des catégories : rien à faire (--force pour reforcer).');
    return;
  }

  if (force) {
    await executer(`DELETE FROM plats`);
    await executer(`DELETE FROM categories`);
    await executer(`DELETE FROM services`);
    await executer(`DELETE FROM reglages`);
  }

  await transaction(async (t) => {
    await semerCarte(t);
    await semerServices(t);
    await semerReglages(t);
  });

  console.log('\nSemis terminé.');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
