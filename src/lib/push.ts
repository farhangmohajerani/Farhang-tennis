/**
 * Notifications on this device (Web Push). The worker (public/sw.js) shows them; the notify Edge Function
 * sends them and holds the key pair (the app asks it for the public half). On iPhone and iPad they work
 * only in the app added to the Home Screen (iOS 16.4+).
 */
import type { Result } from './social';

/** unsupported: this browser cannot · install: iPhone/iPad Safari, add to Home Screen first · denied: blocked in settings. */
export type PushState = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
export const isStandalone = () =>
  !!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function fromB64u(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64u(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---- the server's public key (asked once, kept for the session) ---- */
let keySource: (() => Promise<string>) | null = null;
let keyPromise: Promise<string> | null = null;
/** Online version: where the public key comes from (the notify function). */
export function setPushKeySource(f: () => Promise<string>) {
  keySource = f;
  keyPromise = null;
}
function pushKey(): Promise<string> {
  if (!keySource) return Promise.reject(new Error('no_push_key'));
  if (!keyPromise) {
    keyPromise = keySource()
      .then((k) => {
        if (!/^[A-Za-z0-9_-]{80,100}$/.test(k ?? '')) throw new Error('bad_push_key');
        return k;
      })
      .catch((e) => {
        keyPromise = null;
        throw e;
      });
  }
  return keyPromise;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registered once at start (online version only), so a notification tap can open the right page. */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration =
      'serviceWorker' in navigator
        ? navigator.serviceWorker.register('sw.js').catch((e) => {
            console.warn('service worker', e);
            return null;
          })
        : Promise.resolve(null);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as { type?: string; url?: string } | null;
        if (d?.type === 'open' && d.url && d.url.startsWith(window.location.origin)) window.location.href = d.url;
      });
    }
  }
  return registration;
}

const supported = () => 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator && !!keySource;

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registerWorker();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  const on = !!sub && Notification.permission === 'granted' && owner() === currentUser;
  // Ready before the tap: Safari wants the subscription soon after the person allows it.
  if (!on) void pushKey().catch(() => undefined);
  return on ? 'on' : 'off';
}

type Save = (s: { endpoint: string; p256dh: string; auth: string; lang: string }) => Promise<Result>;

/** Who turned notifications on for this browser: they stay that person's, never the next one's. */
const OWNER_KEY = 'tennis-progress:push-owner';
let currentUser = '';
export function setPushUser(id: string) {
  currentUser = id;
}
function owner(): string {
  try {
    return window.localStorage.getItem(OWNER_KEY) ?? '';
  } catch {
    return '';
  }
}
function setOwner(id: string | null) {
  try {
    if (id) window.localStorage.setItem(OWNER_KEY, id);
    else window.localStorage.removeItem(OWNER_KEY);
  } catch {
    /* private mode */
  }
}

/** Ask the browser (must run from a tap), subscribe, and register this device. */
export async function enablePush(save: Save, lang: string): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  // Asked first, while the tap still counts (Safari requires it).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const [reg, key] = await Promise.all([registerWorker(), pushKey()]);
  if (!reg) return 'unsupported';
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older key cannot be reused.
  if (sub && b64u(sub.options?.applicationServerKey) !== key) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) as unknown as BufferSource });
  const keys = sub.toJSON().keys ?? {};
  const r = await save({ endpoint: sub.endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '', lang });
  if (r?.error) throw new Error(r.error);
  setOwner(currentUser);
  return 'on';
}

export async function disablePush(disable: (endpoint: string) => Promise<Result>): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await disable(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => false);
  setOwner(null);
}

/**
 * At start: keep the server's copy current (the language may have changed). Someone else turned them on
 * in this browser and never signed out: switched off here, so nobody gets notifications they did not ask for.
 */
export async function syncPush(save: Save, lang: string): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  if (owner() !== currentUser) {
    await sub.unsubscribe().catch(() => false);
    setOwner(null);
    return;
  }
  const keys = sub.toJSON().keys ?? {};
  await save({ endpoint: sub.endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '', lang }).catch(() => undefined);
}
