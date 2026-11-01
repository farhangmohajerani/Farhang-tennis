import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPoint,
  decodePoint,
  encodePoint,
  engineSets,
  gameLabel,
  isBreakPoint,
  matchStats,
  metricValue,
  newEngine,
  peek,
  replay,
  serverOf,
  setsText,
  summary,
  type Engine,
  type Point,
  type Side,
} from '../src/lib/match';
import { evaluateGoal, evaluateTournament, furthestRound, makeTournament } from '../src/lib/competition';
import { createDemoState } from '../src/data/demo';
import { MatchSchema, POINT_RE, type Log, type Match, type MatchFormat } from '../src/types';

const BO3: MatchFormat = { sets: 3, games: 6, finalSet: 'full', noAd: false };
const JUNIOR: MatchFormat = { sets: 3, games: 6, finalSet: 'mtb', noAd: false };

const pt = (win: Side, extra: Partial<Point> = {}): string => encodePoint({ win, serve: 1, end: 'other', wing: null, shot: null, rally: null, net: false, dir: null, ...extra });
/** n points for one side. */
const pts = (win: Side, n: number) => Array.from({ length: n }, () => pt(win));
/** A game won by `win` (4 straight points). */
const game = (win: Side) => pts(win, 4);
function play(e: Engine, codes: string[]) {
  for (const c of codes) applyPoint(e, decodePoint(c).win);
}
function mkMatch(points: string[], format: MatchFormat = BO3, firstServer: Side = 'p', extra: Partial<Match> = {}): Match {
  return MatchSchema.parse({
    id: 'm1',
    playerId: 'pl',
    date: '2026-05-01',
    kind: 'practice',
    format,
    firstServer,
    mode: 'live',
    points,
    status: 'live',
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
    ...extra,
  });
}

test('point codes round-trip', () => {
  const samples: Point[] = [
    { win: 'p', serve: 1, end: 'ace', wing: null, shot: 'serve', rally: 'short', net: false, dir: 't' },
    { win: 'o', serve: 2, end: 'doubleFault', wing: null, shot: 'serve', rally: 'short', net: false, dir: null },
    { win: 'p', serve: 2, end: 'winner', wing: 'bh', shot: 'volley', rally: 'mid', net: true, dir: 'wide' },
    { win: 'o', serve: 1, end: 'unforcedError', wing: 'bh', shot: 'slice', rally: 'long', net: false, dir: 'body' },
    { win: 'p', serve: 1, end: 'returnError', wing: 'fh', shot: 'drive', rally: 'short', net: false, dir: null },
    { win: 'o', serve: 1, end: 'forcedError', wing: 'fh', shot: 'halfVolley', rally: null, net: true, dir: null },
    { win: 'p', serve: 1, end: 'other', wing: null, shot: null, rally: null, net: false, dir: null },
  ];
  for (const s of samples) {
    const code = encodePoint(s);
    assert.match(code, POINT_RE);
    assert.equal(code.length, 8);
    assert.deepEqual(decodePoint(code), s);
  }
});

test('matches charted with the older 6-character code are still read', () => {
  assert.deepEqual(decodePoint('p1Wfm-'), { win: 'p', serve: 1, end: 'winner', wing: 'fh', shot: 'drive', rally: 'mid', net: false, dir: null });
  assert.deepEqual(decodePoint('o2Uvln'), { win: 'o', serve: 2, end: 'unforcedError', wing: null, shot: 'volley', rally: 'long', net: true, dir: null });
  assert.ok(MatchSchema.safeParse({ ...mkMatch([]), points: ['p1Wfm-', 'p1Wfvmnt'] }).success, 'old and new codes in one match');
});

test('court side follows the score: deuce court on even points, ad court on odd points', () => {
  const sides = (m: Match) => replay(m).ctx.map((c) => c.court);
  // 15-0, 30-0, 30-15, 30-30, 40-30, deuce, AD, deuce, AD, game
  const g = [pt('p'), pt('p'), pt('o'), pt('o'), pt('p'), pt('o'), pt('p'), pt('o'), pt('p'), pt('p')];
  assert.deepEqual(sides(mkMatch(g)), ['deuce', 'ad', 'deuce', 'ad', 'deuce', 'ad', 'deuce', 'ad', 'deuce', 'ad']);
  // no-ad deciding point: the receiver chooses the side, so it is not assigned
  const noAd = sides(mkMatch([pt('p'), pt('o'), pt('p'), pt('o'), pt('p'), pt('o'), pt('p')], { ...BO3, noAd: true }));
  assert.deepEqual(noAd.slice(5), ['ad', null]);
  // tie-break: first point deuce court, then ad, deuce…
  const toTb = Array.from({ length: 6 }, () => [...game('p'), ...game('o')]).flat();
  const tb = sides(mkMatch([...toTb, pt('p'), pt('o'), pt('p')])).slice(-3);
  assert.deepEqual(tb, ['deuce', 'ad', 'deuce']);
});

test('serve and return by court side, serve direction, returns by forehand / backhand', () => {
  // Player serves game 1: wins deuce-court points, loses one ad-court point on a forehand return winner.
  const g1 = [
    pt('p', { end: 'ace', shot: 'serve', dir: 't' }), // deuce
    pt('o', { end: 'returnWinner', wing: 'fh', shot: 'drive', dir: 'wide' }), // ad
    pt('p', { end: 'returnError', wing: 'bh', shot: 'slice', dir: 'wide' }), // deuce
    pt('p', { serve: 2, end: 'winner', wing: 'fh', shot: 'drive', dir: 'body' }), // ad
    pt('p', { end: 'unforcedError', wing: 'bh', shot: 'volley' }), // deuce: opponent's backhand volley error
  ];
  const st = matchStats(mkMatch(g1));
  assert.deepEqual([st.court.p.deuce.servePlayed, st.court.p.deuce.serveWon], [3, 3]);
  assert.deepEqual([st.court.p.ad.servePlayed, st.court.p.ad.serveWon], [2, 1]);
  assert.equal(st.court.p.ad.firstIn, 1);
  assert.equal(st.court.p.deuce.aces, 1);
  assert.deepEqual([st.court.o.ad.returnPlayed, st.court.o.ad.returnWon], [2, 1]);
  assert.equal(st.serveDir.p.deuce.t.played, 1);
  assert.deepEqual(st.serveDir.p.ad.wide, { played: 1, won: 0 });
  assert.deepEqual(st.serveDir.p.deuce.wide, { played: 1, won: 1 });
  assert.equal(st.returns.o.fh.winners, 1);
  assert.equal(st.returns.o.bh.errors, 1);
  assert.equal(st.strokes.o['bh:volley'].unforced, 1, 'opponent missed a backhand volley');
  assert.equal(st.strokes.p['fh:drive'].winners, 1);
  assert.equal(Math.round(metricValue('adServeWon', st)!), 50);
  assert.equal(metricValue('deuceServeWon', st), 100);
  assert.equal(metricValue('adReturnWon', st), null, 'the player has not returned yet');
});

test('a game: 15-30-40-game, then the other player serves', () => {
  const e = newEngine(BO3, 'p');
  play(e, pts('p', 3));
  assert.deepEqual(gameLabel(e), { p: '40', o: '0', deuce: false });
  play(e, pts('p', 1));
  assert.equal(e.sets[0].p, 1);
  assert.equal(serverOf(e), 'o');
  assert.deepEqual(gameLabel(e), { p: '0', o: '0', deuce: false });
});

test('deuce and advantage need a two-point lead', () => {
  const e = newEngine(BO3, 'p');
  play(e, [pt('p'), pt('o'), pt('p'), pt('o'), pt('p'), pt('o')]);
  assert.equal(gameLabel(e).deuce, true);
  play(e, [pt('p')]);
  assert.deepEqual(gameLabel(e), { p: 'AD', o: '40', deuce: false });
  play(e, [pt('o')]);
  assert.equal(gameLabel(e).deuce, true);
  play(e, [pt('o'), pt('o')]);
  assert.equal(e.sets[0].o, 1, 'receiver broke after deuce');
});

test('no-ad: the point at 40-40 decides the game and is a break point', () => {
  const e = newEngine({ ...BO3, noAd: true }, 'p');
  play(e, [pt('p'), pt('o'), pt('p'), pt('o'), pt('p'), pt('o')]);
  assert.equal(isBreakPoint(e), true);
  play(e, [pt('o')]);
  assert.deepEqual([e.sets[0].p, e.sets[0].o], [0, 1]);
});

test('break points: 30-40 and advantage receiver, never in a tie-break', () => {
  const e = newEngine(BO3, 'p');
  play(e, [pt('p'), pt('p'), pt('o'), pt('o'), pt('o')]); // 30-40
  assert.equal(isBreakPoint(e), true);
  play(e, [pt('p')]); // deuce
  assert.equal(isBreakPoint(e), false);
  play(e, [pt('o')]); // AD receiver
  assert.equal(isBreakPoint(e), true);
});

test('sets: 6-4 ends a set, 6-5 does not, 7-5 does', () => {
  const e = newEngine(BO3, 'p');
  for (let i = 0; i < 4; i++) play(e, [...game('p'), ...game('o')]); // 4-4
  play(e, [...game('p'), ...game('p')]); // 6-4
  assert.equal(e.sets[0].winner, 'p');
  assert.equal(e.setsWon.p, 1);
  const f = newEngine(BO3, 'p');
  for (let i = 0; i < 5; i++) play(f, [...game('p'), ...game('o')]); // 5-5
  play(f, game('p')); // 6-5
  assert.equal(f.sets[0].winner, null);
  play(f, game('p')); // 7-5
  assert.equal(f.sets[0].winner, 'p');
});

test('tie-break at 6-6: serve rotation A, BB, AA…; 7-6(5); the next set starts with the other server', () => {
  const e = newEngine(BO3, 'p');
  for (let i = 0; i < 6; i++) play(e, [...game('p'), ...game('o')]); // 6-6, 12 games → p due to serve
  assert.ok(e.tb, 'tie-break started');
  const order: Side[] = [];
  const seq: Side[] = ['p', 'o', 'p', 'o', 'p', 'o', 'p', 'o', 'p', 'o', 'p', 'p']; // 7-5
  for (const w of seq) {
    order.push(serverOf(e));
    applyPoint(e, w);
  }
  assert.deepEqual(order.slice(0, 7), ['p', 'o', 'o', 'p', 'p', 'o', 'o']);
  assert.equal(e.sets[0].winner, 'p');
  assert.equal(setsText(engineSets(e)), '7-6(5)');
  assert.equal(serverOf(e), 'o', 'player who served first in the tie-break receives first next set');
});

test('tie-break needs a two-point lead past 7', () => {
  const e = newEngine(BO3, 'o');
  for (let i = 0; i < 6; i++) play(e, [...game('o'), ...game('p')]);
  play(e, [...pts('p', 6), ...pts('o', 6)]); // 6-6 in the tie-break
  play(e, [pt('p')]); // 7-6
  assert.equal(e.sets[0].winner, null);
  play(e, [pt('p')]); // 8-6
  assert.equal(e.sets[0].winner, 'p');
  assert.equal(setsText(engineSets(e)), '7-6(6)');
});

test('deciding match tie-break to 10, by two', () => {
  const e = newEngine(JUNIOR, 'p');
  for (let i = 0; i < 6; i++) play(e, game('p')); // 6-0
  for (let i = 0; i < 6; i++) play(e, game('o')); // 0-6
  assert.ok(e.tb && e.tb.target === 10, 'match tie-break');
  play(e, [...pts('p', 9), ...pts('o', 9)]); // 9-9
  assert.equal(peek(e, 'p').match, false);
  play(e, [pt('p')]); // 10-9
  assert.equal(e.winner, null);
  assert.equal(peek(e, 'p').match, true, 'match point');
  play(e, [pt('p')]); // 11-9
  assert.equal(e.winner, 'p');
  assert.equal(setsText(engineSets(e)), '6-0 0-6 [11-9]');
});

test('short sets: tie-break at 4-4', () => {
  const e = newEngine({ sets: 3, games: 4, finalSet: 'mtb', noAd: true }, 'p');
  for (let i = 0; i < 4; i++) play(e, [...game('p'), ...game('o')]);
  assert.ok(e.tb && e.tb.target === 7);
});

test('replay ignores points after the match is over and stops the score', () => {
  const winSet = Array.from({ length: 6 }, () => game('p')).flat();
  const m = mkMatch([...winSet, ...winSet, ...pts('o', 8)]);
  const r = replay(m);
  assert.equal(r.engine.winner, 'p');
  assert.equal(r.ctx.length, 48);
  assert.equal(summary(m).text, '6-0 6-0');
});

test('statistics: serve, return, winners and errors go to the right player', () => {
  // Player serves the first game (p serves points 1-6), opponent serves game 2.
  const g1 = [
    pt('p', { end: 'ace', shot: 'serve' }), // 15-0 ace
    pt('o', { serve: 2, end: 'doubleFault', shot: 'serve' }), // 15-15 DF
    pt('p', { end: 'winner', wing: 'fh', shot: 'drive', rally: 'mid' }), // 30-15 FH winner on 1st
    pt('o', { serve: 2, end: 'unforcedError', wing: 'bh', shot: 'drive', rally: 'long' }), // 30-30 player BH UE on 2nd
    pt('p', { end: 'returnError', wing: 'bh', shot: 'drive' }), // 40-30 opponent return error
    pt('p', { serve: 2, end: 'forcedError', wing: 'fh', shot: 'drive', net: true }), // game, at net
  ];
  const g2 = [
    pt('p', { end: 'returnWinner', wing: 'fh', shot: 'drive' }), // player return winner
    pt('o', { end: 'ace', shot: 'serve' }),
    pt('o', { end: 'serviceWinner', shot: 'serve' }),
    pt('o', { end: 'winner', wing: 'fh', shot: 'drive' }),
    pt('o', { serve: 2, end: 'other' }),
  ];
  const st = matchStats(mkMatch([...g1, ...g2]));
  assert.equal(st.points, 11);
  assert.equal(st.p.servicePoints, 6);
  assert.equal(st.p.firstIn, 3);
  assert.equal(st.p.firstWon, 3);
  assert.equal(st.p.secondPlayed, 3);
  assert.equal(st.p.secondWon, 1);
  assert.equal(st.p.aces, 1);
  assert.equal(st.p.doubleFaults, 1);
  assert.equal(st.p.unforcedErrors, 1);
  assert.equal(st.p.winners, 2, 'FH winner + return winner');
  assert.equal(st.p.returnWinners, 1);
  assert.equal(st.o.returnErrors, 1);
  assert.equal(st.o.forcedErrors, 1);
  assert.equal(st.o.aces, 1);
  assert.equal(st.o.serviceWinners, 1);
  assert.equal(st.o.winners, 1);
  assert.equal(st.p.serviceGames, 1);
  assert.equal(st.p.serviceGamesWon, 1);
  assert.equal(st.o.serviceGames, 1);
  assert.equal(st.o.serviceGamesWon, 1);
  assert.equal(st.p.returnPoints, 5);
  assert.equal(st.p.returnWon, 1);
  assert.equal(st.net.played, 1);
  assert.equal(st.net.won, 1);
  assert.equal(st.strokes.p['fh:drive'].winners, 1);
  assert.equal(st.strokes.p['rfh:drive'].winners, 1, 'return winner kept apart from rally forehands');
  assert.equal(st.strokes.p['bh:drive'].unforced, 1);
  assert.equal(st.strokes.o['fh:drive'].forced, 1);
  assert.equal(st.strokes.o['fh:drive'].winners, 1);
  assert.equal(st.returns.p.fh.winners, 1);
  assert.equal(st.returns.o.bh.errors, 1);
  assert.equal(st.rally.mid.won, 1);
  assert.equal(st.rally.long.played, 1);
  assert.equal(st.rally.short.played, 6, 'serve/return endings count as short rallies');
  assert.equal(Math.round(metricValue('firstServeIn', st)!), 50);
  assert.equal(metricValue('doubleFaults', st), 1);
  assert.deepEqual(st.momentum.slice(0, 4), [1, 0, 1, 0]);
});

test('break points faced and saved', () => {
  const g = [pt('o'), pt('o'), pt('o'), pt('p'), pt('p'), pt('p'), pt('p'), pt('p')]; // 0-40 then hold
  const st = matchStats(mkMatch(g));
  assert.equal(st.p.bpFaced, 3);
  assert.equal(st.p.bpSaved, 3);
  assert.equal(st.o.bpChances, 3);
  assert.equal(st.o.bpConverted, 0);
  assert.equal(metricValue('breakPointsSaved', st), 100);
});

test('final score only: winner from the sets, tie-break notation', () => {
  const m = mkMatch([], BO3, 'p', { mode: 'score', sets: [{ p: 7, o: 6, tb: 5 }, { p: 3, o: 6, tb: null }, { p: 6, o: 4, tb: null }], status: 'done' });
  const s = summary(m);
  assert.equal(s.winner, 'p');
  assert.equal(s.text, '7-6(5) 3-6 6-4');
  const j = mkMatch([], JUNIOR, 'p', { mode: 'score', sets: [{ p: 6, o: 3, tb: null }, { p: 4, o: 6, tb: null }, { p: 7, o: 10, tb: null }], status: 'done' });
  assert.equal(summary(j).winner, 'o');
  assert.equal(summary(j).text, '6-3 4-6 [7-10]');
});

test('tournament: furthest round, eliminated result goal, stat and training goals', () => {
  const t = makeTournament({ id: 't1', playerId: 'pl', name: 'Open', start: '2026-05-01', end: '2026-05-03' });
  const winSet = Array.from({ length: 6 }, () => game('p')).flat();
  const won = mkMatch([...winSet, ...winSet], BO3, 'p', { id: 'a', tournamentId: 't1', round: 'R32', kind: 'official' });
  const lost = mkMatch([], BO3, 'p', { id: 'b', tournamentId: 't1', round: 'R16', kind: 'official', mode: 'score', sets: [{ p: 2, o: 6, tb: null }, { p: 3, o: 6, tb: null }], status: 'done' });
  assert.equal(furthestRound(t, [won]), 'R16', 'winning R32 reaches R16');
  assert.equal(furthestRound(t, [won, lost]), 'R16');
  const ctx = { tournament: t, matches: [won, lost], stats: matchStats(won), logs: [] as Log[], today: '2026-05-02' };
  assert.equal(evaluateGoal({ id: 'g', kind: 'outcome', round: 'R16' }, ctx).status, 'met');
  assert.equal(evaluateGoal({ id: 'g', kind: 'outcome', round: 'QF' }, ctx).status, 'missed', 'eliminated in R16');
  // won: 48 points, player served every other game, every point won on the first serve
  assert.equal(evaluateGoal({ id: 'g', kind: 'stat', metric: 'firstServeIn', op: 'gte', value: 60 }, ctx).status, 'met');
  assert.equal(evaluateGoal({ id: 'g', kind: 'stat', metric: 'doubleFaults', op: 'lte', value: 0 }, ctx).status, 'met');
  const log = (date: string, d: number, s: number): Log => ({ id: date + d, playerId: 'pl', drillId: 'fh-006', sessionId: null, date, context: 'practice', eligible: 10, attempts: 10, correctDecisions: d, successful: s, errors: {}, notes: '', createdAt: date } as unknown as Log);
  const drill = evaluateGoal({ id: 'g', kind: 'drill', drillId: 'fh-006', target: 60 }, { ...ctx, logs: [log('2026-04-20', 10, 5), log('2026-01-01', 10, 10)] });
  assert.equal(drill.logs, 1, 'only logs inside the six-week preparation window');
  assert.equal(Math.round(drill.actual!), 50);
  assert.equal(drill.status, 'pending');
  assert.equal(evaluateGoal({ id: 'g', kind: 'custom', text: 'Routine', achieved: true }, ctx).status, 'met');
});

test('demo data: charted matches are finished wins with full statistics', () => {
  const s = createDemoState('2026-06-15');
  const charted = s.matches.filter((m) => m.mode === 'live');
  assert.equal(charted.length, 2);
  for (const m of charted) {
    assert.ok(MatchSchema.safeParse(m).success);
    assert.equal(summary(m).winner, 'p');
    assert.ok(matchStats(m).points > 60);
  }
  const past = s.tournaments.find((t) => t.id === 'tour-demo-past')!;
  const ev = evaluateTournament(s, past, '2026-06-15');
  assert.equal(ev.reached, 'R16');
  assert.deepEqual(ev.record, { won: 1, lost: 1 });
});

test('every generated label key exists in English and Persian', async () => {
  const { DICT_EN, DICT_FA } = await import('../src/lib/i18n');
  const { ROUNDS, SURFACES, SHOT_TYPES, WINGS, SERVE_DIRS, COURT_SIDES, RALLY, POINT_END, GOAL_METRICS } = await import('../src/types');
  const keys = [
    ...ROUNDS.map((r) => `round_${r}`),
    ...SURFACES.map((s) => `surface_${s}`),
    ...SHOT_TYPES.map((s) => `shot_${s}`),
    ...WINGS.flatMap((w) => [`wing_${w}`, `wingShort_${w}`]),
    ...SERVE_DIRS.map((d) => `dir_${d}`),
    ...COURT_SIDES.flatMap((c) => [`court_${c}`, `courtShort_${c}`]),
    ...RALLY.map((r) => `rally_${r}`),
    ...POINT_END.map((e) => `end_${e}`),
    ...GOAL_METRICS.map((m) => `metric_${m}`),
    ...['met', 'missed', 'pending', 'info'].map((s) => `goalStatus_${s}`),
    ...['junior', 'bo3', 'oneSet', 'short', 'bo5'].map((k) => `preset_${k}`),
    ...['result', 'training', 'both'].flatMap((a) => [`aim_${a}`, `aimHelp_${a}`]),
    ...['outcome', 'stat', 'drill', 'custom'].map((k) => `goal_${k}`),
    'tab_matches',
    'tab_tournaments',
  ];
  for (const k of keys) {
    assert.ok(k in DICT_EN, `missing English ${k}`);
    assert.ok((DICT_FA as Record<string, string>)[k], `missing Persian ${k}`);
  }
});
