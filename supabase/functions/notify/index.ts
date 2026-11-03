// 21GRAM Tennis — "match started" notifications.
//
// The app calls this right after a live match is first saved. It sends one push notification per match
// to the people connected to that player — the family and its coaches — except whoever started it.
// The caller must be able to see the match (the database's access rules decide). Devices that the push
// service reports as gone are switched off.
//
// {"action": "publicKey"} returns the public half of the Web Push (VAPID) key pair, which the app needs
// to register a device. The pair is made here on first use and kept in the table app_keys, which only
// the server can read, so the private key never leaves the server. (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// and APP_URL secrets, if set, are used instead.)
// Deploy: supabase functions deploy notify   (JWT check on)

import { generateVapidKeys, sendPush, type Subscription, type Vapid } from './webpush.ts';

type Env = { url: string; serviceKey: string; anonKey: string; vapid: Vapid; appUrl: string };
type Sender = (sub: Subscription, message: unknown, vapid: Vapid) => Promise<number>;

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9_.~:@+-]{1,100}$/;
const KEY = /^[A-Za-z0-9_-]{40,100}$/;
/** The browsers' push services; nothing else is ever called (the database checks the same when a device registers). */
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

type Call = (path: string, init?: RequestInit) => Promise<Response>;
let cached: { vapid: Vapid; appUrl: string } | null = null;

/** The key pair and app address: secrets if set, else app_keys (made on first use; the first writer wins). */
async function keys(env: Env, call: Call): Promise<{ vapid: Vapid; appUrl: string }> {
  if (env.vapid.publicKey && env.vapid.privateKey && env.appUrl) return { vapid: { ...env.vapid, subject: env.vapid.subject || env.appUrl }, appUrl: env.appUrl };
  if (cached) return cached;
  const read = async () =>
    Object.fromEntries(
      ((await (await call(`/rest/v1/app_keys?select=name,value&name=in.(vapid_public,vapid_private,app_url)`)).json()) as { name: string; value: string }[]).map((r) => [r.name, r.value]),
    ) as Record<string, string>;
  let k = await read();
  if (!KEY.test(k.vapid_public ?? '') || !KEY.test(k.vapid_private ?? '')) {
    const made = await generateVapidKeys();
    await call('/rest/v1/app_keys?on_conflict=name', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([
        { name: 'vapid_public', value: made.publicKey },
        { name: 'vapid_private', value: made.privateKey },
      ]),
    });
    k = await read();
  }
  const appUrl = env.appUrl || (/^https:\/\//.test(k.app_url ?? '') ? k.app_url : '');
  if (!KEY.test(k.vapid_public ?? '') || !KEY.test(k.vapid_private ?? '')) throw new Error('no push keys');
  cached = { vapid: { publicKey: k.vapid_public, privateKey: k.vapid_private, subject: appUrl || 'https://supabase.com' }, appUrl };
  return cached;
}

function texts(lang: string, player: string, opponent: string, starter: string) {
  if (lang === 'fa') {
    return {
      title: `🎾 بازی ${player} شروع شد`,
      body: `${opponent ? `مقابل ${opponent} · ` : ''}امتیازها را ${starter} ثبت می‌کند. برای دنبال کردن زنده بزنید.`,
    };
  }
  return {
    title: `🎾 ${player}’s match has started`,
    body: `${opponent ? `vs ${opponent} · ` : ''}${starter} is keeping score. Tap to follow it live.`,
  };
}

export async function handle(req: Request, env: Env, send: Sender = sendPush): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth) || !env.url || !env.serviceKey) return reply({ error: 'not_signed_in' }, 401);
  const input = (await req.json().catch(() => ({}))) as { matchId?: unknown; action?: unknown };

  const me = await fetch(`${env.url}/auth/v1/user`, { headers: { apikey: env.anonKey || env.serviceKey, Authorization: auth } });
  if (!me.ok) return reply({ error: 'not_signed_in' }, 401);
  const uid = String(((await me.json()) as { id?: string }).id ?? '');
  if (!UUID.test(uid)) return reply({ error: 'not_signed_in' }, 401);

  const service: Record<string, string> = env.serviceKey.startsWith('eyJ')
    ? { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` }
    : { apikey: env.serviceKey };
  const call: Call = async (path, init = {}) => {
    const res = await fetch(`${env.url}${path}`, {
      ...init,
      headers: { ...service, 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
    });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  const get = async <T>(path: string) => (await (await call(path)).json()) as T[];

  if (input.action === 'publicKey') {
    try {
      return reply({ publicKey: (await keys(env, call)).vapid.publicKey });
    } catch (e) {
      console.error('notify keys', e);
      return reply({ error: 'failed' }, 500);
    }
  }
  const matchId = typeof input.matchId === 'string' && ID.test(input.matchId) ? input.matchId : '';
  if (!matchId) return reply({ error: 'bad_match' }, 400);

  // The match as the caller sees it: their access rules decide whether they may announce it.
  const seen = await fetch(`${env.url}/rest/v1/docs?select=data&path=eq.${enc(`academy/data/matches/${matchId}`)}`, {
    headers: { apikey: env.anonKey || env.serviceKey, Authorization: auth },
  });
  const rows = seen.ok ? ((await seen.json()) as { data: Record<string, unknown> }[]) : [];
  const match = rows[0]?.data;
  if (!match) return reply({ error: 'not_found' }, 404);
  if (match.status !== 'live') return reply({ ok: true, sent: 0, reason: 'not_live' });
  // Only a match that has just started (not an old one left open and edited later).
  const started = Date.parse(String(match.createdAt ?? ''));
  if (!started || Date.now() - started > 12 * 3600 * 1000) return reply({ ok: true, sent: 0, reason: 'not_recent' });
  const playerId = String(match.playerId ?? '');
  if (!UUID.test(playerId)) return reply({ ok: true, sent: 0, reason: 'no_account' });

  try {
    // Once per match, however often it is called.
    const first = await call('/rest/v1/match_notifications?on_conflict=match_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ match_id: matchId, sent_by: uid }),
    });
    if (!((await first.json()) as unknown[]).length) return reply({ ok: true, sent: 0, reason: 'already_sent' });

    const coaches = await get<{ coach_id: string }>(`/rest/v1/connections?select=coach_id&family_id=eq.${playerId}&status=eq.accepted`);
    const people = [...new Set([playerId, ...coaches.map((c) => c.coach_id)])].filter((id) => id !== uid && UUID.test(id));
    if (!people.length) return reply({ ok: true, sent: 0 });
    const profiles = await get<{ user_id: string; display_name: string; notify_live: boolean; blocked: boolean }>(
      `/rest/v1/profiles?select=user_id,display_name,notify_live,blocked&user_id=in.(${[...people, uid].join(',')})`,
    );
    const starter = profiles.find((p) => p.user_id === uid)?.display_name ?? '';
    const allowed = profiles.filter((p) => p.user_id !== uid && p.notify_live && !p.blocked).map((p) => p.user_id);
    if (!allowed.length) return reply({ ok: true, sent: 0 });
    const player = await get<{ data: { name?: string } }>(`/rest/v1/docs?select=data&path=eq.${enc(`academy/data/players/${playerId}`)}`);
    const playerName = String(player[0]?.data?.name ?? '');
    const subs = await get<Subscription & { lang: string; user_id: string }>(
      `/rest/v1/push_subscriptions?select=endpoint,p256dh,auth,lang,user_id&user_id=in.(${allowed.join(',')})&disabled_at=is.null`,
    );
    if (!subs.length) return reply({ ok: true, sent: 0, devices: 0 });
    const { vapid, appUrl } = await keys(env, call);
    let sent = 0;
    for (const sub of subs) {
      const t = texts(sub.lang, playerName, String(match.opponent ?? ''), starter);
      let status = 0;
      try {
        status = PUSH_HOST.test(sub.endpoint) ? await send(sub, { ...t, url: `${appUrl}#match-${matchId}`, tag: `match-${matchId}` }, vapid) : 410;
      } catch (e) {
        console.error('push failed', e);
      }
      if (status >= 200 && status < 300) sent++;
      else if (status === 404 || status === 410) {
        await call(`/rest/v1/push_subscriptions?endpoint=eq.${enc(sub.endpoint)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ disabled_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }
    return reply({ ok: true, sent, devices: subs.length });
  } catch (e) {
    console.error('notify', matchId, e);
    return reply({ error: 'failed', detail: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
}

// On Supabase (Deno). In tests the handler is imported and called directly.
const D = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void; env: { get(k: string): string | undefined } } }).Deno;
if (D?.serve) {
  const fromKeys = (name: string) => {
    try {
      const v = (JSON.parse(D.env.get(name) ?? '{}') as Record<string, string>).default ?? '';
      return v.startsWith('sb_') || v.startsWith('eyJ') ? v : D.env.get(v) ?? '';
    } catch {
      return '';
    }
  };
  const appUrl = D.env.get('APP_URL') ?? '';
  D.serve((req) =>
    handle(req, {
      url: D.env.get('SUPABASE_URL') ?? '',
      serviceKey: D.env.get('SUPABASE_SERVICE_ROLE_KEY') || fromKeys('SUPABASE_SECRET_KEYS'),
      anonKey: D.env.get('SUPABASE_ANON_KEY') || fromKeys('SUPABASE_PUBLISHABLE_KEYS'),
      vapid: { publicKey: D.env.get('VAPID_PUBLIC_KEY') ?? '', privateKey: D.env.get('VAPID_PRIVATE_KEY') ?? '', subject: appUrl },
      appUrl,
    }),
  );
}
