/* Génère une version WebP à côté de chaque JPG de assets/img.
 * Usage : node outils/images-webp.mjs
 * Les pages servent le WebP via <picture> et gardent le JPG en secours. */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'img');

function jpgs(dossier) {
  return readdirSync(dossier).flatMap(nom => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return jpgs(chemin);
    return /\.jpe?g$/i.test(nom) ? [chemin] : [];
  });
}

for (const jpg of jpgs(racine)) {
  // Le logo reste en JPG (favicon, données structurées) ; les plats n'ont
  // que leur vignette, la visionneuse affichant le JPG complet.
  if (jpg.endsWith('logo.jpg')) continue;
  const estPlat = jpg.includes(join('img', 'plats'));
  const webp = jpg.replace(/\.jpe?g$/i, '.webp');
  if (!estPlat) {
    const { size } = await sharp(jpg).webp({ quality: 78 }).toFile(webp);
    console.log(webp.replace(racine + '/', ''), Math.round(size / 1024) + ' Ko');
  }

  // Les plats s'affichent en vignette de 74 px : une version 160 px (écrans
  // à forte densité compris) évite de télécharger la photo entière. La
  // visionneuse, elle, garde le JPG complet.
  if (estPlat) {
    await sharp(jpg).resize(160, 160, { fit: 'cover' }).webp({ quality: 75 })
      .toFile(webp.replace(/\.webp$/, '-160.webp'));
  }
}
