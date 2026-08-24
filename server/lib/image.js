import sharp from 'sharp';
import { writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DOSSIER_PLATS = join(__dirname, '..', 'public', 'uploads', 'plats');

/** Redimensionne et recompresse une photo de plat, comme fait à la main
 *  pour les photos actuelles du site (1000 px de large maximum, JPEG 82). */
export async function enregistrerPhotoPlat(buffer, nomFichier) {
  const image = sharp(buffer).rotate(); // rotate() sans argument lit l'EXIF et corrige l'orientation
  const meta = await image.metadata();
  const redimensionnee = meta.width > 1000 ? image.resize({ width: 1000 }) : image;
  const jpeg = await redimensionnee.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
  await writeFile(join(DOSSIER_PLATS, nomFichier), jpeg);
}

export async function supprimerPhotoPlat(nomFichier) {
  if (!nomFichier) return;
  try { await unlink(join(DOSSIER_PLATS, nomFichier)); } catch { /* déjà absente */ }
}
