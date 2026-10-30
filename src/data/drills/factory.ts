import type { Category, Drill, Level, Thresholds } from '../../types';

/**
 * Compact authoring format for seed drills. Every drill-specific field is
 * written by hand per drill; only category-wide boilerplate (default
 * equipment, safety baseline, measurement wording, age band, thresholds)
 * is filled in by `build()`.
 */
export interface Seed {
  n: string; // name
  l: Level;
  p: string; // number / arrangement of players
  t: number; // duration minutes
  r: string; // repetitions
  o: string; // objective
  s: string; // setup
  c: string; // court layout
  e?: string[]; // extra equipment
  st: string[]; // step-by-step
  el: string; // eligibility / opportunity definition
  a: string; // attempt KPI
  d: string; // decision KPI
  x: string; // execution KPI
  cu: string[]; // coaching cues
  m: [string, string][]; // [mistake, correction]
  pr: string; // progression
  rg: string; // regression
  sf?: string; // drill-specific safety note
  ref?: string[];
}

export const AGE_SKILL: Record<Level, string> = {
  beginner: 'Ages 6–12 or adult starters · ITN 9–10 · UTR 1–3',
  intermediate: 'Ages 10–16 club/junior players · ITN 6–8 · UTR 4–7',
  advanced: 'Ages 13+ national-level juniors / strong club · ITN 3–5 · UTR 8–11',
  professional: 'ITF/WTA/ATP-track and college players · ITN 1–2 · UTR 12+',
};

/** Provisional starting thresholds (%) — editable by admins, NOT scientific norms. */
export const LEVEL_THRESHOLDS: Record<Level, Thresholds> = {
  beginner: { attempt: [40, 60, 80], decision: [40, 55, 70], execution: [30, 45, 60], provisional: true },
  intermediate: { attempt: [50, 70, 85], decision: [50, 65, 80], execution: [40, 55, 70], provisional: true },
  advanced: { attempt: [60, 75, 90], decision: [60, 75, 85], execution: [50, 65, 78], provisional: true },
  professional: { attempt: [70, 85, 95], decision: [70, 82, 90], execution: [60, 72, 85], provisional: true },
};

const BASE_EQUIPMENT: Record<Category, string[]> = {
  forehand: ['Racquets', 'Basket of 60+ balls', 'Target cones'],
  backhand: ['Racquets', 'Basket of 60+ balls', 'Target cones'],
  serve: ['Racquets', 'Basket of 60+ balls', 'Service-box targets'],
  return: ['Racquets', 'Basket of 60+ balls', 'Target cones'],
  volley: ['Racquets', 'Basket of 60+ balls', 'Throw-down lines'],
  footwork: ['Racquets', 'Agility cones / flat markers'],
  defense: ['Racquets', 'Basket of 60+ balls', 'Throw-down lines'],
  tactical: ['Racquets', 'Match balls', 'Throw-down lines / cones'],
  pointplay: ['Racquets', 'Match balls', 'Scoreboard or score sheet'],
  mental: ['Racquets', 'Match balls', 'Score sheet / journal'],
};

const BASE_SAFETY: Record<Category, string> = {
  forehand: 'Clear loose balls from the hitting zone between sets; feeder stands beside the net post or behind a screen.',
  backhand: 'Clear loose balls from the hitting zone between sets; feeder stands beside the net post or behind a screen.',
  serve: 'Limit serve volume for growing players (shoulder load); warm up the shoulder with bands first; nobody stands in the receiving box during feeds.',
  return: 'Server-side feeder must protect themselves (screen or distance); receivers wear eye-safe positioning, never hug the service line on hard feeds.',
  volley: 'Feed at a controlled pace when the player is inside the service line; eyes up, racquet face in front for protection.',
  footwork: 'Check surface grip and footwear; progress volume gradually; stop on any joint pain.',
  defense: 'Use full court depth and clear back-fence space; monitor fatigue — sprint-heavy drills need rest ratios of at least 1:2.',
  tactical: 'Standard live-ball rules: call "ball" for stray balls and stop play; keep spare balls off the court.',
  pointplay: 'Standard live-ball rules: stop play for stray balls; enforce hydration breaks every 15–20 minutes.',
  mental: 'Keep emotional language respectful; the coach monitors frustration and resets with a breathing routine if needed.',
};

let counter: Partial<Record<string, number>> = {};

export function build(prefix: string, category: Category, seeds: Seed[]): Drill[] {
  counter[prefix] = 0;
  return seeds.map((s) => {
    counter[prefix] = (counter[prefix] ?? 0) + 1;
    const id = `${prefix}-${String(counter[prefix]).padStart(3, '0')}`;
    const measurement =
      `Per set, tally four numbers on the Session Execution screen: ` +
      `(1) Eligible opportunities — ${lowerFirst(s.el)} ` +
      `(2) Attempts — ${lowerFirst(s.a)} ` +
      `(3) Correct decisions — ${lowerFirst(s.d)} ` +
      `(4) Successful executions — ${lowerFirst(s.x)} ` +
      `Tag each miss with an error type (net, long, wide, wrong choice, late). ` +
      `A sound decision that misses still earns decision credit; an attempt outside eligible conditions is logged as an attempt with no decision credit. ` +
      `Volume: ${s.r}.`;
    return {
      id,
      name: s.n,
      category,
      level: s.l,
      ageSkill: AGE_SKILL[s.l],
      objective: s.o,
      setup: s.s,
      courtLayout: s.c,
      players: s.p,
      equipment: [...BASE_EQUIPMENT[category], ...(s.e ?? [])],
      durationMin: s.t,
      repetitions: s.r,
      steps: s.st,
      cues: s.cu,
      mistakes: s.m.map(([mistake, correction]) => ({ mistake, correction })),
      eligibility: s.el,
      kpi: { attempt: s.a, decision: s.d, execution: s.x },
      measurement,
      thresholds: structuredCloneSafe(LEVEL_THRESHOLDS[s.l]),
      progression: s.pr,
      regression: s.rg,
      safety: s.sf ? `${s.sf} ${BASE_SAFETY[category]}` : BASE_SAFETY[category],
      video: { url: '', placeholder: true },
      references: s.ref ?? [],
      archived: false,
      custom: false,
      updatedAt: '2026-10-27T00:00:00.000Z',
    };
  });
}

function lowerFirst(t: string) {
  const trimmed = t.trim().replace(/\.?$/, '.');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
