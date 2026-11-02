import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignedDrillIds, drillAccess, hasPro, isLocked, planActive } from '../src/lib/access';
import { createDemoState } from '../src/data/demo';
import { SEED_DRILLS } from '../src/data/drills';
import { drillsFromCSV, drillsToCSV } from '../src/lib/drillIO';
import { parseCSV, toCSV } from '../src/lib/csv';
import { reducer } from '../src/lib/reducer';
import { docsOf, familyDoc } from '../src/lib/artifactDb';
import { AppStateSchema } from '../src/types';

const drill = (id: string) => SEED_DRILLS.find((d) => d.id === id)!;

test('free or Pro: beginner and own drills free by default; the admin choice wins', () => {
  const beginner = SEED_DRILLS.filter((d) => d.level === 'beginner');
  assert.ok(beginner.length > 30 && beginner.every((d) => drillAccess(d) === 'free'));
  assert.ok(SEED_DRILLS.filter((d) => d.level !== 'beginner').every((d) => drillAccess(d) === 'pro'));
  assert.equal(drillAccess({ ...drill('fh-004'), custom: true }), 'free', "the academy's own drills");
  assert.equal(drillAccess({ ...drill('fh-001'), access: 'pro' }), 'pro');
  assert.equal(drillAccess({ ...drill('fh-004'), access: 'free' }), 'free');
});

test('who has Pro: staff always; a parent with an active plan', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.ok(hasPro('coach', null, now) && hasPro('admin', null, now));
  assert.equal(hasPro('parent', null, now), false);
  assert.ok(hasPro('parent', { plan: 'family', until: null }, now), 'no end date');
  assert.ok(hasPro('parent', { plan: 'family', until: '2026-12-01T00:00:00Z' }, now));
  assert.equal(planActive({ plan: 'family', until: '2026-11-01T00:00:00Z' }, now), false, 'expired');
});

test('locks: only with subscriptions on, only Pro drills, never drills in the child’s plan', () => {
  const s = createDemoState('2026-11-02');
  const assigned = assignedDrillIds(s);
  assert.ok(assigned.has('fh-006'));
  const ctx = { paywall: true, pro: false, assigned };
  assert.equal(isLocked(drill('fh-004'), ctx), true);
  assert.equal(isLocked(drill('fh-006'), ctx), false, 'assigned by the coach');
  assert.equal(isLocked(drill('fh-001'), ctx), false, 'free');
  assert.equal(isLocked(drill('fh-004'), { ...ctx, paywall: false }), false);
  assert.equal(isLocked(drill('fh-004'), { ...ctx, pro: true }), false);
});

test('admin actions, CSV round trip and what families receive', () => {
  let s = createDemoState('2026-11-02');
  s = reducer(s, { type: 'setPaywall', on: true });
  s = reducer(s, { type: 'setDrillAccess', ids: ['fh-001'], access: 'pro' });
  s = reducer(s, { type: 'setDrillAccess', ids: ['fh-004'], access: 'free' });
  assert.equal(s.settings.paywall, true);
  assert.equal(drillAccess(s.drills.find((d) => d.id === 'fh-001')!), 'pro');
  // Back to the default rule.
  const back = reducer(s, { type: 'setDrillAccess', ids: ['fh-004'], access: null });
  assert.equal(back.drills.find((d) => d.id === 'fh-004')!.access, undefined);
  // CSV keeps the choice; files without the column still import.
  const csv = drillsToCSV(s.drills);
  const again = drillsFromCSV(csv);
  assert.equal(again.errors.length, 0);
  assert.deepEqual(again.drills.find((d) => d.id === 'fh-001')!.access, 'pro');
  assert.equal(again.drills.find((d) => d.id === 'fh-002')!.access, undefined);
  const rows = parseCSV(csv);
  const i = rows[0].indexOf('access');
  assert.ok(i > 0, 'access column exported');
  const withoutAccess = toCSV(rows.map((r) => r.filter((_, k) => k !== i)));
  const oldFile = drillsFromCSV(withoutAccess);
  assert.equal(oldFile.errors.length, 0, 'files exported before free / Pro still import');
  assert.equal(oldFile.drills.find((d) => d.id === 'fh-001')!.access, undefined);
  // Families cannot read the academy settings: the switch and the choices travel in their document.
  const player = s.players[0];
  const fam = familyDoc(s, player.id)!;
  assert.equal(fam.paywall, true);
  assert.deepEqual(fam.access, { 'fh-001': 'pro', 'fh-004': 'free' });
  assert.deepEqual(docsOf(s).get('academy/config'), { levelDefaults: s.settings.levelDefaults, paywall: true });
  // Stored state without the new setting still loads (off).
  const { paywall: _p, ...oldSettings } = s.settings;
  assert.equal(AppStateSchema.parse({ ...s, settings: oldSettings }).settings.paywall, false);
});
