import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gainPour } from '../server/lib/fidelite.js';

test('gainPour() arrondit vers le bas', () => {
  assert.equal(gainPour(2000, 10), 200);
  assert.equal(gainPour(1650, 10), 165);
  assert.equal(gainPour(999, 10), 99);   // 99,9 centimes → 99
  assert.equal(gainPour(5, 10), 0);      // rien à créditer sur 5 centimes
  assert.equal(gainPour(0, 10), 0);
  assert.equal(gainPour(2000, 0), 0);
});

/* Les tests qui suivent touchent une vraie base : ils vérifient des
   propriétés que seul Postgres garantit (unicité du gain, refus du
   découvert), et qu'un faux objet ne prouverait pas. Ils se sautent d'eux-
   mêmes si aucune base n'est joignable, pour qu'un `npm test` reste utile
   sur un poste qui n'en a pas. */
let db = null, fid = null, enc = null, baseDispo = false;

before(async () => {
  try {
    db = await import('../server/db.js');
    fid = await import('../server/lib/fidelite.js');
    enc = await import('../server/lib/encaissement.js');
    await db.une('SELECT 1');
    baseDispo = true;
  } catch {
    baseDispo = false;
  }
});

after(async () => { if (db) await db.pool.end().catch(() => {}); });

/** Deux clients jetables et une commande à eux, nettoyés en sortie. */
async function jeuDEssai(total = 2000) {
  const suffixe = String(Date.now()).slice(-7);
  const a = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ('Test','Un','t1@example.test',$1,$1,'1990-01-01') RETURNING *`,
    ['9990' + suffixe]
  );
  const b = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ('Test','Deux','t2@example.test',$1,$1,'1990-01-01') RETURNING *`,
    ['9991' + suffixe]
  );
  const cmd = await db.une(
    `INSERT INTO commandes (reference, client_id, type, date, heure, total_cents, statut)
     VALUES ($1, $2, 'emporter', '2030-01-01', '12:00', $3, 'confirmee') RETURNING *`,
    ['TST-' + suffixe, a.id, total]
  );
  return { a, b, cmd, nettoyer: () => db.executer(`DELETE FROM clients WHERE id = ANY($1::int[])`, [[a.id, b.id]]) };
}

test('un encaissement crédite le taux, et ne crédite qu\'une fois', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, cmd, nettoyer } = await jeuDEssai(2000);
  try {
    const taux = await fid.tauxFidelite();
    const premier = await enc.encaisserCommande(cmd.id);
    assert.equal(premier.gain, gainPour(2000, taux));
    assert.equal(await fid.soldeDe(a.id), gainPour(2000, taux));

    // Rejouer l'encaissement ne doit rien ajouter : c'est ce qui protège
    // d'un double clic ou d'une requête réémise.
    const second = await enc.encaisserCommande(cmd.id);
    assert.ok(second.erreur, 'un second encaissement doit être refusé');
    assert.equal(await fid.soldeDe(a.id), gainPour(2000, taux));
  } finally { await nettoyer(); }
});

test('la cagnotte dépensée ne regénère pas de points sur elle-même', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, cmd, nettoyer } = await jeuDEssai(2000);
  try {
    const taux = await fid.tauxFidelite();
    await fid.ajuster({ clientId: a.id, deltaCents: 500, libelle: 'test' });

    const r = await enc.encaisserCommande(cmd.id, { remiseCents: 500 });
    assert.equal(r.remise, 500);
    assert.equal(r.aPayer, 1500);
    // Le gain porte sur les 15 € réellement payés, pas sur les 20 € affichés.
    assert.equal(r.gain, gainPour(1500, taux));
    assert.equal(await fid.soldeDe(a.id), gainPour(1500, taux));
  } finally { await nettoyer(); }
});

test('un transfert déplace le solde entre deux clients', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, b, nettoyer } = await jeuDEssai();
  try {
    await fid.ajuster({ clientId: a.id, deltaCents: 1000, libelle: 'test' });
    const r = await fid.transferer({ deClientId: a.id, versTelephone: b.telephone_saisi, montantCents: 400 });
    assert.ok(!r.erreur, r.erreur);
    assert.equal(await fid.soldeDe(a.id), 600);
    assert.equal(await fid.soldeDe(b.id), 400);
  } finally { await nettoyer(); }
});

test('un transfert plus grand que le solde est refusé, sans rien bouger', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, b, nettoyer } = await jeuDEssai();
  try {
    await fid.ajuster({ clientId: a.id, deltaCents: 300, libelle: 'test' });
    const r = await fid.transferer({ deClientId: a.id, versTelephone: b.telephone_saisi, montantCents: 500 });
    assert.ok(r.erreur, 'le transfert devait être refusé');
    assert.equal(await fid.soldeDe(a.id), 300);
    assert.equal(await fid.soldeDe(b.id), 0);
  } finally { await nettoyer(); }
});

test('on ne s\'envoie pas de points à soi-même', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, nettoyer } = await jeuDEssai();
  try {
    await fid.ajuster({ clientId: a.id, deltaCents: 1000, libelle: 'test' });
    const r = await fid.transferer({ deClientId: a.id, versTelephone: a.telephone_saisi, montantCents: 100 });
    assert.ok(r.erreur);
    assert.equal(await fid.soldeDe(a.id), 1000);
  } finally { await nettoyer(); }
});

test('la base refuse un solde négatif, quoi qu\'en dise le code appelant', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { a, nettoyer } = await jeuDEssai();
  try {
    await assert.rejects(
      () => db.executer(`UPDATE clients SET cagnotte_cents = -1 WHERE id = $1`, [a.id]),
      /cagnotte/i
    );
  } finally { await nettoyer(); }
});
