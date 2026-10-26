import { test } from 'node:test';
import assert from 'node:assert/strict';

/* Les emails au client et au salon, envoyés via la messagerie OVH. Comme
   pour Telegram, la suite ne touche jamais le vrai SMTP : envoyerEmail()
   n'est exercée que dans son chemin dormant (pas d'identifiants = pas de
   connexion), et les gabarits — ce qui compte vraiment — sont vérifiés
   sans réseau du tout. */

const anciens = {
  host: process.env.SMTP_HOST, user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS, contact: process.env.CONTACT_EMAIL,
};
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.CONTACT_EMAIL;

const {
  emailActif, contactInterne, envoyerEmail,
  emailConfirmationReservation, emailConfirmationCommande,
  emailConfirmationPaiement, emailNotificationInterne,
} = await import('../server/lib/email.js');

test('emailActif() exige l\'hôte, l\'identifiant ET le mot de passe', () => {
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  assert.equal(emailActif(), false);

  process.env.SMTP_HOST = 'ssl0.ovh.net';
  assert.equal(emailActif(), false, 'l\'hôte seul ne suffit pas');

  process.env.SMTP_USER = 'commandes@table-de-carthage.com';
  assert.equal(emailActif(), false, 'il manque encore le mot de passe');

  process.env.SMTP_PASS = 'x';
  assert.equal(emailActif(), true);

  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
});

test('contactInterne() a une valeur par défaut, surchargeable', () => {
  delete process.env.CONTACT_EMAIL;
  assert.equal(contactInterne(), 'contact@table-de-carthage.com');
  process.env.CONTACT_EMAIL = 'gerante@table-de-carthage.com';
  assert.equal(contactInterne(), 'gerante@table-de-carthage.com');
  delete process.env.CONTACT_EMAIL;
});

test('envoyerEmail() ne tente rien tant que ce n\'est pas configuré', async () => {
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  const r = await envoyerEmail({ a: 'client@example.com', sujet: 'Test', html: '<p>Test</p>' });
  assert.deepEqual(r, { ignore: true });
});

test('envoyerEmail() ne tente rien sans destinataire, même configuré', async () => {
  process.env.SMTP_HOST = 'ssl0.ovh.net';
  process.env.SMTP_USER = 'commandes@table-de-carthage.com';
  process.env.SMTP_PASS = 'x';
  const r = await envoyerEmail({ a: '', sujet: 'Test', html: '<p>Test</p>' });
  assert.deepEqual(r, { ignore: true });
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
});

const client = { prenom: 'Sami', nom: 'Ben Ali', email: 'sami@example.com' };

test('emailConfirmationReservation() reprend la référence, la date et les couverts', () => {
  const { sujet, html } = emailConfirmationReservation({
    client, reference: 'RES-ABC123', dateLisible: 'vendredi 3 octobre 2026', heure: '20:00', couverts: 4,
  });
  assert.match(sujet, /RES-ABC123/);
  assert.match(html, /Sami/);
  assert.match(html, /vendredi 3 octobre 2026/);
  assert.match(html, /20:00/);
  assert.match(html, />4</);
});

test('emailConfirmationCommande() liste les lignes et calcule le total affiché', () => {
  const { sujet, html } = emailConfirmationCommande({
    client, reference: 'CMD-XYZ789', dateLisible: 'demain', heure: '12:30',
    lignes: [{ nom: 'Couscous agneau', prix_cents: 1650, quantite: 2 }],
    totalCents: 3300,
  });
  assert.match(sujet, /CMD-XYZ789/);
  assert.match(html, /Couscous agneau/);
  assert.match(html, /2 × Couscous agneau/);
  assert.match(html, /33,00 €|33 €/);
});

test('emailConfirmationPaiement() omet la référence quand elle manque (addition de table)', () => {
  const { html } = emailConfirmationPaiement({
    client, reference: null, montantCents: 4500, libelle: 'Votre addition est réglée.',
  });
  assert.doesNotMatch(html, /Référence/);
  assert.match(html, /45,00 €|45 €/);
  assert.match(html, /addition est réglée/);
});

test('emailConfirmationPaiement() garde la référence quand elle est fournie', () => {
  const { html } = emailConfirmationPaiement({
    client, reference: 'CMD-ABC', montantCents: 1200, libelle: 'Réglée.',
  });
  assert.match(html, /Référence/);
  assert.match(html, /CMD-ABC/);
});

// ── Échappement HTML : un prénom ou un détail ne sont jamais du HTML de
// confiance, ils viennent d'une saisie client. Sans échappement, un
// prénom contenant `<` casserait la mise en page de l'email, voire pire.

test('emailConfirmationReservation() échappe le prénom inséré dans l\'email', () => {
  const { html } = emailConfirmationReservation({
    client: { prenom: '<b>Mallory</b>', nom: 'X', email: 'm@example.com' },
    reference: 'RES-1', dateLisible: 'demain', heure: '20:00', couverts: 2,
  });
  assert.doesNotMatch(html, /<b>Mallory<\/b>/);
  assert.match(html, /&lt;b&gt;Mallory&lt;\/b&gt;/);
});

test('emailNotificationInterne() reprend titre, détail et lien absolu', () => {
  const { sujet, html } = emailNotificationInterne({
    titre: 'Nouvelle réservation — 4 couverts',
    detail: 'Sami Ben Ali · table 3',
    lien: '/salon/reservations?date=2026-10-27',
  });
  assert.equal(sujet, 'Nouvelle réservation — 4 couverts');
  assert.match(html, /Sami Ben Ali · table 3/);
  assert.match(html, /\/salon\/reservations\?date=2026-10-27/);
});

test('emailNotificationInterne() échappe un détail contenant du HTML (client malveillant)', () => {
  const { html } = emailNotificationInterne({
    titre: 'Nouvelle commande', detail: '<img src=x onerror=alert(1)> Ben Ali', lien: '',
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

if (anciens.host) process.env.SMTP_HOST = anciens.host; else delete process.env.SMTP_HOST;
if (anciens.user) process.env.SMTP_USER = anciens.user; else delete process.env.SMTP_USER;
if (anciens.pass) process.env.SMTP_PASS = anciens.pass; else delete process.env.SMTP_PASS;
if (anciens.contact) process.env.CONTACT_EMAIL = anciens.contact; else delete process.env.CONTACT_EMAIL;
