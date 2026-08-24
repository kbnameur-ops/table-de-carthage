/** Reprend le contenu de assets/js/menu-data.js (source de vérité du site
 *  statique) pour peupler la base au premier démarrage, et copie les
 *  photos existantes vers le dossier servi par l'application dynamique.
 *  Sans effet si la base contient déjà des catégories, sauf avec --force. */
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { versCents } from './lib/money.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const racine = join(__dirname, '..');

function chargerMenuStatique() {
  const code = readFileSync(join(racine, 'assets/js/menu-data.js'), 'utf8');
  // Fichier maison, non exposé aux utilisateurs : l'évaluer directement
  // évite d'écrire un second parseur pour ce qui reste du JSON étendu.
  const fn = new Function(`${code}\nreturn MENU;`);
  return fn();
}

function dejaSemee() {
  return db.prepare(`SELECT COUNT(*) AS n FROM categories`).get().n > 0;
}

function copierPhoto(nomPhoto) {
  if (!nomPhoto) return null;
  const source = join(racine, 'assets/img/plats', `${nomPhoto}.jpg`);
  const dest = join(racine, 'server/public/uploads/plats', `${nomPhoto}.jpg`);
  if (!existsSync(source)) {
    console.warn(`  ⚠ photo introuvable : ${nomPhoto}.jpg`);
    return null;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  return `${nomPhoto}.jpg`;
}

function semerCarte() {
  const menu = chargerMenuStatique();
  const insCat = db.prepare(
    `INSERT INTO categories (slug, nom, accroche, position) VALUES (?, ?, ?, ?)`
  );
  const insPlat = db.prepare(
    `INSERT INTO plats (categorie_id, nom, description, prix_cents, photo, vegetarien, signature, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let totalPlats = 0;
  menu.forEach((cat, iCat) => {
    const { lastInsertRowid: catId } = insCat.run(cat.id, cat.name, cat.tagline, iCat);
    cat.items.forEach((plat, iPlat) => {
      const photo = copierPhoto(plat.photo);
      insPlat.run(
        catId, plat.name, plat.desc, versCents(plat.price),
        photo, plat.veg ? 1 : 0, plat.star ? 1 : 0, iPlat
      );
      totalPlats++;
    });
  });
  console.log(`✓ ${menu.length} catégories, ${totalPlats} plats importés`);
}

function semerServices() {
  const ins = db.prepare(
    `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, pas_minutes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Horaires réels du restaurant ; la capacité (tables/couverts) est un
  // point de départ à ajuster dans le salon — /salon/services.
  ins.run('Semaine (lundi–samedi)', '123456', '12:00', '23:00', 12, 48, 30, 0);
  ins.run('Dimanche', '7', '12:00', '22:00', 12, 48, 30, 1);
  console.log('✓ 2 services créés avec une capacité de départ (12 tables, 48 couverts) — à ajuster dans le salon');
}

function semerReglages() {
  const ins = db.prepare(
    `INSERT INTO reglages (cle, valeur) VALUES (?, ?)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`
  );
  ins.run('nom_restaurant', 'La Table de Carthage');
  ins.run('telephone', '+33761976711');
  ins.run('adresse', '6 boulevard Richard Wallace, 92800 Puteaux');
  console.log('✓ réglages généraux enregistrés');
}

const force = process.argv.includes('--force');
if (dejaSemee() && !force) {
  console.log('La base contient déjà des catégories : rien à faire (--force pour reforcer).');
  process.exit(0);
}

if (force) {
  db.exec(`DELETE FROM plats; DELETE FROM categories; DELETE FROM services; DELETE FROM reglages;`);
}

db.transaction(() => {
  semerCarte();
  semerServices();
  semerReglages();
})();

console.log('\nSemis terminé.');
