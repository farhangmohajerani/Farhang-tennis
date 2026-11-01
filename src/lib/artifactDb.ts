/**
 * Shared academy storage on the claude.ai artifact `db` capability.
 *
 * Every record is its own document, so several coaches can work at once without
 * overwriting each other's work:
 *   academy/data/players/{id}      academy/data/plans/{id}
 *   academy/data/logs/{id}         academy/data/tournaments/{id}
 *   academy/data/matches/{id}      one match: details, format and its points (6-character codes)
 *   academy/library/drills/{id}    only drills that differ from the 200-drill seed (edits, archives, custom)
 *   academy/config                 level-default star thresholds
 * Per-viewer conveniences (language, role preview, selected player) stay in browser storage.
 *
 *   family/{parentUserId}/players/{playerId}   read-only copy of one child's plan and results
 *
 * Access (declared at publish): owner = admin; people invited as Editor = coaches;
 * Viewers are parents and read only their own family/{their id} documents, which coaches
 * keep up to date whenever a linked child's data changes. Only the owner writes the
 * library and thresholds.
 */
import { DrillSchema, LogSchema, MatchSchema, PlanSchema, PlayerSchema, ThresholdsSchema, TournamentSchema, type AppState, type Level, type Role, type Thresholds } from '../types';
import { SEED_DRILLS } from '../data/drills';
import { LEVEL_THRESHOLDS } from '../data/drills/factory';
import type { StorageAdapter } from './storage';
import type { z } from 'zod';

/* Minimal structural types for the parts of the db/user capabilities we use. */
interface Snap { id: string; exists: boolean; data(): Record<string, unknown> | undefined; metadata: { fromCache: boolean; hasPendingWrites: boolean } }
interface QSnap { docs: Snap[] }
interface DocRef { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; onSnapshot(n: (s: Snap) => void, e?: (err: DbErr) => void): () => void }
interface CollRef { onSnapshot(n: (s: QSnap) => void, e?: (err: DbErr) => void): () => void }
export interface DbLike { doc(path: string): DocRef; collection(path: string): CollRef }
export interface UserLike { isOwner(): Promise<boolean>; canEdit(): Promise<boolean>; id(): Promise<string | null> }
interface DbErr { code: string; message: string }

export const DB_RULES = [
  { path: '', read: 'admin', write: 'admin' },
  { path: 'academy/library', read: 'admin', write: 'owner' },
  { path: 'academy/config', read: 'admin', write: 'owner' },
  { path: 'family', read: 'admin', write: 'admin' },
  { path: 'family/{self}', read: 'view', write: 'admin' },
];

const FAMILY = 'family';
const familyPath = (parentId: string, playerId: string) => `${FAMILY}/${parentId}/players/${playerId}`;
const MAX_FAMILY_LOGS = 400;
const MAX_FAMILY_MATCHES = 80;
const FAMILY_BUDGET = 240_000;

/** The read-only copy of one child's data that a linked parent can read. */
export function familyDoc(s: AppState, playerId: string): Record<string, unknown> | null {
  const player = s.players.find((p) => p.id === playerId);
  if (!player) return null;
  const plans = s.plans.filter((p) => p.playerId === playerId && (p.owner === 'coach' || p.sharedWithCoachId));
  let logs = s.logs.filter((l) => l.playerId === playerId).slice(-MAX_FAMILY_LOGS);
  let matches = s.matches
    .filter((m) => m.playerId === playerId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_FAMILY_MATCHES);
  const tournaments = s.tournaments.filter((t) => t.playerId === playerId);
  const goalDrills = tournaments.flatMap((t) => t.goals.flatMap((g) => (g.kind === 'drill' ? [g.drillId] : [])));
  const used = new Set([...plans.flatMap((p) => p.sessions.flatMap((x) => x.items.map((i) => i.drillId))), ...logs.map((l) => l.drillId), ...goalDrills]);
  const drills = s.drills.filter((d) => used.has(d.id) && SEED_JSON.get(d.id) !== JSON.stringify(d));
  const body = () => ({ player: { ...player, parentIds: [] }, plans, logs, tournaments, matches, drills });
  // Stay under the 256 KiB document limit by keeping the newest results and matches.
  while (JSON.stringify(body()).length > FAMILY_BUDGET && (logs.length > 20 || matches.length > 5)) {
    if (logs.length > 20) logs = logs.slice(Math.floor(logs.length / 4));
    if (JSON.stringify(body()).length > FAMILY_BUDGET && matches.length > 5) matches = matches.slice(Math.max(1, Math.floor(matches.length / 4)));
  }
  return body();
}

const COLLS = {
  players: { path: 'academy/data/players', schema: PlayerSchema },
  plans: { path: 'academy/data/plans', schema: PlanSchema },
  logs: { path: 'academy/data/logs', schema: LogSchema },
  tournaments: { path: 'academy/data/tournaments', schema: TournamentSchema },
  matches: { path: 'academy/data/matches', schema: MatchSchema },
} as const;
type CollKey = keyof typeof COLLS;
const DRILLS_PATH = 'academy/library/drills';
const CONFIG_PATH = 'academy/config';
const PREFS_KEY = 'tennis-progress:prefs';
const SEED_JSON = new Map(SEED_DRILLS.map((d) => [d.id, JSON.stringify(d)]));

const ROLE_RANK: Record<Role, number> = { parent: 0, coach: 1, admin: 2 };

type Op = { kind: 'set'; body: Record<string, unknown> } | { kind: 'delete' };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readPrefs(): Partial<AppState['settings']> {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function writePrefs(s: AppState['settings']) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: s.lang, role: s.role, activePlayerId: s.activePlayerId }));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Documents (path → body) that represent this state. */
export function docsOf(s: AppState): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const k of Object.keys(COLLS) as CollKey[]) for (const item of s[k]) m.set(`${COLLS[k].path}/${item.id}`, item as unknown as Record<string, unknown>);
  for (const d of s.drills) if (SEED_JSON.get(d.id) !== JSON.stringify(d)) m.set(`${DRILLS_PATH}/${d.id}`, d as unknown as Record<string, unknown>);
  m.set(CONFIG_PATH, { levelDefaults: s.settings.levelDefaults });
  for (const p of s.players) {
    if (!p.parentIds?.length) continue;
    const doc = familyDoc(s, p.id);
    if (doc) for (const parent of p.parentIds) m.set(familyPath(parent, p.id), doc);
  }
  return m;
}

/** Placeholder meaning "exists remotely, contents unknown": forces one rewrite and lets unlinks delete it. */
const UNKNOWN = '\u0000unknown';

export class ArtifactDbAdapter implements StorageAdapter {
  readonly kind = 'artifact' as const;
  label = 'Shared academy database on claude.ai — saved for everyone this page is shared with';
  readonly debounceMs = 0;
  /** Highest role this viewer may use (from their sharing level). */
  maxRole: Role = 'parent';
  canWrite = false;
  readOnlyReason: string | null = null;

  private synced = new Map<string, string>();
  private pending = new Map<string, number>();
  private queue = new Map<string, { op: Op; v: number }>();
  private version = 0;
  private running = false;
  private drained: (() => void)[] = [];
  private fatal: string | null = null;
  private apply: ((fn: (s: AppState) => AppState) => void) | null = null;
  private remote: { coll: Partial<Record<CollKey, Snap[]>>; drills: Snap[] | null; config: Snap | null } = { coll: {}, drills: null, config: null };
  private unsubs: (() => void)[] = [];

  constructor(private db: DbLike, private user: UserLike | null, label?: string) {
    if (label) this.label = label;
  }

  /** This viewer's claude.ai user id (parents need it for their family path). */
  myId: string | null = null;

  async load(): Promise<AppState> {
    const [owner, editor, myId] = await Promise.all([this.user?.isOwner() ?? false, this.user?.canEdit() ?? false, this.user?.id() ?? null]);
    this.maxRole = owner ? 'admin' : editor ? 'coach' : 'parent';
    this.canWrite = owner || editor;
    this.myId = myId;
    if (this.maxRole === 'parent') return this.loadParent();

    let resolveInit!: () => void;
    const init = new Promise<void>((r) => (resolveInit = r));
    const expected = Object.keys(COLLS).length + 2;
    const seen = new Set<string>();
    const mark = (key: string) => {
      if (!seen.has(key)) {
        seen.add(key);
        if (seen.size === expected) resolveInit();
      }
    };
    const onErr = (e: DbErr) => {
      if (e.code === 'revoked' || e.code === 'not_granted') this.readOnlyReason = 'access';
      console.warn('db listener', e.code, e.message);
    };

    for (const k of Object.keys(COLLS) as CollKey[]) {
      this.unsubs.push(
        this.db.collection(COLLS[k].path).onSnapshot((snap) => {
          this.remote.coll[k] = snap.docs;
          if (seen.size === expected) this.applyColl(k);
          mark(k);
        }, onErr),
      );
    }
    this.unsubs.push(
      this.db.collection(DRILLS_PATH).onSnapshot((snap) => {
        this.remote.drills = snap.docs;
        if (seen.size === expected) this.applyDrills();
        mark('drills');
      }, onErr),
    );
    this.unsubs.push(
      this.db.doc(CONFIG_PATH).onSnapshot((snap) => {
        this.remote.config = snap;
        if (seen.size === expected) this.applyConfig();
        mark('config');
      }, onErr),
    );
    await Promise.race([init, sleep(12000)]);

    let state: AppState = this.baseState('coach');
    state.settings.role = (() => {
      const r = readPrefs().role;
      return r && ROLE_RANK[r] <= ROLE_RANK[this.maxRole] ? r : this.maxRole;
    })();
    for (const k of Object.keys(COLLS) as CollKey[]) state = this.mergeColl(state, k);
    state = this.mergeDrills(state);
    state = this.mergeConfig(state);
    if (!state.players.some((p) => p.id === state.settings.activePlayerId)) state.settings.activePlayerId = state.players[0]?.id ?? '';
    return state;
  }

  private baseState(role: Role): AppState {
    const prefs = readPrefs();
    return {
      version: 1,
      drills: SEED_DRILLS.map((d) => ({ ...d })),
      people: [],
      players: [],
      plans: [],
      tournaments: [],
      logs: [],
      matches: [],
      settings: {
        lang: prefs.lang === 'fa' ? 'fa' : prefs.lang === 'en' ? 'en' : navigator.language?.toLowerCase().startsWith('fa') ? 'fa' : 'en',
        role,
        activePlayerId: prefs.activePlayerId ?? '',
        levelDefaults: JSON.parse(JSON.stringify(LEVEL_THRESHOLDS)),
      },
    };
  }

  /** Parents read only family/{their id}/players/*, written by the coaches. */
  private async loadParent(): Promise<AppState> {
    let state = this.baseState('parent');
    if (!this.myId) return state;
    let first!: () => void;
    const ready = new Promise<void>((r) => (first = r));
    let docs: Snap[] = [];
    let initialised = false;
    const build = (s: AppState): AppState => {
      const out = { ...s, players: [] as AppState['players'], plans: [] as AppState['plans'], logs: [] as AppState['logs'], tournaments: [] as AppState['tournaments'], matches: [] as AppState['matches'] };
      const overrides = new Map<string, z.infer<typeof DrillSchema>>();
      for (const d of docs) {
        const raw = d.data() ?? {};
        const pl = PlayerSchema.safeParse(raw.player);
        if (!pl.success) continue;
        out.players.push(pl.data);
        for (const x of (raw.plans as unknown[]) ?? []) { const r = PlanSchema.safeParse(x); if (r.success) out.plans.push(r.data); }
        for (const x of (raw.logs as unknown[]) ?? []) { const r = LogSchema.safeParse(x); if (r.success) out.logs.push(r.data); }
        for (const x of (raw.tournaments as unknown[]) ?? []) { const r = TournamentSchema.safeParse(x); if (r.success) out.tournaments.push(r.data); }
        for (const x of (raw.matches as unknown[]) ?? []) { const r = MatchSchema.safeParse(x); if (r.success) out.matches.push(r.data); }
        for (const x of (raw.drills as unknown[]) ?? []) { const r = DrillSchema.safeParse(x); if (r.success) overrides.set(r.data.id, r.data); }
      }
      out.players.sort((a, b) => a.name.localeCompare(b.name));
      out.drills = SEED_DRILLS.map((d) => overrides.get(d.id) ?? d);
      const active = out.players.some((p) => p.id === s.settings.activePlayerId) ? s.settings.activePlayerId : out.players[0]?.id ?? '';
      return { ...out, settings: { ...out.settings, role: 'parent', activePlayerId: active } };
    };
    this.unsubs.push(
      this.db.collection(`${FAMILY}/${this.myId}/players`).onSnapshot(
        (snap) => {
          docs = snap.docs;
          if (initialised) this.apply?.(build);
          first();
        },
        () => first(),
      ),
    );
    await Promise.race([ready, sleep(12000)]);
    initialised = true;
    state = build(state);
    return state;
  }

  /** Called once by the store; later remote changes arrive through it. */
  subscribe(apply: (fn: (s: AppState) => AppState) => void) {
    this.apply = apply;
  }

  private applyColl(k: CollKey) {
    this.apply?.((s) => this.mergeColl(s, k));
  }
  private applyDrills() {
    this.apply?.((s) => this.mergeDrills(s));
  }
  private applyConfig() {
    this.apply?.((s) => this.mergeConfig(s));
  }

  /** Remote wins, except for documents this view is still writing. */
  private mergeColl(s: AppState, k: CollKey): AppState {
    const docs = this.remote.coll[k] ?? [];
    const base = COLLS[k].path;
    const schema = COLLS[k].schema as unknown as z.ZodTypeAny;
    const local = new Map((s[k] as { id: string }[]).map((x) => [x.id, x]));
    const out: unknown[] = [];
    const seenIds = new Set<string>();
    for (const d of docs) {
      const path = `${base}/${d.id}`;
      seenIds.add(d.id);
      if (this.pending.has(path)) {
        const l = local.get(d.id);
        if (l) out.push(l);
        continue;
      }
      const parsed = schema.safeParse(d.data());
      if (!parsed.success) continue;
      this.synced.set(path, JSON.stringify(parsed.data));
      out.push(parsed.data);
    }
    for (const [id, l] of local) if (!seenIds.has(id) && this.pending.has(`${base}/${id}`)) out.push(l);
    for (const path of [...this.synced.keys()]) {
      if (path.startsWith(base + '/') && !seenIds.has(path.slice(base.length + 1)) && !this.pending.has(path)) this.synced.delete(path);
    }
    if (k === 'plans') (out as { createdAt: string }[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (k === 'logs') (out as { date: string; createdAt: string }[]).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    if (k === 'players') (out as { name: string }[]).sort((a, b) => a.name.localeCompare(b.name));
    if (k === 'tournaments') (out as { start: string }[]).sort((a, b) => a.start.localeCompare(b.start));
    if (k === 'matches') (out as { date: string; createdAt: string }[]).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const next = { ...s, [k]: out } as AppState;
    if (k === 'players') {
      for (const p of next.players) for (const parent of p.parentIds ?? []) {
        const fp = familyPath(parent, p.id);
        if (!this.synced.has(fp) && !this.pending.has(fp)) this.synced.set(fp, UNKNOWN);
      }
    }
    if (k === 'players' && !next.players.some((p) => p.id === next.settings.activePlayerId)) {
      next.settings = { ...next.settings, activePlayerId: next.players[0]?.id ?? '' };
    }
    return next;
  }

  private mergeDrills(s: AppState): AppState {
    const docs = this.remote.drills ?? [];
    const overrides = new Map<string, z.infer<typeof DrillSchema>>();
    const seenIds = new Set<string>();
    for (const d of docs) {
      const path = `${DRILLS_PATH}/${d.id}`;
      seenIds.add(d.id);
      if (this.pending.has(path)) continue;
      const parsed = DrillSchema.safeParse(d.data());
      if (!parsed.success) continue;
      this.synced.set(path, JSON.stringify(parsed.data));
      overrides.set(d.id, parsed.data);
    }
    for (const path of [...this.synced.keys()]) {
      if (path.startsWith(DRILLS_PATH + '/') && !seenIds.has(path.slice(DRILLS_PATH.length + 1)) && !this.pending.has(path)) this.synced.delete(path);
    }
    const localById = new Map(s.drills.map((d) => [d.id, d]));
    const pendingLocal = (id: string) => this.pending.has(`${DRILLS_PATH}/${id}`);
    const drills = SEED_DRILLS.map((seed) => (pendingLocal(seed.id) ? localById.get(seed.id) ?? seed : overrides.get(seed.id) ?? seed));
    const seedIds = new Set(SEED_DRILLS.map((d) => d.id));
    for (const [id, d] of overrides) if (!seedIds.has(id)) drills.push(d);
    for (const d of s.drills) if (!seedIds.has(d.id) && !overrides.has(d.id) && pendingLocal(d.id)) drills.push(d);
    return { ...s, drills: drills.filter(Boolean) };
  }

  private mergeConfig(s: AppState): AppState {
    const snap = this.remote.config;
    const defaults = JSON.parse(JSON.stringify(LEVEL_THRESHOLDS)) as Record<Level, Thresholds>;
    let levelDefaults = defaults;
    if (snap?.exists && !this.pending.has(CONFIG_PATH)) {
      const raw = (snap.data()?.levelDefaults ?? {}) as Record<string, unknown>;
      for (const l of Object.keys(defaults) as Level[]) {
        const p = ThresholdsSchema.safeParse(raw[l]);
        if (p.success) levelDefaults[l] = p.data;
      }
    } else if (this.pending.has(CONFIG_PATH)) {
      return s;
    }
    // An absent config document means "defaults": record that so nothing is written on load.
    this.synced.set(CONFIG_PATH, JSON.stringify({ levelDefaults }));
    return { ...s, settings: { ...s.settings, levelDefaults } };
  }

  /** Diff the state against what the database holds and write only what changed. */
  save(state: AppState): Promise<void> {
    writePrefs(state.settings);
    if (!this.canWrite) return Promise.resolve();
    const next = docsOf(state);
    for (const [path, body] of next) {
      const json = JSON.stringify(body);
      if (this.synced.get(path) !== json) this.enqueue(path, { kind: 'set', body: JSON.parse(json) }, json);
    }
    for (const path of [...this.synced.keys()]) if (!next.has(path)) this.enqueue(path, { kind: 'delete' }, null);
    if (this.fatal) return Promise.reject(new Error(this.fatal));
    if (!this.queue.size && !this.running) return Promise.resolve();
    void this.run();
    return new Promise((resolve, reject) => this.drained.push(() => (this.fatal ? reject(new Error(this.fatal)) : resolve())));
  }

  private enqueue(path: string, op: Op, json: string | null) {
    // Owner-only paths: skip silently for coaches (their UI does not offer these edits).
    if (this.maxRole !== 'admin' && (path.startsWith(DRILLS_PATH) || path === CONFIG_PATH)) return;
    const v = ++this.version;
    this.queue.set(path, { op, v });
    this.pending.set(path, v);
    if (json === null) this.synced.delete(path);
    else this.synced.set(path, json);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.size) {
        const batch = [...this.queue.entries()].slice(0, 4);
        for (const [p] of batch) this.queue.delete(p);
        await Promise.all(batch.map(([path, item]) => this.write(path, item)));
      }
    } finally {
      this.running = false;
      const waiters = this.drained.splice(0);
      waiters.forEach((w) => w());
    }
  }

  private async write(path: string, item: { op: Op; v: number }) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const ref = this.db.doc(path);
        if (item.op.kind === 'set') await ref.set(item.op.body);
        else await ref.delete();
        if (this.pending.get(path) === item.v) this.pending.delete(path);
        return;
      } catch (e) {
        const code = (e as DbErr)?.code ?? 'unavailable';
        if (code === 'resource_exhausted' || code === 'unavailable') {
          await sleep(600 * 2 ** attempt + Math.random() * 300);
          if (this.pending.get(path) !== item.v) return; // superseded by a newer write
          continue;
        }
        if (this.pending.get(path) === item.v) this.pending.delete(path);
        this.fatal =
          code === 'quota_exceeded'
            ? 'The shared database is full. Delete old results or contact the academy owner.'
            : code === 'invalid_argument'
              ? 'You do not have permission to change this. Ask the academy owner for Editor access.'
              : `Could not save (${code}).`;
        if (code === 'invalid_argument') this.canWrite = false;
        return;
      }
    }
    this.fatal = 'The database is busy. Your last change may not be saved — try again in a minute.';
  }

  async clear() {
    /* Not offered for the shared academy: deleting is done record by record. */
  }
}

/** Resolve the shared adapter when this page runs inside a claude.ai viewer with `db`. */
export async function artifactAdapter(): Promise<ArtifactDbAdapter | null> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c || typeof c.use !== 'function') return null;
  const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
  if (!db) return null;
  return new ArtifactDbAdapter(db as DbLike, (user as UserLike | null) ?? null);
}
