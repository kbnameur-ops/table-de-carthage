import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* Le paiement en ligne. Sans compte Stripe, on ne peut pas prouver qu'une
   vraie carte est débitée — mais tout le reste se prouve, et c'est là que
   sont les erreurs qui coûtent de l'argent : une commande impayée qui part
   en cuisine, une empreinte débitée deux fois, un gain de fidélité crédité
   sur un webhook rejoué.

   Le mode simulation (PAIEMENT_SIMULE=1 sans clé Stripe) rejoue les
   réponses de la banque, si bien que toute la machine à états tourne pour
   de vrai contre un vrai Postgres. */

process.env.PAIEMENT_SIMULE = '1';
delete process.env.STRIPE_SECRET_KEY;

const { paiementActif, paiementSimule, paiementDisponible, creerIntention,
        cleSecreteInvalide, modeStripe, definirEnregistrement,
        clePublique, clePubliqueEstSecrete, diagnosticCleSecrete } =
  await import('../server/lib/paiement.js');

test('la fonctionnalité dort tant qu\'aucune clé Stripe n\'est posée', () => {
  // C'est ce qui rend le déploiement sans danger : mettre ce code en ligne
  // ne change rien tant que le compte Stripe n'est pas prêt.
  assert.equal(paiementActif(), false);
});

test('la simulation exige l\'absence de clé Stripe', async () => {
  assert.equal(paiementSimule(), true);
  assert.equal(paiementDisponible(), true);

  // Avec une clé réelle, la simulation doit s'éteindre : il ne doit exister
  // aucun moyen de déclarer un paiement abouti sur une installation
  // réellement branchée à Stripe.
  process.env.STRIPE_SECRET_KEY = 'sk_test_factice';
  assert.equal(paiementSimule(), false);
  assert.equal(paiementActif(), true);
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(paiementSimule(), true);
});

test('une clé mal collée éteint le paiement au lieu de bloquer les commandes', async () => {
  // Le cas vécu : une valeur qui n'est pas une clé Stripe avait allumé le
  // paiement — donc exigé une carte à chaque commande — tout en le rendant
  // incapable de fonctionner. Le tunnel devenait un cul-de-sac : plus
  // personne ne pouvait commander. Une configuration douteuse doit rendre
  // la fonctionnalité inerte, jamais bloquante.
  const mauvaises = [
    'sogzoh-tABCDEFGHsri0',            // ce qui était réellement posé
    'STRIPE_SECRET_KEY=sk_live_abc',   // le nom de la variable dans sa valeur
    'whsec_abc',                       // le secret du webhook à la place
    'pk_live_abc',                     // la clé publique à la place
  ];
  for (const cle of mauvaises) {
    process.env.STRIPE_SECRET_KEY = cle;
    assert.equal(paiementActif(), false, `« ${cle} » ne doit pas allumer le paiement`);
    assert.equal(cleSecreteInvalide(), true, `« ${cle} » doit être signalée`);
    assert.equal(modeStripe(), null);
  }

  for (const cle of ['sk_test_51abc', 'sk_live_51abc', 'rk_live_51abc']) {
    process.env.STRIPE_SECRET_KEY = cle;
    assert.equal(paiementActif(), true, `« ${cle} » est une clé valable`);
    assert.equal(cleSecreteInvalide(), false);
  }

  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(cleSecreteInvalide(), false, 'aucune clé posée n\'est pas une erreur');
});

test('creerIntention() refuse un montant ou un mode aberrant', async () => {
  for (const montant of [0, -100, 12.5, NaN, null]) {
    await assert.rejects(() => creerIntention({ montantCents: montant, mode: 'empreinte', cle: 'x' }),
      /montant invalide/, `un montant de ${montant} devait être refusé`);
  }
  await assert.rejects(() => creerIntention({ montantCents: 100, mode: 'gratuit', cle: 'x' }),
    /mode de paiement inconnu/);
});

/* Ce qui suit touche une vraie base : la machine à états du règlement
   s'appuie sur des index uniques partiels et des contraintes que seul
   Postgres fait respecter. Se saute si aucune base n'est joignable. */
let db = null, reg = null, cuisine = null, analyse = null, baseDispo = false;
let service = null, table = null;
const clients = [];

before(async () => {
  try {
    db = await import('../server/db.js');
    reg = await import('../server/lib/reglement.js');
    cuisine = await import('../server/lib/cuisine.js');
    analyse = await import('../server/lib/analyse.js');
    const tables = await import('../server/lib/tables.js');
    await db.une('SELECT 1');
    baseDispo = true;

    service = await db.une(
      `INSERT INTO services (nom, jours, debut, fin, tables_total, couverts_total, actif)
       VALUES ($1, 'L', '12:00', '14:00', 0, 0, false) RETURNING *`,
      ['Essai paiement ' + Date.now()]
    );
    [table] = await tables.creerTables(service.id, { nom: 'Paiement', couverts: 4 });
  } catch { baseDispo = false; }
});

after(async () => {
  if (!baseDispo) return;
  for (const id of clients) await db.executer(`DELETE FROM clients WHERE id = $1`, [id]);
  if (table) await db.executer(`DELETE FROM tables_resto WHERE id = $1`, [table.id]);
  if (service) await db.executer(`DELETE FROM services WHERE id = $1`, [service.id]);
  await db.pool.end().catch(() => {});
});

const DATE = '2032-03-04';
let compteur = 0;

async function clientDEssai(cagnotteCents = 0) {
  const suffixe = String(Date.now()).slice(-6) + String(++compteur % 10);
  const c = await db.une(
    `INSERT INTO clients (prenom, nom, email, telephone, telephone_saisi, date_naissance, cagnotte_cents)
     VALUES ('Pay','Test','pay@example.test',$1,$1,'1990-01-01',$2) RETURNING *`,
    ['9996' + suffixe, cagnotteCents]
  );
  clients.push(c.id);
  return c;
}

/** Une commande à emporter dans l'état où le tunnel la laisse quand le
 *  paiement est actif : enregistrée, mais pas encore payée. */
async function commandeAPayer(totalCents = 4000, { cagnotte = 0 } = {}) {
  const client = await clientDEssai(cagnotte);
  const cmd = await db.une(
    `INSERT INTO commandes (reference, client_id, type, date, heure, total_cents, statut)
     VALUES ($1, $2, 'emporter', $3, '19:00', $4, 'a_payer') RETURNING *`,
    ['PAY-' + Date.now() + '-' + (++compteur), client.id, DATE, totalCents]
  );
  await db.executer(
    `INSERT INTO commande_lignes (commande_id, nom, prix_cents, quantite) VALUES ($1, 'Couscous', $2, 1)`,
    [cmd.id, totalCents]
  );
  return { client, cmd };
}

test('une commande pas encore payée ne part pas en cuisine', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();

  // C'est l'invariant qui protège le restaurant : sans lui, un panier
  // abandonné à l'écran de paiement ferait travailler le piano pour rien.
  assert.equal(cuisine.colonneDe('a_payer'), null);
  assert.ok(!cuisine.STATUTS_AU_PASSE.includes('a_payer'));

  const tableau = await cuisine.tableauDuJour(DATE);
  assert.ok(!tableau.commandes.some(c => c.id === cmd.id),
    'une commande « à régler » ne doit pas figurer au passe');
});

test('l\'empreinte autorisée envoie la commande en cuisine, une seule fois', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  assert.ok(!ouvert.erreur, ouvert.erreur);
  assert.equal(ouvert.paiement.mode, 'empreinte');
  assert.equal(ouvert.paiement.montant_cents, 4000);

  const r = await reg.marquerAutorise(ouvert.paiement.intention_id);
  assert.equal(r.paiement.statut, 'autorise');

  const apres = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'en_attente', 'la commande doit maintenant être visible au passe');
  const tableau = await cuisine.tableauDuJour(DATE);
  assert.ok(tableau.commandes.some(c => c.id === cmd.id));

  // Stripe réémet ses webhooks : le second passage ne doit rien refaire.
  const rejoue = await reg.marquerAutorise(ouvert.paiement.intention_id);
  assert.ok(rejoue.ignore, 'un webhook rejoué ne doit rien changer');
});

test('rouvrir le paiement d\'une commande retombe sur la même empreinte', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  const a = await reg.ouvrirPaiementCommande(cmd.id);
  const b = await reg.ouvrirPaiementCommande(cmd.id);

  // Deux empreintes bloqueraient deux fois le montant sur la carte du
  // client — c'est le genre d'erreur qui se voit sur un relevé bancaire.
  assert.equal(a.paiement.id, b.paiement.id);
  assert.equal(a.paiement.intention_id, b.paiement.intention_id);

  const n = await db.une(
    `SELECT COUNT(*)::int AS n FROM paiements WHERE commande_id = $1 AND statut = 'a_confirmer'`,
    [cmd.id]);
  assert.equal(n.n, 1);
});

test('la base refuse deux paiements vivants sur la même commande', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { client, cmd } = await commandeAPayer();
  await reg.ouvrirPaiementCommande(cmd.id);

  // L'index unique partiel est la vraie garantie : le JavaScript peut se
  // faire doubler par deux requêtes simultanées, pas Postgres.
  await assert.rejects(
    () => db.une(
      `INSERT INTO paiements (client_id, commande_id, montant_cents, mode, intention_id)
       VALUES ($1, $2, 4000, 'empreinte', $3) RETURNING *`,
      [client.id, cmd.id, 'pi_doublon_' + Date.now()]
    ),
    /duplicate key|idx_paiement_commande_vivant/
  );
});

test('débiter l\'empreinte encaisse et crédite la fidélité sur ce qui est payé', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { client, cmd } = await commandeAPayer(4000, { cagnotte: 500 });
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  await reg.marquerAutorise(ouvert.paiement.intention_id);

  // 40 € autorisés, 5 € réglés en points : la carte ne doit porter que 35 €.
  const r = await reg.capturerEtEncaisser(ouvert.paiement.id, { remiseCents: 500 });
  assert.ok(!r.erreur, r.erreur);
  assert.equal(r.paiement.statut, 'capture');
  assert.equal(r.paiement.capture_cents, 3500);

  const apres = await db.une(`SELECT statut, remise_cagnotte_cents FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'encaissee');
  assert.equal(apres.remise_cagnotte_cents, 500);

  // Le gain porte sur les 35 € réellement payés, pas sur les 40 € affichés :
  // sinon la cagnotte se régénérerait elle-même.
  const gain = await db.une(
    `SELECT delta_cents FROM fidelite_mouvements WHERE commande_id = $1 AND type = 'gain'`, [cmd.id]);
  assert.equal(gain.delta_cents, 350);

  const solde = await db.une(`SELECT cagnotte_cents FROM clients WHERE id = $1`, [client.id]);
  assert.equal(solde.cagnotte_cents, 350, '5 € dépensés, 3,50 € gagnés');

  // Un second clic ne redébite pas.
  const encore = await reg.capturerEtEncaisser(ouvert.paiement.id, { remiseCents: 500 });
  assert.ok(encore.erreur, 'un paiement déjà débité doit être refusé');
});

test('une cagnotte qui couvre tout libère l\'empreinte au lieu de débiter zéro', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer(2000, { cagnotte: 2000 });
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  await reg.marquerAutorise(ouvert.paiement.intention_id);

  // Stripe refuserait une capture de 0 : on rend l'empreinte.
  const r = await reg.capturerEtEncaisser(ouvert.paiement.id, { remiseCents: 2000 });
  assert.ok(!r.erreur, r.erreur);
  assert.equal(r.paiement.statut, 'libere');
  assert.equal(r.paiement.capture_cents, 0);

  const apres = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'encaissee', 'la commande reste réglée, mais par les points');
});

test('libérer une empreinte annule la commande sans rien débiter', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  await reg.marquerAutorise(ouvert.paiement.intention_id);

  const r = await reg.libererPaiement(ouvert.paiement.id);
  assert.ok(!r.erreur, r.erreur);
  assert.equal(r.paiement.statut, 'libere');
  assert.equal(r.paiement.capture_cents, 0);

  const apres = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'annulee');
});

test('une empreinte déjà débitée ne se libère pas', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  await reg.marquerAutorise(ouvert.paiement.intention_id);
  await reg.capturerEtEncaisser(ouvert.paiement.id);

  // Rendre l'argent après l'avoir pris passe par un remboursement, pas par
  // une libération : le dire plutôt que de faire semblant.
  const r = await reg.libererPaiement(ouvert.paiement.id);
  assert.ok(r.erreur);
  assert.match(r.erreur, /rembours/);
});

test('un paiement refusé laisse la commande hors cuisine, et retentable', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);

  await reg.marquerEchoue(ouvert.paiement.intention_id, 'carte refusée');
  const apres = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'a_payer', 'rien ne part en cuisine sur un refus');

  // L'échec ayant libéré la place, le client peut retenter : c'est ce qui
  // évite de lui faire ressaisir toute sa commande.
  const seconde = await reg.ouvrirPaiementCommande(cmd.id);
  assert.ok(!seconde.erreur, seconde.erreur);
  assert.notEqual(seconde.paiement.id, ouvert.paiement.id);
});

test('un même événement Stripe n\'est traité qu\'une fois', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const id = 'evt_test_' + Date.now();
  assert.equal(await reg.evenementDejaVu(id, 'payment_intent.succeeded'), false);
  assert.equal(await reg.evenementDejaVu(id, 'payment_intent.succeeded'), true);
  await db.executer(`DELETE FROM paiement_evenements WHERE id = $1`, [id]);
});

test('le règlement immédiat encaisse dans la foulée', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer(1500);
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id, { mode: 'immediat' });
  assert.equal(ouvert.paiement.mode, 'immediat');

  const r = await reg.marquerPayeEtEncaisser(ouvert.paiement.intention_id);
  assert.equal(r.paiement.statut, 'capture');
  assert.equal(r.paiement.capture_cents, 1500);

  const apres = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [cmd.id]);
  assert.equal(apres.statut, 'encaissee');

  const rejoue = await reg.marquerPayeEtEncaisser(ouvert.paiement.intention_id);
  assert.ok(rejoue.ignore, 'un webhook rejoué ne doit pas réencaisser');
});

test('une commande annulée ou déjà réglée n\'ouvre pas de paiement', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer();
  await db.executer(`UPDATE commandes SET statut = 'annulee' WHERE id = $1`, [cmd.id]);
  const r = await reg.ouvrirPaiementCommande(cmd.id);
  assert.ok(r.erreur);
  assert.match(r.erreur, /annulée/);
});

test('une commande « à régler » ne compte ni en demande ni en chiffre d\'affaires', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer(9900);

  // Un panier abandonné à l'écran de paiement gonflerait la demande d'achats
  // qui n'ont jamais eu lieu — et fausserait la prévision bâtie dessus.
  const k = await analyse.indicateurs(DATE, DATE);
  const plats = await analyse.platsVendus(DATE, DATE);
  const compte = plats.reduce((s, p) => s + p.quantite, 0);

  await db.executer(`UPDATE commandes SET statut = 'en_attente' WHERE id = $1`, [cmd.id]);
  const k2 = await analyse.indicateurs(DATE, DATE);
  const plats2 = await analyse.platsVendus(DATE, DATE);
  const compte2 = plats2.reduce((s, p) => s + p.quantite, 0);

  assert.equal(k2.nb_commandes, k.nb_commandes + 1, 'confirmée, elle compte');
  assert.equal(compte2, compte + 1, 'et ses plats aussi');
});

test('creerIntention rattache la fiche client quand il y en a une', async (t) => {
  // En simulation, aucune requête ne part chez Stripe : ce test vérifie que
  // la signature accepte la fiche sans rien casser, et que le paiement
  // reste possible sans elle — une panne de création de fiche ne doit
  // jamais empêcher de payer.
  const avec = await creerIntention({
    montantCents: 1000, mode: 'empreinte', cle: 'k-avec', clientStripeId: 'cus_test',
  });
  const sans = await creerIntention({ montantCents: 1000, mode: 'empreinte', cle: 'k-sans' });
  assert.match(avec.id, /^pi_sim_/);
  assert.match(sans.id, /^pi_sim_/);
});

test('definirEnregistrement dit oui ou non, sans rien supposer', async () => {
  assert.deepEqual(await definirEnregistrement('pi_x', true), { enregistrer: true });
  assert.deepEqual(await definirEnregistrement('pi_x', false), { enregistrer: false });
  // Une valeur absente vaut « non » : l'enregistrement ne s'obtient que
  // par un oui explicite.
  assert.deepEqual(await definirEnregistrement('pi_x', undefined), { enregistrer: false });
});

test('choisirEnregistrementCarte n\'accepte que le paiement du bon client', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { client, cmd } = await commandeAPayer(3000);
  const r = await reg.ouvrirPaiementCommande(cmd.id);
  assert.ok(r.paiement, r.erreur);

  // Un autre client ne peut pas décider de l'enregistrement de cette carte.
  const vole = await reg.choisirEnregistrementCarte(r.paiement.id, true, { clientId: -1 });
  assert.ok(vole.erreur, 'un client étranger doit être refusé');

  const ok = await reg.choisirEnregistrementCarte(r.paiement.id, true, { clientId: client.id });
  assert.equal(ok.enregistrer, true);
  let relu = await db.une(`SELECT carte_enregistree FROM paiements WHERE id = $1`, [r.paiement.id]);
  assert.equal(relu.carte_enregistree, true);

  // Décocher doit défaire : sinon une case cochée puis décochée laisserait
  // la carte enregistrée contre l'avis du client.
  await reg.choisirEnregistrementCarte(r.paiement.id, false, { clientId: client.id });
  relu = await db.une(`SELECT carte_enregistree FROM paiements WHERE id = $1`, [r.paiement.id]);
  assert.equal(relu.carte_enregistree, false);

  // Une fois autorisé, le choix n'est plus modifiable.
  await reg.marquerAutorise(r.paiement.intention_id);
  const tard = await reg.choisirEnregistrementCarte(r.paiement.id, true, { clientId: client.id });
  assert.ok(tard.erreur, 'un paiement déjà traité ne se modifie plus');
});

test('une commande bloquée « à régler » se dénoue en deux issues seulement', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');

  // Abandonner : personne ne viendra.
  const a = await commandeAPayer(2000);
  const ra = await reg.denouerCommandeAPayer(a.cmd.id, 'abandonner');
  assert.equal(ra.statut, 'annulee', ra.erreur);
  let relu = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [a.cmd.id]);
  assert.equal(relu.statut, 'annulee');

  // Reprendre au comptoir : la commande rejoint le circuit ordinaire et
  // part en cuisine. Aucune carte n'a été débitée.
  const b = await commandeAPayer(2500);
  const rb = await reg.denouerCommandeAPayer(b.cmd.id, 'au_comptoir');
  assert.equal(rb.statut, 'en_attente', rb.erreur);
  relu = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [b.cmd.id]);
  assert.equal(relu.statut, 'en_attente');

  // Une action inventée ne fait rien.
  const c = await commandeAPayer(1500);
  assert.ok((await reg.denouerCommandeAPayer(c.cmd.id, 'encaisser')).erreur);
  relu = await db.une(`SELECT statut FROM commandes WHERE id = $1`, [c.cmd.id]);
  assert.equal(relu.statut, 'a_payer', 'la commande ne doit pas avoir bougé');

  // Une commande qui n'attend plus de paiement ne se dénoue pas.
  assert.ok((await reg.denouerCommandeAPayer(b.cmd.id, 'abandonner')).erreur);
});

test('dénouer ferme l\'intention en attente, sinon plus rien n\'est payable', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer(3000);
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  assert.ok(ouvert.paiement, ouvert.erreur);

  await reg.denouerCommandeAPayer(cmd.id, 'au_comptoir');
  const p = await db.une(`SELECT statut, echec_motif FROM paiements WHERE id = $1`, [ouvert.paiement.id]);
  assert.equal(p.statut, 'echoue');
  assert.match(p.echec_motif, /comptoir/);
  // L'index unique n'accepte qu'un paiement vivant : laisser celui-ci
  // debout interdirait toute nouvelle tentative sur cette commande.
  assert.equal(await reg.paiementVivantCommande(cmd.id), null);
});

test('une empreinte déjà autorisée ne se dénoue pas : c\'est un arbitrage', async (t) => {
  if (!baseDispo) return t.skip('pas de base de données joignable');
  const { cmd } = await commandeAPayer(4000);
  const ouvert = await reg.ouvrirPaiementCommande(cmd.id);
  await reg.marquerAutorise(ouvert.paiement.intention_id);
  // marquerAutorise fait déjà sortir la commande de 'a_payer' : le refus
  // vient de là, et c'est bien ce qu'on veut vérifier — de l'argent est
  // bloqué sur la carte, seul Débiter ou Libérer doit y toucher.
  const r = await reg.denouerCommandeAPayer(cmd.id, 'abandonner');
  assert.ok(r.erreur, 'une commande avec empreinte prise ne se dénoue pas');
  const p = await db.une(`SELECT statut FROM paiements WHERE id = $1`, [ouvert.paiement.id]);
  assert.equal(p.statut, 'autorise', 'l\'empreinte doit rester intacte');
});

test('une clé secrète posée dans la variable publique n\'est jamais livrée au navigateur', async () => {
  // Le pire des deux cas : cette valeur part dans le HTML de chaque page de
  // paiement, lisible par le premier client venu — et une clé secrète
  // permet de débiter n'importe quelle carte.
  const avant = process.env.STRIPE_PUBLIC_KEY;
  try {
    for (const secrete of ['sk_test_51Abc', 'sk_live_51Abc', 'rk_live_51Abc']) {
      process.env.STRIPE_PUBLIC_KEY = secrete;
      assert.equal(clePubliqueEstSecrete(), true, secrete);
      assert.equal(clePublique(), '', `${secrete} ne doit pas sortir`);
    }
    // Une vraie clé publiable passe, elle.
    process.env.STRIPE_PUBLIC_KEY = 'pk_test_51Abc';
    assert.equal(clePubliqueEstSecrete(), false);
    assert.equal(clePublique(), 'pk_test_51Abc');
  } finally {
    if (avant === undefined) delete process.env.STRIPE_PUBLIC_KEY;
    else process.env.STRIPE_PUBLIC_KEY = avant;
  }
});

test('le diagnostic nomme l\'erreur sans jamais montrer la valeur', async () => {
  const avant = process.env.STRIPE_SECRET_KEY;
  const essayer = (valeur) => {
    process.env.STRIPE_SECRET_KEY = valeur;
    const d = diagnosticCleSecrete();
    // Aucune phrase ne doit recracher le secret qu'on vient de poser.
    if (d) assert.ok(!d.includes(valeur.trim()) || valeur.trim().length < 4,
      `le diagnostic ne doit pas contenir la valeur : ${d}`);
    return d;
  };
  try {
    assert.match(essayer(' sk_test_51Abc '), /espace|retour à la ligne/);
    assert.match(essayer('STRIPE_SECRET_KEY=sk_test_51Abc'), /=/);
    assert.match(essayer('whsec_9f2b1c'), /webhook/);
    assert.match(essayer('pk_test_51Abc'), /publiable/);
    assert.match(essayer('sogzoh-tzzzzzzzzsri0'), /aucun préfixe Stripe connu \(20 caractères\)/);

    // Une clé valide n'a rien à diagnostiquer, et une absence non plus.
    process.env.STRIPE_SECRET_KEY = 'sk_test_51AbcDef';
    assert.equal(diagnosticCleSecrete(), null);
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(diagnosticCleSecrete(), null);
  } finally {
    if (avant === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = avant;
  }
});

test('une clé tronquée au préfixe est reconnue comme telle', async () => {
  // Stripe masque la clé secrète dans son tableau de bord : sélectionner ce
  // qui est affiché ne ramène que « sk_test_ », soit huit caractères.
  // C'est l'erreur la plus fréquente, et « aucun préfixe connu » enverrait
  // chercher au mauvais endroit.
  const avant = process.env.STRIPE_SECRET_KEY;
  try {
    for (const tronquee of ['sk_test_', 'sk_live_', 'rk_test_', 'rk_live_']) {
      process.env.STRIPE_SECRET_KEY = tronquee;
      assert.equal(paiementActif(), false, `${tronquee} ne doit pas activer le paiement`);
      assert.match(diagnosticCleSecrete(), /tronquée/, tronquee);
    }
    // Une clé complète n'est pas prise pour une clé tronquée.
    process.env.STRIPE_SECRET_KEY = 'sk_test_51AbcDefGhiJkl';
    assert.equal(diagnosticCleSecrete(), null);
  } finally {
    if (avant === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = avant;
  }
});
