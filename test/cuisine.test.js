import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ETATS, LIBELLES, suivant } from '../server/lib/cuisine.js';

test('suivant() décrit la file de la cuisine, et s\'arrête à « prête »', () => {
  assert.equal(suivant('confirmee'), 'vue');
  assert.equal(suivant('vue'), 'en_preparation');
  assert.equal(suivant('en_preparation'), 'prete');
  assert.equal(suivant('prete'), null);
  assert.equal(suivant('encaissee'), null);
});

test('chaque état de la file porte un libellé', () => {
  for (const e of ETATS) assert.ok(LIBELLES[e], `libellé manquant pour ${e}`);
});

/* Comme pour la fidélité, ce qui suit touche une vraie base : l'anti-retour
   est garanti par la condition SQL, pas par le JavaScript, donc seul un vrai
   Postgres peut le démontrer. Se saute si aucune base n'est joignable. */
let db = null, cuisine = null, baseDispo = false;

before(async () => {
  try {
    db = await import('../server/db.js');
    cuisine = await import('../server/lib/cuisine.js');
    await db.une('SELECT 1');
    baseDispo = true;
  } catch { baseDispo = false; }
});

after(async () => { if (db) await db.pool.end().catch(() => {}); });

async function commandeDEssai() {
  const suffixe = String(Date.now()).slice(-7);
  const client = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ('Cuis','Test','c@example.test',$1,$1,'1990-01-01') RETURNING *`,
    ['9992' + suffixe]
  );
  const cmd = await db.une(
    `INSERT INTO commandes (reference, client_id, type, date, heure, total_cents, statut)
     VALUES ($1, $2, 'emporter', '2030-01-01', '12:00', 1000, 'confirmee') RETURNING *`,
    ['CUI-' + suffixe, client.id]
  );
  return { client, cmd, nettoyer: () => db.executer(`DELETE FROM clients WHERE id = $1`, [client.id]) };
}

test('une commande avance état par état', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd, nettoyer } = await commandeDEssai();
  try {
    for (const vers of ['vue', 'en_preparation', 'prete']) {
      const r = await cuisine.avancer(cmd.id, vers);
      assert.ok(!r.erreur, r.erreur);
      assert.equal(r.commande.statut, vers);
    }
    const finale = await db.une(`SELECT * FROM commandes WHERE id = $1`, [cmd.id]);
    assert.ok(finale.vue_le && finale.preparation_le && finale.prete_le,
      'chaque passage doit poser son horodatage');
  } finally { await nettoyer(); }
});

test('une commande ne recule jamais', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd, nettoyer } = await commandeDEssai();
  try {
    await cuisine.avancer(cmd.id, 'vue');
    await cuisine.avancer(cmd.id, 'en_preparation');

    // Deux écrans de cuisine ouverts sur le même passe se doublent : un
    // « lue » arrivé en retard ne doit pas ramener la commande en arrière.
    const tardif = await cuisine.avancer(cmd.id, 'vue');
    assert.ok(tardif.erreur, 'un retour en arrière devait être refusé');
    const etat = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
    assert.equal(etat.statut, 'en_preparation');
  } finally { await nettoyer(); }
});

test('« prête » ne se pose qu\'une fois, même sur un double clic', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd, nettoyer } = await commandeDEssai();
  try {
    await cuisine.avancer(cmd.id, 'prete');
    const premier = await db.une(`SELECT prete_le FROM commandes WHERE id = $1`, [cmd.id]);
    const second = await cuisine.avancer(cmd.id, 'prete');
    assert.ok(second.erreur);
    const apres = await db.une(`SELECT prete_le FROM commandes WHERE id = $1`, [cmd.id]);
    assert.equal(apres.prete_le.getTime(), premier.prete_le.getTime());
  } finally { await nettoyer(); }
});

test('un plat retombé repart au feu, et son horodatage est effacé', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd, nettoyer } = await commandeDEssai();
  try {
    await cuisine.avancer(cmd.id, 'prete');
    await cuisine.ramenerEnPreparation(cmd.id);
    const etat = await db.une(`SELECT statut, prete_le FROM commandes WHERE id = $1`, [cmd.id]);
    assert.equal(etat.statut, 'en_preparation');
    assert.equal(etat.prete_le, null);
  } finally { await nettoyer(); }
});

test('le tableau ne montre que ce qui est encore au feu', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd, nettoyer } = await commandeDEssai();
  try {
    const dansLeTableau = async () => {
      const t = await cuisine.tableauDuJour('2030-01-01');
      return t.commandes.some(c => c.id === cmd.id);
    };
    assert.equal(await dansLeTableau(), true);

    // Encaissée, elle ne concerne plus le piano.
    await db.executer(`UPDATE commandes SET statut = 'encaissee' WHERE id = $1`, [cmd.id]);
    assert.equal(await dansLeTableau(), false);
  } finally { await nettoyer(); }
});
