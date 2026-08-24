/** Stockage des photos de plats : Vercel Blob si BLOB_READ_WRITE_TOKEN est
 *  défini (déploiement Vercel avec un store Blob relié au projet), sinon
 *  repli sur le disque local — pratique pour développer sans dépendre d'un
 *  compte cloud, et cohérent avec le reste de l'app qui tourne aussi bien
 *  en local qu'en production. Le `photo` stocké en base est toujours une
 *  URL complète en mode Blob, ou un chemin `/uploads/plats/...` en local :
 *  les deux se servent tels quels dans les vues, sans distinction. */
import sharp from 'sharp';
import { put, del } from '@vercel/blob';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOSSIER_PLATS = join(__dirname, '..', 'public', 'uploads', 'plats');

function utiliseBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Redimensionne et recompresse une photo de plat (1000 px de large
 *  maximum, JPEG qualité 82), puis la stocke. Retourne l'URL/le chemin à
 *  enregistrer dans la colonne `photo`. */
export async function enregistrerPhotoPlat(buffer, nomFichier) {
  const image = sharp(buffer).rotate(); // rotate() sans argument lit l'EXIF et corrige l'orientation
  const meta = await image.metadata();
  const redimensionnee = meta.width > 1000 ? image.resize({ width: 1000 }) : image;
  const jpeg = await redimensionnee.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();

  if (utiliseBlob()) {
    const { url } = await put(`plats/${nomFichier}`, jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false, // nomFichier porte déjà un suffixe aléatoire pour un upload du salon (voir lib/slug.js) ;
      allowOverwrite: true,   // server/seed.js réutilise un nom fixe par plat pour rester idempotent (--force)
    });
    return url;
  }

  await mkdir(DOSSIER_PLATS, { recursive: true });
  await writeFile(join(DOSSIER_PLATS, nomFichier), jpeg);
  return `/uploads/plats/${nomFichier}`;
}

export async function supprimerPhotoPlat(valeur) {
  if (!valeur) return;
  try {
    if (/^https?:\/\//.test(valeur)) {
      await del(valeur);
    } else {
      await unlink(join(DOSSIER_PLATS, valeur.replace(/^\/uploads\/plats\//, '')));
    }
  } catch {
    // déjà absente, ou store inaccessible : rien de plus à faire ici.
  }
}
