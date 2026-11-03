/**
 * Usernames and connections (Supabase): find a player or a coach by username, send a request,
 * answer requests, and disconnect. Families see exactly what a coach may do before they allow it.
 * The database decides what each side then sees.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { formatDate, type DictKey } from '../lib/i18n';
import {
  connectionsSnapshot,
  getSocial,
  incoming,
  reloadConnections,
  socialSnapshot,
  subscribeConnections,
  type Connection,
  type LinkRequest,
  type Member,
  type Result,
  type SearchHit,
} from '../lib/social';
import { Badge, Button, Card, ConfirmButton, cx, inputCls, Modal, SectionTitle } from './ui';

export function useConnections(): Connection[] | null {
  return useSyncExternalStore(subscribeConnections, connectionsSnapshot, connectionsSnapshot);
}

/** Connections and link requests together (and a re-render when my profile changes). */
export function useSocialState() {
  return useSyncExternalStore(subscribeConnections, socialSnapshot, socialSnapshot);
}

/** My profile, kept current after Settings changes it. */
export function useMe() {
  useSocialState();
  return getSocial()?.me ?? null;
}

/** Requests waiting for this person's answer (0 outside usernames mode). */
export function useIncomingCount(): number {
  const { conns, links } = useSocialState();
  return incoming(conns).length + (links ?? []).filter((l) => l.direction === 'in').length;
}

/** A readable message for an error the database returned. */
export function useSocialError() {
  const { t, lang } = useStore();
  return (r: Result): string => {
    if (r.error === 'wait' && r.until) return t('socialErr_wait', { date: formatDate(lang, r.until.slice(0, 10), { day: 'numeric', month: 'long' }) });
    const key: Record<string, DictKey> = {
      too_many: 'socialErr_too_many',
      not_found: 'socialErr_not_found',
      not_connected: 'socialErr_not_connected',
      blocked: 'socialErr_blocked',
      same_kind: 'socialErr_same_kind',
      username_taken: 'usernameTaken',
      bad_username: 'usernameRule',
      staff: 'socialErr_staff',
    };
    return t(key[r.error ?? ''] ?? 'socialErr');
  };
}

/** Run one request; errors become a toast. Returns the result, or null when it failed. */
export function useAct() {
  const { t, toast } = useStore();
  const errText = useSocialError();
  return async (fn: () => Promise<Result>, ok?: (r: Result) => string | null): Promise<Result | null> => {
    try {
      const r = await fn();
      if (r?.error) {
        toast(errText(r), 'error');
        return null;
      }
      const msg = ok?.(r);
      if (msg) toast(msg);
      await reloadConnections();
      return r ?? {};
    } catch {
      toast(t('socialErr'), 'error');
      return null;
    }
  };
}

export function Handle({ u, className }: { u: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cx('font-mono text-[13px] text-muted', className)}>
      @{u}
    </bdi>
  );
}

/** Coaches the academy confirmed. */
export function VerifiedBadge() {
  const { t } = useStore();
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 align-middle text-[11px] font-bold text-accent" title={t('verifiedHelp')} data-testid="verified">
      ✓ {t('verified')}
    </span>
  );
}

/** "Your username: @yaman — share it so they can find you." */
export function MyUsername() {
  const { t } = useStore();
  const me = useMe();
  if (!me) return null;
  return (
    <p className="mb-3 rounded-xl bg-sunken px-3 py-2 text-[13px]" data-testid="my-username">
      {t('myUsernameLabel')} <Handle u={me.username} className="font-semibold text-ink" /> · <span className="text-muted">{t('shareUsername')}</span>
    </p>
  );
}

type CoachRef = { username: string; displayName: string; verified?: boolean };

/**
 * Before a family lets a coach in (accepting their request, or asking them): what the coach will be
 * able to see and do, what they never see, and the optional AI analysis.
 */
export function AllowCoachSheet({ coach, mode, onClose, onDone }: { coach: CoachRef; mode: 'accept' | 'send'; onClose: () => void; onDone?: (r: Result) => void }) {
  const { state, t, adapter } = useStore();
  const social = getSocial();
  const act = useAct();
  const own = state.players.find((p) => p.id === adapter.myId);
  const [ai, setAi] = useState(own?.aiConsent === true);
  const [busy, setBusy] = useState(false);
  if (!social) return null;
  const player = own?.name || social.me.displayName;
  const yes: DictKey[] = ['allowSee', 'allowPlan', 'allowLive'];
  const no: DictKey[] = ['allowNoEmail', 'allowNoOthers'];
  return (
    <Modal open onClose={onClose} title={t(mode === 'accept' ? 'allowTitle' : 'askTitle')}>
      <div className="flex flex-col gap-4" data-testid="allow-sheet">
        <div className="flex items-center gap-3 rounded-2xl bg-sunken p-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-band font-display text-xl text-band-ink" aria-hidden="true">
            {coach.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {coach.displayName} {coach.verified && <VerifiedBadge />}
            </p>
            <Handle u={coach.username} />
          </div>
        </div>
        <section>
          <h3 className="mb-1.5 text-[14px] font-semibold">{t('allowCan', { coach: coach.displayName, player })}</h3>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {yes.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="font-bold text-good" aria-hidden="true">✓</span>
                <span>{t(k, { player })}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1.5 text-[14px] font-semibold">{t('allowNever')}</h3>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {no.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="font-bold text-bad" aria-hidden="true">✕</span>
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </section>
        <label className="flex items-start gap-2.5 rounded-2xl border border-line p-3 text-[14px]">
          <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent" checked={ai} onChange={(e) => setAi(e.target.checked)} data-testid="allow-ai" />
          <span>
            <span className="font-semibold">{t('allowAi')}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">{t('allowAiHint')}</span>
          </span>
        </label>
        <p className="text-[12.5px] text-muted">{t('allowRevoke')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} data-testid="allow-cancel">
            {t('notNow')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            data-testid="allow-confirm"
            onClick={async () => {
              setBusy(true);
              try {
                if (own && ai !== (own.aiConsent === true)) await social.updatePlayer({ aiConsent: ai }).catch(() => null);
                const r = await act(
                  () => (mode === 'accept' ? social.respond(coach.username, true) : social.send(coach.username)),
                  (x) => t(mode === 'accept' || x.status === 'accepted' ? 'connectedWith' : 'requestSent', { u: coach.username }),
                );
                if (r) {
                  if (mode === 'accept' || r.status === 'accepted') social.refresh();
                  onDone?.(r);
                  onClose();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(mode === 'accept' ? 'allowBtn' : 'askBtn')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Search the other side (coaches find families, families find coaches) and send requests. */
export function PeopleSearch({ autoFocus }: { autoFocus?: boolean }) {
  const { t } = useStore();
  const social = getSocial();
  const act = useAct();
  const conns = useConnections();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ hit: SearchHit; mode: 'accept' | 'send' } | null>(null);
  const seq = useRef(0);
  const query = q.trim();
  useEffect(() => {
    if (!social || query.length < 2) {
      seq.current++;
      setHits(null);
      setBusy(false);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      social
        .search(query)
        .then((r) => n === seq.current && setHits(r ?? []))
        .catch(() => n === seq.current && setHits([]))
        .finally(() => n === seq.current && setBusy(false));
    }, 300);
    return () => clearTimeout(timer);
    // Connections changing (an answer arrived) refreshes the buttons.
  }, [query, social, conns]);
  if (!social) return null;
  const family = social.me.kind === 'family';
  const mark = (u: string, status: SearchHit['status'], direction: SearchHit['direction']) =>
    setHits((hs) => hs?.map((h) => (h.username === u ? { ...h, status, direction } : h)) ?? hs);
  return (
    <div className="flex flex-col gap-2" data-testid="people-search">
      <input
        type="search"
        className={inputCls}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t(family ? 'searchCoach' : 'searchUsername')}
        aria-label={t(family ? 'searchCoach' : 'searchUsername')}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        data-testid="people-search-input"
      />
      {!family && <p className="text-[12.5px] text-muted">{t('coachAskHint')}</p>}
      {query.length === 1 && <p className="text-[13px] text-muted">{t('searchMin')}</p>}
      {busy && <p className="text-[13px] text-muted">{t('searching')}</p>}
      {!busy && hits && hits.length === 0 && (
        <p className="text-[13px] text-muted" data-testid="no-results">
          {t(family ? 'noPeopleFound' : 'noFamilyFound', { q: query })}
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" data-testid="search-results">
          {hits.map((h) => (
            <li key={h.username} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`hit-${h.username}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {h.displayName} {h.verified && <VerifiedBadge />}
                </p>
                <Handle u={h.username} />
              </div>
              {h.status === 'accepted' ? (
                <Badge tone="good">✓ {t('connectedBadge')}</Badge>
              ) : h.status === 'pending' && h.direction === 'out' ? (
                <Badge tone="warn">{t('requestPending')}</Badge>
              ) : h.status === 'pending' && h.direction === 'in' ? (
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`accept-${h.username}`}
                  onClick={async () => {
                    if (family) return setSheet({ hit: h, mode: 'accept' });
                    const r = await act(() => social.respond(h.username, true), () => t('connectedWith', { u: h.username }));
                    if (r) {
                      mark(h.username, 'accepted', 'in');
                      social.refresh();
                    }
                  }}
                >
                  {t('acceptRequest')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`request-${h.username}`}
                  onClick={async () => {
                    if (family) return setSheet({ hit: h, mode: 'send' });
                    const r = await act(
                      () => social.send(h.username),
                      (x) => t(x.status === 'accepted' ? 'connectedWith' : 'requestSent', { u: h.username }),
                    );
                    if (r) mark(h.username, r.status === 'accepted' ? 'accepted' : 'pending', 'out');
                  }}
                >
                  {t('sendRequest')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {sheet && (
        <AllowCoachSheet
          coach={sheet.hit}
          mode={sheet.mode}
          onClose={() => setSheet(null)}
          onDone={(r) => mark(sheet.hit.username, sheet.mode === 'accept' || r.status === 'accepted' ? 'accepted' : 'pending', sheet.mode === 'accept' ? 'in' : 'out')}
        />
      )}
    </div>
  );
}

/** Requests to answer, and requests waiting for the other side (or only one of the two lists). */
export function RequestsList({ only }: { only?: 'in' | 'out' }) {
  const { t } = useStore();
  const social = getSocial();
  const act = useAct();
  const conns = useConnections();
  const [sheet, setSheet] = useState<Connection | null>(null);
  if (!social) return null;
  const inc = only === 'out' ? [] : incoming(conns);
  const out = only === 'in' ? [] : (conns ?? []).filter((c) => c.status === 'pending' && c.direction === 'out');
  if (!inc.length && !out.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-3">
      {inc.length > 0 && (
        <section className="rounded-2xl border-2 border-accent bg-accent-soft p-3" data-testid="requests-in">
          <h3 className="eyebrow mb-2">{t('requestsIn')}</h3>
          <ul className="flex flex-col gap-2">
            {inc.map((c) => (
              <li key={c.username} className="flex flex-wrap items-center gap-2" data-testid={`req-in-${c.username}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.displayName} {c.verified && <VerifiedBadge />} <Handle u={c.username} />
                  </p>
                  <p className="text-[13px] text-muted">{t(c.kind === 'coach' ? 'wantsToCoach' : 'wantsToJoin')}</p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`accept-${c.username}`}
                  onClick={async () => {
                    // A family first sees what the coach may do.
                    if (c.kind === 'coach') return setSheet(c);
                    const r = await act(() => social.respond(c.username, true), () => t('connectedWith', { u: c.username }));
                    if (r) social.refresh();
                  }}
                >
                  {t(c.kind === 'coach' ? 'reviewRequest' : 'acceptRequest')}
                </Button>
                <Button size="sm" data-testid={`decline-${c.username}`} onClick={() => void act(() => social.respond(c.username, false), () => t('requestDeclined'))}>
                  {t('declineRequest')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {out.length > 0 && (
        <section className="rounded-2xl border border-line p-3" data-testid="requests-out">
          <h3 className="eyebrow mb-2">{t('requestsOut')}</h3>
          <ul className="flex flex-col gap-2">
            {out.map((c) => (
              <li key={c.username} className="flex flex-wrap items-center gap-2" data-testid={`req-out-${c.username}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.displayName} <Handle u={c.username} />
                  </p>
                  <p className="text-[13px] text-muted">{t('waitingAnswer')}</p>
                </div>
                <Button size="sm" data-testid={`cancel-${c.username}`} onClick={() => void act(() => social.remove(c.username), () => t('requestCancelled'))}>
                  {t('cancelRequest')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet && <AllowCoachSheet coach={sheet} mode="accept" onClose={() => setSheet(null)} />}
    </div>
  );
}

/**
 * Family: a coach asks to move the history of a player they added without an account (plans, results,
 * matches) into this account. Nothing moves until the family allows it.
 */
export function LinkRequestsCard() {
  const { t } = useStore();
  const social = getSocial();
  const act = useAct();
  const { links } = useSocialState();
  const list = (links ?? []).filter((l) => l.direction === 'in');
  if (!social || !list.length) return null;
  return (
    <section className="mb-4 rounded-2xl border-2 border-accent bg-accent-soft p-3" data-testid="link-requests">
      <h3 className="eyebrow mb-2">{t('linkRequestsTitle')}</h3>
      <ul className="flex flex-col gap-3">
        {list.map((l) => (
          <li key={l.id} className="flex flex-col gap-2" data-testid={`link-req-${l.id}`}>
            <p className="text-[14px]">{t('linkRequestText', { coach: l.coachName, name: l.offlineName })}</p>
            <p className="text-[12.5px] text-muted">{t('linkRequestHint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid={`link-allow-${l.id}`}
                onClick={async () => {
                  const r = await act(() => social.respondLink(l.id, true), (x) => t('linkAllowed', { n: x.moved ?? 0 }));
                  if (r) social.refresh();
                }}
              >
                {t('linkAllow')}
              </Button>
              <Button size="sm" data-testid={`link-decline-${l.id}`} onClick={() => void act(() => social.respondLink(l.id, false), () => t('requestDeclined'))}>
                {t('declineRequest')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Coach: the request to move a player without an account, while the family decides. */
export function useOutgoingLink(offlineId: string): LinkRequest | undefined {
  const { links } = useSocialState();
  return (links ?? []).find((l) => l.direction === 'out' && l.offlineId === offlineId);
}

/** Disconnect from a coach or a player. */
export function DisconnectButton({ username }: { username: string }) {
  const { t } = useStore();
  const social = getSocial();
  const act = useAct();
  if (!social) return null;
  return (
    <ConfirmButton
      label={t('disconnect')}
      confirmLabel={t('disconnectConfirm')}
      onConfirm={() =>
        void act(() => social.remove(username), () => t('disconnected', { u: username })).then((r) => {
          if (r) social.refresh();
        })
      }
    />
  );
}

/** Family: the coaches you are connected to. */
export function MyCoaches() {
  const { t } = useStore();
  const conns = useConnections();
  const coaches = (conns ?? []).filter((c) => c.status === 'accepted');
  if (conns === null) return <p className="mb-4 text-sm text-muted">…</p>;
  if (!coaches.length) return <p className="mb-4 text-sm text-muted" data-testid="no-coach">{t('noCoachYet')}</p>;
  return (
    <ul className="mb-4 flex flex-col divide-y divide-line rounded-2xl border border-line" data-testid="my-coaches">
      {coaches.map((c) => (
        <li key={c.username} className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid={`coach-${c.username}`}>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {c.displayName} {c.verified && <VerifiedBadge />}
            </p>
            <Handle u={c.username} />
          </div>
          <Badge tone="good">✓ {t('connectedBadge')}</Badge>
          <DisconnectButton username={c.username} />
        </li>
      ))}
    </ul>
  );
}

/** Family: coaches, requests and search in one place. */
export function CoachesModal({ onClose }: { onClose: () => void }) {
  const { t } = useStore();
  useEffect(() => {
    void reloadConnections();
  }, []);
  return (
    <Modal open onClose={onClose} title={t('myCoachesTitle')} wide>
      <MyUsername />
      <LinkRequestsCard />
      <RequestsList />
      <MyCoaches />
      <SectionTitle>{t('findCoachTitle')}</SectionTitle>
      <p className="-mt-1 mb-2 text-[13px] text-muted">{t('findCoachHelp')}</p>
      <PeopleSearch />
    </Modal>
  );
}

/** Dashboard: requests to answer, right where the person lands. */
export function IncomingRequestsCard() {
  const { conns, links } = useSocialState();
  if (!getSocial() || (!incoming(conns).length && !(links ?? []).some((l) => l.direction === 'in'))) return null;
  return (
    <div className="mb-4" data-testid="dash-requests">
      <LinkRequestsCard />
      <RequestsList only="in" />
    </div>
  );
}

/** Family dashboard: no coach yet → find one here. */
export function FindCoachCard() {
  const { t } = useStore();
  const conns = useConnections();
  const social = getSocial();
  if (!social || social.me.kind !== 'family' || conns === null || conns.some((c) => c.status === 'accepted')) return null;
  return (
    <Card className="mb-5 p-5" data-testid="find-coach-card">
      <SectionTitle>{t('findCoachTitle')}</SectionTitle>
      <p className="-mt-1 mb-2 text-[13px] text-muted">{t('findCoachHelp')}</p>
      <MyUsername />
      <RequestsList only="out" />
      <PeopleSearch />
    </Card>
  );
}

/** Coach dashboard without players: find them by username. */
export function FindPlayersCard() {
  const { t } = useStore();
  if (!getSocial()) return null;
  return (
    <Card className="mb-5 max-w-2xl p-5" data-testid="find-players-card">
      <SectionTitle>{t('findPlayersCard')}</SectionTitle>
      <p className="-mt-1 mb-2 text-[13px] text-muted">{t('findPlayersCardHelp')}</p>
      <MyUsername />
      <RequestsList only="out" />
      <PeopleSearch />
    </Card>
  );
}

/** Admin: everyone with an account — confirm coaches, pause or remove accounts. */
export function MembersPanel() {
  const { t, lang, toast } = useStore();
  const social = getSocial();
  const errText = useSocialError();
  const [list, setList] = useState<Member[] | null>(null);
  const [q, setQ] = useState('');
  const load = () =>
    social
      ?.members()
      .then((m) => setList(m ?? []))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [social]);
  if (!social) return null;
  const coaches = (list ?? []).filter((m) => m.kind === 'coach').length;
  const families = (list ?? []).filter((m) => m.kind === 'family').length;
  const needle = q.trim().toLowerCase();
  const shown = (list ?? []).filter((m) => !needle || m.username.includes(needle) || m.displayName.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle));
  const run = async (fn: () => Promise<Result>, ok: string) => {
    try {
      const r = await fn();
      if (r?.error) return toast(errText(r), 'error');
      toast(ok);
      await load();
    } catch {
      toast(t('socialErr'), 'error');
    }
  };
  return (
    <Card className="p-5" data-testid="members-panel">
      <SectionTitle aside={list && <span className="num text-[13px] text-muted">{t('membersCounts', { c: coaches, f: families })}</span>}>{t('membersTitle')}</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">{t('membersHelp')}</p>
      {list && list.length > 6 && (
        <input type="search" className={cx(inputCls, 'mb-3')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('membersSearch')} aria-label={t('membersSearch')} data-testid="members-search" />
      )}
      {list === null ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" data-testid="members-list">
          {shown.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm" data-testid={`member-${m.username}`}>
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-semibold">
                  {m.displayName} {m.verified && <VerifiedBadge />} <Handle u={m.username} />
                </p>
                <p className="truncate text-[12px] text-muted" dir="ltr">
                  {m.email} · {new Date(m.createdAt).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB')}
                </p>
              </div>
              <Badge tone={m.kind === 'coach' ? 'accent' : 'band'}>{t(m.kind === 'coach' ? 'kind_coach' : 'kind_family')}</Badge>
              {m.staff && <Badge tone="neutral">{t('staffBadge')}</Badge>}
              {m.blocked && <Badge tone="bad">{t('blockedBadge')}</Badge>}
              {!m.consentAt && <Badge tone="warn">{t('noConsentBadge')}</Badge>}
              <span className="num text-[12px] text-muted">{t('connectionsN', { n: m.connections })}</span>
              <div className="flex w-full flex-wrap justify-end gap-1.5">
                {m.kind === 'coach' && (
                  <Button
                    size="sm"
                    data-testid={`verify-${m.username}`}
                    onClick={() => void run(() => social.setFlags(m.username, { verified: !m.verified }), t(m.verified ? 'unverifiedToast' : 'verifiedToast', { u: m.username }))}
                  >
                    {t(m.verified ? 'unverifyBtn' : 'verifyBtn')}
                  </Button>
                )}
                {!m.staff && (
                  <Button
                    size="sm"
                    data-testid={`block-${m.username}`}
                    onClick={() => void run(() => social.setFlags(m.username, { blocked: !m.blocked }), t(m.blocked ? 'unblockedToast' : 'blockedToast', { u: m.username }))}
                  >
                    {t(m.blocked ? 'unblockBtn' : 'blockBtn')}
                  </Button>
                )}
                {!m.staff && m.userId !== social.myId && (
                  <ConfirmButton
                    label={t('removeAccountBtn')}
                    confirmLabel={t('removeAccountConfirm', { u: m.username })}
                    onConfirm={() => void run(() => social.removeAccount(m.userId), t('removedToast', { u: m.username }))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
