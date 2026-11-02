import type { MyPlan } from './access';
/** Staff management (Supabase mode only): coaches are invited by email and get access on sign-in. */
export interface TeamMember { email: string; role: 'admin' | 'coach'; pending: boolean; requested?: boolean; userId?: string }
/** A parent account the admin can give a Family plan to. */
export interface ParentAccount { userId: string; email: string; plan: MyPlan | null }
export interface Team {
  list(): Promise<TeamMember[]>;
  invite(email: string, role: 'admin' | 'coach'): Promise<void>;
  remove(m: TeamMember): Promise<void>;
  approve(m: TeamMember): Promise<void>;
  myEmail: string;
  signOut(): void;
  /** Admin: emails and Family plans of these parent accounts. */
  parents(ids: string[]): Promise<ParentAccount[]>;
  /** Admin: give, change or remove (null) a Family plan. */
  setPlan(userId: string, plan: MyPlan | null): Promise<void>;
  /** Delete the signed-in account for good (App Store rule: deletion inside the app). */
  deleteAccount(): Promise<void>;
}
let current: Team | null = null;
export const setTeam = (t: Team) => {
  current = t;
};
export const getTeam = () => current;
