/**
 * Minimal in-memory stand-in for the Supabase endpoints the app uses: auth, PostgREST on `docs`,
 * `staff` and `subscriptions`, the RPCs of supabase/social.sql and social-2.sql (usernames,
 * connections, consents, privacy, approvals, moderation, push devices) with the same access rules,
 * and the two Edge Functions. Used by the e2e tests; the real rules are tested in SQL separately.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { handle as deleteAccountFunction } from '../supabase/functions/delete-account/index.ts';
import { handle as notifyFunction } from '../supabase/functions/notify/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USERNAME = /^[a-z0-9][a-z0-9_.]{2,23}$/;
/** The service role key (edge functions): passes every access rule. */
export const SERVICE_KEY = 'service-role-test-key';

/* ---- the PostgREST filters the app and the edge function use: eq, like (* wildcard), in, data->>key ---- */
function filtersOf(url) {
  const out = [];
  for (const [key, v] of url.searchParams) {
    if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(key)) continue;
    const m = /^(eq|like|in|is)\.([\s\S]*)$/.exec(v);
    if (!m) throw new Error(`mock: unsupported filter ${key}=${v}`);
    out.push({ key, op: m[1], arg: m[2] });
  }
  return out;
}
function fieldOf(row, key) {
  const j = /^(\w+)->>(\w+)$/.exec(key);
  const v = j ? row[j[1]]?.[j[2]] : row[key];
  return v === undefined || v === null ? null : String(v);
}
function inList(arg) {
  const body = arg.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const likeRe = (pat) => new RegExp('^' + [...pat].map((ch) => (ch === '*' || ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))).join('') + '$', 's');
const passes = (row, filters) =>
  filters.every(({ key, op, arg }) => {
    const v = fieldOf(row, key);
    if (op === 'eq') return v === arg;
    if (op === 'like') return v !== null && likeRe(arg).test(v);
    if (op === 'is') return arg === 'null' ? v === null : v === arg;
    return v !== null && inList(arg).includes(v);
  });
const pick = (rows, url) => {
  const cols = (url.searchParams.get('select') ?? '').split(',');
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
};

export function startMockSupabase(port = 4300, ownerEmail = 'owner@example.com') {
  const users = new Map(); // email -> {id, email, password, meta}
  const tokens = new Map(); // token -> user
  const staff = new Map(); // user_id -> {user_id, email, role}
  const invites = new Map([[ownerEmail, { email: ownerEmail, role: 'admin', used_at: null }]]);
  const docs = new Map(); // path -> {path, data, updated_at}
  const subs = new Map(); // user_id -> {user_id, plan, expires_at, source}
  const profiles = new Map(); // user_id -> {user_id, username, display_name, kind, created_at, discoverable, blocked, verified, notify_live, guardian, consent_version, consent_at}
  const connections = new Map(); // `${coach}|${family}` -> {coach_id, family_id, status, requested_by, created_at, responded_at, closed_by}
  const links = new Map(); // id -> {id, coach_id, family_id, offline_id, offline_name, status, created_at, responded_at}
  const pushSubs = new Map(); // endpoint -> {endpoint, user_id, p256dh, auth, lang, user_agent, created_at, disabled_at}
  const matchNotes = new Map(); // match_id -> {match_id, sent_by, sent_at}
  const appKeys = new Map([['app_url', { name: 'app_url', value: 'https://example.com/app/' }]]); // name -> {name, value} (server only)
  /** What the notify function sent (the push services are not called in tests). */
  const pushes = [];
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
  const now = () => new Date(Date.UTC(2026, 0, 1) + clock * 1000).getTime();

  const role = (u) => staff.get(u?.id)?.role ?? null;
  const isAdmin = (u) => role(u) === 'admin';
  const myKind = (u) => profiles.get(u?.id)?.kind ?? null;
  const blocked = (u) => profiles.get(u?.id)?.blocked === true;
  const createdOk = (u, data) => data?.createdBy === undefined || data?.createdBy === null || data.createdBy === u?.id;
  const byUsername = (name) => [...profiles.values()].find((p) => p.username === String(name ?? '').trim().toLowerCase()) ?? null;
  const parentOf = (p) => p.split('/').slice(0, -1).join('/');
  const seg = (path) => path.split('/')[3];
  const isPlayerPath = (path) => path.startsWith('academy/data/players/');

  /* ---- access rules: the earlier staff rules OR the social rules (supabase/social.sql) ---- */
  const docPlayer = (path, data) => (isPlayerPath(path) ? seg(path) : /^academy\/data\/(plans|logs|tournaments|matches)\//.test(path) ? data?.playerId ?? null : null);
  const canCoachPlayer = (u, p) => {
    if (!u || !p || blocked(u)) return false;
    if (UUID.test(p)) return connections.get(`${u.id}|${p}`)?.status === 'accepted';
    const d = docs.get(`academy/data/players/${p}`)?.data;
    return !!d && d.ownerId === u.id && d.archived !== true;
  };
  const canSeePlayer = (u, p) => !!p && (p === u?.id || canCoachPlayer(u, p));
  const ownOffline = (u, path, data) => isPlayerPath(path) && !UUID.test(seg(path)) && data?.ownerId === u?.id && data?.archived !== true && !blocked(u);
  const staffRead = (u, path) => !!role(u) || path.startsWith(`family/${u?.id}/`);
  const staffWrite = (u, path) => isAdmin(u) || (role(u) === 'coach' && !path.startsWith('academy/library/') && path !== 'academy/config');
  const canRead = (u, path, data) =>
    staffRead(u, path) ||
    path.startsWith('academy/library/') ||
    path === 'academy/config' ||
    (path.startsWith('academy/data/') && canSeePlayer(u, docPlayer(path, data))) ||
    ownOffline(u, path, data);
  const canInsert = (u, path, data) =>
    staffWrite(u, path) ||
    (path.startsWith('academy/data/') && createdOk(u, data) && (canCoachPlayer(u, docPlayer(path, data)) || (ownOffline(u, path, data) && myKind(u) === 'coach')));
  const canUpdate = (u, path, oldData, newData) =>
    staffWrite(u, path) || (path.startsWith('academy/data/') && canCoachPlayer(u, docPlayer(path, oldData)) && canCoachPlayer(u, docPlayer(path, newData)));
  const canDelete = (u, path, data) =>
    staffWrite(u, path) ||
    (path.startsWith('academy/data/') && !(isPlayerPath(path) && UUID.test(seg(path))) && createdOk(u, data) && canCoachPlayer(u, docPlayer(path, data)));

  const issue = (u) => {
    const t = crypto.randomBytes(16).toString('hex');
    tokens.set(t, u);
    const payload = Buffer.from(JSON.stringify({ sub: u.id, email: u.email, user_metadata: u.meta ?? {}, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return { access_token: `x.${payload}.${t}`, refresh_token: t, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
  };
  const SERVICE = { id: 'service', email: '', service: true };
  const who = (req) => {
    const authz = req.headers.authorization ?? '';
    if (authz === `Bearer ${SERVICE_KEY}` || (!authz && req.headers.apikey === SERVICE_KEY)) return SERVICE;
    const t = authz.split('.').pop();
    return tokens.get(t) ?? null;
  };
  /** Remove an account the way auth.users' "on delete cascade" does. */
  const dropUser = (id) => {
    for (const [k, c] of connections) if (c.coach_id === id || c.family_id === id) connections.delete(k);
    for (const [k, l] of links) if (l.coach_id === id || l.family_id === id) links.delete(k);
    for (const [k, x] of pushSubs) if (x.user_id === id) pushSubs.delete(k);
    profiles.delete(id);
    staff.delete(id);
    subs.delete(id);
    for (const [email, x] of users) if (x.id === id) users.delete(email);
    for (const [t, x] of tokens) if (x.id === id) tokens.delete(t);
  };
  // Like the docs_keep_created_by trigger: who created a document never changes.
  const putDoc = (path, data) => {
    const old = docs.get(path)?.data;
    const next = old && 'createdBy' in old ? { ...data, createdBy: old.createdBy } : data;
    docs.set(path, { path, parent: parentOf(path), data: next, updated_at: stamp() });
  };
  const newProfile = (u, name, display, kind, extra = {}) => ({
    user_id: u.id,
    username: name,
    display_name: display,
    kind,
    created_at: stamp(),
    discoverable: kind === 'coach',
    blocked: false,
    verified: false,
    notify_live: true,
    guardian: false,
    consent_version: null,
    consent_at: null,
    ...extra,
  });
  const familyPlayer = (u, name, display, a) => {
    const year = new Date().getFullYear();
    const by = Number(a.p_birth_year);
    putDoc(`academy/data/players/${u.id}`, {
      id: u.id,
      name: display,
      birthYear: by >= year - 90 && by <= year - 3 ? by : year - 12,
      level: 'beginner',
      hand: 'right',
      backhand: 'two',
      coachId: '',
      parentId: '',
      parentIds: [],
      goals: '',
      accountId: u.id,
      username: name,
      aiConsent: false,
    });
  };
  const pairOf = (u, other) => (myKind(u) === 'coach' ? `${u.id}|${other}` : `${other}|${u.id}`);
  const moveOffline = (off, familyId) => {
    const pdoc = docs.get(`academy/data/players/${off}`);
    let moved = 0;
    for (const d of docs.values()) {
      if (/^academy\/data\/(plans|logs|tournaments|matches)\//.test(d.path) && d.data.playerId === off) {
        d.data = { ...d.data, playerId: familyId };
        d.updated_at = stamp();
        moved++;
      }
    }
    const famDoc = docs.get(`academy/data/players/${familyId}`);
    if (famDoc && pdoc && 'level' in pdoc.data) {
      famDoc.data = { ...famDoc.data, level: pdoc.data.level, goals: pdoc.data.goals };
      famDoc.updated_at = stamp();
    }
    if (pdoc) {
      pdoc.data = { ...pdoc.data, archived: true, mergedInto: familyId };
      pdoc.updated_at = stamp();
    }
    return moved;
  };

  const rpc = {
    claim_staff(u) {
      // Only a new academy's first admin claims by email (supabase/staff-codes.sql).
      const inv = invites.get(u.email);
      const hasAdmin = [...staff.values()].some((x) => x.role === 'admin');
      if (inv && !inv.used_at && inv.role === 'admin' && !hasAdmin) {
        staff.set(u.id, { user_id: u.id, email: u.email, role: 'admin' });
        inv.used_at = stamp();
      }
      return role(u);
    },
    my_profile(u) {
      const p = profiles.get(u.id);
      return p
        ? {
            username: p.username,
            displayName: p.display_name,
            kind: p.kind,
            discoverable: p.discoverable,
            notifyLive: p.notify_live,
            verified: p.verified,
            blocked: p.blocked,
            guardian: p.guardian,
            consentAt: p.consent_at,
          }
        : null;
    },
    username_available(_u, a) {
      const name = String(a.p_username ?? '').trim().toLowerCase();
      return USERNAME.test(name) && !byUsername(name);
    },
    register_profile(u, a) {
      // Replaced by register_profile_v2 (no longer callable by signed-in people in production).
      return { status: 403, body: { code: '42501', message: 'permission denied for function register_profile' } };
    },
    register_profile_v2(u, a) {
      const name = String(a.p_username ?? '').trim().toLowerCase();
      const display = String(a.p_display_name ?? '').trim();
      if (profiles.has(u.id)) return { error: 'exists' };
      if (!USERNAME.test(name)) return { error: 'bad_username' };
      if (display.length < 1 || display.length > 60) return { error: 'bad_name' };
      if (!['coach', 'family'].includes(a.p_kind)) return { error: 'bad_kind' };
      const consent = String(a.p_consent ?? '').trim();
      if (consent.length < 1 || consent.length > 40) return { error: 'consent_required' };
      if (a.p_kind === 'family' && a.p_guardian !== true) return { error: 'guardian_required' };
      if (byUsername(name)) return { error: 'username_taken' };
      profiles.set(
        u.id,
        newProfile(u, name, display, a.p_kind, {
          discoverable: a.p_kind === 'coach' ? true : a.p_discoverable === true,
          guardian: a.p_kind === 'family',
          consent_version: consent,
          consent_at: stamp(),
        }),
      );
      if (a.p_kind === 'family' && !docs.has(`academy/data/players/${u.id}`)) familyPlayer(u, name, display, a);
      return { ok: true, username: name };
    },
    give_consent(u, a) {
      const p = profiles.get(u.id);
      if (!p) return { error: 'no_profile' };
      const consent = String(a.p_consent ?? '').trim();
      if (consent.length < 1 || consent.length > 40) return { error: 'consent_required' };
      if (p.kind === 'family' && a.p_guardian !== true) return { error: 'guardian_required' };
      Object.assign(p, { consent_version: consent, consent_at: stamp(), guardian: p.kind === 'family' });
      return { ok: true };
    },
    update_my_profile(u, a) {
      const p = profiles.get(u.id);
      if (!p) return { error: 'no_profile' };
      const name = String(a.p_display_name ?? '').trim();
      if (a.p_display_name != null && (name.length < 1 || name.length > 60)) return { error: 'bad_name' };
      if (a.p_display_name != null) p.display_name = name;
      p.discoverable = p.kind === 'coach' ? true : a.p_discoverable == null ? p.discoverable : !!a.p_discoverable;
      if (a.p_notify_live != null) p.notify_live = !!a.p_notify_live;
      const own = docs.get(`academy/data/players/${u.id}`);
      if (p.kind === 'family' && a.p_display_name != null && own) putDoc(own.path, { ...own.data, name });
      return { ok: true };
    },
    change_username(u, a) {
      const p = profiles.get(u.id);
      if (!p) return { error: 'no_profile' };
      const name = String(a.p_username ?? '').trim().toLowerCase();
      if (!USERNAME.test(name)) return { error: 'bad_username' };
      const other = byUsername(name);
      if (other && other.user_id !== u.id) return { error: 'username_taken' };
      p.username = name;
      const own = docs.get(`academy/data/players/${u.id}`);
      if (p.kind === 'family' && own) putDoc(own.path, { ...own.data, username: name });
      return { ok: true, username: name };
    },
    family_update_player(u, a) {
      if (myKind(u) !== 'family') return { error: 'not_family' };
      const patch = a.p_patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'bad_patch' };
      const year = new Date().getFullYear();
      const clean = {};
      if ('name' in patch) {
        const n = String(patch.name ?? '').trim();
        if (n.length < 1 || n.length > 60) return { error: 'bad_name' };
        clean.name = n;
      }
      if ('birthYear' in patch) {
        if (typeof patch.birthYear !== 'number' || patch.birthYear < year - 90 || patch.birthYear > year - 3) return { error: 'bad_year' };
        clean.birthYear = Math.trunc(patch.birthYear);
      }
      if ('hand' in patch) {
        if (!['right', 'left'].includes(patch.hand)) return { error: 'bad_hand' };
        clean.hand = patch.hand;
      }
      if ('backhand' in patch) {
        if (!['one', 'two'].includes(patch.backhand)) return { error: 'bad_backhand' };
        clean.backhand = patch.backhand;
      }
      if ('aiConsent' in patch) {
        if (typeof patch.aiConsent !== 'boolean') return { error: 'bad_consent' };
        clean.aiConsent = patch.aiConsent;
      }
      const own = docs.get(`academy/data/players/${u.id}`);
      if (own) putDoc(own.path, { ...own.data, ...clean });
      if (clean.name) profiles.get(u.id).display_name = clean.name;
      return { ok: true };
    },
    search_people(u, a) {
      const kind = myKind(u);
      const q = String(a.p_query ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}_. ]/gu, '').trim();
      if (!kind || q.length < 2 || blocked(u)) return [];
      return [...profiles.values()]
        .filter((p) => p.kind !== kind && p.user_id !== u.id && !p.blocked)
        .filter(
          (p) =>
            p.username === q ||
            ((p.kind === 'coach' || p.discoverable) && (p.username.startsWith(q) || p.display_name.toLowerCase().startsWith(q) || p.display_name.toLowerCase().includes(' ' + q))),
        )
        .sort((x, y) => Number(y.username === q) - Number(x.username === q) || Number(y.verified) - Number(x.verified) || x.username.localeCompare(y.username))
        .slice(0, 20)
        .map((p) => {
          const c = connections.get(kind === 'coach' ? `${u.id}|${p.user_id}` : `${p.user_id}|${u.id}`);
          const live = c && ['pending', 'accepted'].includes(c.status);
          return {
            username: p.username,
            display_name: p.display_name,
            kind: p.kind,
            verified: p.verified,
            status: live ? c.status : null,
            direction: live ? (c.requested_by === kind ? 'out' : 'in') : null,
          };
        });
    },
    search_profiles(u, a) {
      return rpc.search_people(u, a).map(({ verified: _v, ...rest }) => rest);
    },
    send_request(u, a) {
      const kind = myKind(u);
      if (!kind) return { error: 'no_profile' };
      if (blocked(u)) return { error: 'blocked' };
      const target = byUsername(a.p_username);
      if (!target || target.user_id === u.id || target.blocked) return { error: 'not_found' };
      if (target.kind === kind) return { error: 'same_kind' };
      const coach = kind === 'coach' ? u.id : target.user_id;
      const family = kind === 'family' ? u.id : target.user_id;
      const key = `${coach}|${family}`;
      const row = connections.get(key);
      if (row?.status === 'accepted') return { status: 'accepted' };
      if (row?.status === 'pending' && row.requested_by !== kind) {
        row.status = 'accepted';
        row.responded_at = stamp();
        row.closed_by = null;
        return { status: 'accepted' };
      }
      if (row?.status === 'pending') return { status: 'pending' };
      if (row && ['declined', 'removed'].includes(row.status) && row.closed_by && row.closed_by !== kind && now() - Date.parse(row.responded_at) < 30 * 86400_000) {
        return { error: 'wait', until: new Date(Date.parse(row.responded_at) + 30 * 86400_000).toISOString() };
      }
      const recent = [...connections.values()].filter(
        (c) => c.requested_by === kind && now() - Date.parse(c.created_at) < 3600_000 && (kind === 'coach' ? c.coach_id === u.id : c.family_id === u.id),
      ).length;
      if (recent >= 30) return { error: 'too_many' };
      connections.set(key, { coach_id: coach, family_id: family, status: 'pending', requested_by: kind, created_at: stamp(), responded_at: null, closed_by: null });
      return { status: 'pending' };
    },
    respond_request(u, a) {
      const kind = myKind(u);
      if (!kind) return { error: 'no_profile' };
      const other = byUsername(a.p_username);
      if (!other || other.kind === kind) return { error: 'not_found' };
      const row = connections.get(kind === 'coach' ? `${u.id}|${other.user_id}` : `${other.user_id}|${u.id}`);
      if (blocked(u)) return { error: 'blocked' };
      if (!row || row.status !== 'pending' || row.requested_by === kind) return { error: 'not_found' };
      row.status = a.p_accept ? 'accepted' : 'declined';
      row.responded_at = stamp();
      row.closed_by = a.p_accept ? null : kind;
      return { status: row.status };
    },
    remove_connection(u, a) {
      const kind = myKind(u);
      if (!kind) return { error: 'no_profile' };
      const other = byUsername(a.p_username);
      if (!other || other.kind === kind) return { error: 'not_found' };
      const row = connections.get(kind === 'coach' ? `${u.id}|${other.user_id}` : `${other.user_id}|${u.id}`);
      if (row && ['pending', 'accepted'].includes(row.status)) {
        row.status = 'removed';
        row.responded_at = stamp();
        row.closed_by = kind;
      }
      return { status: 'removed' };
    },
    my_connections_v2(u) {
      return rpc.my_connections(u).map((c) => ({ ...c, verified: byUsername(c.username)?.verified === true }));
    },
    my_connections(u) {
      const kind = myKind(u);
      if (!kind) return [];
      return [...connections.values()]
        .filter((c) => ['pending', 'accepted'].includes(c.status) && (kind === 'coach' ? c.coach_id === u.id : c.family_id === u.id))
        .map((c) => {
          const p = profiles.get(kind === 'coach' ? c.family_id : c.coach_id);
          return { username: p.username, display_name: p.display_name, kind: p.kind, status: c.status, direction: c.requested_by === kind ? 'out' : 'in', player_id: c.family_id, since: c.responded_at ?? c.created_at };
        })
        .sort((x, y) => y.status.localeCompare(x.status) || x.username.localeCompare(y.username));
    },
    merge_offline_player(u, a) {
      // Coaches ask the family (request_link); the direct move is the admin's.
      if (!isAdmin(u)) return { error: 'not_allowed' };
      const off = String(a.p_offline ?? '');
      if (UUID.test(off)) return { error: 'not_offline' };
      const pdoc = docs.get(`academy/data/players/${off}`);
      if (!pdoc || pdoc.data.archived === true) return { error: 'not_found' };
      const fam = byUsername(a.p_username);
      if (!fam || fam.kind !== 'family') return { error: 'not_found' };
      return { ok: true, moved: moveOffline(off, fam.user_id) };
    },
    request_link(u, a) {
      if (myKind(u) !== 'coach' || blocked(u)) return { error: 'not_allowed' };
      const off = String(a.p_offline ?? '');
      if (UUID.test(off)) return { error: 'not_offline' };
      const pdoc = docs.get(`academy/data/players/${off}`);
      if (!pdoc || pdoc.data.archived === true || pdoc.data.ownerId !== u.id) return { error: 'not_found' };
      const fam = byUsername(a.p_username);
      if (!fam || fam.kind !== 'family') return { error: 'not_found' };
      if (connections.get(`${u.id}|${fam.user_id}`)?.status !== 'accepted') return { error: 'not_connected' };
      const open = [...links.values()].find((l) => l.offline_id === off && l.status === 'pending');
      if (open && open.family_id === fam.user_id) return { ok: true, id: open.id };
      if (open) Object.assign(open, { status: 'cancelled', responded_at: stamp() });
      const id = crypto.randomUUID();
      links.set(id, { id, coach_id: u.id, family_id: fam.user_id, offline_id: off, offline_name: String(pdoc.data.name ?? '').trim() || '—', status: 'pending', created_at: stamp(), responded_at: null });
      return { ok: true, id };
    },
    cancel_link(u, a) {
      const l = links.get(a.p_id);
      if (!l || l.status !== 'pending' || l.coach_id !== u.id) return { error: 'not_found' };
      Object.assign(l, { status: 'cancelled', responded_at: stamp() });
      return { ok: true };
    },
    respond_link(u, a) {
      const l = links.get(a.p_id);
      if (!l || l.status !== 'pending' || l.family_id !== u.id) return { error: 'not_found' };
      if (!a.p_accept) {
        Object.assign(l, { status: 'declined', responded_at: stamp() });
        return { ok: true, status: 'declined' };
      }
      const pdoc = docs.get(`academy/data/players/${l.offline_id}`);
      if (!pdoc || pdoc.data.archived === true || pdoc.data.ownerId !== l.coach_id || connections.get(`${l.coach_id}|${u.id}`)?.status !== 'accepted') {
        Object.assign(l, { status: 'cancelled', responded_at: stamp() });
        return { error: 'not_found' };
      }
      const moved = moveOffline(l.offline_id, u.id);
      Object.assign(l, { status: 'accepted', responded_at: stamp() });
      return { ok: true, status: 'accepted', moved };
    },
    my_link_requests(u) {
      return [...links.values()]
        .filter((l) => l.status === 'pending' && (l.coach_id === u.id || l.family_id === u.id))
        .sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map((l) => {
          const c = profiles.get(l.coach_id);
          const f = profiles.get(l.family_id);
          return {
            id: l.id,
            offline_id: l.offline_id,
            offline_name: l.offline_name,
            coach_username: c?.username,
            coach_name: c?.display_name,
            family_username: f?.username,
            family_name: f?.display_name,
            direction: l.coach_id === u.id ? 'out' : 'in',
            created_at: l.created_at,
          };
        });
    },
    family_save_match(u, a) {
      const m = a.p_match;
      if (myKind(u) !== 'family') return { error: 'not_family' };
      if (blocked(u)) return { error: 'blocked' };
      if (!m || typeof m !== 'object' || Array.isArray(m) || !/^[\w.~:@+-]{1,100}$/.test(String(m.id))) return { error: 'bad_match' };
      if (m.playerId !== u.id) return { error: 'not_linked' };
      const path = `academy/data/matches/${m.id}`;
      const old = docs.get(path);
      if (old && (old.data.playerId !== u.id || (old.data.scorerId ?? '') !== u.id)) return { error: 'not_scorer' };
      putDoc(path, { ...m, scorerId: u.id, scorerRole: 'parent', ai: old?.data.ai ?? null, createdBy: old?.data.createdBy ?? u.id });
      return { ok: true };
    },
    family_delete_match(u, a) {
      if (myKind(u) !== 'family') return { error: 'not_family' };
      const d = docs.get(`academy/data/matches/${a.p_id ?? ''}`);
      if (!d || d.data.playerId !== u.id || (d.data.createdBy !== u.id && d.data.scorerId !== u.id)) return { error: 'not_found' };
      putDoc(d.path, { ...d.data, deletedAt: new Date().toISOString() });
      return { ok: true };
    },
    admin_set_flags(u, a) {
      if (!isAdmin(u)) return { error: 'not_admin' };
      const p = byUsername(a.p_username);
      if (!p) return { error: 'not_found' };
      if (a.p_blocked === true && staff.has(p.user_id)) return { error: 'staff' };
      if (a.p_blocked != null) p.blocked = !!a.p_blocked;
      if (a.p_verified != null) p.verified = !!a.p_verified;
      return { ok: true };
    },
    admin_profiles_v2(u) {
      return rpc.admin_profiles(u).map((p) => ({ ...p, staff: staff.has(p.user_id) }));
    },
    save_push_subscription(u, a) {
      if (!myKind(u)) return { error: 'no_profile' };
      const ep = String(a.p_endpoint ?? '');
      if (!/^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//.test(ep) || ep.length > 2000 || !/^[A-Za-z0-9_-]{80,100}$/.test(a.p_p256dh ?? '') || !/^[A-Za-z0-9_-]{16,30}$/.test(a.p_auth ?? '')) return { error: 'bad_subscription' };
      pushSubs.set(ep, { endpoint: ep, user_id: u.id, p256dh: a.p_p256dh, auth: a.p_auth, lang: a.p_lang === 'fa' ? 'fa' : 'en', user_agent: String(a.p_user_agent ?? '').slice(0, 300), created_at: stamp(), disabled_at: null });
      return { ok: true };
    },
    disable_push_subscription(u, a) {
      const x = pushSubs.get(a.p_endpoint);
      if (x && x.user_id === u.id) x.disabled_at = stamp();
      return { ok: true };
    },
    admin_profiles(u) {
      if (!isAdmin(u)) return [];
      return [...profiles.values()]
        .sort((x, y) => x.kind.localeCompare(y.kind) || x.username.localeCompare(y.username))
        .map((p) => ({
          ...p,
          consent_at: p.consent_at,
          email: [...users.values()].find((x) => x.id === p.user_id)?.email ?? '',
          connections: [...connections.values()].filter((c) => c.status === 'accepted' && (c.coach_id === p.user_id || c.family_id === p.user_id)).length,
        }));
    },
    user_emails(u, a) {
      if (!role(u)) return [];
      return [...users.values()].filter((x) => a.p_ids.includes(x.id)).map((x) => ({ id: x.id, email: x.email }));
    },
    delete_my_account(u) {
      if (isAdmin(u) && [...staff.values()].filter((x) => x.role === 'admin').length <= 1) return { status: 400, body: { message: 'last_admin' } };
      const offline = new Set([...docs.values()].filter((d) => isPlayerPath(d.path) && !UUID.test(seg(d.path)) && d.data.ownerId === u.id).map((d) => seg(d.path)));
      for (const d of [...docs.values()]) {
        const pid = docPlayer(d.path, d.data);
        if (d.path === `academy/data/players/${u.id}` || d.path.startsWith(`family/${u.id}/`)) docs.delete(d.path);
        else if (/^academy\/data\/(plans|logs|tournaments|matches)\//.test(d.path) && (pid === u.id || offline.has(pid))) docs.delete(d.path);
        else if (isPlayerPath(d.path) && offline.has(seg(d.path))) docs.delete(d.path);
      }
      dropUser(u.id);
      return undefined;
    },
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
      const u = { id: crypto.randomUUID(), email, password: json.password, meta: json.data ?? {} };
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
    if (p === '/auth/v1/recover') return send(200, {});
    if (p === '/functions/v1/delete-account') {
      // Like the platform's JWT check: a signed-in user's token is required before the function runs.
      if (!who(req) || who(req).service) return send(401, { msg: 'Invalid JWT' });
      const r = await deleteAccountFunction(
        new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', apikey: req.headers.apikey ?? '' }, body: body || undefined }),
        { url: `http://localhost:${port}`, serviceKey: SERVICE_KEY, anonKey: 'test' },
      );
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    }
    if (p === '/functions/v1/notify') {
      if (!who(req) || who(req).service) return send(401, { msg: 'Invalid JWT' });
      const r = await notifyFunction(
        new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', apikey: req.headers.apikey ?? '' }, body: body || undefined }),
        // No secrets: the function makes its key pair and keeps it in app_keys, like on Supabase.
        { url: `http://localhost:${port}`, serviceKey: SERVICE_KEY, anonKey: 'test', vapid: { publicKey: '', privateKey: '', subject: '' }, appUrl: '' },
        async (sub, message, vapid) => {
          pushes.push({ endpoint: sub.endpoint, message, vapidPublic: vapid.publicKey, subject: vapid.subject });
          return sub.endpoint.includes('gone') ? 410 : 201;
        },
      );
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    }
    const u = who(req);
    if (!u) return send(401, { message: 'JWT required' });
    if (p === '/auth/v1/user' && req.method === 'GET') return u.service ? send(401, {}) : send(200, { id: u.id, email: u.email });
    if (p === '/auth/v1/user' && req.method === 'PUT') {
      u.password = json.password;
      return send(200, { id: u.id, email: u.email });
    }
    if (p.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') {
      if (!u.service) return send(403, { msg: 'User not allowed' });
      const id = p.split('/').pop();
      if (![...users.values()].some((x) => x.id === id)) return send(404, { msg: 'User not found' });
      dropUser(id);
      return send(200, {});
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = rpc[p.split('/').pop()];
      if (!fn) return send(404, { code: 'PGRST202', message: 'Could not find the function' });
      const out = fn(u, json);
      if (out && typeof out === 'object' && 'status' in out && 'body' in out) return send(out.status, out.body);
      return out === undefined ? send(204) : send(200, out);
    }
    if (p === '/rest/v1/docs') {
      const filters = filtersOf(url);
      const visible = [...docs.values()].filter((d) => (u.service || canRead(u, d.path, d.data)) && passes(d, filters)).sort((a, b) => a.path.localeCompare(b.path));
      if (req.method === 'GET') {
        const [from, to] = (req.headers.range ?? '0-9999').split('-').map(Number);
        return send(200, pick(visible.slice(from, to + 1), url));
      }
      if (req.method === 'POST') {
        const old = docs.get(json.path);
        const ok =
          u.service ||
          (old ? canUpdate(u, json.path, old.data, json.data) && canRead(u, json.path, old.data) : canInsert(u, json.path, json.data) && canRead(u, json.path, json.data));
        if (!ok) return send(403, { message: 'new row violates row-level security policy for table "docs"' });
        putDoc(json.path, json.data);
        return send(201);
      }
      if (req.method === 'DELETE') {
        if (!filters.length) return send(400, { message: 'DELETE requires a WHERE clause' });
        // Like PostgREST: rows the rules do not allow are simply not deleted.
        const gone = [];
        for (const d of visible) {
          if (u.service || canDelete(u, d.path, d.data)) {
            docs.delete(d.path);
            gone.push(d);
          }
        }
        if (/return=representation/.test(req.headers.prefer ?? '')) return send(200, url.searchParams.get('select') ? pick(gone, url) : gone);
        return send(204);
      }
      if (req.method === 'PATCH') {
        if (!filters.length) return send(400, { message: 'UPDATE requires a WHERE clause' });
        for (const d of visible) if (u.service || canUpdate(u, d.path, d.data, json.data)) putDoc(d.path, json.data);
        return send(204);
      }
    }
    if (p === '/rest/v1/subscriptions') {
      const eq = (k) => url.searchParams.get(k)?.replace(/^eq\./, '');
      if (req.method === 'GET') {
        let rows = [...subs.values()].filter((r) => r.user_id === u.id || isAdmin(u));
        if (eq('user_id')) rows = rows.filter((r) => r.user_id === eq('user_id'));
        return send(200, rows);
      }
      if (!isAdmin(u)) return send(403, { message: 'row-level security' });
      if (req.method === 'POST') {
        if (json.source !== 'manual') return send(403, { message: 'row-level security' });
        subs.set(json.user_id, { user_id: json.user_id, plan: json.plan, expires_at: json.expires_at ?? null, source: 'manual' });
        return send(201);
      }
      if (req.method === 'DELETE') {
        subs.delete(eq('user_id'));
        return send(204);
      }
    }
    // Tables only the Edge Functions reach (service role); signed-in people use the RPCs.
    const tables = {
      profiles: [profiles, 'user_id'],
      connections: [connections, null],
      push_subscriptions: [pushSubs, 'endpoint'],
      match_notifications: [matchNotes, 'match_id'],
      app_keys: [appKeys, 'name'],
    };
    const tname = p.replace('/rest/v1/', '');
    if (tables[tname]) {
      if (!u.service) return send(req.method === 'GET' ? 200 : 403, req.method === 'GET' ? [] : { message: 'row-level security' });
      const [map, pk] = tables[tname];
      const filters = filtersOf(url);
      const rows = [...map.values()].filter((r) => passes(r, filters));
      if (req.method === 'GET') return send(200, pick(rows, url));
      if (req.method === 'PATCH') {
        for (const r of rows) Object.assign(r, json);
        return send(204);
      }
      if (req.method === 'POST' && pk) {
        const ignore = /ignore-duplicates/.test(req.headers.prefer ?? '');
        const added = [];
        for (const item of Array.isArray(json) ? json : [json]) {
          if (map.has(item[pk]) && ignore) continue;
          const row = tname === 'match_notifications' ? { sent_at: stamp(), ...item } : item;
          map.set(item[pk], { ...(map.get(item[pk]) ?? {}), ...row });
          added.push(row);
        }
        return send(201, /return=representation/.test(req.headers.prefer ?? '') ? added : undefined);
      }
      return send(405, {});
    }
    if (p === '/rest/v1/staff') {
      if (req.method === 'GET') return send(200, u.service || role(u) ? pick([...staff.values()].filter((r) => passes(r, filtersOf(url))), url) : []);
      return send(403, {});
    }
    send(404, { message: 'not found ' + p });
  });
  const linkFor = (email) => issue(users.get(email));
  /** For tests: a direct call as a user, through the same rules. */
  const as = (email) => {
    const user = users.get(email);
    return {
      rpc: (fn, args = {}) => rpc[fn](user, args),
      read: () => [...docs.values()].filter((d) => canRead(user, d.path, d.data)).map((d) => d.path),
      canInsert: (path, data) => canInsert(user, path, data),
      canUpdate: (path, data) => canUpdate(user, path, docs.get(path)?.data, data),
      canDelete: (path) => canDelete(user, path, docs.get(path)?.data),
    };
  };
  return new Promise((r) => server.listen(port, () => r({ server, docs, staff, invites, subs, users, profiles, connections, links, pushSubs, matchNotes, appKeys, pushes, linkFor, as })));
}
