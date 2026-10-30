import type { Session, Tournament } from '../types';

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function inTournament(iso: string, t: Tournament): boolean {
  return iso >= t.start && iso <= t.end;
}

export function tournamentOn(iso: string, tournaments: Tournament[]): Tournament | undefined {
  return tournaments.find((t) => inTournament(iso, t));
}

/** Sessions scheduled on a tournament day (completed/skipped sessions are ignored). */
export function findConflicts(sessions: Session[], tournaments: Tournament[]): { session: Session; tournament: Tournament }[] {
  const out: { session: Session; tournament: Tournament }[] = [];
  for (const s of sessions) {
    if (s.status !== 'planned') continue;
    const t = tournamentOn(s.date, tournaments);
    if (t) out.push({ session: s, tournament: t });
  }
  return out;
}

/** Planned sessions in the 2 days before a tournament start — coach should taper volume. */
export function taperWarnings(sessions: Session[], tournaments: Tournament[]): { session: Session; tournament: Tournament }[] {
  const out: { session: Session; tournament: Tournament }[] = [];
  for (const s of sessions) {
    if (s.status !== 'planned') continue;
    for (const t of tournaments) {
      if (s.date < t.start && s.date >= addDays(t.start, -2)) out.push({ session: s, tournament: t });
    }
  }
  return out;
}

/**
 * Move planned sessions off tournament days. Each conflicting session moves to the
 * first free day after the tournament; later sessions are pushed so dates stay
 * strictly increasing and never land on another tournament. Completed sessions are untouched.
 */
export function rescheduleAroundTournaments(sessions: Session[], tournaments: Tournament[]): Session[] {
  const sorted = [...sessions].sort((a, b) => a.index - b.index);
  let lastDate = '';
  return sorted.map((s) => {
    if (s.status !== 'planned') {
      lastDate = s.date > lastDate ? s.date : lastDate;
      return s;
    }
    let date = s.date;
    if (lastDate && date <= lastDate) date = addDays(lastDate, 1);
    let guard = 0;
    let t = tournamentOn(date, tournaments);
    while (t && guard < 400) {
      date = addDays(t.end, 1);
      t = tournamentOn(date, tournaments);
      guard++;
    }
    lastDate = date;
    return date === s.date ? s : { ...s, date };
  });
}

/** Generate `count` training dates from `start` on the given weekdays (0=Sun), skipping tournament days. */
export function generateDates(start: string, count: number, weekdays: number[], tournaments: Tournament[]): string[] {
  const days = weekdays.length ? weekdays : [1, 3, 5];
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (out.length < count && guard < 1000) {
    const wd = fromISO(cur).getDay();
    if (days.includes(wd) && !tournamentOn(cur, tournaments)) out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}
