import { AppStateSchema, type AppState } from '../types';
import { formatZod } from './drillIO';

/**
 * Persistence abstraction. The app ships with LocalStorageAdapter (demo, this browser only)
 * and SupabaseAdapter (production: auth + per-user workspace row, see supabase/schema.sql).
 */
export interface StorageAdapter {
  readonly kind: 'local' | 'supabase' | 'memory' | 'artifact';
  /** Delay before a change is written (default 250 ms). */
  readonly debounceMs?: number;
  /** Highest role this viewer may switch to (shared mode); undefined = any. */
  maxRole?: 'parent' | 'coach' | 'admin';
  /** False when this viewer can only read. */
  canWrite?: boolean;
  /** Live updates from other people (shared mode). */
  subscribe?(apply: (fn: (s: AppState) => AppState) => void): void;
  /** Human-readable description shown in the UI so demo storage is never mistaken for production. */
  readonly label: string;
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

export const LOCAL_KEY = 'tennis-progress:v1';

export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly label = 'In-memory only — changes are lost on reload (browser storage unavailable)';
  private data: string | null = null;
  async load() {
    return this.data ? parseState(this.data) : null;
  }
  async save(state: AppState) {
    this.data = JSON.stringify(state);
  }
  async clear() {
    this.data = null;
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  readonly label = 'Demo storage — saved in this browser only (localStorage), not synced or backed up';
  constructor(private key = LOCAL_KEY) {}
  static available(): boolean {
    try {
      const k = '__tp_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }
  async load() {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return null;
    }
    return raw ? parseState(raw) : null;
  }
  async save(state: AppState) {
    window.localStorage.setItem(this.key, JSON.stringify(state));
  }
  async clear() {
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

export function parseState(raw: string): AppState | null {
  try {
    const parsed = AppStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn('Stored state failed validation — falling back to seed data.', formatZod(parsed.error));
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Supabase (REST, no SDK dependency).                                 */
/* ------------------------------------------------------------------ */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: { id: string; email?: string };
}

const SESSION_KEY = 'tennis-progress:supabase-session';

/** Build-time config injected by scripts/build.mjs from SUPABASE_URL / SUPABASE_ANON_KEY env vars. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = (typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '') || '';
  const anonKey = (typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '') || '';
  return url && anonKey ? { url: url.replace(/\/$/, ''), anonKey } : null;
}

export class SupabaseAuth {
  constructor(private cfg: SupabaseConfig) {}

  current(): SupabaseSession | null {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as SupabaseSession) : null;
    } catch {
      return null;
    }
  }

  private store(s: SupabaseSession | null) {
    try {
      if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  private async call(path: string, body: unknown): Promise<SupabaseSession> {
    const res = await fetch(`${this.cfg.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description || json.msg || json.message || `Auth failed (${res.status})`);
    if (!json.access_token) throw new Error('Check your email to confirm the account, then sign in.');
    const session: SupabaseSession = { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at, user: json.user };
    this.store(session);
    return session;
  }

  signIn(email: string, password: string) {
    return this.call('token?grant_type=password', { email, password });
  }

  signUp(email: string, password: string) {
    return this.call('signup', { email, password });
  }

  async refresh(): Promise<SupabaseSession | null> {
    const s = this.current();
    if (!s) return null;
    if (s.expires_at && s.expires_at * 1000 > Date.now() + 60_000) return s;
    try {
      return await this.call('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    } catch {
      this.store(null);
      return null;
    }
  }

  signOut() {
    this.store(null);
  }
}

/**
 * Stores the whole workspace as one JSONB row per user in `workspace_state`
 * (row-level security restricts each row to its owner). See supabase/schema.sql.
 */
export class SupabaseAdapter implements StorageAdapter {
  readonly kind = 'supabase' as const;
  readonly label: string;
  constructor(private cfg: SupabaseConfig, private auth: SupabaseAuth) {
    this.label = `Supabase — ${new URL(cfg.url).host}`;
  }

  private async headers() {
    const s = await this.auth.refresh();
    if (!s) throw new Error('Not signed in');
    return { apikey: this.cfg.anonKey, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
  }

  async load() {
    const res = await fetch(`${this.cfg.url}/rest/v1/workspace_state?select=data&limit=1`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    const rows = (await res.json()) as { data: unknown }[];
    if (!rows.length) return null;
    return parseState(JSON.stringify(rows[0].data));
  }

  async save(state: AppState) {
    const s = this.auth.current();
    const res = await fetch(`${this.cfg.url}/rest/v1/workspace_state?on_conflict=owner`, {
      method: 'POST',
      headers: { ...(await this.headers()), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ owner: s?.user.id, data: state, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
  }

  async clear() {
    const res = await fetch(`${this.cfg.url}/rest/v1/workspace_state?owner=eq.${this.auth.current()?.user.id}`, { method: 'DELETE', headers: await this.headers() });
    if (!res.ok) throw new Error(`Clear failed (${res.status})`);
  }
}
