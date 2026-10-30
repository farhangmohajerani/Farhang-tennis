/**
 * Connecting a parent to a child. Two implementations:
 *  - claude.ai: the parent's open page shows a code in `room` presence; the platform vouches for the sender id.
 *  - Supabase: the database issues the parent a 6-digit code (my_pair_code) and resolves it for staff only.
 */
export interface Pairing {
  /** The current viewer's code (parents). null = unavailable here. */
  myCode(): Promise<string | null>;
  /** Staff: the user id behind a code, or null. */
  resolve(code: string): Promise<string | null>;
  /** Staff: display labels for user ids. */
  names(ids: string[]): Promise<Record<string, string>>;
  /** True when the code only works while the parent's page is open. */
  needsOpenPage: boolean;
}

let current: Pairing | null = null;
export const setPairing = (p: Pairing) => {
  current = p;
};
export const getPairing = () => current;

type Use = (n: string) => Promise<unknown>;
interface Peer { by: string | null; isMe: boolean; kind: string; presence: Record<string, unknown> }
interface Room { presence(p: Record<string, unknown>): Promise<void>; peers(): readonly Peer[] }
interface UserNs { profiles(ids: string[]): Promise<Record<string, { name: string }>> }

function sessionCode(): string {
  const KEY = 'tennis-progress:pair-code';
  try {
    const old = window.sessionStorage.getItem(KEY);
    if (old) return old;
  } catch {
    /* ignore */
  }
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  const code = String(100000 + (a[0] % 900000));
  try {
    window.sessionStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
  return code;
}

export function roomPairing(): Pairing | null {
  const c = (window as unknown as { claude?: { use?: Use } }).claude;
  if (!c || typeof c.use !== 'function') return null;
  const use = c.use.bind(c);
  return {
    needsOpenPage: true,
    async myCode() {
      const room = (await use('room').catch(() => null)) as Room | null;
      if (!room) return null;
      const code = sessionCode();
      await room.presence({ pair: code }).catch(() => undefined);
      return code;
    },
    async resolve(code) {
      const room = (await use('room').catch(() => null)) as Room | null;
      const peer = room?.peers().find((p) => p.kind === 'viewer' && !p.isMe && p.by && p.presence?.pair === code);
      return peer?.by ?? null;
    },
    async names(ids) {
      const u = (await use('user').catch(() => null)) as UserNs | null;
      if (!u) return {};
      const ps = await u.profiles(ids);
      return Object.fromEntries(ids.map((id) => [id, ps[id]?.name || '']));
    },
  };
}

export function rpcPairing(rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>): Pairing {
  return {
    needsOpenPage: false,
    myCode: () => rpc<string | null>('my_pair_code'),
    resolve: (code) => rpc<string | null>('resolve_pair_code', { p_code: code }),
    async names(ids) {
      const rows = await rpc<{ id: string; email: string }[]>('user_emails', { p_ids: ids });
      return Object.fromEntries(rows.map((r) => [r.id, r.email]));
    },
  };
}
