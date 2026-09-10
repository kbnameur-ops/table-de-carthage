/** Stockage des photos : Vercel Blob si BLOB_READ_WRITE_TOKEN est
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
const dossierLocal = (rayon) => join(__dirname, '..', 'public', 'uploads', rayon);

function utiliseBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Redimensionne et recompresse une photo (1000 px de large maximum, JPEG
 *  qualité 82), puis la stocke. Retourne l'URL/le chemin à enregistrer.
 *
 *  `rayon` sépare les usages dans le stockage : 'plats' pour la carte,
 *  'evenements' pour les soirées. Deux photos différentes peuvent porter le
 *  même nom de fichier sans s'écraser. */
export async function enregistrerPhoto(buffer, nomFichier, rayon = 'plats') {
  const image = sharp(buffer).rotate(); // rotate() sans argument lit l'EXIF et corrige l'orientation
  const meta = await image.metadata();
  const redimensionnee = meta.width > 1000 ? image.resize({ width: 1000 }) : image;
  const jpeg = await redimensionnee.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();

  if (utiliseBlob()) {
    const { url } = await put(`${rayon}/${nomFichier}`, jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false, // nomFichier porte déjà un suffixe aléatoire pour un upload du salon (voir lib/slug.js) ;
      allowOverwrite: true,   // server/seed.js réutilise un nom fixe par plat pour rester idempotent (--force)
    });
    return url;
  }

  await mkdir(dossierLocal(rayon), { recursive: true });
  await writeFile(join(dossierLocal(rayon), nomFichier), jpeg);
  return `/uploads/${rayon}/${nomFichier}`;
}

/** L'ancien nom, conservé pour la carte : tout le back-office des plats
 *  l'appelle, et le renommer partout n'apporterait rien. */
export const enregistrerPhotoPlat = (buffer, nomFichier) =>
  enregistrerPhoto(buffer, nomFichier, 'plats');

export async function supprimerPhoto(valeur) {
  if (!valeur) return;
  try {
    if (/^https?:\/\//.test(valeur)) {
      await del(valeur);
    } else {
      // '/uploads/plats/x.jpg' comme '/uploads/evenements/x.jpg' : le
      // chemin porte déjà son rayon, il suffit de le rejoindre à la racine.
      await unlink(join(__dirname, '..', 'public', valeur.replace(/^\//, '')));
    }
  } catch {
    // déjà absente, ou store inaccessible : rien de plus à faire ici.
  }
}

export const supprimerPhotoPlat = supprimerPhoto;
