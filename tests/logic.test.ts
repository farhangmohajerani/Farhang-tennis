import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_DRILLS } from '../src/data/drills';
import { CATEGORY_TARGETS, CATEGORIES, LEVELS, AppStateSchema, DrillSchema, type Session } from '../src/types';
import { computeKpis, ratio, starsFor, sumLogs, transfer, validateCounts, isOverAttempting, delta } from '../src/lib/kpi';
import { drillsFromCSV, drillsToCSV, drillsFromJSON, drillsToJSON, mergeDrills } from '../src/lib/drillIO';
import { parseCSV, toCSV } from '../src/lib/csv';
import { findConflicts, rescheduleAroundTournaments, generateDates, addDays, taperWarnings } from '../src/lib/schedule';
import { createDemoState } from '../src/data/demo';
import { reducer } from '../src/lib/reducer';
import { parseState } from '../src/lib/storage';
import { DICT_EN, DICT_FA } from '../src/lib/i18n';

test('exactly 200 drills with the required category split', () => {
  assert.equal(SEED_DRILLS.length, 200);
  for (const c of CATEGORIES) assert.equal(SEED_DRILLS.filter((d) => d.category === c).length, CATEGORY_TARGETS[c], c);
  assert.equal(Object.values(CATEGORY_TARGETS).reduce((a, b) => a + b, 0), 200);
});

test('drill ids and names are unique and every drill validates', () => {
  assert.equal(new Set(SEED_DRILLS.map((d) => d.id)).size, 200);
  assert.equal(new Set(SEED_DRILLS.map((d) => d.name.toLowerCase())).size, 200);
  for (const d of SEED_DRILLS) assert.ok(DrillSchema.safeParse(d).success, d.id);
});

test('every drill carries every required field with content', () => {
  for (const d of SEED_DRILLS) {
    for (const f of ['objective', 'setup', 'courtLayout', 'players', 'repetitions', 'eligibility', 'measurement', 'progression', 'regression', 'safety', 'ageSkill'] as const) {
      assert.ok(d[f].trim().length > 0, `${d.id}.${f}`);
    }
    assert.ok(d.steps.length >= 2 && d.cues.length >= 1 && d.mistakes.length >= 1 && d.equipment.length >= 1, d.id);
    assert.ok(d.kpi.attempt && d.kpi.decision && d.kpi.execution, d.id);
    assert.ok(d.video.placeholder === true && d.thresholds.provisional === true, d.id);
  }
});

test('all four levels are represented', () => {
  for (const l of LEVELS) assert.ok(SEED_DRILLS.some((d) => d.level === l), l);
});

test('KPI formulas', () => {
  const k = computeKpis({ eligible: 10, attempts: 8, correctDecisions: 6, successful: 3 });
  assert.ok(k.attempt.ok && Math.abs(k.attempt.value - 0.8) < 1e-9);
  assert.ok(k.decision.ok && Math.abs(k.decision.value - 0.75) < 1e-9);
  assert.ok(k.execution.ok && Math.abs(k.execution.value - 0.5) < 1e-9);
});

test('KPI never divides by zero', () => {
  const k = computeKpis({ eligible: 0, attempts: 0, correctDecisions: 0, successful: 0 });
  assert.equal(k.attempt.ok, false);
  assert.equal(k.decision.ok, false);
  assert.equal(k.execution.ok, false);
  const k2 = computeKpis({ eligible: 5, attempts: 0, correctDecisions: 0, successful: 0 });
  assert.ok(k2.attempt.ok && k2.attempt.value === 0);
  assert.equal(k2.decision.ok, false);
  assert.equal(starsFor(k2.decision, [40, 60, 80]), null);
  assert.equal(transfer(ratio(1, 0), ratio(1, 2)), null);
  assert.equal(delta(ratio(1, 0), ratio(1, 2)), null);
});

test('stars respect thresholds and cap over-attempting', () => {
  assert.equal(starsFor(ratio(39, 100), [40, 60, 80]), 0);
  assert.equal(starsFor(ratio(40, 100), [40, 60, 80]), 1);
  assert.equal(starsFor(ratio(60, 100), [40, 60, 80]), 2);
  assert.equal(starsFor(ratio(80, 100), [40, 60, 80]), 3);
  assert.equal(starsFor(ratio(15, 10), [40, 60, 80]), 3);
  assert.equal(isOverAttempting({ eligible: 8, attempts: 11 }), true);
});

test('count validation enforces the KPI hierarchy', () => {
  assert.deepEqual(validateCounts({ eligible: 10, attempts: 8, correctDecisions: 6, successful: 3 }), []);
  assert.ok(validateCounts({ eligible: 10, attempts: 4, correctDecisions: 6, successful: 3 }).includes('correctDecisions:gtAttempts'));
  assert.ok(validateCounts({ eligible: 3, attempts: 8, correctDecisions: 6, successful: 3 }).includes('correctDecisions:gtEligible'));
  assert.ok(validateCounts({ eligible: 10, attempts: 8, correctDecisions: 2, successful: 3 }).includes('successful:gtDecisions'));
  assert.ok(validateCounts({ eligible: -1, attempts: 1.5, correctDecisions: 0, successful: 0 }).length >= 2);
});

test('sumLogs and transfer', () => {
  const t = sumLogs([{ eligible: 10, attempts: 8, correctDecisions: 6, successful: 3 }, { eligible: 10, attempts: 10, correctDecisions: 8, successful: 5 }]);
  assert.deepEqual([t.eligible, t.attempts, t.correctDecisions, t.successful, t.logs], [20, 18, 14, 8, 2]);
  const tr = transfer(ratio(6, 10), ratio(8, 10));
  assert.ok(tr !== null && Math.abs(tr - 0.75) < 1e-9);
});

test('CSV parser handles quotes, commas, newlines', () => {
  const rows = [['a', 'b,c', 'he said "hi"', 'line1\nline2'], ['1', '', 'x', 'y']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});

test('drill CSV and JSON round-trip losslessly for all 200 drills', () => {
  const csv = drillsFromCSV(drillsToCSV(SEED_DRILLS));
  assert.equal(csv.errors.length, 0, JSON.stringify(csv.errors.slice(0, 3)));
  assert.deepEqual(csv.drills, SEED_DRILLS);
  const json = drillsFromJSON(drillsToJSON(SEED_DRILLS));
  assert.equal(json.errors.length, 0);
  assert.deepEqual(json.drills, SEED_DRILLS);
});

test('import rejects invalid rows with messages', () => {
  const bad = drillsFromJSON(JSON.stringify([{ ...SEED_DRILLS[0], id: 'BAD ID', durationMin: -3 }, SEED_DRILLS[1]]));
  assert.equal(bad.drills.length, 1);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /id|durationMin/);
  assert.equal(drillsFromJSON('not json').errors.length, 1);
  assert.equal(drillsFromCSV('id,name\n1,2').drills.length, 0);
});

test('mergeDrills replaces same id and appends new ids', () => {
  const changed = { ...SEED_DRILLS[0], name: 'Renamed' };
  const custom = { ...SEED_DRILLS[1], id: 'custom-abc123', name: 'New custom', custom: true };
  const r = mergeDrills(SEED_DRILLS, [changed, custom]);
  assert.equal(r.drills.length, 201);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.drills.find((d) => d.id === SEED_DRILLS[0].id)?.name, 'Renamed');
});

const sess = (index: number, date: string, status: Session['status'] = 'planned'): Session => ({ id: `s${index}`, index, date, title: 't', focus: '', items: [], status, coachNote: '', kind: 'training' });

test('tournament conflicts and rescheduling', () => {
  const tours = [{ id: 't', playerId: 'p', name: 'Open', start: '2026-11-10', end: '2026-11-12' }];
  const sessions = [sess(1, '2026-11-08'), sess(2, '2026-11-10'), sess(3, '2026-11-12'), sess(4, '2026-11-13'), sess(5, '2026-11-01', 'completed')];
  assert.equal(findConflicts(sessions, tours).length, 2);
  const out = rescheduleAroundTournaments(sessions, tours);
  assert.equal(findConflicts(out, tours).length, 0);
  const dates = out.filter((s) => s.status === 'planned').sort((a, b) => a.index - b.index).map((s) => s.date);
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] > dates[i - 1], `strictly increasing ${dates}`);
  assert.equal(out.find((s) => s.id === 's5')?.date, '2026-11-01');
  assert.equal(taperWarnings([sess(1, '2026-11-08')], tours).length, 1);
});

test('generateDates skips tournament days and honours weekdays', () => {
  const tours = [{ id: 't', playerId: 'p', name: 'Open', start: '2026-11-03', end: '2026-11-05' }];
  const d = generateDates('2026-11-02', 10, [1, 3, 5], tours);
  assert.equal(d.length, 10);
  assert.ok(!d.some((x) => x >= '2026-11-03' && x <= '2026-11-05'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('demo state validates and references only existing drills', () => {
  const s = createDemoState('2026-10-27');
  assert.ok(AppStateSchema.safeParse(s).success);
  const ids = new Set(s.drills.map((d) => d.id));
  for (const p of s.plans) for (const se of p.sessions) for (const it of se.items) assert.ok(ids.has(it.drillId), it.drillId);
  for (const l of s.logs) assert.ok(ids.has(l.drillId));
  assert.equal(s.plans[0].sessions.length, 10);
  assert.ok(findConflicts(s.plans[0].sessions, s.tournaments).length >= 1, 'demo has a visible tournament conflict');
  assert.ok(s.logs.length > 0);
});

test('reducer: add to session is idempotent, delete only custom, defaults apply', () => {
  let s = createDemoState('2026-10-27');
  const plan = s.plans[0];
  const target = plan.sessions[5];
  s = reducer(s, { type: 'addSessionItem', planId: plan.id, sessionId: target.id, drillId: 'sv-001', reason: 'x' });
  s = reducer(s, { type: 'addSessionItem', planId: plan.id, sessionId: target.id, drillId: 'sv-001', reason: 'x' });
  assert.equal(s.plans[0].sessions[5].items.filter((i) => i.drillId === 'sv-001').length, 1);
  const before = s.drills.length;
  s = reducer(s, { type: 'deleteDrill', id: 'fh-001' });
  assert.equal(s.drills.length, before, 'seed drills cannot be hard-deleted');
  s = reducer(s, { type: 'setLevelDefaults', level: 'beginner', thresholds: { attempt: [1, 2, 3], decision: [4, 5, 6], execution: [7, 8, 9], provisional: true } });
  s = reducer(s, { type: 'applyLevelDefaults', level: 'beginner' });
  assert.ok(s.drills.filter((d) => d.level === 'beginner').every((d) => d.thresholds.attempt[0] === 1));
  assert.ok(s.drills.filter((d) => d.level !== 'beginner').every((d) => d.thresholds.attempt[0] !== 1));
});

test('stored state round-trips through parseState; corrupt state is rejected', () => {
  const s = createDemoState('2026-10-27');
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.equal(parseState('{"version":1}'), null);
  assert.equal(parseState('garbage'), null);
});

test('Persian dictionary covers every English key', () => {
  const missing = Object.keys(DICT_EN).filter((k) => !(k in DICT_FA));
  assert.deepEqual(missing, []);
});
