// Web Push: sending a notification to one browser subscription (RFC 8030),
// with the payload encrypted for that browser (RFC 8291, "aes128gcm") and the
// request signed with the server's VAPID key (RFC 8292). Uses only the Web
// Crypto API, so it runs as-is in Edge Functions and is unit-tested in
// webpush.test.ts.

export type VapidKeys = {
  publicKey: string; // base64url uncompressed P-256 point: the app's applicationServerKey
  privateJwk: JsonWebKey;
};

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: base64UrlEncode(publicKey), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

// The Authorization header for a push to `endpoint`: a 12-hour ES256 token
// for the push service's origin, plus our public key.
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const part = (value: unknown) => base64UrlEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: keys.privateJwk.kty, crv: keys.privateJwk.crv, x: keys.privateJwk.x, y: keys.privateJwk.y, d: keys.privateJwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // Web Crypto's ECDSA signature is r || s, which is what ES256 uses.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

// Encrypts `payload` for one browser (RFC 8291) as a single aes128gcm record.
// `senderKeys` and `salt` are fresh for every message; tests pass fixed ones
// to compare against a reference implementation.
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  options: { senderKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublic = base64UrlDecode(target.p256dh);
  const authSecret = base64UrlDecode(target.auth);
  if (receiverPublic.length !== 65 || authSecret.length !== 16) throw new Error('Invalid subscription keys');
  if (payload.length + 1 + 16 > RECORD_SIZE) throw new Error('Notification payload is too large');

  const sender =
    options.senderKeys ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256),
  );

  // HKDF, written out: each expansion here needs only one HMAC block.
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hmacSha256(
    prkKey,
    concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic, new Uint8Array([1])),
  );
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const contentKey = (await hmacSha256(prk, concat(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concat(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (here, only) record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))),
  );

  // Header: salt | record size | key id length | key id (our public key).
  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, ciphertext);
}

// Sends one notification. The caller decides what to do with the response
// (404/410 mean the subscription is gone for good).
export async function sendPush(
  target: PushTarget,
  payload: string,
  keys: VapidKeys,
  subject: string,
): Promise<Response> {
  const body = await encryptPayload(encoder.encode(payload), target);
  return fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(3 * 24 * 60 * 60), // keep trying for 3 days if the phone is offline
      Urgency: 'normal',
    },
    body,
  });
}
