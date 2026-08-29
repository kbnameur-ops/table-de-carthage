import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* La salle et la cuisine ont chacune leur porte d'entrée, mais un seul
   verrou. Ce qui se casse ici ne se voit pas à l'écran : ça se voit dans le
   navigateur d'un commis, sous la forme d'un « trop de redirections ». */

let db = null, personnel = null, baseDispo = false;
const employes = [];

before(async () => {
  try {
    db = await import('../server/db.js');
    personnel = await import('../server/lib/personnel.js');
    await db.une('SELECT 1');
    baseDispo = true;
  } catch { baseDispo = false; }
});

after(async () => {
  if (!baseDispo) return;
  for (const id of employes) await db.executer(`DELETE FROM employes WHERE id = $1`, [id]);
  await db.pool.end().catch(() => {});
});

let compteur = 0;
async function employeDEssai({ service, cuisine, actif = true }) {
  const e = await db.une(
    `INSERT INTO employes (prenom, nom, identifiant, mot_de_passe, actif, acces_service, acces_cuisine)
     VALUES ('Essai','Personnel',$1,'x',$2,$3,$4) RETURNING id`,
    [`essai.${Date.now()}.${++compteur}`, actif, service, cuisine]
  );
  employes.push(e.id);
  return e;
}

const session = (id) => ({ session: { role: 'serveur', sujetId: id } });

test('apresConnexion garde en cuisine qui entre par la cuisine', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { apresConnexion } = personnel;
  assert.equal(apresConnexion({ acces_service: true, acces_cuisine: true }, 'cuisine'), '/cuisine');
  assert.equal(apresConnexion({ acces_service: true, acces_cuisine: true }, 'service'), '/service');
  // Un serveur sans accès cuisine qui pousse la porte du passe n'y reste pas :
  // sinon il rebondirait entre la porte et un écran qui lui est fermé.
  assert.equal(apresConnexion({ acces_service: true, acces_cuisine: false }, 'cuisine'), '/service');
  assert.equal(apresConnexion({ acces_service: false, acces_cuisine: true }, 'service'), '/cuisine');
});

test('une porte ne renvoie jamais vers un écran fermé', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { dejaConnecte } = personnel;

  const commis = await employeDEssai({ service: false, cuisine: true });
  // Le cas qui bouclait : un commis de cuisine arrive sur la porte de la
  // salle. On l'emmène au passe, jamais au plan de salle.
  assert.equal(await dejaConnecte(session(commis.id), 'service'), '/cuisine');
  assert.equal(await dejaConnecte(session(commis.id), 'cuisine'), '/cuisine');

  const serveur = await employeDEssai({ service: true, cuisine: false });
  assert.equal(await dejaConnecte(session(serveur.id), 'cuisine'), '/service');
  assert.equal(await dejaConnecte(session(serveur.id), 'service'), '/service');

  const deuxCasquettes = await employeDEssai({ service: true, cuisine: true });
  assert.equal(await dejaConnecte(session(deuxCasquettes.id), 'cuisine'), '/cuisine');
  assert.equal(await dejaConnecte(session(deuxCasquettes.id), 'service'), '/service');
});

test('une fiche désactivée renvoie au formulaire, pas à un écran', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { dejaConnecte } = personnel;
  const parti = await employeDEssai({ service: true, cuisine: true, actif: false });
  assert.equal(await dejaConnecte(session(parti.id), 'service'), null);
  assert.equal(await dejaConnecte(session(parti.id), 'cuisine'), null);
  assert.equal(await dejaConnecte({ session: { role: 'client' } }, 'cuisine'), null);
});

test('le salon passe par les deux portes', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { dejaConnecte } = personnel;
  const admin = { session: { role: 'admin', sujetId: 1 } };
  assert.equal(await dejaConnecte(admin, 'cuisine'), '/cuisine');
  assert.equal(await dejaConnecte(admin, 'service'), '/service');
});
