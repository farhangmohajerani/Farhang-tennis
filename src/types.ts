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

export const TournamentSchema = z.object({
  id: nonEmpty,
  playerId: nonEmpty,
  name: nonEmpty,
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type Tournament = z.infer<typeof TournamentSchema>;

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
  settings: SettingsSchema,
});
export type AppState = z.infer<typeof AppStateSchema>;
