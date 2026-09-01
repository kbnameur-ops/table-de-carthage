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

/** Vrai seulement si une clé secrète est configurée. Tout le reste du code
 *  s'y réfère plutôt qu'à `process.env` directement : un seul endroit
 *  décide si la fonctionnalité est allumée. */
export function paiementActif() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** La clé publique, à passer au navigateur. Publique par nature : elle ne
 *  permet que de créer un moyen de paiement, jamais de débiter. */
export function clePublique() {
  return process.env.STRIPE_PUBLIC_KEY || '';
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
export async function creerIntention({ montantCents, mode, cle, description, metadonnees = {} }) {
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
    automatic_payment_methods: { enabled: true },
    description,
    metadata: metadonnees,
  }, { idempotencyKey: cle });

  return { id: intention.id, secretClient: intention.client_secret };
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
