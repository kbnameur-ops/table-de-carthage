import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Compose le manuel d'utilisation en PDF.
 *
 *  Le manuel est une page web ; le PDF en est un tirage, pas une seconde
 *  version à tenir à jour. D'où ce script plutôt qu'un fichier écrit à la
 *  main : après chaque modification du manuel, `npm run pdf` suffit.
 *
 *  Les fontes sont téléchargées puis embarquées dans une copie temporaire de
 *  la page. Sans ça, Chromium composerait le PDF avec les fontes du système :
 *  le tirage ne ressemblerait pas au document, et une machine sans réseau
 *  rendrait un document différent d'une machine connectée. */

/** Là où npm installe les paquets globaux, le cas échéant : une machine de
 *  développement a souvent Playwright installé une fois pour toutes plutôt
 *  que projet par projet. */
async function racineGlobale() {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('npm', ['root', '-g']);
    return pathToFileURL(join(stdout.trim(), 'playwright', 'index.js')).href;
  } catch { return null; }
}

/** Playwright n'est pas une dépendance du projet : Vercel installe aussi les
 *  dépendances de développement à chaque déploiement, et tirer un navigateur
 *  complet pour composer un PDF ralentirait chaque mise en ligne pour rien.
 *  Le script le cherche donc là où il se trouve, et explique s'il manque. */
async function chargerChromium() {
  for (const ou of ['playwright', await racineGlobale()]) {
    if (!ou) continue;
    try {
      // Chargé par son chemin, Playwright arrive en CommonJS : ses exports
      // sont alors sous .default, pas à la racine du module.
      const m = await import(ou);
      const chromium = m.chromium ?? m.default?.chromium;
      if (chromium) return chromium;
    } catch { /* on essaie ailleurs */ }
  }
  {
    console.error(
      'Playwright est nécessaire pour composer le PDF :\n'
      + '  npm i -D playwright && npx playwright install chromium\n'
      + '(ou une installation globale : npm i -g playwright)');
    process.exit(1);
  }
}

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const cache = join(racine, '.cache', 'fontes');
const source = join(racine, 'docs', 'manuel-utilisation.html');
const sortie = join(racine, 'docs', 'Manuel-La-Table-de-Carthage.pdf');

const NAVIGATEUR = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Récupère la feuille Google Fonts et remplace chaque URL de fonte par son
 *  contenu en base64. Seul le latin est retenu : les autres sous-ensembles
 *  tripleraient le poids du PDF sans qu'une seule lettre les utilise. */
async function fontesEmbarquees(href) {
  await mkdir(cache, { recursive: true });
  // Un navigateur reçoit du woff2 ; un client inconnu recevrait du ttf.
  const css = await (await fetch(href, { headers: { 'User-Agent': NAVIGATEUR } })).text();

  const blocs = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)]
    .filter(([, sousEnsemble]) => sousEnsemble === 'latin' || sousEnsemble === 'latin-ext');
  if (!blocs.length) throw new Error('aucune fonte latine trouvée dans la feuille Google');

  const rendus = [];
  for (const [, , bloc] of blocs) {
    const url = bloc.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)[1];
    const fichier = join(cache, url.split('/').pop());
    let octets;
    try {
      await access(fichier);
      octets = await readFile(fichier);
    } catch {
      octets = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(fichier, octets);
    }
    rendus.push(bloc.replace(/url\(https:\/\/fonts\.gstatic\.com[^)]+\)/,
      `url(data:font/woff2;base64,${octets.toString('base64')})`));
  }
  return rendus.join('\n');
}

const page = await readFile(source, 'utf8');
const lien = page.match(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com[^"]+)"[^>]*>/);
if (!lien) throw new Error('le manuel ne référence plus de feuille Google Fonts');

const document = ['<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n</head>\n<body>',
  page.replace(/<link rel="preconnect"[^>]*>\s*/g, '')
      .replace(lien[0], `<style>\n${await fontesEmbarquees(lien[1])}\n</style>`),
  '</body>\n</html>'].join('\n');

const temporaire = join(racine, '.cache', 'manuel-impression.html');
await writeFile(temporaire, document);

const chromium = await chargerChromium();
const navigateur = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {}
);
const onglet = await navigateur.newPage();
await onglet.goto('file://' + temporaire, { waitUntil: 'load' });
await onglet.evaluate(() => document.fonts.ready);

// Le tirage ne vaut rien si Chromium est retombé sur les fontes du système.
const composee = await onglet.evaluate(() =>
  getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0].replace(/["']/g, ''));
if (composee !== 'Marcellus') throw new Error(`fonte de titre inattendue : ${composee}`);

await onglet.pdf({
  path: sortie, format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:8pt;color:#6C7A88;'
    + 'padding:0 16mm;display:flex;justify-content:space-between">'
    + '<span>La Table de Carthage — Manuel d\'utilisation</span>'
    + '<span class="pageNumber"></span></div>',
});
await navigateur.close();
console.log('✓', sortie);
