// Envoie une alerte d'essai au(x) gérant(s) pour vérifier la configuration WhatsApp.
// Usage : WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_DESTINATAIRES=336… node outils/whatsapp-test.mjs
import { configWhatsApp, alerterWhatsApp } from '../server/lib/whatsapp.js';

const config = configWhatsApp();
if (!config) {
  console.error('Configuration incomplète : définir WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID et WHATSAPP_DESTINATAIRES.');
  process.exit(1);
}
const ok = await alerterWhatsApp({
  titre: 'Essai — alertes WhatsApp',
  detail: 'Si vous lisez ce message, les réservations et commandes en ligne vous seront signalées ici.',
  lien: '/salon/notifications',
});
console.log(`${ok}/${config.destinataires.length} message(s) envoyé(s) avec le modèle « ${config.modele} » (${config.langue}).`);
process.exit(ok === config.destinataires.length ? 0 : 1);
