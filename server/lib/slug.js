import { randomBytes } from 'node:crypto';

export function slugifier(texte) {
  return texte
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

export function nomFichierUnique(base) {
  return `${slugifier(base)}-${randomBytes(4).toString('hex')}.jpg`;
}
