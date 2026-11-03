// Web Push without packages: VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291) with WebCrypto.
// Works in Deno (Supabase Edge Functions) and in Node 20+ (tests).

const te = new TextEncoder();
/** WebCrypto's parameter type (newer TypeScript types typed arrays more strictly). */
const B = (u: Uint8Array) => u as unknown as BufferSource;

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', B(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: B(salt), info: B(info) }, key, length * 8));
}

/** A P-256 key pair from its raw public key (65 bytes) and private scalar (32 bytes). */
export async function importKeyPair(publicRaw: Uint8Array, privateD: Uint8Array, usage: 'ECDH' | 'ECDSA'): Promise<CryptoKeyPair> {
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(publicRaw.slice(1, 33)), y: b64u(publicRaw.slice(33, 65)), d: b64u(privateD), ext: true };
  const alg = { name: usage, namedCurve: 'P-256' };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, alg, true, usage === 'ECDH' ? ['deriveBits'] : ['sign']);
  const publicKey = await crypto.subtle.importKey('raw', B(publicRaw), alg, true, usage === 'ECDH' ? [] : ['verify']);
  return { privateKey, publicKey };
}

/**
 * Encrypt a message for one subscription (RFC 8291, one record). `fixed` is for the RFC test vector only:
 * normally a new key pair and salt are made for every message.
 */
export async function encrypt(payload: Uint8Array, uaPublicB64: string, authSecretB64: string, fixed?: { asKeys: CryptoKeyPair; salt: Uint8Array }): Promise<Uint8Array> {
  const uaPublic = fromB64u(uaPublicB64);
  const authSecret = fromB64u(authSecretB64);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asKeys = fixed?.asKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', B(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', B(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: B(nonce) }, key, B(concat(payload, new Uint8Array([2])))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export interface Vapid {
  /** Raw public key, base64url (65 bytes). */
  publicKey: string;
  /** Private scalar d, base64url (32 bytes). */
  privateKey: string;
  /** Contact for the push services: an https URL or mailto. */
  subject: string;
}

/** The Authorization header for one push service (its origin is the token's audience). */
export async function vapidHeader(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const header = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const keys = await importKeyPair(fromB64u(vapid.publicKey), fromB64u(vapid.privateKey), 'ECDSA');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, B(te.encode(`${header}.${claims}`))));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** A new VAPID key pair: the raw public key and the private scalar, both base64url. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  if (!jwk.d || pub.length !== 65) throw new Error('key generation failed');
  return { publicKey: b64u(pub), privateKey: jwk.d };
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send one notification; returns the push service's status (201 = accepted, 404/410 = subscription gone). */
export async function sendPush(sub: Subscription, message: unknown, vapid: Vapid, ttl = 3600): Promise<number> {
  const body = await encrypt(te.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body: B(body),
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}
