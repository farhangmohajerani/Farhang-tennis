// 21GRAM Tennis — delete the signed-in person's account inside the app (App Store rule 5.1.1(v)).
//
// Removes, in this order: the plans, results, tournaments and matches of the family's player and of
// the players the person added without an account; those players; older family copies; links in
// older player records; then the sign-in itself (profile, connections, staff role and plan go with
// it). The last admin cannot delete their account. Same steps as delete_my_account() in
// supabase/subscriptions.sql. Uses only Supabase's REST endpoints, so it needs no packages.
//
// Deploy: supabase functions deploy delete-account   (JWT check on: only signed-in people can call it)

type Env = { url: string; serviceKey: string; anonKey: string };

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAYERS = 'academy/data/players/';

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth) || !env.url || !env.serviceKey) return reply({ error: 'not_signed_in' }, 401);

  // Who is asking: Supabase Auth checks the token.
  const me = await fetch(`${env.url}/auth/v1/user`, { headers: { apikey: env.anonKey || env.serviceKey, Authorization: auth } });
  if (!me.ok) return reply({ error: 'not_signed_in' }, 401);
  const uid = String(((await me.json()) as { id?: string }).id ?? '');
  if (!UUID.test(uid)) return reply({ error: 'not_signed_in' }, 401);

  // Everything below runs with the service key (a legacy JWT goes in both headers, a new secret key in apikey only).
  const service: Record<string, string> = env.serviceKey.startsWith('eyJ')
    ? { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` }
    : { apikey: env.serviceKey };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${env.url}${path}`, {
      ...init,
      headers: { ...service, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...((init.headers as Record<string, string>) ?? {}) },
    });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  const rows = async <T>(path: string) => (await (await call(path)).json()) as T[];

  try {
    const admins = await rows<{ user_id: string }>('/rest/v1/staff?select=user_id&role=eq.admin');
    if (admins.some((a) => a.user_id === uid) && admins.length <= 1) return reply({ error: 'last_admin' }, 400);

    // Players this person added without an account (a coach's own players).
    const owned = (await rows<{ path: string }>(`/rest/v1/docs?select=path&path=like.${enc(PLAYERS + '*')}&data->>ownerId=eq.${uid}`))
      .map((d) => d.path.slice(PLAYERS.length))
      .filter((id) => id && !UUID.test(id));
    const ids = [uid, ...owned].map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    for (const coll of ['plans', 'logs', 'tournaments', 'matches']) {
      await call(`/rest/v1/docs?path=like.${enc(`academy/data/${coll}/*`)}&data->>playerId=in.(${enc(ids)})`, { method: 'DELETE' });
    }
    await call(`/rest/v1/docs?path=eq.${enc(PLAYERS + uid)}`, { method: 'DELETE' });
    for (const id of owned) await call(`/rest/v1/docs?path=eq.${enc(PLAYERS + id)}&data->>ownerId=eq.${uid}`, { method: 'DELETE' });
    await call(`/rest/v1/docs?path=like.${enc(`family/${uid}/*`)}`, { method: 'DELETE' });

    // Older links: parents who followed a player.
    const players = await rows<{ path: string; data: { parentIds?: unknown } }>(`/rest/v1/docs?select=path,data&path=like.${enc(PLAYERS + '*')}`);
    for (const p of players) {
      const list = Array.isArray(p.data?.parentIds) ? (p.data.parentIds as unknown[]) : [];
      if (!list.includes(uid)) continue;
      await call(`/rest/v1/docs?path=eq.${enc(p.path)}`, { method: 'PATCH', body: JSON.stringify({ data: { ...p.data, parentIds: list.filter((x) => x !== uid) } }) });
    }

    // The sign-in last: the profile, connections, staff role and plan are removed with it.
    await call(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    return reply({ ok: true });
  } catch (e) {
    console.error('delete-account', uid, e);
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
  D.serve((req) =>
    handle(req, {
      url: D.env.get('SUPABASE_URL') ?? '',
      serviceKey: D.env.get('SUPABASE_SERVICE_ROLE_KEY') || fromKeys('SUPABASE_SECRET_KEYS'),
      anonKey: D.env.get('SUPABASE_ANON_KEY') || fromKeys('SUPABASE_PUBLISHABLE_KEYS'),
    }),
  );
}
