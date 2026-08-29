/* ═══════════════════════════════════════════════════════════
   Fabrique les icônes d'application à partir du logo.

   Le logo est un médaillon circulaire posé sur un fond crème.
   On le recadre au carré autour de l'anneau doré : iOS et Android
   appliquent eux-mêmes leur masque (coins arrondis, cercle, goutte),
   donc l'icône doit être un carré plein, sans transparence — un PNG
   transparent ressortirait en noir sur iOS.

   Usage : node icones.mjs
   ═══════════════════════════════════════════════════════════ */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dirname, 'assets/img/logo.jpg');
const DOSSIER = join(__dirname, 'assets/img/icones');

// Le carré qui cadre le médaillon, mesuré sur le logo (640 × 640) :
// centré sur le cercle, avec une marge suffisante pour que l'anneau
// doré ne touche pas le bord.
const CADRE = { left: 55, top: 28, width: 530, height: 530 };
// Relevée sur les coins du recadrage plutôt que reprise de la charte : le
// fond du logo est légèrement plus sourd que le crème de la feuille de
// style, et un écart de deux tons laisserait une couture visible autour du
// médaillon sur l'icône masquable.
const CREME = { r: 231, g: 229, b: 217 };

const medaillon = () => sharp(SOURCE).extract(CADRE);

mkdirSync(DOSSIER, { recursive: true });

/** Icône pleine : le médaillon occupe tout le carré. Sert à iOS
 *  (apple-touch-icon) et aux icônes « any » du manifeste. */
async function pleine(taille, nom) {
  await medaillon()
    .resize(taille, taille, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(join(DOSSIER, nom));
  return nom;
}

/** Icône masquable : Android peut y découper un cercle, une goutte ou
 *  un carré arrondi. Seuls les 80 % centraux sont garantis visibles,
 *  d'où le médaillon réduit à 72 % et posé sur un fond crème plein. */
async function masquable(taille, nom) {
  const interieur = Math.round(taille * 0.72);
  const marge = Math.round((taille - interieur) / 2);
  const centre = await medaillon().resize(interieur, interieur, { fit: 'cover' }).png().toBuffer();

  await sharp({ create: { width: taille, height: taille, channels: 3, background: CREME } })
    .composite([{ input: centre, top: marge, left: marge }])
    .png({ compressionLevel: 9 })
    .toFile(join(DOSSIER, nom));
  return nom;
}

const faits = [
  await pleine(180, 'icone-180.png'),   // apple-touch-icon
  await pleine(192, 'icone-192.png'),
  await pleine(512, 'icone-512.png'),
  await masquable(512, 'icone-masquable-512.png'),
];
console.log('Icônes écrites dans assets/img/icones/ :', faits.join(', '));
