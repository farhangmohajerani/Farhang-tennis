import type { AppState, Drill, Level, Log, Match, Plan, Player, Role, Session, Thresholds, Tournament } from '../types';
import type { Lang } from './i18n';
import { mergeDrills } from './drillIO';

export type Action =
  | { type: 'replace'; state: AppState }
  | { type: 'remote'; apply: (s: AppState) => AppState }
  | { type: 'upsertPlayer'; player: Player }
  | { type: 'deletePlayer'; id: string }
  | { type: 'setLang'; lang: Lang }
  | { type: 'setRole'; role: Role }
  | { type: 'setActivePlayer'; id: string }
  | { type: 'upsertDrill'; drill: Drill }
  | { type: 'setArchived'; id: string; archived: boolean }
  | { type: 'deleteDrill'; id: string }
  | { type: 'importDrills'; drills: Drill[] }
  | { type: 'setLevelDefaults'; level: Level; thresholds: Thresholds }
  | { type: 'applyLevelDefaults'; level: Level }
  | { type: 'savePlan'; plan: Plan }
  | { type: 'deletePlan'; id: string }
  | { type: 'addSessionItem'; planId: string; sessionId: string; drillId: string; reason: string }
  | { type: 'setSessionStatus'; planId: string; sessionId: string; status: Session['status'] }
  | { type: 'setSessionNote'; planId: string; sessionId: string; note: string }
  | { type: 'addLog'; log: Log }
  | { type: 'deleteLog'; id: string }
  | { type: 'addTournament'; tournament: Tournament }
  | { type: 'upsertTournament'; tournament: Tournament }
  | { type: 'removeTournament'; id: string }
  | { type: 'saveMatch'; match: Match }
  | { type: 'deleteMatch'; id: string };

const now = () => new Date().toISOString();

function mapPlan(state: AppState, planId: string, fn: (p: Plan) => Plan): AppState {
  return { ...state, plans: state.plans.map((p) => (p.id === planId ? fn(p) : p)) };
}

function mapSession(p: Plan, sessionId: string, fn: (s: Session) => Session): Plan {
  return { ...p, sessions: p.sessions.map((s) => (s.id === sessionId ? fn(s) : s)) };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'replace':
      return action.state;
    case 'remote':
      return action.apply(state);
    case 'upsertPlayer': {
      const exists = state.players.some((p) => p.id === action.player.id);
      const players = exists ? state.players.map((p) => (p.id === action.player.id ? action.player : p)) : [...state.players, action.player];
      return { ...state, players, settings: exists ? state.settings : { ...state.settings, activePlayerId: action.player.id } };
    }
    case 'deletePlayer': {
      const players = state.players.filter((p) => p.id !== action.id);
      return {
        ...state,
        players,
        plans: state.plans.filter((p) => p.playerId !== action.id),
        logs: state.logs.filter((l) => l.playerId !== action.id),
        tournaments: state.tournaments.filter((t) => t.playerId !== action.id),
        matches: state.matches.filter((m) => m.playerId !== action.id),
        settings: { ...state.settings, activePlayerId: state.settings.activePlayerId === action.id ? players[0]?.id ?? '' : state.settings.activePlayerId },
      };
    }
    case 'setLang':
      return { ...state, settings: { ...state.settings, lang: action.lang } };
    case 'setRole':
      return { ...state, settings: { ...state.settings, role: action.role } };
    case 'setActivePlayer':
      return { ...state, settings: { ...state.settings, activePlayerId: action.id } };
    case 'upsertDrill': {
      const d = { ...action.drill, updatedAt: now() };
      const exists = state.drills.some((x) => x.id === d.id);
      return { ...state, drills: exists ? state.drills.map((x) => (x.id === d.id ? d : x)) : [...state.drills, d] };
    }
    case 'setArchived':
      return { ...state, drills: state.drills.map((d) => (d.id === action.id ? { ...d, archived: action.archived, updatedAt: now() } : d)) };
    case 'deleteDrill': {
      // Only custom drills can be hard-deleted; seeded drills are archived instead so history stays intact.
      const target = state.drills.find((d) => d.id === action.id);
      if (!target || !target.custom) return state;
      return {
        ...state,
        drills: state.drills.filter((d) => d.id !== action.id),
        plans: state.plans.map((p) => ({ ...p, sessions: p.sessions.map((s) => ({ ...s, items: s.items.filter((i) => i.drillId !== action.id) })) })),
      };
    }
    case 'importDrills':
      return { ...state, drills: mergeDrills(state.drills, action.drills).drills };
    case 'setLevelDefaults':
      return { ...state, settings: { ...state.settings, levelDefaults: { ...state.settings.levelDefaults, [action.level]: action.thresholds } } };
    case 'applyLevelDefaults': {
      const th = state.settings.levelDefaults[action.level];
      if (!th) return state;
      return { ...state, drills: state.drills.map((d) => (d.level === action.level ? { ...d, thresholds: JSON.parse(JSON.stringify(th)), updatedAt: now() } : d)) };
    }
    case 'savePlan': {
      const exists = state.plans.some((p) => p.id === action.plan.id);
      const plan = { ...action.plan, sessions: [...action.plan.sessions].sort((a, b) => a.index - b.index) };
      return { ...state, plans: exists ? state.plans.map((p) => (p.id === plan.id ? plan : p)) : [...state.plans, plan] };
    }
    case 'deletePlan':
      return { ...state, plans: state.plans.filter((p) => p.id !== action.id) };
    case 'addSessionItem':
      return mapPlan(state, action.planId, (p) =>
        mapSession(p, action.sessionId, (s) => (s.items.some((i) => i.drillId === action.drillId) ? s : { ...s, items: [...s.items, { drillId: action.drillId, reason: action.reason }] })),
      );
    case 'setSessionStatus':
      return mapPlan(state, action.planId, (p) => mapSession(p, action.sessionId, (s) => ({ ...s, status: action.status })));
    case 'setSessionNote':
      return mapPlan(state, action.planId, (p) => mapSession(p, action.sessionId, (s) => ({ ...s, coachNote: action.note })));
    case 'addLog':
      return { ...state, logs: [...state.logs, action.log] };
    case 'deleteLog':
      return { ...state, logs: state.logs.filter((l) => l.id !== action.id) };
    case 'addTournament':
    case 'upsertTournament': {
      const others = state.tournaments.filter((t) => t.id !== action.tournament.id);
      return { ...state, tournaments: [...others, action.tournament].sort((a, b) => a.start.localeCompare(b.start)) };
    }
    case 'removeTournament':
      // Matches played there stay with the player; they just lose the link.
      return {
        ...state,
        tournaments: state.tournaments.filter((t) => t.id !== action.id),
        matches: state.matches.map((m) => (m.tournamentId === action.id ? { ...m, tournamentId: null, updatedAt: now() } : m)),
      };
    case 'saveMatch': {
      const m = { ...action.match, updatedAt: now() };
      const exists = state.matches.some((x) => x.id === m.id);
      return { ...state, matches: exists ? state.matches.map((x) => (x.id === m.id ? m : x)) : [...state.matches, m] };
    }
    case 'deleteMatch':
      return { ...state, matches: state.matches.filter((m) => m.id !== action.id) };
    default:
      return state;
  }
}

/* ---------- selectors ---------- */

export function activePlayer(state: AppState) {
  return state.players.find((p) => p.id === state.settings.activePlayerId) ?? state.players[0];
}

export function plansForPlayer(state: AppState, playerId: string) {
  return state.plans.filter((p) => p.playerId === playerId);
}

/** The coach's plan (or a parent plan shared with the coach) is the primary plan. */
export function primaryPlan(state: AppState, playerId: string): Plan | undefined {
  const plans = plansForPlayer(state, playerId);
  return plans.find((p) => p.owner === 'coach') ?? plans.find((p) => p.sharedWithCoachId) ?? plans[0];
}

export function drillMap(state: AppState): Map<string, Drill> {
  return new Map(state.drills.map((d) => [d.id, d]));
}
