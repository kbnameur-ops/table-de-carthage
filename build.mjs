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
const logo = 'data:image/jpeg;base64,' +
  readFileSync(new URL('./assets/img/logo.jpg', import.meta.url)).toString('base64');

// Les remplacements passent par des fonctions : dans une chaîne de
// remplacement, `$$` et `$&` sont des motifs spéciaux qui corrompraient le code.
let out = html
  .replace('<link rel="stylesheet" href="assets/css/style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="assets/js/menu-data.js"></script>\n<script src="assets/js/main.js"></script>',
           () => `<script>\n${data}\n${main}\n</script>`)
  .replaceAll('assets/img/logo.jpg', () => logo);

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
