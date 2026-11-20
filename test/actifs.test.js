import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Une image référencée mais absente ne se voit pas dans les tests de
 *  logique, et dans un <picture> elle est pire qu'une image cassée : le
 *  navigateur choisit la source WebP, reçoit un 404, et n'affiche rien —
 *  il ne retombe pas sur le JPG. C'est arrivé aux photos de la section
 *  « Signatures ». Ce test relit les pages et vérifie chaque fichier. */

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

function pages() {
  const vues = join(racine, 'server', 'views');
  const ejs = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? ejs(join(d, e.name)) : e.name.endsWith('.ejs') ? [join(d, e.name)] : []);
  return [join(racine, 'index.html'), ...ejs(vues)];
}

test('chaque image de assets/img citée par une page existe', () => {
  const manquantes = [];
  for (const page of pages()) {
    const html = readFileSync(page, 'utf8');
    for (const [, chemin] of html.matchAll(/["'\s(]\/?(assets\/img\/[^"'\s),<>]+\.(?:webp|jpe?g|png|svg))/g)) {
      if (!existsSync(join(racine, chemin))) manquantes.push(`${page.replace(racine + '/', '')} → ${chemin}`);
    }
  }
  assert.deepEqual(manquantes, [], 'images citées mais absentes');
});
