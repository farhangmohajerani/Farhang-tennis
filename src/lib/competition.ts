/** Tournaments: matches by round, furthest stage reached, and goal evaluation. */
import { ROUNDS, TournamentSchema, type AppState, type Goal, type Log, type Match, type Round, type Tournament } from '../types';
import { matchStats, meetsTarget, metricValue, summary, sumStats, type MatchStats } from './match';
import { stats } from './selectors';
import { addDays } from './schedule';

/** A tournament with defaults for everything not given. */
export function makeTournament(t: Pick<Tournament, 'id' | 'playerId' | 'name' | 'start' | 'end'> & Partial<Tournament>): Tournament {
  return TournamentSchema.parse(t);
}

export const roundIndex = (r: Round | null | undefined) => (r ? ROUNDS.indexOf(r) : -1);

/** The stage a player reaches by winning a match in round `r`. */
export function nextRound(r: Round): Round {
  if (r === 'Q' || r === 'RR' || r === 'W') return r;
  return ROUNDS[ROUNDS.indexOf(r) + 1];
}

export function matchesOfPlayer(state: AppState, playerId: string): Match[] {
  return state.matches
    .filter((m) => m.playerId === playerId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function tournamentMatches(state: AppState, tournamentId: string): Match[] {
  return state.matches
    .filter((m) => m.tournamentId === tournamentId)
    .sort((a, b) => roundIndex(a.round) - roundIndex(b.round) || a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** Furthest stage reached: the latest round played, one further for a win; never below the manual result. */
export function furthestRound(t: Tournament, matches: Match[]): Round | null {
  let best = roundIndex(t.result);
  for (const m of matches) {
    if (!m.round) continue;
    const w = summary(m).winner;
    const reached = w === 'p' ? nextRound(m.round) : m.round;
    best = Math.max(best, roundIndex(reached));
  }
  return best >= 0 ? ROUNDS[best] : null;
}

/** Lost a knockout match (round-robin losses do not eliminate). */
export function eliminated(matches: Match[]): boolean {
  return matches.some((m) => m.round !== 'RR' && summary(m).winner === 'o');
}

export type TournamentPhase = 'upcoming' | 'live' | 'done';
export function phaseOf(t: Tournament, today: string): TournamentPhase {
  return today < t.start ? 'upcoming' : today > t.end ? 'done' : 'live';
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Charted statistics over the given matches. */
export function chartedStats(matches: Match[]): MatchStats {
  return sumStats(matches.filter((m) => m.mode === 'live' && m.points.length).map(matchStats));
}

/** Preparation window for training-focus goals: six weeks before the start until the end. */
export const PREP_DAYS = 42;

export type GoalStatus = 'met' | 'missed' | 'pending' | 'info';
export interface GoalEval {
  status: GoalStatus;
  /** Percentage, per-match value or round index, depending on the goal. */
  actual: number | null;
  /** Practice logs counted (training-focus goals). */
  logs?: number;
  reached?: Round | null;
}

export function evaluateGoal(goal: Goal, ctx: { tournament: Tournament; matches: Match[]; stats: MatchStats; logs: Log[]; today: string }): GoalEval {
  const { tournament: t, matches, today } = ctx;
  const finished = today > t.end;
  switch (goal.kind) {
    case 'outcome': {
      const reached = furthestRound(t, matches);
      const met = roundIndex(reached) >= roundIndex(goal.round);
      if (met) return { status: 'met', actual: roundIndex(reached), reached };
      return { status: finished || eliminated(matches) ? 'missed' : 'pending', actual: roundIndex(reached), reached };
    }
    case 'stat': {
      const v = metricValue(goal.metric, ctx.stats);
      if (v === null) return { status: 'pending', actual: null };
      if (meetsTarget(v, goal.op, goal.value)) return { status: 'met', actual: v };
      return { status: finished ? 'missed' : 'pending', actual: v };
    }
    case 'drill': {
      const from = addDays(t.start, -PREP_DAYS);
      const logs = ctx.logs.filter((l) => l.drillId === goal.drillId && l.playerId === t.playerId && l.date >= from && l.date <= t.end);
      const k = stats(logs).kpis.execution;
      const v = k.ok ? k.value * 100 : null;
      if (!logs.length || v === null) return { status: goal.target === null ? 'info' : finished ? 'missed' : 'pending', actual: null, logs: logs.length };
      if (goal.target === null) return { status: 'info', actual: v, logs: logs.length };
      if (meetsTarget(v, 'gte', goal.target)) return { status: 'met', actual: v, logs: logs.length };
      return { status: finished ? 'missed' : 'pending', actual: v, logs: logs.length };
    }
    case 'custom':
      return { status: goal.achieved === true ? 'met' : goal.achieved === false ? 'missed' : 'pending', actual: null };
    default:
      return { status: 'pending', actual: null };
  }
}

export function evaluateTournament(state: AppState, t: Tournament, today: string) {
  const matches = tournamentMatches(state, t.id);
  const st = chartedStats(matches);
  const evals = t.goals.map((g) => ({ goal: g, ev: evaluateGoal(g, { tournament: t, matches, stats: st, logs: state.logs, today }) }));
  const record = matches.reduce(
    (acc, m) => {
      const w = summary(m).winner;
      if (w === 'p') acc.won++;
      else if (w === 'o') acc.lost++;
      return acc;
    },
    { won: 0, lost: 0 },
  );
  return { matches, stats: st, evals, reached: furthestRound(t, matches), record };
}
