/* ═══════════════════════════════════════════════════════════
   Construit une version en fichier unique du site.
   Le CSS, le JavaScript et le logo sont incorporés dans le HTML :
   dist/index.html s'ouvre, s'envoie par mail et s'héberge tel quel.

   Usage : node build.mjs [--fragment]
     --fragment  retire <!DOCTYPE>, <html>, <head> et <body>
                 (format attendu par un hébergeur d'Artifact)
   ═══════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const fragment = process.argv.includes('--fragment');
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');

const html = read('./index.html');
const css  = read('./assets/css/style.css');
const data = read('./assets/js/menu-data.js');
const main = read('./assets/js/main.js');
const dataUri = f => 'data:image/jpeg;base64,' +
  readFileSync(new URL(f, import.meta.url)).toString('base64');
const logo = dataUri('./assets/img/logo.jpg');

// Chaque photo référencée dans le HTML ou construite par le JS depuis menu-data
// Les deux fonds du hero sont référencés depuis la feuille de style, donc
// par un chemin relatif à celle-ci : c'est ce chemin-là qu'il faut remplacer.
const photos = new Map([
  ['assets/img/salle.jpg', dataUri('./assets/img/salle.jpg')],
  ['assets/img/facade.jpg', dataUri('./assets/img/facade.jpg')],
  ['../img/salle-hero.jpg', dataUri('./assets/img/salle-hero.jpg')],
  ['../img/salle-hero-mobile.jpg', dataUri('./assets/img/salle-hero-mobile.jpg')],
]);
for (const [, nom] of data.matchAll(/photo: '([\w-]+)'/g)) {
  photos.set(`assets/img/plats/${nom}.jpg`, dataUri(`./assets/img/plats/${nom}.jpg`));
}

// Les remplacements passent par des fonctions : dans une chaîne de
// remplacement, `$$` et `$&` sont des motifs spéciaux qui corrompraient le code.
let out = html
  .replace('<link rel="stylesheet" href="assets/css/style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="assets/js/menu-data.js"></script>\n<script src="assets/js/main.js"></script>',
           () => `<script>\n${data}\n${main}\n</script>`)
  .replaceAll('assets/img/logo.jpg', () => logo);

// Le JS compose ses chemins d'image à l'exécution : on les fait pointer vers
// une table nom → image incorporée, déclarée en tête du script.
const table = Object.fromEntries(
  [...photos].filter(([k]) => k.includes('/plats/'))
             .map(([k, v]) => [k.split('/').pop().replace('.jpg', ''), v]));

out = out
  .replace('assets/img/plats/${it.photo}.jpg', () => '${PHOTOS[it.photo]}')
  // Les données structurées pointeraient vers des fichiers absents de cette
  // version : mieux vaut aucune image qu'une URL morte.
  .replace("if (i.photo) item.image = base + 'assets/img/plats/' + i.photo + '.jpg';", '')
  .replace("image: base + 'assets/img/logo.jpg',", '')
  .replace('<script>', () => `<script>\nconst PHOTOS = ${JSON.stringify(table)};`);

// Le préchargement n'a plus de sens une fois les images incorporées, et
// dupliquerait un data-URI de plusieurs centaines de kilo-octets.
out = out.replace(/^\s*<link rel="preload" as="image"[^>]*>\n/gm, '');

for (const [chemin, uri] of photos) out = out.replaceAll(chemin, () => uri);

if (fragment) {
  const head = out.slice(out.indexOf('<head>') + 6, out.indexOf('</head>'));
  const body = out.slice(out.indexOf('<body>') + 6, out.lastIndexOf('</body>'));
  // On garde le <title>, la police et les styles ; on jette le reste des métadonnées.
  const keep = head
    .split('\n')
    .filter(l => /<title|fonts\.googleapis|<style>|<\/style>/.test(l) || l.startsWith('  ') || !l.trim().startsWith('<'))
    .join('\n');
  // Sur une galerie d'Artifacts, le nom seul identifie mieux la page.
  out = `${keep}\n${body}`.replace(
    '<title>La Table de Carthage — Restaurant Tunisien</title>',
    '<title>La Table de Carthage</title>');
}

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
const target = fragment ? './dist/artifact.html' : './dist/index.html';
writeFileSync(new URL(target, import.meta.url), out);
console.log(`${target} — ${(Buffer.byteLength(out) / 1024).toFixed(0)} Ko`);
