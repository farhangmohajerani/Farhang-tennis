/**
 * Tennis match engine: compact point codes, scoring (advantage / no-ad, tie-breaks, 10-point
 * match tie-break, short sets, serve rotation) and match statistics in the categories used for
 * official ATP/WTA match stats, plus rally length (0–4 / 5–8 / 9+ shots) and stroke breakdown.
 *
 * The score is never stored: it is replayed from the point list, so undoing or deleting a point,
 * or correcting who served first, always gives a consistent score and consistent statistics.
 */
import type { GoalMetric, Match, MatchFormat, PointEnd, Rally, SetScore, Shot } from '../types';
import { RALLY, SHOTS } from '../types';

export type Side = 'p' | 'o';
export const other = (s: Side): Side => (s === 'p' ? 'o' : 'p');

export interface Point {
  win: Side;
  /** 1 = decided on the first serve; 2 = after a first-serve fault (includes double faults). */
  serve: 1 | 2;
  end: PointEnd;
  shot: Shot | null;
  rally: Rally | null;
  /** The charted player came to the net during the point. */
  net: boolean;
}

/* ---------- compact codes ---------- */

const END_CODE: Record<PointEnd, string> = {
  ace: 'A',
  serviceWinner: 'S',
  doubleFault: 'D',
  returnWinner: 'R',
  returnError: 'E',
  winner: 'W',
  forcedError: 'F',
  unforcedError: 'U',
  other: 'X',
};
const SHOT_CODE: Record<Shot, string> = { fh: 'f', bh: 'b', volley: 'v', overhead: 'o', drop: 'd', lob: 'l', serve: 's' };
const RALLY_CODE: Record<Rally, string> = { short: 's', mid: 'm', long: 'l' };
function invert<K extends string>(m: Record<K, string>): Record<string, K> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;
}
const END_OF = invert(END_CODE);
const SHOT_OF = invert(SHOT_CODE);
const RALLY_OF = invert(RALLY_CODE);

export function encodePoint(p: Point): string {
  return `${p.win}${p.serve}${END_CODE[p.end]}${p.shot ? SHOT_CODE[p.shot] : '-'}${p.rally ? RALLY_CODE[p.rally] : '-'}${p.net ? 'n' : '-'}`;
}

export function decodePoint(code: string): Point {
  return {
    win: code[0] === 'o' ? 'o' : 'p',
    serve: code[1] === '2' ? 2 : 1,
    end: END_OF[code[2]] ?? 'other',
    shot: SHOT_OF[code[3]] ?? null,
    rally: RALLY_OF[code[4]] ?? null,
    net: code[5] === 'n',
  };
}

/** Points that end on the serve or the return are 0–4 shot rallies by definition. */
export function rallyOf(p: Point): Rally | null {
  if (p.rally) return p.rally;
  return p.end === 'ace' || p.end === 'serviceWinner' || p.end === 'doubleFault' || p.end === 'returnWinner' || p.end === 'returnError' ? 'short' : null;
}

/** Who hit the shot that ended the point (null when not recorded). */
export function hitterOf(p: Point, server: Side): Side | null {
  switch (p.end) {
    case 'ace':
    case 'serviceWinner':
    case 'doubleFault':
      return server;
    case 'returnWinner':
    case 'returnError':
      return other(server);
    case 'winner':
      return p.win;
    case 'forcedError':
    case 'unforcedError':
      return other(p.win);
    default:
      return null;
  }
}

/** Ending a point on a winning shot (vs an error). */
export const isWinnerEnd = (e: PointEnd) => e === 'winner' || e === 'returnWinner' || e === 'ace' || e === 'serviceWinner';
export const isErrorEnd = (e: PointEnd) => e === 'forcedError' || e === 'unforcedError' || e === 'returnError' || e === 'doubleFault';

/* ---------- scoring engine ---------- */

export interface LiveSet {
  /** Games (for a match tie-break: 1 for the winner once finished). */
  p: number;
  o: number;
  /** Tie-break points, once a tie-break in this set has finished. */
  tb: { p: number; o: number } | null;
  /** This set is a 10-point match tie-break. */
  mtb: boolean;
  winner: Side | null;
}

export interface Engine {
  format: MatchFormat;
  sets: LiveSet[];
  /** Points in the current game or tie-break. */
  game: { p: number; o: number };
  /** Server of the current game (in a tie-break: the player who served its first point). */
  gameServer: Side;
  tb: { first: Side; target: number } | null;
  setsWon: { p: number; o: number };
  winner: Side | null;
}

const isMtbSet = (f: MatchFormat, setIndex: number) => f.finalSet === 'mtb' && f.sets > 1 && setIndex === f.sets - 1;

export function newEngine(format: MatchFormat, firstServer: Side): Engine {
  const mtb = isMtbSet(format, 0);
  return {
    format,
    sets: [{ p: 0, o: 0, tb: null, mtb, winner: null }],
    game: { p: 0, o: 0 },
    gameServer: firstServer,
    tb: mtb ? { first: firstServer, target: 10 } : null,
    setsWon: { p: 0, o: 0 },
    winner: null,
  };
}

export function cloneEngine(e: Engine): Engine {
  return {
    ...e,
    sets: e.sets.map((s) => ({ ...s, tb: s.tb ? { ...s.tb } : null })),
    game: { ...e.game },
    tb: e.tb ? { ...e.tb } : null,
    setsWon: { ...e.setsWon },
  };
}

/** Who serves the next point. In a tie-break: first point A, then B B, A A, … */
export function serverOf(e: Engine): Side {
  if (!e.tb) return e.gameServer;
  const k = e.game.p + e.game.o;
  if (k === 0) return e.tb.first;
  return Math.floor((k - 1) / 2) % 2 === 0 ? other(e.tb.first) : e.tb.first;
}

function gameWon(e: Engine, g: { p: number; o: number }, w: Side): boolean {
  const l = other(w);
  if (e.tb) return g[w] >= e.tb.target && g[w] - g[l] >= 2;
  return e.format.noAd ? g[w] >= 4 : g[w] >= 4 && g[w] - g[l] >= 2;
}

export interface PointResult {
  gameWinner: Side | null;
  setWinner: Side | null;
  matchWinner: Side | null;
}

/** Add one point won by `w` (mutates the engine). Points after the match is over are ignored. */
export function applyPoint(e: Engine, w: Side): PointResult {
  const none: PointResult = { gameWinner: null, setWinner: null, matchWinner: null };
  if (e.winner) return none;
  e.game[w]++;
  if (!gameWon(e, e.game, w)) return none;
  const cur = e.sets[e.sets.length - 1];
  if (e.tb) {
    // Tie-break (or match tie-break) won: it counts as the set's last game.
    cur.tb = { ...e.game };
    if (cur.mtb) cur[w] = 1;
    else cur[w]++;
    // The player who served first in the tie-break receives first in the next set.
    e.gameServer = other(e.tb.first);
    e.tb = null;
    e.game = { p: 0, o: 0 };
    return finishSet(e, w);
  }
  cur[w]++;
  e.game = { p: 0, o: 0 };
  e.gameServer = other(e.gameServer);
  const g = e.format.games;
  if (cur[w] >= g && cur[w] - cur[other(w)] >= 2) return finishSet(e, w);
  if (cur.p === g && cur.o === g) e.tb = { first: e.gameServer, target: 7 };
  return { gameWinner: w, setWinner: null, matchWinner: null };
}

function finishSet(e: Engine, w: Side): PointResult {
  e.sets[e.sets.length - 1].winner = w;
  e.setsWon[w]++;
  if (e.setsWon[w] >= Math.ceil(e.format.sets / 2)) {
    e.winner = w;
    return { gameWinner: w, setWinner: w, matchWinner: w };
  }
  const mtb = isMtbSet(e.format, e.sets.length);
  e.sets.push({ p: 0, o: 0, tb: null, mtb, winner: null });
  if (mtb) e.tb = { first: e.gameServer, target: 10 };
  return { gameWinner: w, setWinner: w, matchWinner: null };
}

/** What winning the next point would mean for `side`. */
export function peek(e: Engine, side: Side): { game: boolean; set: boolean; match: boolean } {
  if (e.winner) return { game: false, set: false, match: false };
  const c = cloneEngine(e);
  const r = applyPoint(c, side);
  return { game: r.gameWinner === side, set: r.setWinner === side, match: r.matchWinner === side };
}

/** Break point: the receiver would win a regular (non-tie-break) game with the next point. */
export function isBreakPoint(e: Engine): boolean {
  if (e.tb || e.winner) return false;
  return peek(e, other(serverOf(e))).game;
}

/* ---------- replay ---------- */

export interface PointCtx {
  index: number;
  point: Point;
  server: Side;
  setIndex: number;
  /** Games in the set before this point. */
  games: { p: number; o: number };
  /** Points in the game (or tie-break) before this point. */
  game: { p: number; o: number };
  tiebreak: boolean;
  breakPoint: boolean;
  gameWinner: Side | null;
  setWinner: Side | null;
}

export interface Replay {
  engine: Engine;
  points: Point[];
  ctx: PointCtx[];
}

export function replay(m: Pick<Match, 'format' | 'firstServer' | 'points'>): Replay {
  const e = newEngine(m.format, m.firstServer);
  const points = m.points.map(decodePoint);
  const ctx: PointCtx[] = [];
  for (let i = 0; i < points.length && !e.winner; i++) {
    const cur = e.sets[e.sets.length - 1];
    const c: PointCtx = {
      index: i,
      point: points[i],
      server: serverOf(e),
      setIndex: e.sets.length - 1,
      games: { p: cur.p, o: cur.o },
      game: { ...e.game },
      tiebreak: !!e.tb,
      breakPoint: isBreakPoint(e),
      gameWinner: null,
      setWinner: null,
    };
    const r = applyPoint(e, points[i].win);
    c.gameWinner = r.gameWinner;
    c.setWinner = r.setWinner;
    ctx.push(c);
  }
  return { engine: e, points: points.slice(0, ctx.length), ctx };
}

/* ---------- labels ---------- */

const CALL = ['0', '15', '30', '40'];

/** Current game score as called on court, from each side ("40" / "AD" / tie-break numbers). */
export function gameLabel(e: Engine): { p: string; o: string; deuce: boolean } {
  const { p, o } = e.game;
  if (e.tb) return { p: String(p), o: String(o), deuce: false };
  if (p >= 3 && o >= 3) {
    if (p === o) return { p: '40', o: '40', deuce: true };
    return p > o ? { p: 'AD', o: '40', deuce: false } : { p: '40', o: 'AD', deuce: false };
  }
  return { p: CALL[p] ?? String(p), o: CALL[o] ?? String(o), deuce: false };
}

/** A set for display, from the player's side. Match tie-break sets carry the points in p/o. */
export interface DisplaySet {
  p: number;
  o: number;
  /** Tie-break points of the set's loser: 7-6(5). */
  tb: number | null;
  mtb: boolean;
  done: boolean;
}

function toDisplay(s: LiveSet, e: Engine | null, current: boolean): DisplaySet {
  if (s.mtb) {
    const pts = s.tb ?? (current && e ? e.game : { p: 0, o: 0 });
    return { p: pts.p, o: pts.o, tb: null, mtb: true, done: !!s.winner };
  }
  return { p: s.p, o: s.o, tb: s.tb ? Math.min(s.tb.p, s.tb.o) : null, mtb: false, done: !!s.winner };
}

/** Columns for a live scoreboard: finished sets plus the current set (a match tie-break in progress shows in the points column). */
export function scoreboardSets(e: Engine): DisplaySet[] {
  return e.sets.map((s, i) => toDisplay(s, e, i === e.sets.length - 1)).filter((s, i, all) => s.done || (i === all.length - 1 && !s.mtb));
}

/** Sets so far: finished sets, plus the set in progress when it has started. */
export function engineSets(e: Engine): DisplaySet[] {
  return e.sets
    .map((s, i) => toDisplay(s, e, i === e.sets.length - 1))
    .filter((s, i, all) => s.done || (i === all.length - 1 && (s.p > 0 || s.o > 0 || e.game.p > 0 || e.game.o > 0)));
}

export function setsText(sets: DisplaySet[]): string {
  return sets.map((s) => (s.mtb ? `[${s.p}-${s.o}]` : `${s.p}-${s.o}${s.tb !== null ? `(${s.tb})` : ''}`)).join(' ');
}

/* ---------- match summary ---------- */

export interface MatchSummary {
  sets: DisplaySet[];
  winner: Side | null;
  text: string;
  /** Present for charted matches. */
  replay: Replay | null;
}

export function summary(m: Match): MatchSummary {
  if (m.mode === 'live') {
    const r = replay(m);
    const sets = engineSets(r.engine);
    const winner = r.engine.winner ?? (m.status === 'done' ? m.winner : null);
    return { sets, winner, text: setsText(sets), replay: r };
  }
  const sets: DisplaySet[] = m.sets.map((s: SetScore, i) => ({ p: s.p, o: s.o, tb: s.tb, mtb: isMtbSet(m.format, i) && m.sets.length === m.format.sets, done: true }));
  return { sets, winner: m.winner ?? winnerFromSets(m.sets, m.format), text: setsText(sets), replay: null };
}

/** Winner implied by entered set scores (null when the score is not a finished match). */
export function winnerFromSets(sets: SetScore[], format: MatchFormat): Side | null {
  const need = Math.ceil(format.sets / 2);
  let p = 0;
  let o = 0;
  for (const s of sets) {
    if (s.p > s.o) p++;
    else if (s.o > s.p) o++;
  }
  return p >= need && p > o ? 'p' : o >= need && o > p ? 'o' : null;
}

/* ---------- statistics ---------- */

export interface SideStats {
  pointsWon: number;
  servicePoints: number;
  firstIn: number;
  firstWon: number;
  secondPlayed: number;
  secondWon: number;
  aces: number;
  doubleFaults: number;
  serviceWinners: number;
  returnPoints: number;
  returnWon: number;
  returnFirstPlayed: number;
  returnFirstWon: number;
  returnSecondPlayed: number;
  returnSecondWon: number;
  /** Winners in play, including return winners (aces and service winners are counted separately). */
  winners: number;
  returnWinners: number;
  unforcedErrors: number;
  forcedErrors: number;
  returnErrors: number;
  bpFaced: number;
  bpSaved: number;
  bpChances: number;
  bpConverted: number;
  serviceGames: number;
  serviceGamesWon: number;
  returnGames: number;
  returnGamesWon: number;
}

export interface MatchStats {
  /** Charted matches included. */
  matches: number;
  points: number;
  p: SideStats;
  o: SideStats;
  /** Points where the charted player came to the net. */
  net: { played: number; won: number };
  /** Points by rally length, won by the charted player. */
  rally: Record<Rally, { played: number; won: number }>;
  /** The charted player's point-ending shots by stroke. */
  strokes: Record<Shot, { winners: number; errors: number }>;
  /** Running (player points − opponent points) after each point; single matches only. */
  momentum: number[];
  /** Point indexes that ended a set; single matches only. */
  setEnds: number[];
}

const SIDE_KEYS: (keyof SideStats)[] = [
  'pointsWon', 'servicePoints', 'firstIn', 'firstWon', 'secondPlayed', 'secondWon', 'aces', 'doubleFaults', 'serviceWinners',
  'returnPoints', 'returnWon', 'returnFirstPlayed', 'returnFirstWon', 'returnSecondPlayed', 'returnSecondWon', 'winners', 'returnWinners',
  'unforcedErrors', 'forcedErrors', 'returnErrors', 'bpFaced', 'bpSaved', 'bpChances', 'bpConverted', 'serviceGames', 'serviceGamesWon',
  'returnGames', 'returnGamesWon',
];
const emptySide = (): SideStats => Object.fromEntries(SIDE_KEYS.map((k) => [k, 0])) as unknown as SideStats;

export function emptyStats(): MatchStats {
  return {
    matches: 0,
    points: 0,
    p: emptySide(),
    o: emptySide(),
    net: { played: 0, won: 0 },
    rally: Object.fromEntries(RALLY.map((r) => [r, { played: 0, won: 0 }])) as MatchStats['rally'],
    strokes: Object.fromEntries(SHOTS.map((s) => [s, { winners: 0, errors: 0 }])) as MatchStats['strokes'],
    momentum: [],
    setEnds: [],
  };
}

export function statsFromReplay(r: Replay): MatchStats {
  const st = emptyStats();
  st.matches = r.ctx.length ? 1 : 0;
  let diff = 0;
  for (const c of r.ctx) {
    const pt = c.point;
    const s = c.server;
    const rcv = other(s);
    const S = st[s];
    const R = st[rcv];
    st.points++;
    st[pt.win].pointsWon++;
    S.servicePoints++;
    R.returnPoints++;
    if (pt.win === rcv) R.returnWon++;
    if (pt.serve === 1) {
      S.firstIn++;
      R.returnFirstPlayed++;
      if (pt.win === s) S.firstWon++;
      else R.returnFirstWon++;
    } else {
      S.secondPlayed++;
      R.returnSecondPlayed++;
      if (pt.win === s) S.secondWon++;
      else R.returnSecondWon++;
    }
    switch (pt.end) {
      case 'ace':
        S.aces++;
        break;
      case 'serviceWinner':
        S.serviceWinners++;
        break;
      case 'doubleFault':
        S.doubleFaults++;
        break;
      case 'returnWinner':
        R.returnWinners++;
        R.winners++;
        break;
      case 'returnError':
        R.returnErrors++;
        break;
      case 'winner':
        st[pt.win].winners++;
        break;
      case 'forcedError':
        st[other(pt.win)].forcedErrors++;
        break;
      case 'unforcedError':
        st[other(pt.win)].unforcedErrors++;
        break;
      default:
        break;
    }
    if (c.breakPoint) {
      S.bpFaced++;
      R.bpChances++;
      if (pt.win === s) S.bpSaved++;
      else R.bpConverted++;
    }
    if (c.gameWinner && !c.tiebreak) {
      S.serviceGames++;
      R.returnGames++;
      if (c.gameWinner === s) S.serviceGamesWon++;
      else R.returnGamesWon++;
    }
    if (pt.net) {
      st.net.played++;
      if (pt.win === 'p') st.net.won++;
    }
    const rl = rallyOf(pt);
    if (rl) {
      st.rally[rl].played++;
      if (pt.win === 'p') st.rally[rl].won++;
    }
    if (pt.shot && hitterOf(pt, s) === 'p') {
      if (isWinnerEnd(pt.end)) st.strokes[pt.shot].winners++;
      else if (isErrorEnd(pt.end)) st.strokes[pt.shot].errors++;
    }
    diff += pt.win === 'p' ? 1 : -1;
    st.momentum.push(diff);
    if (c.setWinner) st.setEnds.push(c.index);
  }
  return st;
}

export function matchStats(m: Match): MatchStats {
  return m.mode === 'live' ? statsFromReplay(replay(m)) : emptyStats();
}

/** Sum several matches (per-match averages divide by `matches`). */
export function sumStats(list: MatchStats[]): MatchStats {
  const out = emptyStats();
  for (const st of list) {
    out.matches += st.matches;
    out.points += st.points;
    for (const side of ['p', 'o'] as const) for (const k of SIDE_KEYS) out[side][k] += st[side][k];
    out.net.played += st.net.played;
    out.net.won += st.net.won;
    for (const r of RALLY) {
      out.rally[r].played += st.rally[r].played;
      out.rally[r].won += st.rally[r].won;
    }
    for (const s of SHOTS) {
      out.strokes[s].winners += st.strokes[s].winners;
      out.strokes[s].errors += st.strokes[s].errors;
    }
  }
  return out;
}

/* ---------- goal metrics ---------- */

export const METRIC_META: Record<GoalMetric, { unit: 'pct' | 'perMatch'; op: 'gte' | 'lte'; value: number }> = {
  firstServeIn: { unit: 'pct', op: 'gte', value: 60 },
  firstServeWon: { unit: 'pct', op: 'gte', value: 60 },
  secondServeWon: { unit: 'pct', op: 'gte', value: 45 },
  doubleFaults: { unit: 'perMatch', op: 'lte', value: 3 },
  aces: { unit: 'perMatch', op: 'gte', value: 2 },
  unforcedErrors: { unit: 'perMatch', op: 'lte', value: 15 },
  winners: { unit: 'perMatch', op: 'gte', value: 10 },
  returnPointsWon: { unit: 'pct', op: 'gte', value: 40 },
  breakPointsSaved: { unit: 'pct', op: 'gte', value: 50 },
  breakPointsConverted: { unit: 'pct', op: 'gte', value: 40 },
  netPointsWon: { unit: 'pct', op: 'gte', value: 60 },
  shortRallyWon: { unit: 'pct', op: 'gte', value: 50 },
  totalPointsWon: { unit: 'pct', op: 'gte', value: 50 },
};

const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

/** The player's value for a goal metric: a percentage (0–100) or a per-match average; null without data. */
export function metricValue(metric: GoalMetric, st: MatchStats): number | null {
  const P = st.p;
  const per = (n: number) => (st.matches > 0 ? n / st.matches : null);
  switch (metric) {
    case 'firstServeIn':
      return pctOf(P.firstIn, P.servicePoints);
    case 'firstServeWon':
      return pctOf(P.firstWon, P.firstIn);
    case 'secondServeWon':
      return pctOf(P.secondWon, P.secondPlayed);
    case 'doubleFaults':
      return per(P.doubleFaults);
    case 'aces':
      return per(P.aces);
    case 'unforcedErrors':
      return per(P.unforcedErrors);
    case 'winners':
      return per(P.winners);
    case 'returnPointsWon':
      return pctOf(P.returnWon, P.returnPoints);
    case 'breakPointsSaved':
      return pctOf(P.bpSaved, P.bpFaced);
    case 'breakPointsConverted':
      return pctOf(P.bpConverted, P.bpChances);
    case 'netPointsWon':
      return pctOf(st.net.won, st.net.played);
    case 'shortRallyWon':
      return pctOf(st.rally.short.won, st.rally.short.played);
    case 'totalPointsWon':
      return pctOf(P.pointsWon, st.points);
    default:
      return null;
  }
}

export function meetsTarget(value: number, op: 'gte' | 'lte', target: number): boolean {
  // Compare rounded to one decimal so 59.96 % shows as 60 % and counts as meeting "≥ 60 %".
  const v = Math.round(value * 10) / 10;
  return op === 'gte' ? v >= target : v <= target;
}

/* ---------- formats ---------- */

export const FORMAT_PRESETS: { key: 'junior' | 'bo3' | 'oneSet' | 'short' | 'bo5'; format: MatchFormat }[] = [
  { key: 'junior', format: { sets: 3, games: 6, finalSet: 'mtb', noAd: false } },
  { key: 'bo3', format: { sets: 3, games: 6, finalSet: 'full', noAd: false } },
  { key: 'oneSet', format: { sets: 1, games: 6, finalSet: 'full', noAd: false } },
  { key: 'short', format: { sets: 3, games: 4, finalSet: 'mtb', noAd: true } },
  { key: 'bo5', format: { sets: 5, games: 6, finalSet: 'full', noAd: false } },
];
