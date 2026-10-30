import type { KpiKey, Log, StarLevels, Thresholds } from '../types';

/** A ratio with an explicit "insufficient data" state instead of NaN/Infinity. */
export type Ratio =
  | { ok: true; value: number; num: number; den: number }
  | { ok: false; reason: 'insufficient'; num: number; den: number };

export function ratio(num: number, den: number): Ratio {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
    return { ok: false, reason: 'insufficient', num, den };
  }
  return { ok: true, value: num / den, num, den };
}

export interface Totals {
  eligible: number;
  attempts: number;
  correctDecisions: number;
  successful: number;
  logs: number;
}

export function sumLogs(logs: Pick<Log, 'eligible' | 'attempts' | 'correctDecisions' | 'successful'>[]): Totals {
  return logs.reduce<Totals>(
    (t, l) => ({
      eligible: t.eligible + l.eligible,
      attempts: t.attempts + l.attempts,
      correctDecisions: t.correctDecisions + l.correctDecisions,
      successful: t.successful + l.successful,
      logs: t.logs + 1,
    }),
    { eligible: 0, attempts: 0, correctDecisions: 0, successful: 0, logs: 0 },
  );
}

export interface KpiSet {
  /** attempts / eligible opportunities — can exceed 100 % (over-attempting / forcing). */
  attempt: Ratio;
  /** correct decisions / attempts */
  decision: Ratio;
  /** successful executions / correct decisions */
  execution: Ratio;
}

export function computeKpis(t: Pick<Totals, 'eligible' | 'attempts' | 'correctDecisions' | 'successful'>): KpiSet {
  return {
    attempt: ratio(t.attempts, t.eligible),
    decision: ratio(t.correctDecisions, t.attempts),
    execution: ratio(t.successful, t.correctDecisions),
  };
}

/** 0–3 stars; null when there is not enough data. Over 100 % attempt rate is capped for star purposes. */
export function starsFor(r: Ratio, levels: StarLevels): 0 | 1 | 2 | 3 | null {
  if (!r.ok) return null;
  const pct = Math.min(r.value, 1) * 100;
  if (pct >= levels[2]) return 3;
  if (pct >= levels[1]) return 2;
  if (pct >= levels[0]) return 1;
  return 0;
}

export function starSet(k: KpiSet, th: Thresholds): Record<KpiKey, 0 | 1 | 2 | 3 | null> {
  return {
    attempt: starsFor(k.attempt, th.attempt),
    decision: starsFor(k.decision, th.decision),
    execution: starsFor(k.execution, th.execution),
  };
}

export function pct(r: Ratio, digits = 0): string {
  return r.ok ? `${(r.value * 100).toFixed(digits)}%` : '—';
}

/** Attempts above eligible opportunities indicate forcing the shot outside eligible conditions. */
export function isOverAttempting(t: Pick<Totals, 'eligible' | 'attempts'>): boolean {
  return t.eligible > 0 && t.attempts > t.eligible;
}

/** Percentage-point change between two ratios; null if either is insufficient. */
export function delta(current: Ratio, base: Ratio): number | null {
  if (!current.ok || !base.ok) return null;
  return (current.value - base.value) * 100;
}

/**
 * Training-to-match transfer: match ratio / practice ratio.
 * 1.0 means the skill transfers fully. Null when either side lacks data.
 */
export function transfer(match: Ratio, practice: Ratio): number | null {
  if (!match.ok || !practice.ok || practice.value === 0) return null;
  return match.value / practice.value;
}

/** Validates that a log's counts respect the KPI hierarchy. Returns error keys. */
export function validateCounts(c: { eligible: number; attempts: number; correctDecisions: number; successful: number }): string[] {
  const errs: string[] = [];
  for (const [k, v] of Object.entries(c)) if (!Number.isInteger(v) || v < 0) errs.push(`${k}:nonNegativeInt`);
  if (c.correctDecisions > c.attempts) errs.push('correctDecisions:gtAttempts');
  if (c.correctDecisions > c.eligible) errs.push('correctDecisions:gtEligible');
  if (c.successful > c.correctDecisions) errs.push('successful:gtDecisions');
  return errs;
}
