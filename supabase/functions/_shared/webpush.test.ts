// Run with: deno test supabase/functions/_shared
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1';

import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from './webpush.ts';

const encoder = new TextEncoder();

// Produced by http_ece (the reference implementation of RFC 8188/8291) from
// these exact keys, salt and payload; our encryption must match it byte for byte.
const VECTOR = {
  receiverPublic: 'BFPX8CCf9a0ekCJD7lSaWutCNLKRm28b4fm5cMmdQc3f5dvclUBLxebZ_8nwUatMcJHJfp-nDuk7Qt7huQIrxuk',
  receiverPrivate: '61OH8mNYTjM8JoOFmly3G68MalOgFKUrHXy67MAm5-w',
  auth: '0wFq7-WRarRirXY-i7pfGQ',
  senderPublic: 'BDSiE8Rfp8W6_9EFEJR83n58V24lWZNtLO9psuCqfa-4CVDBuk4r9jTwlKNdw_KL2K-HAKKz2XtrXgPdxaNt4UA',
  senderPrivate: 'Q0DezhSJm9NhTvY6JtTdpD_AHjRqJ8R5N3EEc8lCYBQ',
  salt: 'GBsLyec1beiqeKwjadAttg',
  payload: '{"title":"Ana recorded a match 0","body":"","url":"/"}',
  expected:
    'GBsLyec1beiqeKwjadAttgAAEABBBDSiE8Rfp8W6_9EFEJR83n58V24lWZNtLO9psuCqfa-4CVDBuk4r9jTwlKNdw_KL2K-HAKKz2XtrXgPdxaNt4UAP23SPx1XQCo-vZVKAIapBXEeJuUzJYN3NFyJ-QNy6qJtj6fZvCRcijJXu1RLHsQOp3VLW5ukAc-8un-UgFgkPrl__-H22iA',
};

// An uncompressed P-256 public key (+ optional private scalar) as a JWK.
function jwk(publicKey: string, privateKey?: string): JsonWebKey {
  const raw = base64UrlDecode(publicKey);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(raw.subarray(1, 33)),
    y: base64UrlEncode(raw.subarray(33, 65)),
    ...(privateKey ? { d: privateKey } : {}),
  };
}

const importEcdh = (key: JsonWebKey, usages: KeyUsage[]) =>
  crypto.subtle.importKey('jwk', key, { name: 'ECDH', namedCurve: 'P-256' }, true, usages);

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
  return out;
};

// The browser's side of RFC 8291, written independently of webpush.ts.
async function decryptAsBrowser(body: Uint8Array, receiverPublic: string, receiverPrivate: string, auth: string) {
  const salt = body.slice(0, 16);
  const keyIdLength = body[20];
  const senderPublic = body.slice(21, 21 + keyIdLength);
  const receiver = await importEcdh(jwk(receiverPublic, receiverPrivate), ['deriveBits']);
  const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver, 256));
  const ikm = await hmac(
    await hmac(base64UrlDecode(auth), shared),
    join(encoder.encode('WebPush: info\0'), base64UrlDecode(receiverPublic), senderPublic, new Uint8Array([1])),
  );
  const prk = await hmac(salt, ikm);
  const key = (await hmac(prk, join(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const iv = (await hmac(prk, join(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, body.slice(21 + keyIdLength)));
  assertEquals(plain.at(-1), 2, 'single final record');
  return new TextDecoder().decode(plain.slice(0, -1));
}

Deno.test('encryption matches the reference implementation byte for byte', async () => {
  const senderKeys = {
    privateKey: await importEcdh(jwk(VECTOR.senderPublic, VECTOR.senderPrivate), ['deriveBits']),
    publicKey: await importEcdh(jwk(VECTOR.senderPublic), []),
  };
  const body = await encryptPayload(
    encoder.encode(VECTOR.payload),
    { p256dh: VECTOR.receiverPublic, auth: VECTOR.auth },
    { senderKeys, salt: base64UrlDecode(VECTOR.salt) },
  );
  assertEquals(base64UrlEncode(body), VECTOR.expected);
});

Deno.test('a browser can decrypt a message sent with fresh keys', async () => {
  const payload = JSON.stringify({ title: 'Silviu recorded a match', body: 'You lost 1–3. Tap to confirm or decline.', url: '/' });
  const first = await encryptPayload(encoder.encode(payload), { p256dh: VECTOR.receiverPublic, auth: VECTOR.auth });
  const second = await encryptPayload(encoder.encode(payload), { p256dh: VECTOR.receiverPublic, auth: VECTOR.auth });
  assert(base64UrlEncode(first) !== base64UrlEncode(second), 'fresh salt and keys every time');
  for (const body of [first, second]) {
    assertEquals(await decryptAsBrowser(body, VECTOR.receiverPublic, VECTOR.receiverPrivate, VECTOR.auth), payload);
  }
});

Deno.test('bad subscription keys and oversized payloads are refused', async () => {
  const short = base64UrlEncode(new Uint8Array(10));
  await assertRejects(() => encryptPayload(encoder.encode('x'), { p256dh: short, auth: VECTOR.auth }), Error, 'Invalid subscription keys');
  await assertRejects(
    () => encryptPayload(encoder.encode('x'.repeat(5000)), { p256dh: VECTOR.receiverPublic, auth: VECTOR.auth }),
    Error,
    'too large',
  );
});

Deno.test('the VAPID token is signed by our key, for the push service, for 12 hours', async () => {
  const keys = await generateVapidKeys();
  assertEquals(base64UrlDecode(keys.publicKey).length, 65);
  const now = Date.UTC(2026, 9, 29, 12);
  const header = await vapidAuthorization('https://web.push.apple.com/QGh2a0x?x=1', keys, 'https://example.org', now);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert(match, header);
  const [, head, claims, signature, k] = match;
  assertEquals(k, keys.publicKey);
  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(head))), { typ: 'JWT', alg: 'ES256' });
  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims))), {
    aud: 'https://web.push.apple.com',
    exp: now / 1000 + 12 * 60 * 60,
    sub: 'https://example.org',
  });
  const verifier = await crypto.subtle.importKey('raw', base64UrlDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, base64UrlDecode(signature), encoder.encode(`${head}.${claims}`)),
    'signature verifies',
  );
  assertMatch(keys.privateJwk.d ?? '', /^[\w-]{43}$/);
});
