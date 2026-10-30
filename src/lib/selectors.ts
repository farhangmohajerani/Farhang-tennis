import type { AppState, Log } from '../types';
import { computeKpis, sumLogs, transfer, type KpiSet, type Totals } from './kpi';

export function playerLogs(state: AppState, playerId: string): Log[] {
  return state.logs.filter((l) => l.playerId === playerId).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export interface Stats {
  totals: Totals;
  kpis: KpiSet;
}

export function stats(logs: Log[]): Stats {
  const totals = sumLogs(logs);
  return { totals, kpis: computeKpis(totals) };
}

/**
 * Baseline = all baseline-context logs on the earliest baseline date.
 * Current  = the most recent (up to 3) non-match logs after that date, including re-test baselines.
 */
export function baselineVsCurrent(logs: Log[], drillId: string): { baseline: Stats | null; current: Stats | null; baselineDate?: string } {
  const ofDrill = logs.filter((l) => l.drillId === drillId);
  const base = ofDrill.filter((l) => l.context === 'baseline');
  if (!base.length) return { baseline: null, current: ofDrill.length ? stats(ofDrill.filter((l) => l.context !== 'match').slice(-3)) : null };
  const baseDate = base.map((l) => l.date).sort()[0];
  const baseLogs = base.filter((l) => l.date === baseDate);
  const after = ofDrill.filter((l) => l.context !== 'match' && !baseLogs.includes(l) && l.date >= baseDate).slice(-3);
  return { baseline: stats(baseLogs), current: after.length ? stats(after) : null, baselineDate: baseDate };
}

export function transferFor(logs: Log[], drillId?: string) {
  const sel = drillId ? logs.filter((l) => l.drillId === drillId) : logs;
  const practice = stats(sel.filter((l) => l.context === 'practice'));
  const match = stats(sel.filter((l) => l.context === 'match'));
  return {
    practice,
    match,
    decision: transfer(match.kpis.decision, practice.kpis.decision),
    execution: transfer(match.kpis.execution, practice.kpis.execution),
  };
}
