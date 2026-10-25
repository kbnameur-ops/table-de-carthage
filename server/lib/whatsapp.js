/** Alerte WhatsApp du gérant, envoyée par le serveur via l'API WhatsApp
 *  Cloud de Meta : le client ne voit rien, il n'a rien à envoyer lui-même.
 *
 *  Un message qui part à l'initiative du restaurant (hors réponse à un
 *  message reçu dans les 24 h) doit utiliser un modèle validé par Meta. Le
 *  modèle attendu a trois variables dans son corps, par exemple :
 *    « 🔔 {{1}}
 *      {{2}}
 *      Voir dans le salon : {{3}} »
 *
 *  Inactif tant que WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID et
 *  WHATSAPP_DESTINATAIRES ne sont pas définis : rien ne change en local. */

const API = 'https://graph.facebook.com/v21.0';
const DELAI_MS = 4000;

export function configWhatsApp(env = process.env) {
  const destinataires = (env.WHATSAPP_DESTINATAIRES || '')
    .split(',').map(n => n.replace(/[^\d]/g, '')).filter(Boolean);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !destinataires.length) return null;
  return {
    token: env.WHATSAPP_TOKEN,
    numeroId: env.WHATSAPP_PHONE_NUMBER_ID,
    destinataires,
    modele: env.WHATSAPP_MODELE || 'alerte_salon',
    langue: env.WHATSAPP_LANGUE || 'fr',
    site: (env.SITE_URL || 'https://table-de-carthage.com').replace(/\/$/, ''),
  };
}

/** Meta refuse dans une variable de modèle les retours à la ligne, les
 *  tabulations et plus de quatre espaces d'affilée ; une variable vide fait
 *  aussi échouer l'envoi. */
export function nettoyerVariable(texte, max = 900) {
  const propre = String(texte ?? '').replace(/[\n\r\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
  return (propre || '—').slice(0, max);
}

export function corpsMessage(config, destinataire, { titre, detail, lien }) {
  const url = /^https?:\/\//.test(lien || '') ? lien : config.site + (lien || '/salon');
  return {
    messaging_product: 'whatsapp',
    to: destinataire,
    type: 'template',
    template: {
      name: config.modele,
      language: { code: config.langue },
      components: [{
        type: 'body',
        parameters: [titre, detail, url].map(t => ({ type: 'text', text: nettoyerVariable(t) })),
      }],
    },
  };
}

/** Envoie l'alerte à chaque destinataire. Ne lève jamais d'erreur : un
 *  WhatsApp perdu ne doit pas faire échouer la réservation du client (la
 *  notification reste visible dans le salon). Renvoie le nombre d'envois
 *  réussis, pour les tests et l'outil de vérification. */
export async function alerterWhatsApp(notification, { env = process.env, fetchFn = fetch } = {}) {
  const config = configWhatsApp(env);
  if (!config) return 0;
  const resultats = await Promise.allSettled(config.destinataires.map(async to => {
    const rep = await fetchFn(`${API}/${config.numeroId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpsMessage(config, to, notification)),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!rep.ok) {
      const err = await rep.json().catch(() => ({}));
      throw new Error(`${rep.status} ${err.error?.message || ''}`.trim());
    }
  }));
  let ok = 0;
  resultats.forEach((r, i) => {
    if (r.status === 'fulfilled') ok++;
    else console.error(`WhatsApp non envoyé à …${config.destinataires[i].slice(-4)} :`, r.reason?.message);
  });
  return ok;
}
