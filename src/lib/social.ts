/**
 * Usernames and connections (Supabase, supabase/social.sql). A coach finds players by username and
 * sends a request; a family finds coaches the same way; once accepted they are connected.
 */
export type Kind = 'coach' | 'family';
export interface Profile {
  username: string;
  displayName: string;
  kind: Kind;
}
export interface SearchHit extends Profile {
  /** Between you and them, if anything. */
  status: 'pending' | 'accepted' | null;
  /** 'out' = you asked, 'in' = they asked. */
  direction: 'in' | 'out' | null;
}
export interface Connection extends Profile {
  status: 'pending' | 'accepted';
  direction: 'in' | 'out';
  /** The player's id (a family account's id). */
  playerId: string;
  since: string;
}
export interface Member extends Profile {
  userId: string;
  email: string;
  createdAt: string;
  connections: number;
}
export type Result = { status?: string; ok?: boolean; moved?: number; error?: string };

export interface Social {
  me: Profile;
  search(q: string): Promise<SearchHit[]>;
  connections(): Promise<Connection[]>;
  send(username: string): Promise<Result>;
  respond(username: string, accept: boolean): Promise<Result>;
  remove(username: string): Promise<Result>;
  /** Coach: move a player added without an account into that player's family account. */
  merge(offlinePlayerId: string, username: string): Promise<Result>;
  /** Admin: everyone. */
  members(): Promise<Member[]>;
  /** Fetch data again now (new access after a request was accepted). */
  refresh(): void;
}

let current: Social | null = null;
export const setSocial = (s: Social) => {
  current = s;
};
export const getSocial = () => current;

/** Usernames: 3–24 of a–z, 0–9, '.', '_', starting with a letter or digit. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,23}$/;
export const cleanUsername = (v: string) => v.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24);

/* ---- Connections, shared by the top bar badge, the dashboard and the people screens ---- */
let conns: Connection[] | null = null;
let connsKey = '';
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let loading: Promise<void> | null = null;

/** Fetch the connection list again; when it changed, documents are fetched again too (access changed). */
export function reloadConnections(): Promise<void> {
  const s = current;
  if (!s) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const list = await s.connections();
      const key = JSON.stringify(list.map((c) => [c.username, c.status, c.direction]));
      if (key !== connsKey) {
        if (conns !== null) s.refresh();
        connsKey = key;
      }
      // Only a real change re-renders what shows connections.
      if (conns !== null && JSON.stringify(list) === JSON.stringify(conns)) return;
      conns = list;
      listeners.forEach((f) => f());
    } catch (e) {
      console.warn('connections', e);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** For useSyncExternalStore: polls every 20 s while anything is watching and the page is visible. */
export function subscribeConnections(f: () => void): () => void {
  listeners.add(f);
  if (!timer && current) {
    void reloadConnections();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadConnections();
    }, 20000);
  }
  return () => {
    listeners.delete(f);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
export const connectionsSnapshot = () => conns;

/** Requests waiting for this person's answer. */
export const incoming = (list: Connection[] | null) => (list ?? []).filter((c) => c.status === 'pending' && c.direction === 'in');
