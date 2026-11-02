import type { MyPlan } from './access';
/**
 * Staff management (Supabase mode only). An invite carries a 6-digit code: the coach signs up with the
 * invited email and types the code (sign-up emails are not verified, so an email alone grants nothing).
 */
export interface TeamMember { email: string; role: 'admin' | 'coach'; pending: boolean; requested?: boolean; userId?: string; code?: string }
/** A parent account the admin can give a Family plan to. */
export interface ParentAccount { userId: string; email: string; plan: MyPlan | null }
export interface Team {
  list(): Promise<TeamMember[]>;
  /** Returns the code to give the invited person. */
  invite(email: string, role: 'admin' | 'coach'): Promise<{ code: string }>;
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
  /** Change the signed-in account's password. */
  changePassword(password: string): Promise<void>;
}
let current: Team | null = null;
export const setTeam = (t: Team) => {
  current = t;
};
export const getTeam = () => current;
