import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aujourdHui, heureParis, creneauPasse } from '../server/lib/jours.js';

/** Le serveur tourne en UTC, le restaurant à Paris. Le 20 novembre 2026 à
 *  20 h 15 UTC, il est 21 h 15 à Puteaux : un retrait à 21 h 00 est passé,
 *  pas un retrait à 21 h 30. C'était l'inverse avant — le site proposait
 *  encore 21 h 00, et même 20 h 30. */

const hiver = new Date('2026-11-20T20:15:00Z'); // 21:15 à Paris (UTC+1)
const ete = new Date('2026-07-01T20:15:00Z');   // 22:15 à Paris (UTC+2)

test("l'heure et la date sont celles de Paris, pas du serveur", () => {
  assert.equal(heureParis(hiver), '21:15');
  assert.equal(heureParis(ete), '22:15');
  assert.equal(aujourdHui(hiver), '2026-11-20');
  // 23 h 30 UTC = 0 h 30 à Paris : on est déjà le lendemain.
  assert.equal(aujourdHui(new Date('2026-11-20T23:30:00Z')), '2026-11-21');
  assert.equal(heureParis(new Date('2026-11-20T23:30:00Z')), '00:30');
});

test('un créneau du jour déjà commencé à Paris n’est plus proposé', () => {
  assert.equal(creneauPasse('2026-11-20', '20:30', hiver), true);
  assert.equal(creneauPasse('2026-11-20', '21:00', hiver), true);
  assert.equal(creneauPasse('2026-11-20', '21:15', hiver), true, 'le créneau de maintenant est passé');
  assert.equal(creneauPasse('2026-11-20', '21:30', hiver), false);
  assert.equal(creneauPasse('2026-07-01', '22:00', ete), true, 'en été, deux heures d’écart');
  assert.equal(creneauPasse('2026-07-01', '22:30', ete), false);
  assert.equal(creneauPasse('2026-11-21', '12:00', hiver), false, 'demain reste ouvert');
  assert.equal(creneauPasse('2026-11-19', '23:00', hiver), true, 'hier est passé');
});

test('le délai de préparation écarte les retraits trop proches', () => {
  // 21 h 15 à Paris, délai de 30 minutes : 21 h 45 est le premier retrait possible.
  assert.equal(creneauPasse('2026-11-20', '21:30', hiver, 30), true);
  assert.equal(creneauPasse('2026-11-20', '21:40', hiver, 30), true);
  assert.equal(creneauPasse('2026-11-20', '21:45', hiver, 30), false, 'pile 30 minutes après : accepté');
  assert.equal(creneauPasse('2026-11-20', '22:00', hiver, 30), false);
  // Le délai qui franchit minuit : à 23 h 50 avec 30 min, 00 h 15 le lendemain est trop tôt.
  const tard = new Date('2026-11-20T22:50:00Z'); // 23:50 à Paris
  assert.equal(creneauPasse('2026-11-21', '00:15', tard, 30), true);
  assert.equal(creneauPasse('2026-11-21', '00:30', tard, 30), false);
  assert.equal(creneauPasse('2026-11-20', '22:00', hiver, 0), false, 'délai 0 : comme avant');
});
