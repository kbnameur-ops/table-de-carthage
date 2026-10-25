import { test } from 'node:test';
import assert from 'node:assert/strict';

/* Le relais Telegram. Rien ici ne doit jamais toucher le vrai bot : la
   suite tourne sans réseau, et c'est volontaire — un faux négatif à cause
   d'un Telegram indisponible serait pire qu'inutile. envoyerTelegram()
   n'est donc exercée que dans son chemin dormant (pas de jeton = pas
   d'appel), et formaterMessage() — la partie qui compte vraiment, parce
   que c'est elle qui a cassé en vrai lors de la mise au point — est
   testée sans réseau du tout. */

const anciens = { token: process.env.TELEGRAM_BOT_TOKEN, chats: process.env.TELEGRAM_CHAT_IDS };
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_IDS;

const { telegramActif, envoyerTelegram, formaterMessage } = await import('../server/lib/telegram.js');

test('telegramActif() exige le jeton ET au moins un destinataire', () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_IDS;
  assert.equal(telegramActif(), false);

  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  assert.equal(telegramActif(), false, 'le jeton seul ne suffit pas');
  delete process.env.TELEGRAM_BOT_TOKEN;

  process.env.TELEGRAM_CHAT_IDS = '42';
  assert.equal(telegramActif(), false, 'un destinataire seul ne suffit pas');
  delete process.env.TELEGRAM_CHAT_IDS;

  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  process.env.TELEGRAM_CHAT_IDS = '42';
  assert.equal(telegramActif(), true);

  // Une virgule en trop, ou des espaces mal placés, ne doivent pas
  // produire un destinataire fantôme ni casser l'activation.
  process.env.TELEGRAM_CHAT_IDS = ' 42 , , 1001 ,';
  assert.equal(telegramActif(), true);

  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_IDS;
});

test('envoyerTelegram() ne tente rien tant que ce n\'est pas configuré', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_IDS;
  const r = await envoyerTelegram('peu importe');
  assert.deepEqual(r, { ignore: true });
});

test('formaterMessage() met le titre en gras et ajoute le lien complet', () => {
  const msg = formaterMessage({
    titre: 'Nouvelle commande', detail: 'Test Client', lien: '/salon/commandes',
  });
  assert.match(msg, /^🔔 \*Nouvelle commande\*/);
  assert.match(msg, /Test Client/);
  assert.match(msg, /\/salon\/commandes/);
});

test('formaterMessage() n\'omet ni le détail ni le lien quand ils manquent', () => {
  assert.doesNotMatch(formaterMessage({ titre: 'Seul le titre' }), /\n.+\n/s);
  const sansLien = formaterMessage({ titre: 'T', detail: 'D', lien: '' });
  assert.ok(!sansLien.includes('http'));
});

// ── L'échappement MarkdownV2 : la vraie panne rencontrée ────────────────
// Un nom de client, une référence, une adresse contiennent presque tous
// les caractères que Telegram réserve à sa syntaxe. Sans échappement,
// Telegram refuse le message EN ENTIER plutôt que de l'afficher dégradé —
// une seule apostrophe mal gérée, et la notification n'arrive jamais.

test('formaterMessage() échappe les caractères réservés de MarkdownV2', () => {
  const msg = formaterMessage({
    titre: "O'Brien-Smith (famille) — 4 couverts",
    detail: 'REF-ABC_123 · 20:00 · 50,00 € · a+b=c | {x}',
    lien: '/salon/reservations?date=2026-10-29',
  });
  // Chacun des caractères réservés doit apparaître précédé d'un
  // antislash — jamais nu — partout dans le message, lien compris.
  for (const car of ['-', '(', ')', '.', '!', '+', '=', '|', '{', '}']) {
    const motif = new RegExp(`(?<!\\\\)\\${car}`);
    assert.ok(!motif.test(msg), `« ${car} » apparaît sans antislash dans : ${msg}`);
  }
  // Et le texte reste lisible : le nom est toujours là, juste échappé.
  assert.match(msg, /O'Brien\\-Smith/);
});

test('formaterMessage() échappe aussi l\'adresse insérée pour le lien', () => {
  // C'est précisément là que ça a cassé en vrai : le domaine et la date
  // dans l'URL contiennent eux-mêmes des tirets et un point.
  const msg = formaterMessage({ titre: 'T', detail: '', lien: '/salon/commandes?date=2026-10-27' });
  assert.match(msg, /2026\\-10\\-27/);
});

if (anciens.token) process.env.TELEGRAM_BOT_TOKEN = anciens.token; else delete process.env.TELEGRAM_BOT_TOKEN;
if (anciens.chats) process.env.TELEGRAM_CHAT_IDS = anciens.chats; else delete process.env.TELEGRAM_CHAT_IDS;
