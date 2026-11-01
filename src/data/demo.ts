import type { AppState, Log, Match, MatchFormat, Plan, Session, Tournament } from '../types';
import { SEED_DRILLS } from './drills';
import { LEVEL_THRESHOLDS } from './drills/factory';
import { addDays, generateDates } from '../lib/schedule';
import { applyPoint, bare, encodePoint, newEngine, other, serverOf, type Point, type Side } from '../lib/match';

export const DEMO_IDS = {
  coach: 'person-coach-demo',
  parent: 'person-parent-demo',
  admin: 'person-admin-demo',
  player: 'player-demo',
  plan: 'plan-demo',
  tournament: 'tour-demo',
  pastTournament: 'tour-demo-past',
} as const;

/* ---------- a believable charted match, generated deterministically ---------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: [T, number][]): T {
  let x = r() * items.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

function simulatePoint(r: () => number, server: Side): Point {
  const p = server === 'p';
  const dir = pick<Point['dir']>(r, [['wide', 40], ['body', 20], ['t', 40]]);
  const firstIn = r() < (p ? 0.58 : 0.62);
  const serve: 1 | 2 = firstIn ? 1 : 2;
  if (!firstIn && r() < (p ? 0.1 : 0.07)) return bare(other(server), 2, 'doubleFault', { shot: 'serve', rally: 'short' });
  const serverWins = r() < (p ? (serve === 1 ? 0.7 : 0.53) : serve === 1 ? 0.58 : 0.44);
  const win: Side = serverWins ? server : other(server);
  const rally = pick<Point['rally']>(r, [['short', 45], ['mid', 35], ['long', 20]]);
  const wing = pick<Point['wing']>(r, [['fh', 55], ['bh', 45]]);
  const shot = pick<Point['shot']>(r, [['drive', 58], ['slice', 9], ['drop', 4], ['lob', 4], ['approach', 6], ['pass', 5], ['volley', 9], ['halfVolley', 1], ['overhead', 4]]);
  const net = win === 'p' ? r() < 0.16 || shot === 'volley' || shot === 'overhead' : r() < 0.06;
  const x = r();
  if (serverWins) {
    if (serve === 1 && x < 0.08) return bare(win, serve, 'ace', { shot: 'serve', rally: 'short', dir });
    if (x < 0.18) return bare(win, serve, 'serviceWinner', { shot: 'serve', rally: 'short', dir });
    if (x < 0.32) return bare(win, serve, 'returnError', { wing, shot: r() < 0.2 ? 'slice' : 'drive', rally: 'short', dir });
  } else if (x < 0.07) {
    return bare(win, serve, 'returnWinner', { wing, shot: 'drive', rally: 'short', dir });
  }
  const end = pick<Point['end']>(r, [['winner', 38], ['forcedError', 25], ['unforcedError', 37]]);
  return bare(win, serve, end, { wing: shot === 'overhead' ? null : wing, shot, rally, net, dir });
}

/** Simulate until the player wins (the demo story needs a win); same result every time. */
function demoPoints(format: MatchFormat, firstServer: Side, seed: number): string[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = rng(seed + attempt * 7919);
    const e = newEngine(format, firstServer);
    const pts: string[] = [];
    while (!e.winner && pts.length < 400) {
      const pt = simulatePoint(r, serverOf(e));
      applyPoint(e, pt.win);
      pts.push(encodePoint(pt));
    }
    if (e.winner === 'p') return pts;
  }
  return [];
}

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
  const tournament: Tournament = {
    id: DEMO_IDS.tournament,
    playerId: DEMO_IDS.player,
    name: 'Regional Junior Open (demo)',
    start: addDays(today, 15),
    end: addDays(today, 17),
    location: 'Ankara',
    category: 'National U14',
    surface: 'hard',
    indoor: false,
    aim: 'both',
    goals: [
      { id: 'goal-demo-1', kind: 'outcome', round: 'QF' },
      { id: 'goal-demo-2', kind: 'stat', metric: 'firstServeIn', op: 'gte', value: 60 },
      { id: 'goal-demo-3', kind: 'stat', metric: 'unforcedErrors', op: 'lte', value: 15 },
      { id: 'goal-demo-4', kind: 'drill', drillId: 'tp-001', target: 50 },
      { id: 'goal-demo-5', kind: 'custom', text: 'Same routine before every serve', achieved: null },
    ],
    notes: 'Taper the last two days. Arrive early for a 30-minute hit on the match courts.',
    result: null,
    review: '',
  };
  const pastTournament: Tournament = {
    id: DEMO_IDS.pastTournament,
    playerId: DEMO_IDS.player,
    name: 'Ankara Club Championship (demo)',
    start: addDays(today, -24),
    end: addDays(today, -22),
    location: 'Ankara',
    category: 'Club',
    surface: 'clay',
    indoor: false,
    aim: 'training',
    goals: [
      { id: 'goal-demo-6', kind: 'stat', metric: 'firstServeIn', op: 'gte', value: 60 },
      { id: 'goal-demo-7', kind: 'stat', metric: 'doubleFaults', op: 'lte', value: 4 },
      { id: 'goal-demo-8', kind: 'drill', drillId: 'fh-006', target: 55 },
    ],
    notes: '',
    result: null,
    review: 'Second serve held up well. Depth dropped in the second round under pressure — keep depth as priority 1.',
  };
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

  const junior: MatchFormat = { sets: 3, games: 6, finalSet: 'mtb', noAd: false };
  const baseMatch = { playerId: DEMO_IDS.player, opponentHand: 'right' as const, indoor: false, endReason: 'completed' as const, winner: null, sets: [], points: [] as string[], notes: '' };
  const matches: Match[] = [
    {
      ...baseMatch,
      id: 'match-demo-1',
      date: pastTournament.start,
      kind: 'official',
      tournamentId: pastTournament.id,
      round: 'R32',
      opponent: 'Mina Aksoy',
      opponentRating: 'UTR 5.1',
      surface: 'clay',
      format: junior,
      firstServer: 'p',
      mode: 'live',
      points: demoPoints(junior, 'p', 11),
      status: 'done',
      notes: 'Served well on big points. Backhand errors in long rallies.',
      createdAt: `${pastTournament.start}T10:00:00.000Z`,
      updatedAt: `${pastTournament.start}T12:00:00.000Z`,
    },
    {
      ...baseMatch,
      id: 'match-demo-2',
      date: addDays(pastTournament.start, 1),
      kind: 'official',
      tournamentId: pastTournament.id,
      round: 'R16',
      opponent: 'Zeynep Kılıç',
      opponentRating: 'UTR 6.0',
      opponentHand: 'left',
      surface: 'clay',
      format: junior,
      firstServer: 'o',
      mode: 'score',
      sets: [
        { p: 4, o: 6, tb: null },
        { p: 3, o: 6, tb: null },
      ],
      status: 'done',
      winner: 'o',
      notes: 'Lefty serve out wide caused problems on the ad side.',
      createdAt: `${addDays(pastTournament.start, 1)}T10:00:00.000Z`,
      updatedAt: `${addDays(pastTournament.start, 1)}T12:00:00.000Z`,
    },
    {
      ...baseMatch,
      id: 'match-demo-3',
      date: addDays(today, -5),
      kind: 'practice',
      tournamentId: null,
      round: null,
      opponent: 'Deniz Yıldız',
      opponentRating: 'Club',
      surface: 'hard',
      format: junior,
      firstServer: 'o',
      mode: 'live',
      points: demoPoints(junior, 'o', 29),
      status: 'done',
      notes: 'Good depth in the first set. Approached two short balls and won both.',
      createdAt: `${addDays(today, -5)}T16:00:00.000Z`,
      updatedAt: `${addDays(today, -5)}T18:00:00.000Z`,
    },
  ];

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
    tournaments: [pastTournament, tournament],
    logs,
    matches,
    settings: {
      lang: 'en',
      role: 'coach',
      activePlayerId: DEMO_IDS.player,
      levelDefaults: JSON.parse(JSON.stringify(LEVEL_THRESHOLDS)),
    },
  };
}
