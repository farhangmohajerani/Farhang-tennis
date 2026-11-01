import { z } from 'zod';

export const CATEGORIES = [
  'forehand',
  'backhand',
  'serve',
  'return',
  'volley',
  'footwork',
  'defense',
  'tactical',
  'pointplay',
  'mental',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Required seed counts per category (spec). Sum = 200. */
export const CATEGORY_TARGETS: Record<Category, number> = {
  forehand: 25,
  backhand: 20,
  serve: 25,
  return: 15,
  volley: 15,
  footwork: 20,
  defense: 15,
  tactical: 30,
  pointplay: 20,
  mental: 15,
};

export const LEVELS = ['beginner', 'intermediate', 'advanced', 'professional'] as const;
export type Level = (typeof LEVELS)[number];

export const KPI_KEYS = ['attempt', 'decision', 'execution'] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

/** [1-star, 2-star, 3-star] minimum percentages, ascending. */
export const StarLevelsSchema = z
  .tuple([z.number().min(0).max(200), z.number().min(0).max(200), z.number().min(0).max(200)])
  .refine((t) => t[0] <= t[1] && t[1] <= t[2], { message: 'Star thresholds must be ascending' });
export type StarLevels = z.infer<typeof StarLevelsSchema>;

export const ThresholdsSchema = z.object({
  attempt: StarLevelsSchema,
  decision: StarLevelsSchema,
  execution: StarLevelsSchema,
  provisional: z.boolean(),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

const nonEmpty = z.string().trim().min(1);

export const DrillSchema = z.object({
  id: z.string().regex(/^[a-z]{2,3}-\d{3}$|^custom-[a-z0-9]+$/, 'id must look like fh-001 or custom-xxxx'),
  name: nonEmpty,
  category: z.enum(CATEGORIES),
  level: z.enum(LEVELS),
  ageSkill: nonEmpty,
  objective: nonEmpty,
  setup: nonEmpty,
  courtLayout: nonEmpty,
  players: nonEmpty,
  equipment: z.array(nonEmpty).min(1),
  durationMin: z.number().int().min(1).max(180),
  repetitions: nonEmpty,
  steps: z.array(nonEmpty).min(2),
  cues: z.array(nonEmpty).min(1),
  mistakes: z.array(z.object({ mistake: nonEmpty, correction: nonEmpty })).min(1),
  eligibility: nonEmpty,
  kpi: z.object({ attempt: nonEmpty, decision: nonEmpty, execution: nonEmpty }),
  measurement: nonEmpty,
  thresholds: ThresholdsSchema,
  progression: nonEmpty,
  regression: nonEmpty,
  safety: nonEmpty,
  video: z.object({ url: z.string(), placeholder: z.boolean() }),
  references: z.array(z.string()),
  archived: z.boolean(),
  custom: z.boolean(),
  updatedAt: z.string(),
});
export type Drill = z.infer<typeof DrillSchema>;

export const ROLES = ['parent', 'coach', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PlayerSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  birthYear: z.number().int(),
  level: z.enum(LEVELS),
  hand: z.enum(['right', 'left']),
  backhand: z.enum(['one', 'two']),
  coachId: z.string(),
  parentId: z.string(),
  /** claude.ai user ids of parents who may follow this player (read-only). */
  parentIds: z.array(z.string()).default([]),
  goals: z.string(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const PersonSchema = z.object({ id: nonEmpty, name: nonEmpty, role: z.enum(ROLES), email: z.string() });
export type Person = z.infer<typeof PersonSchema>;

export const SessionItemSchema = z.object({
  drillId: nonEmpty,
  /** Why the coach picked this drill — shown to parents. */
  reason: z.string(),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const SessionSchema = z.object({
  id: nonEmpty,
  index: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: nonEmpty,
  focus: z.string(),
  items: z.array(SessionItemSchema),
  status: z.enum(['planned', 'completed', 'skipped']),
  coachNote: z.string(),
  kind: z.enum(['baseline', 'training', 'match-eval']),
});
export type Session = z.infer<typeof SessionSchema>;

export const PlanSchema = z.object({
  id: nonEmpty,
  playerId: nonEmpty,
  name: nonEmpty,
  priority: z.string(),
  owner: z.enum(['coach', 'parent']),
  /** Phase-2 support: a parent-owned plan can be shared with a coach. */
  sharedWithCoachId: z.string().nullable(),
  createdAt: z.string(),
  sessions: z.array(SessionSchema),
});
export type Plan = z.infer<typeof PlanSchema>;

/* ---------- Competition: tournaments, goals and matches ---------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SURFACES = ['hard', 'clay', 'grass', 'carpet'] as const;
export type Surface = (typeof SURFACES)[number];

/** Draw stages, earliest first. 'W' (won the title) is only a goal / result, never a match round. */
export const ROUNDS = ['Q', 'RR', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'] as const;
export type Round = (typeof ROUNDS)[number];
export const MATCH_ROUNDS = ROUNDS.filter((r) => r !== 'W') as Exclude<Round, 'W'>[];

/** Match statistics a tournament goal can target (evaluated from charted matches). */
export const GOAL_METRICS = [
  'firstServeIn',
  'firstServeWon',
  'secondServeWon',
  'doubleFaults',
  'aces',
  'unforcedErrors',
  'winners',
  'returnPointsWon',
  'breakPointsSaved',
  'breakPointsConverted',
  'netPointsWon',
  'shortRallyWon',
  'totalPointsWon',
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GoalSchema = z.discriminatedUnion('kind', [
  /** Result: reach this stage of the draw (or win the title). */
  z.object({ id: nonEmpty, kind: z.literal('outcome'), round: z.enum(ROUNDS) }),
  /** A match statistic, e.g. first serve in ≥ 60 % or double faults ≤ 3 per match. */
  z.object({ id: nonEmpty, kind: z.literal('stat'), metric: z.enum(GOAL_METRICS), op: z.enum(['gte', 'lte']), value: z.number().min(0).max(1000) }),
  /** Training focus: a drill practised for this tournament, optionally with an execution target (%). */
  z.object({ id: nonEmpty, kind: z.literal('drill'), drillId: nonEmpty, target: z.number().min(0).max(100).nullable().default(null) }),
  /** Anything else (e.g. "same routine before every serve"); the coach marks it after the event. */
  z.object({ id: nonEmpty, kind: z.literal('custom'), text: nonEmpty, achieved: z.boolean().nullable().default(null) }),
]);
export type Goal = z.infer<typeof GoalSchema>;

export const TournamentSchema = z.object({
  id: nonEmpty,
  playerId: nonEmpty,
  name: nonEmpty,
  start: isoDate,
  end: isoDate,
  location: z.string().default(''),
  /** e.g. ITF J60, Tennis Europe Cat 2, national, club. */
  category: z.string().default(''),
  surface: z.enum(SURFACES).nullable().default(null),
  indoor: z.boolean().default(false),
  /** What this tournament is for: results, applying training, or both. */
  aim: z.enum(['result', 'training', 'both']).default('both'),
  goals: z.array(GoalSchema).default([]),
  /** Preparation notes before the event. */
  notes: z.string().default(''),
  /** Furthest stage reached, when matches were not recorded (otherwise computed from matches). */
  result: z.enum(ROUNDS).nullable().default(null),
  /** After the event: what went well, what to work on next. */
  review: z.string().default(''),
});
export type Tournament = z.infer<typeof TournamentSchema>;

/** How a point ended. */
export const POINT_END = ['ace', 'serviceWinner', 'doubleFault', 'returnWinner', 'returnError', 'winner', 'forcedError', 'unforcedError', 'other'] as const;
export type PointEnd = (typeof POINT_END)[number];
/** Stroke of the shot that ended the point. */
export const SHOTS = ['fh', 'bh', 'volley', 'overhead', 'drop', 'lob', 'serve'] as const;
export type Shot = (typeof SHOTS)[number];
/** Rally length: 0–4, 5–8, 9+ shots. */
export const RALLY = ['short', 'mid', 'long'] as const;
export type Rally = (typeof RALLY)[number];
/**
 * One point, stored compactly (6 characters) so a whole match stays small to sync on every tap:
 * winner (p/o) · serve (1/2) · end (A ace, S service winner, D double fault, R return winner,
 * E return error, W winner, F forced error, U unforced error, X other) · stroke (f b v o d l s, - none)
 * · rally (s m l, - unknown) · player at net (n, -). Example: "p1Wfs-". See lib/match.ts.
 */
export const POINT_RE = /^[po][12][ASDREWFUX][fbvodls-][sml-][n-]$/;

export const MatchFormatSchema = z.object({
  sets: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  /** Games per set: 6 (standard) or 4 (short sets); tie-break at games-all. */
  games: z.union([z.literal(4), z.literal(6)]),
  /** Deciding set: a full set or a 10-point match tie-break. */
  finalSet: z.enum(['full', 'mtb']),
  noAd: z.boolean(),
});
export type MatchFormat = z.infer<typeof MatchFormatSchema>;

/** A set score from the player's side. `tb` = tie-break points of the set's loser (7-6(5)); for a match tie-break, p/o hold the points. */
export const SetScoreSchema = z.object({
  p: z.number().int().min(0).max(99),
  o: z.number().int().min(0).max(99),
  tb: z.number().int().min(0).max(99).nullable().default(null),
});
export type SetScore = z.infer<typeof SetScoreSchema>;

export const MatchSchema = z.object({
  id: nonEmpty,
  playerId: nonEmpty,
  date: isoDate,
  kind: z.enum(['practice', 'official']),
  tournamentId: z.string().nullable().default(null),
  round: z.enum(ROUNDS).nullable().default(null),
  opponent: z.string().default(''),
  /** Free text: UTR 9.5, ITF 420, club level… */
  opponentRating: z.string().default(''),
  opponentHand: z.enum(['right', 'left']).nullable().default(null),
  surface: z.enum(SURFACES).nullable().default(null),
  indoor: z.boolean().default(false),
  format: MatchFormatSchema,
  firstServer: z.enum(['p', 'o']),
  /** live = charted point by point; score = final score only. */
  mode: z.enum(['live', 'score']),
  points: z.array(z.string().regex(POINT_RE)).default([]),
  /** Final set scores when mode is 'score'. */
  sets: z.array(SetScoreSchema).default([]),
  status: z.enum(['live', 'done']),
  endReason: z.enum(['completed', 'retired', 'stopped']).default('completed'),
  /** Winner when finished early or entered as a score (charted matches compute it). */
  winner: z.enum(['p', 'o']).nullable().default(null),
  notes: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Match = z.infer<typeof MatchSchema>;

export const ERROR_TYPES = ['net', 'long', 'wide', 'wrongChoice', 'late', 'other'] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const LogSchema = z
  .object({
    id: nonEmpty,
    playerId: nonEmpty,
    drillId: nonEmpty,
    sessionId: z.string().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    context: z.enum(['baseline', 'practice', 'match']),
    eligible: z.number().int().min(0),
    attempts: z.number().int().min(0),
    correctDecisions: z.number().int().min(0),
    successful: z.number().int().min(0),
    errors: z.record(z.enum(ERROR_TYPES), z.number().int().min(0)),
    notes: z.string(),
    createdAt: z.string(),
  })
  .refine((l) => l.correctDecisions <= l.attempts, { message: 'Correct decisions cannot exceed attempts', path: ['correctDecisions'] })
  .refine((l) => l.correctDecisions <= l.eligible, { message: 'Correct decisions cannot exceed eligible opportunities', path: ['correctDecisions'] })
  .refine((l) => l.successful <= l.correctDecisions, { message: 'Successful executions cannot exceed correct decisions', path: ['successful'] });
export type Log = z.infer<typeof LogSchema>;

export const SettingsSchema = z.object({
  lang: z.enum(['en', 'fa']),
  role: z.enum(ROLES),
  activePlayerId: z.string(),
  levelDefaults: z.object({ beginner: ThresholdsSchema, intermediate: ThresholdsSchema, advanced: ThresholdsSchema, professional: ThresholdsSchema }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AppStateSchema = z.object({
  version: z.literal(1),
  drills: z.array(DrillSchema),
  people: z.array(PersonSchema),
  players: z.array(PlayerSchema),
  plans: z.array(PlanSchema),
  tournaments: z.array(TournamentSchema),
  logs: z.array(LogSchema),
  matches: z.array(MatchSchema).default([]),
  settings: SettingsSchema,
});
export type AppState = z.infer<typeof AppStateSchema>;
