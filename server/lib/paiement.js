import { randomBytes } from 'node:crypto';

/** Le paiement en ligne, via Stripe.
 *
 *  ── Dormant tant que les clés ne sont pas posées ──
 *  Sans `STRIPE_SECRET_KEY`, `paiementActif()` répond false et tout le
 *  reste du site se comporte comme avant : les tunnels acceptent une
 *  commande sans carte, aucun écran de paiement n'apparaît. C'est
 *  volontaire — mettre ce code en ligne ne doit rien casser le jour où il
 *  est déployé, mais seulement le jour où le compte Stripe est prêt.
 *
 *  ── Deux modes ──
 *  `empreinte` : Stripe autorise le montant sans le débiter (capture
 *  manuelle). L'argent est bloqué sur la carte du client, et le restaurant
 *  décide plus tard de le prendre ou de le rendre. C'est ce qui protège
 *  d'une commande préparée que personne ne vient chercher. Une autorisation
 *  Stripe vit environ sept jours ; au-delà, elle tombe d'elle-même.
 *
 *  `immediat` : débité tout de suite. C'est ce qu'on veut quand le client
 *  règle son addition depuis son téléphone — il n'y a rien à arbitrer plus
 *  tard.
 *
 *  ── Le montant ne vient jamais du navigateur ──
 *  Toutes les fonctions d'ici reçoivent un montant déjà recalculé côté
 *  serveur à partir des lignes de commande. Un montant posté par le client
 *  serait un moyen de payer 1 centime une commande à 40 €.
 */

const DEVISE = 'eur';

// Forme d'une clé secrète Stripe : `sk_` pour une clé standard, `rk_` pour
// une clé restreinte, puis le mode. Tout le reste n'en est pas une.
const FORME_CLE_SECRETE = /^(sk|rk)_(test|live)_[A-Za-z0-9]/;

/** Une valeur a été posée dans STRIPE_SECRET_KEY, mais ce n'est pas une clé
 *  Stripe — une valeur collée de travers, le nom de la variable inclus dans
 *  sa propre valeur, un secret d'un autre service. */
export function cleSecreteInvalide() {
  const cle = process.env.STRIPE_SECRET_KEY || '';
  return cle !== '' && !FORME_CLE_SECRETE.test(cle);
}

/** Vrai seulement si une clé secrète PLAUSIBLE est configurée. Tout le reste
 *  du code s'y réfère plutôt qu'à `process.env` directement : un seul
 *  endroit décide si la fonctionnalité est allumée.
 *
 *  La vérification de forme n'est pas un luxe. Sans elle, une clé mal
 *  copiée suffisait à allumer le paiement — donc à exiger une carte à
 *  chaque commande — tout en le rendant incapable de fonctionner : les
 *  clients ne pouvaient plus commander du tout, et le tunnel devenait un
 *  cul-de-sac. Une configuration douteuse doit rendre la fonctionnalité
 *  inerte, jamais bloquante. */
export function paiementActif() {
  return FORME_CLE_SECRETE.test(process.env.STRIPE_SECRET_KEY || '');
}

// Forme d'une clé publiable Stripe. Elle est faite pour circuler.
const FORME_CLE_PUBLIQUE = /^pk_(test|live)_[A-Za-z0-9]/;

/** Vrai si ce qui est posé dans STRIPE_PUBLIC_KEY est en réalité une clé
 *  SECRÈTE. C'est la confusion la plus coûteuse des deux : les deux clés se
 *  ressemblent, se copient au même endroit, et une seule doit jamais
 *  quitter le serveur. */
export function clePubliqueEstSecrete() {
  return FORME_CLE_SECRETE.test(process.env.STRIPE_PUBLIC_KEY || '');
}

/** La clé publique, à passer au navigateur. Publique par nature : elle ne
 *  permet que de créer un moyen de paiement, jamais de débiter.
 *
 *  Une clé secrète posée ici par erreur ne sort PAS : cette fonction rend
 *  une chaîne vide plutôt que de la livrer. Elle est écrite en clair dans
 *  le HTML de la page de paiement, donc lisible par le premier client
 *  venu — et une clé secrète permet de débiter n'importe quelle carte et
 *  de lire tout le compte Stripe. Le paiement ne marchera pas, ce qui est
 *  visible et réparable ; une clé secrète publiée ne se répare qu'en la
 *  révoquant. */
export function clePublique() {
  if (clePubliqueEstSecrete()) return '';
  return process.env.STRIPE_PUBLIC_KEY || '';
}

/** Ce qui cloche dans STRIPE_SECRET_KEY, en une phrase lisible par
 *  quelqu'un qui n'écrit pas de code — et sans jamais montrer la valeur.
 *
 *  Dire « clé invalide » sans dire quoi laisse deviner : on recolle la même
 *  chose, on redéploie, on recommence. Ces quatre cas couvrent à peu près
 *  toutes les façons de se tromper en copiant une clé. */
export function diagnosticCleSecrete() {
  const brute = process.env.STRIPE_SECRET_KEY || '';
  if (brute === '' || paiementActif()) return null;

  const cle = brute.trim();
  if (cle !== brute) {
    return 'Elle comporte un espace ou un retour à la ligne au début ou à la fin.';
  }
  if (cle.includes('=')) {
    return 'Elle contient un « = » : le nom de la variable a sans doute été collé avec sa valeur. Ne collez que la valeur.';
  }
  if (cle.startsWith('whsec_')) {
    return 'C’est le secret du webhook (whsec_…), pas la clé secrète. Il va dans STRIPE_WEBHOOK_SECRET.';
  }
  if (FORME_CLE_PUBLIQUE.test(cle)) {
    return 'C’est la clé publiable (pk_…), pas la clé secrète. Les deux se prennent au même endroit chez Stripe, mais ce n’est pas la même ligne.';
  }

  // Le cas le plus fréquent, et le plus déroutant : Stripe masque la clé
  // secrète dans son tableau de bord. Sélectionner ce qui est affiché ne
  // ramène que le préfixe — « sk_test_ » fait exactement huit caractères.
  // Dire « aucun préfixe connu » sur cette valeur-là serait faux, et
  // enverrait chercher au mauvais endroit.
  // Pas de test de longueur au-delà : une clé bien formée est acceptée telle
  // quelle, et c'est Stripe qui tranche. Deviner une longueur minimale
  // reviendrait à refuser un jour une vraie clé sur une supposition.
  const PREFIXE_SEUL = /^(sk|rk)_(test|live)_$/;
  if (PREFIXE_SEUL.test(cle)) {
    return `Elle est tronquée : elle commence bien par ${cle.slice(0, 8)} mais s’arrête là (${cle.length} caractères, une vraie clé en fait une centaine). Chez Stripe la clé secrète est masquée : cliquez sur « Révéler », ou utilisez le bouton de copie à côté d’elle.`;
  }

  return `Elle ne commence par aucun préfixe Stripe connu (${cle.length} caractères). Une clé secrète commence par sk_test_ ou sk_live_.`;
}

/** En développement, sans compte Stripe, on veut quand même pouvoir
 *  parcourir tout le circuit — créer une empreinte, l'autoriser, la
 *  capturer, la libérer — et le vérifier par des tests. Ce mode ne
 *  s'enclenche que si `PAIEMENT_SIMULE=1` ET qu'aucune clé Stripe n'est
 *  configurée : impossible de simuler un paiement sur une installation
 *  réellement branchée à Stripe. */
export function paiementSimule() {
  return process.env.PAIEMENT_SIMULE === '1' && !process.env.STRIPE_SECRET_KEY;
}

/** Comme `paiementActif()`, mais vrai aussi en simulation : c'est cette
 *  fonction que les écrans consultent pour savoir s'il faut demander une
 *  carte. */
export function paiementDisponible() {
  return paiementActif() || paiementSimule();
}

/** Le mode dans lequel Stripe est branché, déduit de la clé publique :
 *  `test` (aucun argent réel ne bouge) ou `reel`. Rien de secret ici — une
 *  clé publique est faite pour circuler — mais c'est une information que le
 *  salon doit pouvoir lire d'un coup d'œil. Sans elle, personne ne peut
 *  distinguer « les cartes de mes clients sont refusées » de « je suis
 *  encore en mode test », et c'est précisément le genre de doute qui coûte
 *  un service. */
export function modeStripe() {
  if (paiementSimule()) return 'simulation';
  const cle = process.env.STRIPE_PUBLIC_KEY || process.env.STRIPE_SECRET_KEY || '';
  if (!paiementActif()) return null;
  if (cle.startsWith('pk_test_') || cle.startsWith('sk_test_')) return 'test';
  if (cle.startsWith('pk_live_') || cle.startsWith('sk_live_')) return 'reel';
  return 'inconnu';
}

/** Ce qu'il manque pour que le paiement fonctionne vraiment. Poser la clé
 *  secrète sans le secret du webhook laisse les clients payer sans qu'aucune
 *  commande ne soit jamais confirmée : mieux vaut le dire que le découvrir
 *  un soir de service. */
export function manquePourPaiement() {
  if (!paiementActif()) return [];
  const manques = [];
  if (!process.env.STRIPE_PUBLIC_KEY) manques.push('STRIPE_PUBLIC_KEY');
  if (!process.env.STRIPE_WEBHOOK_SECRET) manques.push('STRIPE_WEBHOOK_SECRET');
  return manques;
}

let clientStripe = null;
async function stripe() {
  if (!clientStripe) {
    const { default: Stripe } = await import('stripe');
    clientStripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Épinglée : une version d'API qui change toute seule ferait varier
      // la forme des objets reçus par les webhooks sans qu'on l'ait voulu.
      apiVersion: '2025-10-29.clover',
      // Ce site tourne en fonction serverless : trois essais d'une requête
      // qui traîne coûtent moins qu'une commande perdue.
      maxNetworkRetries: 2,
    });
  }
  return clientStripe;
}

const faux = (prefixe) => `${prefixe}_sim_${randomBytes(9).toString('hex')}`;

/** Crée l'intention de paiement et rend de quoi ouvrir le formulaire.
 *
 *  `cle` est la clé d'idempotence : deux appels avec la même clé ne créent
 *  qu'une seule intention chez Stripe. On y met notre propre référence de
 *  commande, si bien qu'un double clic sur « Payer », ou un navigateur qui
 *  réémet la requête, ne bloque pas deux fois le montant sur la carte. */
export async function creerIntention({ montantCents, mode, cle, description, metadonnees = {}, clientStripeId = null }) {
  if (!Number.isInteger(montantCents) || montantCents <= 0) {
    throw new Error(`montant invalide : ${montantCents}`);
  }
  if (mode !== 'empreinte' && mode !== 'immediat') {
    throw new Error(`mode de paiement inconnu : ${mode}`);
  }

  if (paiementSimule()) {
    const id = faux('pi');
    return { id, secretClient: `${id}_secret_${randomBytes(6).toString('hex')}` };
  }

  const intention = await (await stripe()).paymentIntents.create({
    amount: montantCents,
    currency: DEVISE,
    capture_method: mode === 'empreinte' ? 'manual' : 'automatic',
    // Laisse Stripe proposer ce que le navigateur et le compte permettent :
    // Apple Pay sur iPhone, Google Pay sur Android et Chrome, la carte
    // partout. Énumérer les moyens à la main reviendrait à en priver les
    // clients dès que Stripe en active un nouveau.
    automatic_payment_methods: { enabled: true },
    // La fiche client est rattachée dès la création, même si le client ne
    // demande rien : sans elle, la case « enregistrer ma carte » ne pourrait
    // plus être honorée une fois la carte saisie, et il faudrait tout
    // recommencer.
    ...(clientStripeId ? { customer: clientStripeId } : {}),
    description,
    metadata: metadonnees,
  }, { idempotencyKey: cle });

  return { id: intention.id, secretClient: intention.client_secret };
}

/** La fiche Stripe d'un client, créée à la volée.
 *
 *  Elle ne contient que de quoi le reconnaître sur un relevé Stripe et
 *  porter ses cartes enregistrées. Aucune carte n'y est attachée tant que
 *  le client ne l'a pas demandé. */
export async function creerClientStripe({ prenom, nom, email, telephone, clientId }) {
  if (paiementSimule()) return faux('cus');
  const fiche = await (await stripe()).customers.create({
    name: `${prenom || ''} ${nom || ''}`.trim() || undefined,
    email: email || undefined,
    phone: telephone || undefined,
    metadata: { client_id: String(clientId) },
  }, { idempotencyKey: `client-${clientId}` });
  return fiche.id;
}

/** Enregistrer — ou non — la carte pour les prochaines fois.
 *
 *  `setup_future_usage` est posé sur l'intention, donc côté serveur : c'est
 *  ce qui autorise Stripe à conserver le moyen de paiement une fois le
 *  paiement abouti. Le navigateur ne fait que dire ce que le client a
 *  coché ; il ne décide de rien, et surtout pas à la place d'un autre.
 *
 *  Décocher doit défaire : on remet explicitement la valeur à null plutôt
 *  que de ne rien faire, sinon une case cochée puis décochée laisserait la
 *  carte enregistrée contre l'avis du client. */
export async function definirEnregistrement(intentionId, enregistrer) {
  if (paiementSimule()) return { enregistrer: !!enregistrer };
  await (await stripe()).paymentIntents.update(intentionId, {
    setup_future_usage: enregistrer ? 'off_session' : null,
  });
  return { enregistrer: !!enregistrer };
}

/** Le secret d'une intention déjà créée, pour rouvrir le formulaire.
 *
 *  Il est demandé à Stripe plutôt que gardé en base : c'est le jeton qui
 *  autorise le navigateur à agir sur ce paiement, il n'a aucune raison de
 *  dormir dans nos tables où il survivrait à la transaction. */
export async function recupererSecret(intentionId) {
  if (paiementSimule()) return `${intentionId}_secret_${randomBytes(6).toString('hex')}`;
  const intention = await (await stripe()).paymentIntents.retrieve(intentionId);
  return intention.client_secret;
}

/** Débite tout ou partie d'une empreinte.
 *
 *  Capturer moins que le montant autorisé est parfaitement licite chez
 *  Stripe, et c'est ce qui permet d'accepter la cagnotte au comptoir sur
 *  une commande déjà pré-autorisée : on a bloqué 40 €, le client règle
 *  5 € en points, on ne prend que 35 € et le reste est rendu. */
export async function capturer(intentionId, montantCents) {
  if (paiementSimule()) return { capture_cents: montantCents };
  const intention = await (await stripe()).paymentIntents.capture(intentionId, {
    amount_to_capture: montantCents,
  });
  return { capture_cents: intention.amount_received };
}

/** Rend l'empreinte sans rien débiter. */
export async function liberer(intentionId) {
  if (paiementSimule()) return { libere: true };
  await (await stripe()).paymentIntents.cancel(intentionId);
  return { libere: true };
}

/** Vérifie la signature d'un webhook et rend l'événement.
 *
 *  `corps` doit être le corps BRUT de la requête, octet pour octet : c'est
 *  sur ces octets exacts que porte la signature. Un corps déjà analysé
 *  puis re-sérialisé en JSON ne redonne pas la même chaîne, et la
 *  vérification échouerait — d'où le montage de cette route avant
 *  `express.json()` dans server/index.js.
 *
 *  Sans signature valide, on ne traite rien : n'importe qui connaissant
 *  l'adresse du webhook pourrait sinon déclarer une commande payée. */
export async function evenementDepuisWebhook(corps, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET absent : webhook refusé.');
  return (await stripe()).webhooks.constructEvent(corps, signature, secret);
}
