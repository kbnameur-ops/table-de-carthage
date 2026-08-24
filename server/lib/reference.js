import { randomInt } from 'node:crypto';

// Sans 0/O/1/I : évite les confusions à l'oral au téléphone avec le client.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genererReference(prefixe) {
  let suffixe = '';
  for (let i = 0; i < 6; i++) suffixe += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefixe}-${suffixe}`;
}
