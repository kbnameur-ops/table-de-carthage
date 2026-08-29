import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliserPeriode, joursDeLaPeriode, jourSemaineDe, saisonDe,
  pivoterServeurEtJour, JOURS_SEMAINE, SAISONS,
} from '../server/lib/analyse.js';

test('jourSemaineDe() lit le calendrier en ISO (1 = lundi, 7 = dimanche)', () => {
  // Fait de calendrier vérifiable : le 1er janvier 2024 est tombé un lundi.
  assert.equal(jourSemaineDe('2024-01-01'), 1);
  assert.equal(jourSemaineDe('2024-01-07'), 7);
  assert.equal(jourSemaineDe('2024-01-08'), 1);
});

test('saisonDe() découpe l\'année en quatre trimestres calendaires', () => {
  assert.equal(saisonDe('2024-01-15'), 'Hiver');
  assert.equal(saisonDe('2024-02-28'), 'Hiver');
  assert.equal(saisonDe('2024-04-01'), 'Printemps');
  assert.equal(saisonDe('2024-07-14'), 'Été');
  assert.equal(saisonDe('2024-10-31'), 'Automne');
  assert.equal(saisonDe('2024-12-25'), 'Hiver');
});

test('joursDeLaPeriode() énumère chaque date, bornes incluses', () => {
  assert.deepEqual(joursDeLaPeriode('2024-02-27', '2024-03-01'),
    ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']); // 2024 est bissextile
  assert.deepEqual(joursDeLaPeriode('2024-05-05', '2024-05-05'), ['2024-05-05']);
});

test('normaliserPeriode() retombe sur 30 jours quand rien n\'est fourni', () => {
  const { debut, fin, periode } = normaliserPeriode({});
  assert.equal(periode, 'personnalise');
  assert.equal(joursDeLaPeriode(debut, fin).length, 30);
});

test('normaliserPeriode() reconnaît les périodes prêtes à l\'emploi', () => {
  const { debut, fin, periode } = normaliserPeriode({ periode: '7j' });
  assert.equal(periode, '7j');
  assert.equal(joursDeLaPeriode(debut, fin).length, 7);
});

test('normaliserPeriode() remet une période inversée dans l\'ordre', () => {
  const { debut, fin } = normaliserPeriode({ debut: '2026-08-20', fin: '2026-08-01' });
  assert.equal(debut, '2026-08-01');
  assert.equal(fin, '2026-08-20');
});

test('normaliserPeriode() ignore une date invalide plutôt que de planter', () => {
  const { debut, fin } = normaliserPeriode({ debut: 'n-importe-quoi', fin: '2026-08-29' });
  assert.equal(fin, '2026-08-29');
  assert.equal(joursDeLaPeriode(debut, fin).length, 30); // repli sur 30 jours
});

test('normaliserPeriode() plafonne un recul démesuré à un an', () => {
  const { debut, fin } = normaliserPeriode({ debut: '1990-01-01', fin: '2026-08-29' });
  assert.equal(fin, '2026-08-29');
  assert.ok(joursDeLaPeriode(debut, fin).length <= 367,
    'une faute de saisie dans l\'URL ne doit pas agréger toute l\'histoire du restaurant');
});

test('pivoterServeurEtJour() met en grille sans perdre les cases vides', () => {
  const lignes = [
    { date: '2031-01-01', serveur: 'Alice', ca_cents: 1000 },
    { date: '2031-01-02', serveur: 'Bob', ca_cents: 500 },
  ];
  const { serveurs, grille } = pivoterServeurEtJour(lignes, ['2031-01-01', '2031-01-02', '2031-01-03']);
  assert.deepEqual(serveurs, ['Alice', 'Bob']); // triée par CA décroissant
  assert.deepEqual(grille, [
    { date: '2031-01-01', parServeur: [1000, 0] },
    { date: '2031-01-02', parServeur: [0, 500] },
    { date: '2031-01-03', parServeur: [0, 0] },
  ]);
});

/* Ce qui suit touche une vraie base : les agrégats SQL (FILTER, GROUP BY,
   les compteurs bigint que Postgres rend en texte) ne se vérifient pas sur
   un objet simulé. Se saute si aucune base n'est joignable. */
let db = null, analyse = null, baseDispo = false;
let service = null, table = null, client = null;
const D1 = '2031-05-01', D2 = '2031-05-02', D3 = '2031-05-03'; // jeudi, vendredi, samedi

/** Un seul `before()` pour la mise en place et le jeu de données : deux
 *  hooks de haut niveau enregistrés séparément s'exécutent en parallèle
 *  chez node:test, pas l'un après l'autre — le second se retrouvait à
 *  écrire des commandes avant que la table et le client du premier
 *  n'existent. */
before(async () => {
  try {
    db = await import('../server/db.js');
    analyse = await import('../server/lib/analyse.js');
    const tables = await import('../server/lib/tables.js');
    await db.une('SELECT 1');
    baseDispo = true;

    service = await db.une(
      `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, actif)
       VALUES ($1, 'L', '12:00', '14:00', 0, 0, false) RETURNING *`,
      ['Essai analyse ' + Date.now()]
    );
    [table] = await tables.creerTables(service.id, { nom: 'Analyse', couverts: 4 });
    client = await db.une(
      `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance)
       VALUES ('Ana','Lyse','ana.lyse@example.test',$1,$1,'1990-01-01') RETURNING *`,
      ['9994' + String(Date.now()).slice(-6)]
    );
  } catch { baseDispo = false; return; }
  await semerJeuDEssai();
});

after(async () => {
  if (!baseDispo) return;
  await db.executer(`DELETE FROM clients WHERE id = $1`, [client.id]); // cascade commandes, lignes, tablees
  await db.executer(`DELETE FROM tables_resto WHERE id = $1`, [table.id]);
  await db.executer(`DELETE FROM services WHERE id = $1`, [service.id]);
  await db.pool.end().catch(() => {});
});

let compteurRef = 0;
async function commandeDEssai({ date, type, statut, prisParNom = null, remiseCents = 0, lignes }) {
  let tableeId = null;
  if (type === 'sur_place') {
    const t = await db.une(
      `INSERT INTO tablees (table_id, client_id, date, statut, fermee_le)
       VALUES ($1, $2, $3, 'fermee', now()) RETURNING id`,
      [table.id, client.id, date]
    );
    tableeId = t.id;
  }
  const total = lignes.reduce((s, l) => s + l.prix_cents * l.quantite, 0);
  const cmd = await db.une(
    `INSERT INTO commandes
       (reference, client_id, type, tablee_id, date, heure, total_cents, statut, remise_cagnotte_cents, pris_par_nom)
     VALUES ($1, $2, $3, $4, $5, '19:00', $6, $7, $8, $9) RETURNING *`,
    ['ANA-' + Date.now() + '-' + (++compteurRef), client.id, type, tableeId, date, total, statut, remiseCents, prisParNom]
  );
  for (const l of lignes) {
    await db.executer(
      `INSERT INTO commande_lignes (commande_id, nom, prix_cents, quantite) VALUES ($1, $2, $3, $4)`,
      [cmd.id, l.nom, l.prix_cents, l.quantite]
    );
  }
  return cmd;
}

/** Le jeu de données rejoué par tous les tests qui suivent :
 *
 *   D1 (jeudi) — A : sur place,  encaissée,  Alice   → 2×Kafteji + 1×Couscous = 1800
 *                B : à emporter, confirmée (pas encaissée), sans serveur    =  500
 *                C : sur place,  ANNULÉE                                   → exclue de tout
 *   D2 (vendredi) — rien : un jour sans une seule commande.
 *   D3 (samedi)  — D : sur place,  encaissée, sans serveur, remise 100     =  800 - 100 = 700
 *                  E : à emporter, encaissée, Bob                          → 3×Kafteji = 1500
 *
 *  Chiffre d'affaires attendu : 1800 + 700 + 1500 = 4000. Commandes qui
 *  comptent (tout sauf annulée) : 4. Plats vendus (tout sauf annulée,
 *  encaissée ou non) : 2+1 (A) + 1 (B) + 1 (D) + 3 (E) = 8. */
async function semerJeuDEssai() {
  await commandeDEssai({
    date: D1, type: 'sur_place', statut: 'encaissee', prisParNom: 'Alice',
    lignes: [{ nom: 'Kafteji', prix_cents: 500, quantite: 2 }, { nom: 'Couscous', prix_cents: 800, quantite: 1 }],
  });
  await commandeDEssai({
    date: D1, type: 'emporter', statut: 'confirmee',
    lignes: [{ nom: 'Kafteji', prix_cents: 500, quantite: 1 }],
  });
  await commandeDEssai({
    date: D1, type: 'sur_place', statut: 'annulee',
    lignes: [{ nom: 'Kafteji', prix_cents: 500, quantite: 9 }], // ne doit apparaître nulle part
  });
  await commandeDEssai({
    date: D3, type: 'sur_place', statut: 'encaissee', remiseCents: 100,
    lignes: [{ nom: 'Couscous', prix_cents: 800, quantite: 1 }],
  });
  await commandeDEssai({
    date: D3, type: 'emporter', statut: 'encaissee', prisParNom: 'Bob',
    lignes: [{ nom: 'Kafteji', prix_cents: 500, quantite: 3 }],
  });
}

test('indicateurs() sépare le chiffre d\'affaires encaissé du volume de demande', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const k = await analyse.indicateurs(D1, D3);
  assert.equal(k.nb_commandes, 4, 'la commande annulée ne compte pas');
  assert.equal(k.nb_emporter, 2);
  assert.equal(k.nb_sur_place, 2);
  assert.equal(k.nb_encaissees, 3, 'la commande confirmée-non-payée ne compte pas encore');
  assert.equal(k.ca_cents, 4000);
  assert.equal(k.cagnotte_cents, 100);
  assert.equal(k.nbPlats, 8, 'les plats de la commande annulée ne comptent pas, ceux non encaissés si');
  assert.equal(k.panierMoyenCents, Math.round(4000 / 3));
});

test('caParJour() complète les jours muets à zéro plutôt que de sauter la date', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const jours = await analyse.caParJour(D1, D3);
  assert.equal(jours.length, 3);
  assert.deepEqual(jours.map(j => j.date), [D1, D2, D3]);

  const [j1, j2, j3] = jours;
  assert.equal(j1.nbCommandes, 2); assert.equal(j1.caCents, 1800);
  assert.equal(j2.nbCommandes, 0); assert.equal(j2.caCents, 0);
  assert.equal(j3.nbCommandes, 2); assert.equal(j3.caCents, 2200);
});

test('platsVendus() compte la demande, pas seulement ce qui est payé', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const plats = await analyse.platsVendus(D1, D3);
  const kafteji = plats.find(p => p.nom === 'Kafteji');
  const couscous = plats.find(p => p.nom === 'Couscous');
  // 2 (A, encaissée) + 1 (B, seulement confirmée) + 3 (E) = 6 — la commande
  // annulée (9 kaftejis) ne doit laisser aucune trace.
  assert.equal(kafteji.quantite, 6);
  assert.equal(kafteji.ca_cents, 2 * 500 + 1 * 500 + 3 * 500);
  assert.equal(couscous.quantite, 2); // A + D
  assert.equal(couscous.ca_cents, 800 + 800); // brut, avant remise de cagnotte
});

test('caParServeur() range une commande sans serveur dans un repère à part', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const serveurs = await analyse.caParServeur(D1, D3);
  const alice = serveurs.find(s => s.serveur === 'Alice');
  const bob = serveurs.find(s => s.serveur === 'Bob');
  const sans = serveurs.find(s => s.serveur === 'Sans serveur (client)');

  assert.equal(alice.nbCommandes, 1); assert.equal(alice.caCents, 1800);
  assert.equal(bob.nbCommandes, 1); assert.equal(bob.caCents, 1500);
  // B (non encaissée, 0 €) et D (encaissée, 700 €) partagent ce repère.
  assert.equal(sans.nbCommandes, 2); assert.equal(sans.caCents, 700);

  // La somme des lignes retombe exactement sur le chiffre d'affaires total :
  // personne n'a été compté deux fois, personne n'a disparu.
  const total = serveurs.reduce((s, l) => s + l.caCents, 0);
  assert.equal(total, 4000);

  // Trié par CA décroissant : la ligne la plus utile arrive en premier.
  assert.deepEqual(serveurs.map(s => s.serveur), ['Alice', 'Bob', 'Sans serveur (client)']);
});

test('caParServeurEtJour() garde le détail jour par jour, cohérent avec pivoterServeurEtJour', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const lignes = await analyse.caParServeurEtJour(D1, D3);
  const jours = analyse.joursDeLaPeriode(D1, D3);
  const { serveurs, grille } = analyse.pivoterServeurEtJour(lignes, jours);

  const idx = (nom) => serveurs.indexOf(nom);
  const [gD1, gD2, gD3] = grille;
  assert.equal(gD1.parServeur[idx('Alice')], 1800);
  assert.equal(gD1.parServeur[idx('Sans serveur (client)')], 0); // B, pas encore encaissée
  assert.deepEqual(gD2.parServeur, serveurs.map(() => 0)); // jour muet
  assert.equal(gD3.parServeur[idx('Bob')], 1500);
  assert.equal(gD3.parServeur[idx('Sans serveur (client)')], 700);
});

test('caParJourSemaine() moyenne sur les jours du calendrier, pas seulement ceux avec commande', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const semaine = await analyse.caParJourSemaine(D1, D3);
  const parNom = Object.fromEntries(semaine.map(j => [j.jourSemaine, j]));

  assert.equal(parNom['Jeudi'].caMoyenCents, 1800);
  assert.equal(parNom['Jeudi'].commandesMoyennes, 2);
  // Vendredi (D2) n'a eu aucune commande : la moyenne doit être tirée à
  // zéro, et non absente du tableau — c'est tout l'intérêt du correctif.
  assert.equal(parNom['Vendredi'].nbJoursObserves, 1);
  assert.equal(parNom['Vendredi'].caMoyenCents, 0);
  assert.equal(parNom['Samedi'].caMoyenCents, 2200);
  // Un jour de semaine absent de la période entière : zéro partout, jamais
  // une division par zéro qui remonterait NaN à l'écran.
  assert.equal(parNom['Lundi'].nbJoursObserves, 0);
  assert.equal(parNom['Lundi'].caMoyenCents, 0);
  assert.equal(JOURS_SEMAINE.length, 7);
});

test('caParMois() et caParSaison() couvrent le mois même sans un seul jour vendeur', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const mois = await analyse.caParMois(D1, D3);
  assert.equal(mois.length, 1);
  assert.equal(mois[0].mois, '2031-05');
  assert.equal(mois[0].nb_jours, 3); // D1, D2 (muet) et D3
  assert.equal(mois[0].nb_commandes, 4);
  assert.equal(mois[0].ca_cents, 4000);

  const saisons = await analyse.caParSaison(D1, D3);
  assert.equal(saisons.length, SAISONS.length);
  const printemps = saisons.find(s => s.saison === 'Printemps');
  assert.equal(printemps.nbJours, 3);
  assert.equal(printemps.caCents, 4000);
  for (const s of saisons) if (s.saison !== 'Printemps') assert.equal(s.caCents, 0);
});

test('lignesDetaillees() rend une ligne par plat, exclut jamais rien pour l\'export brut', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const lignes = await analyse.lignesDetaillees(D1, D3);
  // Contrairement aux agrégats plus haut, l'export brut garde tout, y
  // compris la commande annulée : à l'analyste de filtrer, pas au CSV de
  // décider à sa place ce qui compte.
  const total = lignes.reduce((s, l) => s + l.quantite, 0);
  assert.equal(total, 2 + 1 + 1 + 9 + 1 + 3); // A (2 lignes) + B + C + D + E
  assert.ok(lignes.some(l => l.statut === 'annulee'));
  assert.ok(lignes.every(l => l.serveur), 'aucune ligne ne doit rester sans repère de serveur');
});
