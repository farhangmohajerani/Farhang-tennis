import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactDbAdapter, type DbLike } from '../src/lib/artifactDb';
import { reducer } from '../src/lib/reducer';
import type { AppState, Player } from '../src/types';

/** In-memory stand-in for the claude.ai db capability (same call shapes, live listeners). */
function mockDb() {
  const store = new Map<string, Record<string, unknown>>();
  const collListeners = new Map<string, Set<() => void>>();
  const docListeners = new Map<string, Set<() => void>>();
  let writes = 0;
  const parent = (p: string) => p.split('/').slice(0, -1).join('/');
  const snapOf = (path: string) => ({ id: path.split('/').pop()!, exists: store.has(path), data: () => store.get(path), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = (path: string) => {
    collListeners.get(parent(path))?.forEach((f) => f());
    docListeners.get(path)?.forEach((f) => f());
  };
  const db: DbLike = {
    doc(path) {
      return {
        async set(d) {
          writes++;
          store.set(path, JSON.parse(JSON.stringify(d)));
          notify(path);
        },
        async delete() {
          writes++;
          store.delete(path);
          notify(path);
        },
        onSnapshot(next) {
          const f = () => next(snapOf(path));
          if (!docListeners.has(path)) docListeners.set(path, new Set());
          docListeners.get(path)!.add(f);
          queueMicrotask(f);
          return () => docListeners.get(path)!.delete(f);
        },
      };
    },
    collection(path) {
      return {
        onSnapshot(next) {
          const f = () => next({ docs: [...store.keys()].filter((k) => parent(k) === path).sort().map(snapOf) });
          if (!collListeners.has(path)) collListeners.set(path, new Set());
          collListeners.get(path)!.add(f);
          queueMicrotask(f);
          return () => collListeners.get(path)!.delete(f);
        },
      };
    },
  };
  return { db, store, writes: () => writes };
}

const owner = { isOwner: async () => true, canEdit: async () => true, id: async () => 'u_owner' };
const coach = { isOwner: async () => false, canEdit: async () => true, id: async () => 'u_coach' };
const viewer = { isOwner: async () => false, canEdit: async () => false, id: async () => 'u_parent' };

const player = (id: string, name: string): Player => ({ id, name, birthYear: 2013, level: 'intermediate', hand: 'right', backhand: 'two', coachId: '', parentId: '', parentIds: [], goals: '' });

/** A tiny "app": reducer + adapter wiring, like StoreProvider does. */
async function client(db: DbLike, user: typeof owner) {
  const a = new ArtifactDbAdapter(db, user);
  let state: AppState = await a.load();
  a.subscribe((fn) => {
    state = reducer(state, { type: 'remote', apply: fn });
  });
  return {
    a,
    get state() {
      return state;
    },
    async act(action: Parameters<typeof reducer>[1]) {
      state = reducer(state, action);
      await a.save(state);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('roles come from the sharing level', async () => {
  const { db } = mockDb();
  assert.equal((await client(db, owner)).a.maxRole, 'admin');
  assert.equal((await client(db, coach)).a.maxRole, 'coach');
  const v = await client(db, viewer);
  assert.equal(v.a.maxRole, 'parent');
  assert.equal(v.a.canWrite, false);
});

test('empty academy loads with the 200 seed drills and writes nothing on load', async () => {
  const m = mockDb();
  const c = await client(m.db, owner);
  assert.equal(c.state.drills.length, 200);
  assert.equal(c.state.players.length, 0);
  await c.a.save(c.state);
  assert.equal(m.writes(), 0);
});

test('only changed records are written, one document each', async () => {
  const m = mockDb();
  const c = await client(m.db, owner);
  await c.act({ type: 'upsertPlayer', player: player('p1', 'Ela') });
  assert.equal(m.writes(), 1);
  assert.ok(m.store.has('academy/data/players/p1'));
  await c.act({ type: 'setArchived', id: 'fh-001', archived: true });
  assert.equal(m.writes(), 2);
  assert.ok(m.store.has('academy/library/drills/fh-001'));
  await c.act({ type: 'setLang', lang: 'fa' });
  assert.equal(m.writes(), 2, 'per-viewer settings are not written to the shared db');
});

test('two coaches see each other live and do not overwrite each other', async () => {
  const m = mockDb();
  const a = await client(m.db, owner);
  const b = await client(m.db, coach);
  await a.act({ type: 'upsertPlayer', player: player('p1', 'Ela') });
  await tick();
  assert.deepEqual(b.state.players.map((p) => p.name), ['Ela']);
  await b.act({ type: 'upsertPlayer', player: player('p2', 'Deniz') });
  await a.act({ type: 'upsertPlayer', player: { ...player('p1', 'Ela Demir') } });
  await tick();
  assert.deepEqual(a.state.players.map((p) => p.name).sort(), ['Deniz', 'Ela Demir']);
  assert.deepEqual(b.state.players.map((p) => p.name).sort(), ['Deniz', 'Ela Demir']);
});

test('deleting a player removes it for everyone, with plans and results', async () => {
  const m = mockDb();
  const a = await client(m.db, owner);
  const b = await client(m.db, coach);
  await a.act({ type: 'upsertPlayer', player: player('p1', 'Ela') });
  await a.act({ type: 'addLog', log: { id: 'l1', playerId: 'p1', drillId: 'fh-001', sessionId: null, date: '2026-10-30', context: 'practice', eligible: 10, attempts: 8, correctDecisions: 6, successful: 3, errors: { net: 0, long: 0, wide: 0, wrongChoice: 0, late: 0, other: 0 }, notes: '', createdAt: 'x' } });
  await tick();
  assert.equal(b.state.logs.length, 1);
  await b.act({ type: 'deletePlayer', id: 'p1' });
  await tick();
  assert.equal(a.state.players.length, 0);
  assert.equal(a.state.logs.length, 0);
  assert.equal(m.store.size, 0);
});

test('coaches cannot change the drill library or thresholds; viewers write nothing', async () => {
  const m = mockDb();
  const b = await client(m.db, coach);
  await b.act({ type: 'setArchived', id: 'fh-001', archived: true });
  assert.equal(m.store.size, 0);
  const v = await client(m.db, viewer);
  await v.act({ type: 'upsertPlayer', player: player('p9', 'X') });
  assert.equal(m.store.size, 0);
});

test('owner edits to drills and thresholds reach coaches; restoring a drill removes its override', async () => {
  const m = mockDb();
  const a = await client(m.db, owner);
  const b = await client(m.db, coach);
  await a.act({ type: 'setArchived', id: 'sv-001', archived: true });
  const th = JSON.parse(JSON.stringify(a.state.settings.levelDefaults.beginner));
  th.decision = [41, 60, 80];
  await a.act({ type: 'setLevelDefaults', level: 'beginner', thresholds: th });
  await tick();
  assert.equal(b.state.drills.find((d) => d.id === 'sv-001')?.archived, true);
  assert.equal(b.state.settings.levelDefaults.beginner.decision[0], 41);
  await a.act({ type: 'importDrills', drills: [{ ...b.state.drills.find((d) => d.id === 'sv-001')!, name: 'Renamed serve drill' }] });
  await tick();
  assert.equal(b.state.drills.find((d) => d.id === 'sv-001')?.name, 'Renamed serve drill');
  assert.equal(b.state.drills.length, 200);
});

test('invalid documents from the database are ignored, not crashed on', async () => {
  const m = mockDb();
  m.store.set('academy/data/players/bad', { name: 42 });
  m.store.set('academy/data/players/ok', player('ok', 'Valid') as unknown as Record<string, unknown>);
  const c = await client(m.db, owner);
  assert.deepEqual(c.state.players.map((p) => p.id), ['ok']);
});

test('a permission refusal surfaces as an error and stops further writes', async () => {
  const m = mockDb();
  const refusing: DbLike = {
    ...m.db,
    doc: (p) => ({ ...m.db.doc(p), set: async () => Promise.reject({ code: 'invalid_argument', message: 'no' }) }),
    collection: m.db.collection,
  };
  const c = await client(refusing, coach);
  await assert.rejects(c.act({ type: 'upsertPlayer', player: player('p1', 'Ela') }), /permission/);
  assert.equal(c.a.canWrite, false);
});

const parentUser = { isOwner: async () => false, canEdit: async () => false, id: async () => 'u_parent' };
const otherParent = { isOwner: async () => false, canEdit: async () => false, id: async () => 'u_other' };
const logOf = (id: string, playerId: string) => ({ id, playerId, drillId: 'fh-001', sessionId: null, date: '2026-10-30', context: 'practice' as const, eligible: 10, attempts: 8, correctDecisions: 6, successful: 3, errors: { net: 0, long: 0, wide: 0, wrongChoice: 0, late: 0, other: 0 }, notes: '', createdAt: id });

test('a linked parent sees only their own child, live, and cannot write', async () => {
  const m = mockDb();
  const coachC = await client(m.db, coach);
  await coachC.act({ type: 'upsertPlayer', player: player('p1', 'Ela') });
  await coachC.act({ type: 'upsertPlayer', player: player('p2', 'Deniz') });
  await coachC.act({ type: 'addLog', log: logOf('l1', 'p1') });
  await coachC.act({ type: 'addLog', log: logOf('l2', 'p2') });
  await coachC.act({ type: 'upsertPlayer', player: { ...coachC.state.players.find((p) => p.id === 'p1')!, parentIds: ['u_parent'] } });
  assert.ok(m.store.has('family/u_parent/players/p1'));
  assert.ok(!m.store.has('family/u_parent/players/p2'));

  const par = await client(m.db, parentUser);
  assert.equal(par.a.maxRole, 'parent');
  assert.equal(par.state.settings.role, 'parent');
  assert.deepEqual(par.state.players.map((p) => p.name), ['Ela']);
  assert.deepEqual(par.state.logs.map((l) => l.id), ['l1']);
  assert.deepEqual(par.state.players[0].parentIds, [], 'other parents are not revealed');

  await coachC.act({ type: 'addLog', log: logOf('l3', 'p1') });
  await tick();
  assert.deepEqual(par.state.logs.map((l) => l.id).sort(), ['l1', 'l3']);

  const before = m.writes();
  await par.act({ type: 'addLog', log: logOf('l9', 'p1') });
  assert.equal(m.writes(), before, 'parents never write');

  const stranger = await client(m.db, otherParent);
  assert.equal(stranger.state.players.length, 0);
});

test('unlinking a parent or deleting the player removes the family copy', async () => {
  const m = mockDb();
  const c = await client(m.db, owner);
  await c.act({ type: 'upsertPlayer', player: { ...player('p1', 'Ela'), parentIds: ['u_parent', 'u_other'] } });
  assert.ok(m.store.has('family/u_parent/players/p1') && m.store.has('family/u_other/players/p1'));
  await c.act({ type: 'upsertPlayer', player: { ...c.state.players[0], parentIds: ['u_other'] } });
  assert.ok(!m.store.has('family/u_parent/players/p1'));
  // a second coach session (fresh page) can still unlink links it did not create
  const c2 = await client(m.db, coach);
  await c2.act({ type: 'deletePlayer', id: 'p1' });
  assert.ok(!m.store.has('family/u_other/players/p1'));
  assert.equal(m.store.size, 0);
});
