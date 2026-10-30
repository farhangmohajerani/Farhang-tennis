/**
 * Minimal in-memory stand-in for the Supabase endpoints the app uses (auth, PostgREST on
 * `docs`, `staff`, `staff_invites`, and the RPCs in supabase/academy.sql), including the
 * same access rules. Used by e2e/supabase.mjs; the real rules are tested in SQL separately.
 */
import http from 'node:http';
import crypto from 'node:crypto';

export function startMockSupabase(port = 4300, ownerEmail = 'owner@example.com') {
  const users = new Map(); // email -> {id, email, password}
  const tokens = new Map(); // token -> user
  const staff = new Map(); // user_id -> {user_id, email, role}
  const invites = new Map([[ownerEmail, { email: ownerEmail, role: 'admin' }]]);
  const docs = new Map(); // path -> {path, data, updated_at}
  const codes = new Map(); // user_id -> code
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();

  const role = (u) => staff.get(u?.id)?.role ?? null;
  const canRead = (u, path) => !!role(u) || path.startsWith(`family/${u?.id}/`);
  const canWrite = (u, path) => role(u) === 'admin' || (role(u) === 'coach' && !path.startsWith('academy/library/') && path !== 'academy/config');
  const parentOf = (p) => p.split('/').slice(0, -1).join('/');

  const issue = (u) => {
    const t = crypto.randomBytes(16).toString('hex');
    tokens.set(t, u);
    const payload = Buffer.from(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return { access_token: `x.${payload}.${t}`, refresh_token: t, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
  };
  const who = (req) => {
    const t = (req.headers.authorization ?? '').split('.').pop();
    return tokens.get(t) ?? null;
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') return res.end();
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const p = url.pathname;
    if (p === '/auth/v1/signup') {
      const email = String(json.email).toLowerCase();
      if (users.has(email)) return send(422, { msg: 'User already registered' });
      const u = { id: crypto.randomUUID(), email, password: json.password };
      users.set(email, u);
      return send(200, issue(u));
    }
    if (p === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = tokens.get(json.refresh_token);
        return u ? send(200, issue(u)) : send(400, { error_description: 'Invalid refresh token' });
      }
      const u = users.get(String(json.email).toLowerCase());
      return u && u.password === json.password ? send(200, issue(u)) : send(400, { error_description: 'Invalid login credentials' });
    }
    const u = who(req);
    if (!u) return send(401, { message: 'JWT required' });
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      if (fn === 'claim_staff') {
        const inv = invites.get(u.email);
        if (inv) {
          staff.set(u.id, { user_id: u.id, email: u.email, role: inv.role });
          invites.delete(u.email);
        }
        return send(200, role(u));
      }
      if (fn === 'my_pair_code') {
        if (!codes.has(u.id)) codes.set(u.id, String(100000 + Math.floor(Math.random() * 900000)));
        return send(200, codes.get(u.id));
      }
      if (fn === 'resolve_pair_code') {
        if (!role(u)) return send(200, null);
        const hit = [...codes.entries()].find(([, c]) => c === json.p_code);
        return send(200, hit ? hit[0] : null);
      }
      if (fn === 'user_emails') {
        if (!role(u)) return send(200, []);
        return send(200, [...users.values()].filter((x) => json.p_ids.includes(x.id)).map((x) => ({ id: x.id, email: x.email })));
      }
      return send(404, {});
    }
    if (p === '/rest/v1/docs') {
      if (req.method === 'GET') {
        let rows = [...docs.values()].filter((d) => canRead(u, d.path)).sort((a, b) => a.path.localeCompare(b.path));
        const inF = url.searchParams.get('path');
        if (inF?.startsWith('in.(')) {
          const want = inF.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''));
          rows = rows.filter((r) => want.includes(r.path));
        }
        const [from, to] = (req.headers.range ?? '0-9999').split('-').map(Number);
        rows = rows.slice(from, to + 1);
        const cols = (url.searchParams.get('select') ?? '').split(',');
        return send(200, rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))));
      }
      if (req.method === 'POST') {
        if (!canWrite(u, json.path)) return send(403, { message: 'new row violates row-level security policy' });
        docs.set(json.path, { path: json.path, parent: parentOf(json.path), data: json.data, updated_at: stamp() });
        return send(201);
      }
      if (req.method === 'DELETE') {
        const path = url.searchParams.get('path').replace(/^eq\./, '');
        if (canWrite(u, path)) docs.delete(path);
        return send(204);
      }
    }
    if (p === '/rest/v1/staff') {
      if (req.method === 'GET') return send(200, role(u) ? [...staff.values()] : []);
      if (req.method === 'DELETE' && role(u) === 'admin') {
        staff.delete(url.searchParams.get('user_id').replace(/^eq\./, ''));
        return send(204);
      }
      return send(403, {});
    }
    if (p === '/rest/v1/staff_invites') {
      if (role(u) !== 'admin') return req.method === 'GET' ? send(200, []) : send(403, { message: 'row-level security' });
      if (req.method === 'GET') return send(200, [...invites.values()]);
      if (req.method === 'POST') {
        invites.set(json.email, json);
        return send(201);
      }
      if (req.method === 'DELETE') {
        invites.delete(url.searchParams.get('email').replace(/^eq\./, ''));
        return send(204);
      }
    }
    send(404, { message: 'not found ' + p });
  });
  return new Promise((r) => server.listen(port, () => r({ server, docs, staff, invites })));
}
