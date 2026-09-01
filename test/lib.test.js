import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euros, versCents } from '../server/lib/money.js';
import { normaliserTelephone, telephoneValide } from '../server/lib/phone.js';
import { emailValide, dateValide, heureValide, dateNaissanceValide } from '../server/lib/validate.js';
import { aujourdHui, jourVoisin, libelleJourCourt } from '../server/lib/jours.js';

test('euros() formate en français', () => {
  assert.equal(euros(2000), '20 €');
  assert.equal(euros(1650), '16,50 €');
  assert.equal(euros(0), '0 €');
});

test('versCents() accepte virgule et point, rejette le reste', () => {
  assert.equal(versCents('16,50'), 1650);
  assert.equal(versCents('16.50'), 1650);
  assert.equal(versCents('20'), 2000);
  assert.equal(versCents('abc'), null);
  assert.equal(versCents('-5'), null);
  assert.equal(versCents('5,999'), null); // trois décimales : refusé
});

test('normaliserTelephone() fait converger les variantes d\'un même numéro', () => {
  const variantes = ['06 12 34 56 78', '0612345678', '+33612345678', '33612345678'];
  const normalises = new Set(variantes.map(normaliserTelephone));
  assert.equal(normalises.size, 1, `attendu une seule forme, obtenu : ${[...normalises]}`);
  assert.equal([...normalises][0], '33612345678');
});

test('telephoneValide() distingue un numéro plausible d\'un texte quelconque', () => {
  assert.equal(telephoneValide('06 12 34 56 78'), true);
  assert.equal(telephoneValide('01 23 45 67 89'), true);
  assert.equal(telephoneValide('123'), false);
  assert.equal(telephoneValide('bonjour'), false);
});

test('emailValide()', () => {
  assert.equal(emailValide('a@b.fr'), true);
  assert.equal(emailValide('pas-un-email'), false);
  assert.equal(emailValide('a@b'), false);
});

test('dateValide() rejette les dates calendaires impossibles', () => {
  assert.equal(dateValide('2026-08-25'), true);
  assert.equal(dateValide('2026-02-30'), false); // 30 février n'existe pas
  assert.equal(dateValide('25/08/2026'), false);
});

test('heureValide()', () => {
  assert.equal(heureValide('19:30'), true);
  assert.equal(heureValide('23:59'), true);
  assert.equal(heureValide('24:00'), false);
  assert.equal(heureValide('9:30'), false); // exige deux chiffres
});

test('dateNaissanceValide() exige au moins 13 ans et une année plausible', () => {
  const ilYA5Ans = new Date(); ilYA5Ans.setFullYear(ilYA5Ans.getFullYear() - 5);
  const ilYA30Ans = new Date(); ilYA30Ans.setFullYear(ilYA30Ans.getFullYear() - 30);
  assert.equal(dateNaissanceValide(ilYA5Ans.toISOString().slice(0, 10)), false);
  assert.equal(dateNaissanceValide(ilYA30Ans.toISOString().slice(0, 10)), true);
  assert.equal(dateNaissanceValide('1850-01-01'), false);
});

test('libelleJourCourt() dit le jour comme un client le lirait', () => {
  const ajd = aujourdHui();
  assert.equal(libelleJourCourt(ajd), "aujourd'hui");
  assert.equal(libelleJourCourt(jourVoisin(ajd, 1)), 'demain');
  assert.equal(libelleJourCourt(jourVoisin(ajd, -1)), 'hier');

  // Une date lointaine de l'année en cours : jour et mois abrégé, sans
  // l'année — la répéter à chaque ligne n'apprendrait rien.
  const annee = ajd.slice(0, 4);
  const loin = libelleJourCourt(`${annee}-01-15`) === "aujourd'hui" ? null : libelleJourCourt(`${annee}-01-15`);
  if (loin) {
    assert.match(loin, /^15 janv\.?$/);
  }

  // Une autre année, en revanche, doit être datée : « 15 janv. 2019 ».
  assert.match(libelleJourCourt('2019-01-15'), /2019/);
});
