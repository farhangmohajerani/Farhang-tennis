/**
 * 21GRAM Tennis plans. Part of the drill library is free; Pro drills need a plan once the admin
 * turns subscriptions on. Coaches and admins have the academy's plan; a parent needs the Family plan,
 * except for drills the coach put in their child's plan, which are always open to the family.
 */
import type { AppState, Drill, Role } from '../types';
import { useStore } from './store';

export type DrillAccess = 'free' | 'pro';
export type PlanKind = 'coach' | 'family';
/** A personal plan: until = end date (ISO), or null for no end date. */
export interface MyPlan {
  plan: PlanKind;
  until: string | null;
}

/** The admin's choice for the drill, or the default: beginner drills and the academy's own drills are free. */
export const drillAccess = (d: Pick<Drill, 'access' | 'custom' | 'level'>): DrillAccess => d.access ?? (d.custom || d.level === 'beginner' ? 'free' : 'pro');

export const planActive = (p: MyPlan | null, now = new Date()): boolean => !!p && (p.until === null || new Date(p.until) > now);

export function hasPro(role: Role, plan: MyPlan | null, now = new Date()): boolean {
  return role === 'coach' || role === 'admin' || planActive(plan, now);
}

/** The signed-in account's own plan (Supabase mode); set once at sign-in. */
let myPlan: MyPlan | null = null;
export const setMyPlan = (p: MyPlan | null) => {
  myPlan = p;
};
export const getMyPlan = () => myPlan;

/** Drills the coach put in a plan the viewer can see (for a parent: their child's plans). */
export function assignedDrillIds(state: Pick<AppState, 'plans'>): Set<string> {
  const ids = new Set<string>();
  for (const p of state.plans) for (const s of p.sessions) for (const i of s.items) ids.add(i.drillId);
  return ids;
}

export function isLocked(d: Drill, ctx: { paywall: boolean; pro: boolean; assigned: Set<string> }): boolean {
  return ctx.paywall && !ctx.pro && drillAccess(d) === 'pro' && !ctx.assigned.has(d.id);
}

export function useAccess() {
  const { state } = useStore();
  const paywall = state.settings.paywall;
  const pro = hasPro(state.settings.role, getMyPlan());
  const assigned = paywall && !pro ? assignedDrillIds(state) : new Set<string>();
  return { paywall, pro, plan: getMyPlan(), locked: (d: Drill) => isLocked(d, { paywall, pro, assigned }) };
}
