/** Staff management (Supabase mode only): coaches are invited by email and get access on sign-in. */
export interface TeamMember { email: string; role: 'admin' | 'coach'; pending: boolean; requested?: boolean; userId?: string }
export interface Team {
  list(): Promise<TeamMember[]>;
  invite(email: string, role: 'admin' | 'coach'): Promise<void>;
  remove(m: TeamMember): Promise<void>;
  approve(m: TeamMember): Promise<void>;
  myEmail: string;
  signOut(): void;
}
let current: Team | null = null;
export const setTeam = (t: Team) => {
  current = t;
};
export const getTeam = () => current;
