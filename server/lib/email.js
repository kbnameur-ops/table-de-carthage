/** Les emails envoyés aux clients et au salon, via la messagerie OVH du
 *  site.
 *
 *  ── Dormant tant que rien n'est configuré ──
 *  Sans SMTP_HOST, SMTP_USER et SMTP_PASS, emailActif() répond false et
 *  rien ne part — même principe que Stripe (paiementActif()) et Telegram
 *  (telegramActif()) : mettre ce code en ligne ne doit rien changer avant
 *  que les identifiants soient renseignés.
 *
 *  ── Un email qui échoue ne doit jamais bloquer le client ──
 *  Une réservation, une commande ou un paiement doivent aboutir même si
 *  OVH est indisponible ou si le mot de passe a changé. envoyerEmail() ne
 *  lève donc jamais : elle journalise et s'arrête là. */
import nodemailer from 'nodemailer';
import { NOM, SITE, TELEPHONE } from './seo.js';
import { euros } from './money.js';

export function emailActif() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** L'adresse qui reçoit les notifications internes (nouvelle commande,
 *  nouvelle réservation...) — distincte de la boîte d'envoi. */
export function contactInterne() {
  return process.env.CONTACT_EMAIL || 'contact@table-de-carthage.com';
}

let transporteur = null;

/** Un seul transporteur, créé à la première utilisation : pas de
 *  connexion SMTP tant qu'aucun email ne part réellement. */
function obtenirTransporteur() {
  if (!transporteur) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port !== 587, // 465 : TLS direct · 587 : STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Un OVH lent ou injoignable ne doit jamais faire attendre le
      // client des minutes pour une réservation déjà enregistrée : on
      // abandonne l'envoi après quelques secondes plutôt que de bloquer
      // la réponse sur les délais par défaut de nodemailer.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return transporteur;
}

/** Envoie un email. Ne lève jamais : une panne OVH ne doit jamais
 *  remonter jusqu'à une réservation, une commande ou un paiement en
 *  cours. */
export async function envoyerEmail({ a, sujet, html }) {
  if (!emailActif() || !a) return { ignore: true };
  try {
    await obtenirTransporteur().sendMail({
      from: `"${NOM}" <${process.env.SMTP_USER}>`,
      to: a,
      subject: sujet,
      html,
    });
    return { envoye: true };
  } catch (err) {
    console.error(`Email non envoyé à ${a} :`, err.message);
    return { erreur: err.message };
  }
}

const COULEUR = '#8a3b2b';

/** Échappe ce qui vient d'une saisie libre (prénom, nom, téléphone...)
 *  avant de l'insérer dans l'email : sans ça, un client qui saisit
 *  `<script>` ou `&` comme prénom casserait la mise en page, voire pire. */
function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function enveloppe(corps) {
  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;padding:24px;color:#2b2420;line-height:1.5;">
    <h1 style="font-size:19px;color:${COULEUR};margin:0 0 20px;">${NOM}</h1>
    ${corps}
    <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5ddd3;font-size:12px;color:#8a8275;">
      ${NOM} · ${TELEPHONE} · <a href="${SITE}" style="color:${COULEUR};">${SITE.replace(/^https?:\/\//, '')}</a>
    </p>
  </div>`;
}

function ligne(libelle, valeur) {
  return `<tr><td style="padding:4px 16px 4px 0;color:#6b6358;white-space:nowrap;">${libelle}</td><td style="padding:4px 0;font-weight:bold;">${valeur}</td></tr>`;
}

// ── Les trois emails envoyés au client ──────────────────────────────────

export function emailConfirmationReservation({ client, reference, dateLisible, heure, couverts }) {
  return {
    sujet: `Réservation ${reference} — ${NOM}`,
    html: enveloppe(`
      <p>Bonjour ${echapper(client.prenom)},</p>
      <p>Votre demande de réservation est enregistrée.</p>
      <table>${ligne('Référence', reference)}${ligne('Date', dateLisible)}${ligne('Heure', heure)}${ligne('Couverts', couverts)}</table>
      <p>Nous confirmons chaque réservation par téléphone avant le service. Conservez cette référence : elle apparaît aussi dans votre espace client.</p>
    `),
  };
}

export function emailConfirmationCommande({ client, reference, dateLisible, heure, lignes, totalCents }) {
  const items = lignes.map(l =>
    `<tr><td style="padding:3px 16px 3px 0;">${l.quantite} × ${l.nom}</td><td style="padding:3px 0;text-align:right;">${euros(l.prix_cents * l.quantite)}</td></tr>`
  ).join('');
  return {
    sujet: `Commande ${reference} — ${NOM}`,
    html: enveloppe(`
      <p>Bonjour ${echapper(client.prenom)},</p>
      <p>Votre commande à emporter est enregistrée.</p>
      <table style="width:100%;">${items}
        <tr><td style="padding:8px 16px 0 0;font-weight:bold;border-top:1px solid #e5ddd3;">Total</td>
            <td style="padding:8px 0 0;text-align:right;font-weight:bold;border-top:1px solid #e5ddd3;">${euros(totalCents)}</td></tr>
      </table>
      <table style="margin-top:16px;">${ligne('Référence', reference)}${ligne('Retrait', `${dateLisible} à ${heure}`)}</table>
      <p>Règlement sur place au retrait, sauf paiement en ligne déjà effectué. Nous vous préviendrons si la commande ne peut pas être honorée.</p>
    `),
  };
}

export function emailConfirmationPaiement({ client, reference, montantCents, libelle }) {
  return {
    sujet: `Paiement confirmé — ${NOM}`,
    html: enveloppe(`
      <p>Bonjour ${echapper(client.prenom)},</p>
      <p>${libelle}</p>
      <table>${reference ? ligne('Référence', reference) : ''}${ligne('Montant', euros(montantCents))}</table>
    `),
  };
}

// ── La notification interne, envoyée à l'adresse de contact ────────────
// Un seul gabarit pour les trois catégories demandées (commande à
// emporter, réservation de table, réservation d'événement) : ce qui les
// distingue est le texte, pas la présentation.

export function emailNotificationInterne({ titre, detail, lien }) {
  return {
    sujet: titre,
    html: enveloppe(`
      <p style="font-weight:bold;font-size:15px;">${echapper(titre)}</p>
      <p>${echapper(detail)}</p>
      ${lien ? `<p><a href="${SITE}${lien}" style="color:${COULEUR};">${SITE}${lien}</a></p>` : ''}
    `),
  };
}
