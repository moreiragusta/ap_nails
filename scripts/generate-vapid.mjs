// Gera o par de chaves VAPID para notificações (Web Push).
// Uso: npm run vapid
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('\nChave pública  -> wrangler.jsonc, em vars.VAPID_PUBLIC_KEY:\n');
console.log(publicKey);
console.log('\nChave privada  -> segredo (npx wrangler secret put VAPID_PRIVATE_KEY) e .dev.vars:\n');
console.log(d, '\n');
