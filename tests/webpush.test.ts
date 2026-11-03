import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, encrypt, fromB64u, generateVapidKeys, importKeyPair, vapidHeader } from '../supabase/functions/notify/webpush.ts';

const te = new TextEncoder();
const B = (u: Uint8Array) => u as unknown as BufferSource;

/** The receiving side (a browser), for the checks: RFC 8291 decryption of one record. */
async function decrypt(body: Uint8Array, uaKeys: CryptoKeyPair, authSecret: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey('raw', B(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const h = async (s: Uint8Array, k: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: B(s), info: B(info) }, await crypto.subtle.importKey('raw', B(k), 'HKDF', false, ['deriveBits']), n * 8));
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await h(authSecret, ecdh, info, 32);
  const cek = await h(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await h(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', B(cek), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(nonce) }, key, B(cipher)));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'last-record padding delimiter');
  return new TextDecoder().decode(plain.slice(0, end));
}

test('web push encryption matches the RFC 8291 example message exactly', async () => {
  const asKeys = await importKeyPair(
    fromB64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    fromB64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    'ECDH',
  );
  const body = await encrypt(
    te.encode('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { asKeys, salt: fromB64u('DGv6ra1nlYgDCS1FRnbzlw') },
  );
  assert.equal(
    b64u(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('web push: a browser key decrypts what we send (random keys, Persian text)', async () => {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: '🎾 بازی یامان شروع شد', body: 'مقابل حریف', url: 'https://example.com/#match-1' });
  const body = await encrypt(te.encode(msg), b64u(uaPublic), b64u(auth));
  assert.equal(await decrypt(body, ua, auth), msg);
  assert.ok(body.length < 4096, 'fits a push message');
});

test('VAPID header: an ES256 token for the push service, signed by our key', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const vapid = { publicKey: b64u(pub), privateKey: jwk.d!, subject: 'https://example.com/app/' };
  const header = await vapidHeader('https://web.push.apple.com/QGuQyavXutnMH', vapid, Date.UTC(2026, 10, 3));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(m![2])));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://example.com/app/');
  assert.equal(claims.exp, Math.floor(Date.UTC(2026, 10, 3) / 1000) + 12 * 3600);
  assert.equal(m![4], vapid.publicKey);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, B(fromB64u(m![3])), B(te.encode(`${m![1]}.${m![2]}`)));
  assert.ok(ok, 'signature verifies with the public key');
});

test('VAPID keys made by the server: right sizes, and they sign headers that verify', async () => {
  const k = await generateVapidKeys();
  assert.equal(fromB64u(k.publicKey).length, 65, 'raw P-256 public key');
  assert.equal(fromB64u(k.publicKey)[0], 4, 'uncompressed point');
  assert.equal(fromB64u(k.privateKey).length, 32, 'private scalar');
  assert.match(k.publicKey, /^[A-Za-z0-9_-]{87}$/);
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { ...k, subject: 'https://example.com/app/' });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  const pub = await crypto.subtle.importKey('raw', B(fromB64u(k.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, B(fromB64u(m[3])), B(te.encode(`${m[1]}.${m[2]}`))));
  const other = await generateVapidKeys();
  assert.notEqual(other.privateKey, k.privateKey, 'a new pair each time');
});
