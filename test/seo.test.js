import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estPrive, robotsTxt, sitemapXml, metaTags, htmlCarte, jsonLdRestaurant, scriptJsonLd, cheminPhoto, euro,
} from '../server/lib/seo.js';

const menu = [{
  id: 'couscous', name: 'Couscous', tagline: 'Semoule & bouillon',
  items: [
    { name: 'Couscous <Royal>', desc: 'Agneau', price: 20, veg: false, star: true, photo: 'couscous-royal' },
    { name: 'Légumes', desc: 'Veg', price: 14.5, veg: true, star: false },
  ],
}];

test('les espaces privés sont repérés, les pages publiques non', () => {
  for (const p of ['/salon', '/salon/carte', '/service/caisse', '/cuisine', '/compte', '/paiement/ABC', '/table/xyz',
    '/api/carte', '/reserver/confirmation', '/commander/confirmation', '/evenements/soiree/confirmation', '/evenements/reglement/R1']) {
    assert.equal(estPrive(p), true, p);
  }
  for (const p of ['/', '/carte', '/reserver', '/commander', '/privatisation', '/traiteur', '/evenements/soiree', '/tableau']) {
    assert.equal(estPrive(p), false, p);
  }
});

test('robots.txt interdit les espaces privés et annonce le sitemap', () => {
  const r = robotsTxt();
  assert.match(r, /Disallow: \/salon\//);
  assert.match(r, /Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
});

test('sitemap : URL absolues, échappées', () => {
  const x = sitemapXml([{ chemin: '/carte' }, { chemin: '/a?b=1&c=2' }]);
  assert.match(x, /<loc>https:\/\/[^<]+\/carte<\/loc>/);
  assert.match(x, /b=1&amp;c=2/);
});

test('metaTags : canonique et og en index, robots seul en noindex', () => {
  const a = metaTags({ titre: 'T', description: 'D "x"', chemin: '/carte' });
  assert.match(a, /rel="canonical" href="https:\/\/[^"]+\/carte"/);
  assert.match(a, /og:image" content="https:\/\//);
  assert.match(a, /twitter:card/);
  assert.match(a, /content="D &quot;x&quot;"/);
  const b = metaTags({ chemin: '/compte', noindex: true });
  assert.match(b, /noindex/);
  assert.doesNotMatch(b, /canonical/);
});

test("htmlCarte échappe les textes et pose une vignette WebP pour les photos d'amorçage", () => {
  const h = htmlCarte(menu);
  assert.match(h, /Couscous &lt;Royal&gt;/);
  assert.doesNotMatch(h, /<Royal>/);
  assert.match(h, /couscous-royal-160\.webp/);
  assert.match(h, /20 €/);
  assert.match(h, /14,50 €/);
});

test('cheminPhoto : nom d\'amorçage, chemin local et URL distante', () => {
  assert.equal(cheminPhoto('bouza'), '/assets/img/plats/bouza.jpg');
  assert.equal(cheminPhoto('/uploads/plats/x.jpg'), '/uploads/plats/x.jpg');
  assert.equal(cheminPhoto('https://blob.example/x.jpg'), 'https://blob.example/x.jpg');
  assert.equal(euro(12), '12 €');
});

test('JSON-LD : menu complet, prix en chaîne, </script> neutralisé', () => {
  const d = jsonLdRestaurant(menu);
  assert.equal(d['@type'], 'Restaurant');
  assert.equal(d.hasMenu.hasMenuSection[0].hasMenuItem[0].offers.price, '20.00');
  const s = scriptJsonLd({ x: '</script><b>' });
  assert.equal(s.slice('<script type="application/ld+json">'.length, -'</script>'.length).includes('</script>'), false);
});
