import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/** Les soirées. Ce qui compte ici tient en une phrase : on ne vend jamais
 *  deux fois la dernière place. Le reste — l'affichage, le texte — se
 *  rattrape ; une place vendue deux fois, non. */

process.env.PAIEMENT_SIMULE = '1';
delete process.env.STRIPE_SECRET_KEY;

let db, ev, reg, baseDispo = false;
let client, compteur = 0;

// Un seul hook : node:test lance les `before()` de tête de fichier en
// PARALLÈLE, pas l'un après l'autre. Deux hooks se marcheraient dessus.
before(async () => {
  try {
    db = await import('../server/db.js');
    ev = await import('../server/lib/evenements.js');
    reg = await import('../server/lib/reglement.js');
    await db.query('SELECT 1');
    baseDispo = true;
  } catch {
    return;
  }
  const suffixe = String(Date.now()).slice(-6);
  client = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ('Soir','Test','soir@example.test',$1,$1,'1990-01-01') RETURNING *`,
    ['9997' + suffixe]
  );
});

after(async () => {
  if (!baseDispo) return;
  await db.executer(`DELETE FROM evenement_reservations WHERE client_id = $1`, [client.id]);
  await db.executer(`DELETE FROM evenements WHERE slug LIKE 'test-soiree-%'`);
  await db.executer(`DELETE FROM clients WHERE id = $1`, [client.id]);
  await db.pool.end();
});

/** Une soirée neuve, visible, dans trois semaines. */
async function soiree(places = 10, prixCents = 4500) {
  const slug = `test-soiree-${Date.now()}-${++compteur}`;
  return db.une(
    `INSERT INTO evenements (slug, titre, accroche, texte, date, heure, prix_cents, places, visible)
     VALUES ($1, 'Soirée d''essai', 'Une accroche.', 'Un paragraphe.\n\nUn autre.',
             (CURRENT_DATE + 21)::text, '20:00', $2, $3, true) RETURNING *`,
    [slug, prixCents, places]
  );
}

test('le total est recalculé depuis le prix en base, jamais reçu du navigateur', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(10, 4500);
  const r = await ev.reserverPlaces(e.id, client.id, 3);
  assert.ok(r.reservation, r.erreur);
  assert.equal(r.reservation.total_cents, 13500, '3 × 45 €');
  assert.equal(r.reservation.statut, 'a_payer');
});

test('on ne vend pas plus de places qu\'il n\'en reste', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(4);
  assert.ok((await ev.reserverPlaces(e.id, client.id, 3)).reservation);
  const trop = await ev.reserverPlaces(e.id, client.id, 3);
  assert.match(trop.erreur, /pas assez de places/);
  // Et le refus ne doit pas dire combien il en reste : la capacité d'une
  // soirée regarde le restaurant, pas le client.
  assert.doesNotMatch(trop.erreur, /\d/, 'le message ne doit contenir aucun chiffre');
  assert.ok((await ev.reserverPlaces(e.id, client.id, 1)).reservation);
  assert.match((await ev.reserverPlaces(e.id, client.id, 1)).erreur, /complète/);
});

test('deux réservations simultanées ne vendent pas deux fois la dernière place', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  // Le cas qu'on ne peut pas rattraper : deux clients cliquent à la même
  // seconde. La transaction verrouille la soirée, donc le second lit le
  // décompte APRÈS l'écriture du premier.
  const e = await soiree(1);
  const [a, b] = await Promise.all([
    ev.reserverPlaces(e.id, client.id, 1),
    ev.reserverPlaces(e.id, client.id, 1),
  ]);
  const reussies = [a, b].filter(x => x.reservation).length;
  assert.equal(reussies, 1, 'une seule des deux doit aboutir');
  const { vendues } = await ev.placesRestantes(e.id);
  assert.equal(vendues, 1, 'jamais plus que la capacité');
});

test('une soirée invisible ou passée n\'accepte rien', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const cachee = await soiree(10);
  await db.executer(`UPDATE evenements SET visible = false WHERE id = $1`, [cachee.id]);
  assert.match((await ev.reserverPlaces(cachee.id, client.id, 1)).erreur, /pas ouvert/);

  const passee = await soiree(10);
  await db.executer(`UPDATE evenements SET date = '2020-01-01' WHERE id = $1`, [passee.id]);
  assert.match((await ev.reserverPlaces(passee.id, client.id, 1)).erreur, /passé/);
});

test('un nombre de places absurde est refusé', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(100);
  for (const n of [0, -3, 'deux', 21]) {
    assert.ok((await ev.reserverPlaces(e.id, client.id, n)).erreur, `refus attendu pour ${n}`);
  }
});

test('une réservation non payée rend sa place au bout d\'un moment', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  // Sans cette péremption, un panier abandonné à l'écran de carte bancaire
  // rendrait une soirée complète sans avoir rien vendu.
  const e = await soiree(2);
  const r = await ev.reserverPlaces(e.id, client.id, 2);
  assert.equal((await ev.placesRestantes(e.id)).restantes, 0);

  await db.executer(
    `UPDATE evenement_reservations SET cree_le = now() - interval '2 hours' WHERE id = $1`,
    [r.reservation.id]);
  assert.equal((await ev.placesRestantes(e.id)).restantes, 2, 'la place est rendue à la vente');

  // Une réservation PAYÉE, elle, ne se périme jamais.
  const p = await ev.reserverPlaces(e.id, client.id, 1);
  await ev.confirmerReservation(p.reservation.id);
  await db.executer(
    `UPDATE evenement_reservations SET cree_le = now() - interval '2 hours' WHERE id = $1`,
    [p.reservation.id]);
  assert.equal((await ev.placesRestantes(e.id)).restantes, 1, 'une place payée reste acquise');
});

test('le paiement d\'une place se rattache bien à sa réservation', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(10, 3200);
  const r = await ev.reserverPlaces(e.id, client.id, 2);
  const ouvert = await reg.ouvrirPaiementEvenement(r.reservation.id);
  assert.ok(ouvert.paiement, ouvert.erreur);
  assert.equal(ouvert.paiement.montant_cents, 6400);
  assert.equal(ouvert.paiement.mode, 'immediat', 'une place se paie, elle ne se réserve pas sur empreinte');
  assert.equal(ouvert.paiement.evenement_reservation_id, r.reservation.id);

  // Rouvrir ne crée pas un second paiement : deux onglets bloqueraient
  // sinon deux fois le montant.
  const encore = await reg.ouvrirPaiementEvenement(r.reservation.id);
  assert.equal(encore.paiement.id, ouvert.paiement.id);

  // Le webhook confirme la place.
  const fait = await reg.marquerPayeEtEncaisser(ouvert.paiement.intention_id);
  assert.equal(fait.reservation.statut, 'confirmee');
});

test('annuler libère la place', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(5);
  const r = await ev.reserverPlaces(e.id, client.id, 4);
  await ev.confirmerReservation(r.reservation.id);
  assert.equal((await ev.placesRestantes(e.id)).restantes, 1);

  assert.ok((await ev.annulerReservation(r.reservation.id, -1)).erreur, 'pas la réservation d\'autrui');
  const a = await ev.annulerReservation(r.reservation.id, client.id);
  assert.ok(!a.erreur, a.erreur);
  assert.equal((await ev.placesRestantes(e.id)).restantes, 5);
});

test('une soirée qui a vendu ne se supprime pas', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const e = await soiree(10);
  assert.equal(await ev.obstacleASuppression(e.id), null, 'rien de vendu : elle part');

  const r = await ev.reserverPlaces(e.id, client.id, 1);
  await ev.confirmerReservation(r.reservation.id);
  const obstacle = await ev.obstacleASuppression(e.id);
  assert.match(obstacle, /vendu/);
  assert.match(obstacle, /Visible/, 'le refus doit dire quoi faire à la place');
});

test('paragraphes() découpe sur les lignes vides', async () => {
  assert.deepEqual(ev.paragraphes('Un.\n\nDeux.\n\n\nTrois.'), ['Un.', 'Deux.', 'Trois.']);
  assert.deepEqual(ev.paragraphes('  '), []);
  assert.deepEqual(ev.paragraphes(null), []);
  // Un simple retour à la ligne ne coupe pas : c'est une respiration, pas
  // un nouveau paragraphe.
  assert.deepEqual(ev.paragraphes('Une phrase\nqui continue.'), ['Une phrase\nqui continue.']);
});
