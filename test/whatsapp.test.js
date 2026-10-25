import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configWhatsApp, nettoyerVariable, corpsMessage, alerterWhatsApp } from '../server/lib/whatsapp.js';

const ENV = {
  WHATSAPP_TOKEN: 'jeton',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  WHATSAPP_DESTINATAIRES: '+33 6 12 34 56 78, 33700000000',
  SITE_URL: 'https://exemple.fr/',
};
const NOTIF = { titre: 'Nouvelle réservation — 4 couverts', detail: 'Leila B. · sam. 3 oct. à 20:00', lien: '/salon/reservations?date=2026-10-03' };

test('configWhatsApp() reste inactif tant que la configuration est incomplète', () => {
  assert.equal(configWhatsApp({}), null);
  assert.equal(configWhatsApp({ ...ENV, WHATSAPP_DESTINATAIRES: ' , ' }), null);
  assert.equal(configWhatsApp({ ...ENV, WHATSAPP_TOKEN: '' }), null);
  const c = configWhatsApp(ENV);
  assert.deepEqual(c.destinataires, ['33612345678', '33700000000']);
  assert.equal(c.modele, 'alerte_salon');
  assert.equal(c.site, 'https://exemple.fr');
});

test('nettoyerVariable() respecte les règles de Meta', () => {
  assert.equal(nettoyerVariable('a\nb\t c     d'), 'a · b · c d');
  assert.equal(nettoyerVariable(''), '—');
  assert.equal(nettoyerVariable('x'.repeat(2000)).length, 900);
});

test('corpsMessage() remplit le modèle avec titre, détail et lien absolu', () => {
  const corps = corpsMessage(configWhatsApp(ENV), '33612345678', NOTIF);
  assert.equal(corps.type, 'template');
  assert.equal(corps.template.name, 'alerte_salon');
  assert.deepEqual(corps.template.components[0].parameters.map(p => p.text),
    [NOTIF.titre, NOTIF.detail, 'https://exemple.fr/salon/reservations?date=2026-10-03']);
});

test('alerterWhatsApp() prévient chaque destinataire et ne lève jamais', async () => {
  const appels = [];
  const ok = await alerterWhatsApp(NOTIF, { env: ENV, fetchFn: async (url, opts) => {
    appels.push({ url, opts });
    return { ok: true, json: async () => ({}) };
  } });
  assert.equal(ok, 2);
  assert.equal(appels[0].url, 'https://graph.facebook.com/v21.0/123/messages');
  assert.equal(appels[0].opts.headers.Authorization, 'Bearer jeton');
  assert.deepEqual(appels.map(a => JSON.parse(a.opts.body).to), ['33612345678', '33700000000']);

  const erreurs = console.error; console.error = () => {};
  try {
    const echec = await alerterWhatsApp(NOTIF, { env: ENV, fetchFn: async (url, opts) => {
      if (JSON.parse(opts.body).to === '33700000000') throw new Error('réseau');
      return { ok: false, status: 401, json: async () => ({ error: { message: 'jeton expiré' } }) };
    } });
    assert.equal(echec, 0);
  } finally { console.error = erreurs; }

  assert.equal(await alerterWhatsApp(NOTIF, { env: {}, fetchFn: () => assert.fail('aucun appel attendu') }), 0);
});
