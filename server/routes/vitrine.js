import { Router } from 'express';
import { carteVisible } from '../lib/carte.js';
import { evenementsPublics } from '../lib/evenements.js';
import { definitionsPages } from '../lib/vitrine-pages.js';
import {
  metaTags, scriptJsonLd, jsonLdRestaurant, jsonLdFilAriane, jsonLdPage,
  robotsTxt, sitemapXml, NOM,
} from '../lib/seo.js';

export const vitrineRouter = Router();

/** La carte ne doit jamais empêcher le site de s'afficher : sans base, les
 *  pages se rendent avec une carte vide (et le JS retombe sur menu-data.js). */
async function carteOuVide() {
  try { return await carteVisible(); } catch (err) { console.error('carte indisponible', err.message); return []; }
}

vitrineRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt());
});

vitrineRouter.get('/sitemap.xml', async (req, res, next) => {
  try {
    const entrees = [
      { chemin: '/', priorite: '1.0', frequence: 'weekly' },
      { chemin: '/carte', priorite: '0.9', frequence: 'weekly' },
      { chemin: '/reserver', priorite: '0.8' },
      { chemin: '/commander', priorite: '0.8' },
      { chemin: '/privatisation', priorite: '0.7' },
      { chemin: '/traiteur', priorite: '0.7' },
    ];
    try {
      for (const e of await evenementsPublics()) {
        entrees.push({ chemin: `/evenements/${e.slug}`, priorite: '0.6', frequence: 'weekly' });
      }
    } catch (err) { console.error('sitemap sans événements', err.message); }
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml(entrees));
  } catch (err) { next(err); }
});

vitrineRouter.get('/carte', (req, res) => rendre(req, res, '/carte'));
vitrineRouter.get('/privatisation', (req, res) => rendre(req, res, '/privatisation'));
vitrineRouter.get('/traiteur', (req, res) => rendre(req, res, '/traiteur'));

async function rendre(req, res, chemin) {
  const menu = chemin === '/carte' ? await carteOuVide() : [];
  const page = definitionsPages(menu).find(p => p.chemin === chemin);
  const donnees = [
    jsonLdRestaurant(page.avecMenu ? menu : []),
    jsonLdPage({ nom: page.nom, description: page.description, chemin }),
    jsonLdFilAriane([[NOM, '/'], [page.nom, chemin]]),
  ];
  // Même politique que l'accueil : une carte modifiée au salon se voit tout de suite.
  res.set('Cache-Control', 'no-cache');
  res.render('vitrine', {
    titre: page.titre,
    meta: metaTags({ titre: page.titre, description: page.description, chemin }),
    jsonLd: donnees.map(scriptJsonLd).join('\n'),
    contenu: page.contenu,
    chemin,
  });
}
