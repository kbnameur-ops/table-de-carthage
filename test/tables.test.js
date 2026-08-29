import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* Les tables de la salle. Deux choses ne se voient qu'en tapant dans une
   vraie base : le QR obligatoire posé à la création — sans lui, l'ajout
   d'une table échoue au niveau de Postgres — et le refus de supprimer une
   table qui porte des additions, où c'est une contrainte de cohérence qui
   sanctionne, pas le JavaScript. */

let db = null, tables = null, baseDispo = false;
let service = null;
const clients = [];

before(async () => {
  try {
    db = await import('../server/db.js');
    tables = await import('../server/lib/tables.js');
    await db.une('SELECT 1');
    baseDispo = true;
  } catch { baseDispo = false; }
  if (!baseDispo) return;
  service = await db.une(
    `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, actif)
     VALUES ($1, 'L', '12:00', '14:00', 0, 0, false) RETURNING *`,
    ['Essai tables ' + Date.now()]
  );
});

after(async () => {
  if (!baseDispo) return;
  for (const id of clients) await db.executer(`DELETE FROM clients WHERE id = $1`, [id]);
  if (service) await db.executer(`DELETE FROM services WHERE id = $1`, [service.id]);
  await db.pool.end().catch(() => {});
});

let compteur = 0;
async function clientDEssai() {
  const suffixe = String(Date.now()).slice(-6) + String(++compteur % 10);
  const c = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
     VALUES ('Tab','Test','t@example.test',$1,$1,'1990-01-01') RETURNING id`,
    ['9993' + suffixe]
  );
  clients.push(c.id);
  return c;
}

async function tableeSur(tableId, statut) {
  const c = await clientDEssai();
  return db.une(
    `INSERT INTO tablees (table_id, client_id, date, statut)
     VALUES ($1, $2, CURRENT_DATE, $3) RETURNING *`,
    [tableId, c.id, statut]
  );
}

test('codeQr() rend seize caractères hexadécimaux, jamais deux fois les mêmes', () => {
  const vus = new Set();
  for (let i = 0; i < 500; i++) {
    const c = tables?.codeQr?.() ?? null;
    if (c === null) return; // module non chargé : le test de base s'en chargera
    assert.match(c, /^[0-9a-f]{16}$/);
    vus.add(c);
  }
  assert.equal(vus.size, 500);
});

test('créer une table lui pose son QR', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  // Le QR est NOT NULL depuis la migration : une création qui l'oublie
  // n'échoue pas discrètement, elle rend une erreur 500 à l'écran.
  const [t1] = await tables.creerTables(service.id, { nom: 'Solo', couverts: 4 });
  assert.equal(t1.nom, 'Solo', 'une table seule garde son nom tel quel');
  assert.match(t1.code_qr, /^[0-9a-f]{16}$/);
  assert.equal(t1.couverts, 4);
  assert.equal(t1.actif, true);
});

test('créer un lot numérote les tables et donne un QR distinct à chacune', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const lot = await tables.creerTables(service.id, { nom: 'Terrasse', couverts: 2, nombre: 3 });
  assert.deepEqual(lot.map(x => x.nom), ['Terrasse 1', 'Terrasse 2', 'Terrasse 3']);
  assert.equal(new Set(lot.map(x => x.code_qr)).size, 3);
  // Les positions se suivent : c'est l'ordre d'affichage du plan de salle.
  const p = lot.map(x => x.position);
  assert.deepEqual(p, [p[0], p[0] + 1, p[0] + 2]);
});

test('une table qui n\'a jamais servi se supprime', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const [neuve] = await tables.creerTables(service.id, { nom: 'Éphémère', couverts: 2 });
  assert.equal(await tables.obstacleASuppression(neuve.id), null);

  const r = await tables.supprimerTable(neuve.id);
  assert.ok(!r.erreur, r.erreur);
  // une() rend undefined quand il n'y a pas de ligne.
  assert.ok(!(await db.une(`SELECT id FROM tables_resto WHERE id = $1`, [neuve.id])),
    'la table devait avoir disparu');
});

test('une table qui porte une addition fermée ne se supprime pas', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const [vecue] = await tables.creerTables(service.id, { nom: 'Vestige', couverts: 4 });
  await tableeSur(vecue.id, 'fermee');

  const r = await tables.supprimerTable(vecue.id);
  assert.ok(r.erreur, 'la suppression devait être refusée');
  assert.match(r.erreur, /addition/, 'le refus doit dire pourquoi');
  // Et surtout : la table est toujours là. Sans ce garde-fou, la cascade
  // emportait la tablée, et la commande orpheline violait la contrainte de
  // cohérence — l'écran rendait une erreur 500 au lieu d'une explication.
  assert.ok(await db.une(`SELECT id FROM tables_resto WHERE id = $1`, [vecue.id]));
});

test('une table occupée en ce moment se refuse en le disant', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const [occupee] = await tables.creerTables(service.id, { nom: 'Occupée', couverts: 4 });
  await tableeSur(occupee.id, 'ouverte');

  const r = await tables.supprimerTable(occupee.id);
  assert.ok(r.erreur);
  assert.match(r.erreur, /en ce moment/);
});

test('retirer du service se fait sans rien supprimer', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const [hs] = await tables.creerTables(service.id, { nom: 'Retirée', couverts: 4 });
  const tb = await tableeSur(hs.id, 'fermee');

  await db.executer(`UPDATE tables_resto SET actif = false WHERE id = $1`, [hs.id]);
  const apres = await db.une(`SELECT actif FROM tables_resto WHERE id = $1`, [hs.id]);
  assert.equal(apres.actif, false);
  // C'est là tout l'intérêt du décochage : l'addition reste consultable.
  assert.ok(await db.une(`SELECT id FROM tablees WHERE id = $1`, [tb.id]));
});

test('le décompte des additions dit quelles tables sont encore effaçables', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const [neuve] = await tables.creerTables(service.id, { nom: 'Vierge', couverts: 2 });
  const [servie] = await tables.creerTables(service.id, { nom: 'Servie', couverts: 2 });
  await tableeSur(servie.id, 'fermee');
  await tableeSur(servie.id, 'fermee');

  const n = await tables.additionsParTable(service.id);
  assert.equal(n[neuve.id], 0);
  assert.equal(n[servie.id], 2);
});
