// Checks our WebCrypto Web Push against the reference aes128gcm implementation (http_ece) and ECDSA verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ece from 'http_ece';
import { encrypt, vapidAuth, b64u } from '../src/push.js';

const { subtle } = globalThis.crypto;

test('payload decrypts with the subscriber keys', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const uaPrivate = await subtle.exportKey('jwk', ua.privateKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: 'SP98 disponible', body: 'Relais Mal Leclerc : 1,990 €' });

  const body = await encrypt(message, { p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) });

  const { createECDH } = await import('node:crypto');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivate.d, 'base64url'));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, dh: undefined, authSecret: Buffer.from(auth) });
  assert.equal(plain.toString(), message);
});

test('VAPID token is a valid ES256 JWT for the endpoint origin', async () => {
  const k = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u.encode(await subtle.exportKey('raw', k.publicKey));
  const header = await vapidAuth('https://web.push.apple.com/abc', {
    publicKey, privateJwk: await subtle.exportKey('jwk', k.privateKey), subject: 'https://tekncoach.github.io/essence-tracker/',
  });
  const [, jwt, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, publicKey);
  const [h, p, s] = jwt.split('.');
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, b64u.decode(s), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok);
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.ok(claims.exp > Date.now() / 1000);
});
