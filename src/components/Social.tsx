/**
 * Usernames and connections (Supabase): find a player or a coach by username, send a request,
 * answer requests, and disconnect. The database decides what each side then sees.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import type { DictKey } from '../lib/i18n';
import {
  connectionsSnapshot,
  getSocial,
  incoming,
  reloadConnections,
  subscribeConnections,
  type Connection,
  type Member,
  type Result,
  type SearchHit,
} from '../lib/social';
import { Badge, Button, Card, ConfirmButton, cx, inputCls, Modal, SectionTitle } from './ui';

export function useConnections(): Connection[] | null {
  return useSyncExternalStore(subscribeConnections, connectionsSnapshot, connectionsSnapshot);
}

/** Requests waiting for this person's answer (0 outside usernames mode). */
export function useIncomingCount(): number {
  return incoming(useConnections()).length;
}

const errKey = (e: string): DictKey =>
  e === 'too_many' ? 'socialErr_too_many' : e === 'not_found' ? 'socialErr_not_found' : e === 'not_connected' ? 'socialErr_not_connected' : 'socialErr';

/** Run one request; errors become a toast. Returns the result, or null when it failed. */
function useAct() {
  const { t, toast } = useStore();
  return async (fn: () => Promise<Result>, ok?: (r: Result) => string | null): Promise<Result | null> => {
    try {
      const r = await fn();
      if (r?.error) {
        toast(t(errKey(r.error)), 'error');
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

/** "Your username: @yaman — share it so they can find you." */
export function MyUsername() {
  const { t } = useStore();
  const me = getSocial()?.me;
  if (!me) return null;
  return (
    <p className="mb-3 rounded-xl bg-sunken px-3 py-2 text-[13px]" data-testid="my-username">
      {t('myUsernameLabel')} <Handle u={me.username} className="font-semibold text-ink" /> · <span className="text-muted">{t('shareUsername')}</span>
    </p>
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
  const mark = (u: string, status: SearchHit['status'], direction: SearchHit['direction']) =>
    setHits((hs) => hs?.map((h) => (h.username === u ? { ...h, status, direction } : h)) ?? hs);
  return (
    <div className="flex flex-col gap-2" data-testid="people-search">
      <input
        type="search"
        className={inputCls}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchUsername')}
        aria-label={t('searchUsername')}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        data-testid="people-search-input"
      />
      {query.length === 1 && <p className="text-[13px] text-muted">{t('searchMin')}</p>}
      {busy && <p className="text-[13px] text-muted">{t('searching')}</p>}
      {!busy && hits && hits.length === 0 && (
        <p className="text-[13px] text-muted" data-testid="no-results">
          {t('noPeopleFound', { q: query })}
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" data-testid="search-results">
          {hits.map((h) => (
            <li key={h.username} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`hit-${h.username}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{h.displayName}</p>
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
                    const r = await act(() => social.respond(h.username, true), () => t('connectedWith', { u: h.username }));
                    if (r) mark(h.username, 'accepted', 'in');
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
    </div>
  );
}

/** Requests to answer, and requests waiting for the other side (or only one of the two lists). */
export function RequestsList({ only }: { only?: 'in' | 'out' }) {
  const { t } = useStore();
  const social = getSocial();
  const act = useAct();
  const conns = useConnections();
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
                    {c.displayName} <Handle u={c.username} />
                  </p>
                  <p className="text-[13px] text-muted">{t(c.kind === 'coach' ? 'wantsToCoach' : 'wantsToJoin')}</p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`accept-${c.username}`}
                  onClick={() => void act(() => social.respond(c.username, true), () => t('connectedWith', { u: c.username }))}
                >
                  {t('acceptRequest')}
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
    </div>
  );
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
      onConfirm={() => void act(() => social.remove(username), () => t('disconnected', { u: username }))}
    />
  );
}

/** Family: the coaches you are connected to. */
function MyCoaches() {
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
            <p className="font-semibold">{c.displayName}</p>
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
  const conns = useConnections();
  if (!getSocial() || !incoming(conns).length) return null;
  return (
    <div className="mb-4" data-testid="dash-requests">
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

/** Admin: everyone with an account. */
export function MembersPanel() {
  const { t, lang } = useStore();
  const social = getSocial();
  const [list, setList] = useState<Member[] | null>(null);
  useEffect(() => {
    social
      ?.members()
      .then((m) => setList(m ?? []))
      .catch(() => setList([]));
  }, [social]);
  if (!social) return null;
  const coaches = (list ?? []).filter((m) => m.kind === 'coach').length;
  const families = (list ?? []).filter((m) => m.kind === 'family').length;
  return (
    <Card className="p-5" data-testid="members-panel">
      <SectionTitle aside={list && <span className="num text-[13px] text-muted">{t('membersCounts', { c: coaches, f: families })}</span>}>{t('membersTitle')}</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">{t('membersHelp')}</p>
      {list === null ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" data-testid="members-list">
          {list.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid={`member-${m.username}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {m.displayName} <Handle u={m.username} />
                </p>
                <p className="truncate text-[12px] text-muted" dir="ltr">
                  {m.email} · {new Date(m.createdAt).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB')}
                </p>
              </div>
              <Badge tone={m.kind === 'coach' ? 'accent' : 'band'}>{t(m.kind === 'coach' ? 'kind_coach' : 'kind_family')}</Badge>
              <span className="num text-[12px] text-muted">{t('connectionsN', { n: m.connections })}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
