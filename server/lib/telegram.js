/** Les notifications du salon, relayées sur Telegram.
 *
 *  ── Dormant tant que les deux variables ne sont pas posées ──
 *  Sans `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`, `telegramActif()`
 *  répond false et rien de plus ne se passe : la pastille du salon
 *  continue de fonctionner exactement comme avant. Même principe que
 *  Stripe dans lib/paiement.js — mettre ce code en ligne ne doit rien
 *  casser le jour où il est déployé, seulement le jour où le bot est prêt.
 *
 *  ── Pourquoi un relais, pas un remplacement ──
 *  La table `notifications` reste la source de vérité : c'est elle que
 *  lit la pastille du salon, et un Telegram qui n'arrive pas (bot coupé,
 *  jeton révoqué, Telegram en panne) ne doit jamais faire perdre une
 *  commande ni empêcher une réservation d'aboutir. L'envoi est donc
 *  volontairement best-effort : une erreur ici se journalise et s'arrête
 *  là, elle ne remonte jamais à l'appelant. */
import { SITE } from './seo.js';

export function telegramActif() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Échappe les caractères qui ont un sens pour le mode MarkdownV2 de
 *  Telegram. Les champs qu'on y insère (prénom, nom, référence...) sont
 *  du texte libre saisi par un client — sans ça, un nom contenant un
 *  point ou un tiret casserait le format du message, voire le rendrait
 *  invisible (Telegram refuse le message entier si le markdown est
 *  invalide, plutôt que de l'afficher dégradé). */
function echapper(texte) {
  return String(texte).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/** Construit le message envoyé pour une notification du salon. Format
 *  volontairement proche de la pastille : un titre en gras, le détail en
 *  dessous, puis le lien vers l'écran concerné — pour qui a déjà une
 *  session salon ouverte sur son téléphone, un tap suffit. */
export function formaterMessage({ titre, detail, lien }) {
  let texte = `🔔 *${echapper(titre)}*`;
  if (detail) texte += `\n${echapper(detail)}`;
  // L'adresse aussi : elle contient des tirets et des points, deux des
  // caractères réservés. Telegram la redétecte comme lien cliquable une
  // fois la chaîne échappée interprétée — l'échappement ne change que la
  // façon dont le texte est lu, jamais ce qu'il affiche.
  if (lien) texte += `\n${echapper(`${SITE}${lien}`)}`;
  return texte;
}

/** Envoie un message au chat configuré. Ne lève jamais : une panne
 *  Telegram ne doit jamais remonter jusqu'à une réservation ou une
 *  commande en cours. */
export async function envoyerTelegram(texte) {
  if (!telegramActif()) return { ignore: true };
  try {
    const reponse = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: texte,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      }
    );
    const corps = await reponse.json().catch(() => null);
    if (!reponse.ok || !corps?.ok) {
      console.error('Telegram a refusé le message :', corps?.description || reponse.status);
      return { erreur: corps?.description || `HTTP ${reponse.status}` };
    }
    return { envoye: true };
  } catch (err) {
    console.error('Telegram injoignable :', err.message);
    return { erreur: err.message };
  }
}
