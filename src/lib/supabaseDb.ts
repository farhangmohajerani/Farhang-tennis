/**
 * Supabase back end for the shared academy, speaking the same document API as the
 * claude.ai `db` capability so ArtifactDbAdapter (sync, merge, family copies) is reused as is.
 *
 * Table `docs(path, parent, data, updated_at)` with row-level security (supabase/academy.sql):
 * staff read everything, admins write everything, coaches everything except the drill library
 * and thresholds, and each parent reads only family/{their user id}/…
 * Changes from other people arrive by polling (every few seconds while the page is visible).
 */
import type { DbLike, UserLike } from './artifactDb';
import type { SupabaseAuth, SupabaseConfig } from './storage';

interface Row { path: string; data: Record<string, unknown>; updated_at: string }
interface Snap { id: string; exists: boolean; data(): Record<string, unknown> | undefined; metadata: { fromCache: boolean; hasPendingWrites: boolean } }

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');
const POLL_MS = 5000;

class DbError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class SupabaseDocDb implements DbLike {
  private cache = new Map<string, { data: Record<string, unknown>; v: string }>();
  private coll = new Map<string, Set<() => void>>();
  private docs = new Map<string, Set<() => void>>();
  private loaded: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private cfg: SupabaseConfig, private auth: SupabaseAuth) {}

  private async headers(): Promise<Record<string, string>> {
    const s = await this.auth.refresh();
    if (!s) throw new DbError('revoked', 'Signed out');
    return { apikey: this.cfg.anonKey, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url}/rest/v1/${path}`, { ...init, headers: { ...(await this.headers()), ...(init.headers as Record<string, string>) } });
    } catch (e) {
      throw new DbError('unavailable', e instanceof Error ? e.message : String(e));
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /row-level security/i.test(body)) throw new DbError('invalid_argument', body || 'Not allowed');
    if (res.status === 429 || res.status >= 500) throw new DbError('unavailable', body || `HTTP ${res.status}`);
    throw new DbError('invalid_argument', body || `HTTP ${res.status}`);
  }

  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.req(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    return (await res.json()) as T;
  }

  /** Read every visible row (RLS decides which), page by page. */
  private async fetchAll(cols: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const res = await this.req(`docs?select=${cols}&order=path`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      const rows = (await res.json()) as Row[];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  private start() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const rows = await this.fetchAll('path,data,updated_at');
        for (const r of rows) this.cache.set(r.path, { data: r.data, v: r.updated_at });
      })().catch((e) => {
        console.warn('initial load failed', e);
      });
      this.timer = setInterval(() => {
        if (document.visibilityState === 'visible') void this.poll();
      }, POLL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.poll();
      });
    }
    return this.loaded;
  }

  /** Cheap check: paths + versions; then fetch only what changed. */
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const heads = await this.fetchAll('path,updated_at');
      const seen = new Set<string>();
      const changed: string[] = [];
      for (const h of heads) {
        seen.add(h.path);
        if (this.cache.get(h.path)?.v !== h.updated_at) changed.push(h.path);
      }
      const removed = [...this.cache.keys()].filter((p) => !seen.has(p));
      for (let i = 0; i < changed.length; i += 40) {
        const chunk = changed.slice(i, i + 40);
        const res = await this.req(`docs?select=path,data,updated_at&path=in.(${encodeURIComponent(chunk.map((p) => `"${p}"`).join(','))})`);
        for (const r of (await res.json()) as Row[]) this.cache.set(r.path, { data: r.data, v: r.updated_at });
      }
      for (const p of removed) this.cache.delete(p);
      for (const p of new Set([...changed, ...removed])) this.notify(p);
    } catch (e) {
      console.warn('poll failed', e);
    } finally {
      this.polling = false;
    }
  }

  private notify(path: string) {
    this.coll.get(parentOf(path))?.forEach((f) => f());
    this.docs.get(path)?.forEach((f) => f());
  }

  private snap(path: string): Snap {
    const c = this.cache.get(path);
    return { id: path.split('/').pop()!, exists: !!c, data: () => c?.data, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  doc(path: string) {
    return {
      set: async (data: Record<string, unknown>) => {
        await this.req('docs?on_conflict=path', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ path, data }) });
        this.cache.set(path, { data, v: 'local:' + Date.now() });
        this.notify(path);
      },
      delete: async () => {
        await this.req(`docs?path=eq.${encodeURIComponent(path)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        this.cache.delete(path);
        this.notify(path);
      },
      onSnapshot: (next: (s: Snap) => void) => {
        const f = () => next(this.snap(path));
        if (!this.docs.has(path)) this.docs.set(path, new Set());
        this.docs.get(path)!.add(f);
        void this.start().then(f);
        return () => this.docs.get(path)?.delete(f);
      },
    };
  }

  collection(path: string) {
    return {
      onSnapshot: (next: (s: { docs: Snap[] }) => void) => {
        const f = () => next({ docs: [...this.cache.keys()].filter((k) => parentOf(k) === path).sort().map((k) => this.snap(k)) });
        if (!this.coll.has(path)) this.coll.set(path, new Set());
        this.coll.get(path)!.add(f);
        void this.start().then(f);
        return () => this.coll.get(path)?.delete(f);
      },
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Role comes from the staff table: admin = owner, coach = editor, anyone else = parent. */
export async function supabaseUser(db: SupabaseDocDb, auth: SupabaseAuth): Promise<UserLike & { role: string | null; email: string }> {
  const s = await auth.refresh();
  let role: string | null = null;
  try {
    role = await db.rpc<string | null>('claim_staff');
  } catch (e) {
    console.warn('claim_staff failed', e);
  }
  return {
    role,
    email: s?.user.email ?? '',
    isOwner: async () => role === 'admin',
    canEdit: async () => role === 'admin' || role === 'coach',
    id: async () => s?.user.id ?? null,
  };
}
