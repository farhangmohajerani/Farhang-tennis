import type { AppState, Log, Plan, Session } from '../types';
import { SEED_DRILLS } from './drills';
import { LEVEL_THRESHOLDS } from './drills/factory';
import { addDays, generateDates } from '../lib/schedule';

export const DEMO_IDS = {
  coach: 'person-coach-demo',
  parent: 'person-parent-demo',
  admin: 'person-admin-demo',
  player: 'player-demo',
  plan: 'plan-demo',
  tournament: 'tour-demo',
} as const;

/** Demo plan: baseline → focused block → match evaluation → baseline comparison. */
const PLAN_BLUEPRINT: { title: string; focus: string; kind: Session['kind']; items: [string, string][] }[] = [
  {
    title: 'Baseline assessment',
    focus: 'Measure where Ela starts before choosing priorities.',
    kind: 'baseline',
    items: [
      ['fh-006', 'Baseline: how often rally forehands land deep.'],
      ['bh-002', 'Baseline: backhand crosscourt consistency.'],
      ['fh-007', 'Baseline: does she recognize and approach short balls?'],
      ['tp-001', 'Baseline: drop-shot decision quality after deep topspin.'],
    ],
  },
  {
    title: 'Depth & margin',
    focus: 'Priority 1 — push opponents back with height and depth.',
    kind: 'training',
    items: [
      ['fw-001', 'Warm-up: split-step timing.'],
      ['fh-002', 'Builds safe net clearance before adding pace.'],
      ['fh-006', 'Main KPI drill for priority 1 (depth).'],
      ['bh-002', 'Same depth goal on the backhand diagonal.'],
    ],
  },
  {
    title: 'Short-ball recognition',
    focus: 'Priority 2 — attack and approach only the right balls.',
    kind: 'training',
    items: [
      ['fw-003', 'Recovery footwork to reach the next ball in balance.'],
      ['fh-017', 'Separates rally balls from attack balls.'],
      ['fh-007', 'Main KPI drill for priority 2 (approach on short balls).'],
      ['vo-002', 'Finishes the approach with a deep first volley.'],
    ],
  },
  {
    title: 'Deep topspin + drop shot',
    focus: 'Priority 3 — use the drop shot only when the opponent is pushed back.',
    kind: 'training',
    items: [
      ['fh-010', 'Heavy topspin creates the deep ball that sets up the drop.'],
      ['tp-001', 'Main decision drill: drop only when eligible.'],
      ['mn-001', 'Between-point routine to keep decisions calm.'],
    ],
  },
  {
    title: 'Serve foundation',
    focus: 'Reliable second serve so points start safely.',
    kind: 'training',
    items: [
      ['sv-011', 'Routine first: same rhythm every serve.'],
      ['sv-006', 'Kick second serve with high net clearance.'],
      ['sv-007', 'Pressure ladder to test reliability.'],
    ],
  },
  {
    title: 'Depth under pressure',
    focus: 'Priority 1 again with a live opponent.',
    kind: 'training',
    items: [
      ['fw-007', 'Sustained movement before hitting under fatigue.'],
      ['fh-023', 'Margin grid: choose the high-percentage target.'],
      ['tp-002', 'Crosscourt until short, then line.'],
    ],
  },
  {
    title: 'Transition to the net',
    focus: 'Priority 2 in live points.',
    kind: 'training',
    items: [
      ['fw-019', 'Run through the approach without stopping.'],
      ['tp-006', 'Approach line, volley crosscourt pattern.'],
      ['pp-006', 'Live points where short balls must be approached.'],
    ],
  },
  {
    title: 'Pre-tournament sharpening',
    focus: 'Lower volume, high quality, confidence.',
    kind: 'training',
    items: [
      ['fw-020', 'Rehearse the tournament warm-up.'],
      ['tp-030', 'Patience pattern before attacking.'],
      ['mn-002', 'Reset quickly after errors.'],
    ],
  },
  {
    title: 'Match-based evaluation',
    focus: 'Do the priorities show up in real points? Win/loss is NOT the measure.',
    kind: 'match-eval',
    items: [
      ['pp-003', 'Track depth, approaches and drops in live points.'],
      ['mn-006', 'Process scorecard instead of the scoreboard.'],
    ],
  },
  {
    title: 'Re-test vs baseline',
    focus: 'Repeat the baseline drills and decide the next block.',
    kind: 'baseline',
    items: [
      ['fh-006', 'Compare depth with session 1.'],
      ['bh-002', 'Compare backhand consistency with session 1.'],
      ['fh-007', 'Compare short-ball approach decisions with session 1.'],
      ['tp-001', 'Compare drop-shot decisions with session 1.'],
    ],
  },
];

export function createDemoState(today: string): AppState {
  const start = addDays(today, -8);
  const tournament = { id: DEMO_IDS.tournament, playerId: DEMO_IDS.player, name: 'Regional Junior Open (demo)', start: addDays(today, 15), end: addDays(today, 17) };
  // Tue / Thu / Sat schedule. Tournament days are skipped at generation; session 8 is then
  // deliberately placed ON the tournament start so the planner's conflict tools are visible.
  const dates = generateDates(start, 10, [2, 4, 6], []);
  const sessions: Session[] = PLAN_BLUEPRINT.map((b, i) => ({
    id: `sess-demo-${String(i + 1).padStart(2, '0')}`,
    index: i + 1,
    date: dates[i],
    title: b.title,
    focus: b.focus,
    kind: b.kind,
    items: b.items.map(([drillId, reason]) => ({ drillId, reason })),
    status: dates[i] < today ? 'completed' : 'planned',
    coachNote: '',
  }));
  sessions[0].coachNote = 'Good attitude. Depth was the clearest gap — most rally balls landed around the service line.';
  if (sessions[1].status === 'completed') sessions[1].coachNote = 'Rope drill helped: net clearance much better by the last set.';
  if (sessions[2].status === 'completed') sessions[2].coachNote = 'Recognised short balls well; still stops after hitting the approach.';
  if (sessions[7].status === 'planned') sessions[7].date = tournament.start;

  const plan: Plan = {
    id: DEMO_IDS.plan,
    playerId: DEMO_IDS.player,
    name: 'Autumn block — depth, transition, drop-shot decisions',
    priority: 'Depth first, then short-ball transition, then drop-shot decisions.',
    owner: 'coach',
    sharedWithCoachId: null,
    createdAt: `${start}T09:00:00.000Z`,
    sessions,
  };

  const mk = (n: number, sessionIdx: number, drillId: string, context: Log['context'], e: number, a: number, d: number, s: number, errors: Partial<Log['errors']>, notes: string): Log => ({
    id: `log-demo-${String(n).padStart(3, '0')}`,
    playerId: DEMO_IDS.player,
    drillId,
    sessionId: sessions[sessionIdx]?.id ?? null,
    date: sessions[sessionIdx]?.date ?? start,
    context,
    eligible: e,
    attempts: a,
    correctDecisions: d,
    successful: s,
    errors: { net: 0, long: 0, wide: 0, wrongChoice: 0, late: 0, other: 0, ...errors },
    notes,
    createdAt: `${sessions[sessionIdx]?.date ?? start}T18:00:00.000Z`,
  });

  const logs: Log[] = [];
  const done = (i: number) => sessions[i].status === 'completed';
  if (done(0)) {
    logs.push(
      mk(1, 0, 'fh-006', 'baseline', 30, 26, 15, 9, { net: 6, long: 3, other: 2 }, 'Many balls at the service line. Flat swing when tired.'),
      mk(2, 0, 'bh-002', 'baseline', 30, 30, 22, 16, { net: 4, wide: 2 }, 'Solid diagonal, short depth.'),
      mk(3, 0, 'fh-007', 'baseline', 12, 7, 5, 3, { wrongChoice: 2, net: 1, long: 1 }, 'Stayed back on 5 short balls; approached 2 deep balls.'),
      mk(4, 0, 'tp-001', 'baseline', 8, 11, 4, 2, { wrongChoice: 7, net: 2 }, 'Drop shots from behind the baseline — 11 attempts on 8 eligible balls (forcing).'),
    );
  }
  if (done(1)) {
    logs.push(
      mk(5, 1, 'fh-002', 'practice', 40, 40, 33, 24, { net: 7, long: 2 }, 'Over the rope 33/40.'),
      mk(6, 1, 'fh-006', 'practice', 32, 30, 22, 15, { net: 4, long: 3 }, 'Improving, still drops off in the last set.'),
      mk(7, 1, 'bh-002', 'practice', 30, 30, 25, 19, { net: 3, wide: 3 }, ''),
    );
  }
  if (done(2)) {
    logs.push(
      mk(8, 2, 'fh-017', 'practice', 30, 30, 24, 17, { wrongChoice: 6, long: 4 }, 'Attack ball recognition good.'),
      mk(9, 2, 'fh-007', 'practice', 18, 15, 13, 8, { wrongChoice: 2, net: 3, long: 2 }, 'Approaches correct; stops after the hit.'),
      mk(10, 2, 'fh-006', 'match', 22, 19, 12, 7, { net: 4, long: 3 }, 'Practice set vs. Deniz: depth fades under score pressure.'),
    );
  }

  return {
    version: 1,
    drills: SEED_DRILLS.map((d) => ({ ...d })),
    people: [
      { id: DEMO_IDS.coach, name: 'Coach Arda Kaya', role: 'coach', email: 'coach@example.com' },
      { id: DEMO_IDS.parent, name: 'Selin Demir (parent)', role: 'parent', email: 'parent@example.com' },
      { id: DEMO_IDS.admin, name: 'Academy Admin', role: 'admin', email: 'admin@example.com' },
    ],
    players: [
      {
        id: DEMO_IDS.player,
        name: 'Ela Demir',
        birthYear: Number(today.slice(0, 4)) - 13,
        level: 'intermediate',
        hand: 'right',
        backhand: 'two',
        coachId: DEMO_IDS.coach,
        parentId: DEMO_IDS.parent,
        parentIds: [],
        goals: 'Build depth and margin, transition on short balls, smarter drop-shot decisions before the regional junior open.',
      },
    ],
    plans: [plan],
    tournaments: [tournament],
    logs,
    settings: {
      lang: 'en',
      role: 'coach',
      activePlayerId: DEMO_IDS.player,
      levelDefaults: JSON.parse(JSON.stringify(LEVEL_THRESHOLDS)),
    },
  };
}
