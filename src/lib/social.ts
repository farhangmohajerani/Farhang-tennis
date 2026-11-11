/**
 * Accounts and connections (Supabase, supabase/social.sql, social-2.sql and social-3.sql). People find
 * each other by first and last name and send a request; once accepted they are connected.
 */
export type Kind = 'coach' | 'family';
/** Who holds a family-type account: a parent (for one player) or the player themself. */
export type Holder = 'parent' | 'player';
/** What people choose at sign-up. */
export type SignupKind = 'coach' | 'family' | 'player';
export interface Profile {
  /** A hidden internal id (never shown): the requests use it. */
  username: string;
  displayName: string;
  kind: Kind;
  holder?: Holder | null;
}
/** Optional profile answers (coach: club, city, years coaching, certifications, bio; family: parent's name). */
export interface ProfileDetails {
  club?: string;
  city?: string;
  yearsCoaching?: '0-2' | '3-5' | '6-10' | '10+';
  certifications?: string;
  bio?: string;
  parentName?: string;
}
export interface MyProfile extends Profile {
  firstName: string;
  lastName: string;
  details: ProfileDetails;
  /** Families: coaches may find them by name (otherwise only by exact username). Coaches always. */
  discoverable: boolean;
  /** "Match started" notifications. */
  notifyLive: boolean;
  /** Coaches the academy confirmed. */
  verified: boolean;
  blocked: boolean;
  /** Families: a parent or guardian made the account. */
  guardian: boolean;
  /** When the privacy notice was accepted (null for accounts from before). */
  consentAt: string | null;
}
export interface SearchHit extends Profile {
  verified: boolean;
  /** Coaches: their club and city, to tell two people with the same name apart. */
  club?: string | null;
  city?: string | null;
  /** Between you and them, if anything. */
  status: 'pending' | 'accepted' | null;
  /** 'out' = you asked, 'in' = they asked. */
  direction: 'in' | 'out' | null;
}
export interface Connection extends Profile {
  verified: boolean;
  club?: string | null;
  city?: string | null;
  status: 'pending' | 'accepted';
  direction: 'in' | 'out';
  /** The player's id (a family account's id). */
  playerId: string;
  since: string;
}
/** A coach asks to move a player without an account into a family account; the family decides. */
export interface LinkRequest {
  id: string;
  offlineId: string;
  offlineName: string;
  coachUsername: string;
  coachName: string;
  familyUsername: string;
  familyName: string;
  direction: 'in' | 'out';
  createdAt: string;
}
export interface Member extends Profile {
  userId: string;
  email: string;
  createdAt: string;
  connections: number;
  blocked: boolean;
  verified: boolean;
  guardian: boolean;
  consentAt: string | null;
  staff: boolean;
}
export type Result = { status?: string; ok?: boolean; moved?: number; error?: string; until?: string; username?: string };
export interface PlayerPatch {
  name?: string;
  birthYear?: number;
  level?: 'beginner' | 'intermediate' | 'advanced' | 'professional';
  hand?: 'right' | 'left';
  backhand?: 'one' | 'two';
  yearsPlaying?: '<1' | '1-3' | '3-5' | '5+';
  goals?: string;
  aiConsent?: boolean;
}

export interface Social {
  me: MyProfile;
  myId: string;
  search(q: string): Promise<SearchHit[]>;
  connections(): Promise<Connection[]>;
  links(): Promise<LinkRequest[]>;
  send(username: string): Promise<Result>;
  respond(username: string, accept: boolean): Promise<Result>;
  remove(username: string): Promise<Result>;
  /** Coach: ask the family to take a player added without an account. */
  requestLink(offlinePlayerId: string, username: string): Promise<Result>;
  cancelLink(id: string): Promise<Result>;
  /** Family: allow or refuse it. */
  respondLink(id: string, accept: boolean): Promise<Result>;
  /** Admin: move it at once. */
  merge(offlinePlayerId: string, username: string): Promise<Result>;
  updateProfile(p: { firstName?: string; lastName?: string; details?: ProfileDetails; discoverable?: boolean; notifyLive?: boolean }): Promise<Result>;
  /** Family: their player's own details and the AI-analysis choice. */
  updatePlayer(patch: PlayerPatch): Promise<Result>;
  /** Family: hide a match they charted. */
  deleteMatch(id: string): Promise<Result>;
  /** Tell the family and coaches that a live match started (one notification per match). */
  notifyMatch(id: string): Promise<void>;
  savePush(sub: { endpoint: string; p256dh: string; auth: string; lang: string }): Promise<Result>;
  disablePush(endpoint: string): Promise<Result>;
  /** Admin. */
  members(): Promise<Member[]>;
  setFlags(username: string, flags: { blocked?: boolean; verified?: boolean }): Promise<Result>;
  removeAccount(userId: string): Promise<Result>;
  /** Fetch data again now (new access after a request was accepted). */
  refresh(): void;
}

let current: Social | null = null;
export const setSocial = (s: Social) => {
  current = s;
};
export const getSocial = () => current;

/** The privacy notice people accept; a new version would be asked again. */
export const CONSENT_VERSION = 'privacy-2026-11b';

/* ---- Connections and link requests, shared by the top bar, the dashboard and the people screens ---- */
let conns: Connection[] | null = null;
let linkList: LinkRequest[] | null = null;
let connsKey = '';
let snapshot: { conns: Connection[] | null; links: LinkRequest[] | null } = { conns: null, links: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let loading: Promise<void> | null = null;

/** Fetch connections and link requests again; when access changed, documents are fetched again too. */
export function reloadConnections(): Promise<void> {
  const s = current;
  if (!s) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const [list, links] = await Promise.all([s.connections(), s.links().catch(() => [] as LinkRequest[])]);
      const key = JSON.stringify(list.map((c) => [c.username, c.status, c.direction]));
      if (key !== connsKey) {
        if (conns !== null) s.refresh();
        connsKey = key;
      }
      // Only a real change re-renders what shows them.
      if (conns !== null && JSON.stringify(list) === JSON.stringify(conns) && JSON.stringify(links) === JSON.stringify(linkList)) return;
      conns = list;
      linkList = links;
      snapshot = { conns, links: linkList };
      listeners.forEach((f) => f());
    } catch (e) {
      console.warn('connections', e);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** For useSyncExternalStore: polls every 20 s while anything is watching and the page is visible. */
export function subscribeConnections(f: () => void): () => void {
  listeners.add(f);
  if (!timer && current) {
    void reloadConnections();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadConnections();
    }, 20000);
  }
  return () => {
    listeners.delete(f);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
export const connectionsSnapshot = () => snapshot.conns;
export const socialSnapshot = () => snapshot;

/** My profile changed (settings): everything showing it re-renders. */
export function profileChanged() {
  snapshot = { ...snapshot };
  listeners.forEach((f) => f());
}

/** Requests waiting for this person's answer. */
export const incoming = (list: Connection[] | null) => (list ?? []).filter((c) => c.status === 'pending' && c.direction === 'in');

/** A name everyone can read: first name, last name. */
export const nameOf = (p: { displayName: string }) => p.displayName;

/** How many of the profile questions are answered (a player's own questions, or a coach's). */
export function profileProgress(
  me: Pick<MyProfile, 'kind' | 'details'>,
  player?: { birthYear: number | null; level: string | null; hand: string | null; backhand: string | null } | null,
): { done: number; total: number } {
  if (me.kind === 'coach') {
    const d = me.details ?? {};
    const answers = [d.club, d.city, d.yearsCoaching];
    return { done: answers.filter(Boolean).length, total: answers.length };
  }
  const answers = [player?.birthYear, player?.level, player?.hand, player?.backhand];
  return { done: answers.filter((x) => x !== null && x !== undefined).length, total: answers.length };
}
