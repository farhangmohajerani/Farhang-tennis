/**
 * Online version (usernames): the first-run guide, the "turn on match alerts" prompt, the in-app
 * "match started — follow live?" alert, and choosing between plans when a player has several coaches.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { formatNum } from '../lib/i18n';
import { navigate } from '../lib/router';
import { plansForPlayer, primaryPlan } from '../lib/reducer';
import { getSocial, profileProgress } from '../lib/social';
import { enablePush } from '../lib/push';
import type { Match, Plan } from '../types';
import { Button, Card, cx, Modal } from './ui';
import { useMe, useSocialState } from './Social';
import { InstallGuide, usePushState } from './Settings';
import { scoreLine } from './MatchBits';

/* ---- small per-device memory (light conveniences only) ---- */
function readJson<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: fine */
  }
}

/* ---- plans from several coaches ---- */
/** The plan shown for a player: the one chosen on this device, else the main one. */
export function usePlanChoice(playerId: string | undefined): { plans: Plan[]; plan: Plan | undefined; choose: (id: string) => void } {
  const { state } = useStore();
  const [, force] = useState(0);
  if (!playerId) return { plans: [], plan: undefined, choose: () => {} };
  const plans = plansForPlayer(state, playerId).filter((p) => p.owner === 'coach');
  const key = `tennis-progress:plan:${playerId}`;
  const stored = readJson<string>(key, '');
  const plan = plans.find((p) => p.id === stored) ?? primaryPlan(state, playerId);
  return {
    plans,
    plan,
    choose: (id) => {
      writeJson(key, id);
      force((n) => n + 1);
    },
  };
}

export function PlanSwitcher({ plans, plan, choose, dark }: { plans: Plan[]; plan: Plan | undefined; choose: (id: string) => void; dark?: boolean }) {
  const { t } = useStore();
  if (plans.length < 2) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t('plansLabel')} data-testid="plan-switcher">
      {plans.map((p) => {
        const on = p.id === plan?.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => choose(p.id)}
            data-testid={`plan-tab-${p.id}`}
            className={cx(
              'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold',
              on ? 'bg-accent text-accent-ink' : dark ? 'bg-band-ink/10 text-band-ink' : 'border border-line bg-surface text-muted',
            )}
          >
            {p.createdByName ? t('planBy', { name: p.createdByName }) : p.name}
          </button>
        );
      })}
    </div>
  );
}

/* ---- first-run guide ---- */
type Step = { title: string; text: string; done: boolean; action?: { label: string; to: string } };

/** Three steps for a new account (player, family or coach); hidden once done or dismissed. */
export function Guide() {
  const { state, t, lang, adapter } = useStore();
  const me = useMe();
  const { conns } = useSocialState();
  const [push] = usePushState();
  const key = `tennis-progress:guide:${adapter.myId ?? ''}`;
  const [hidden, setHidden] = useState(() => readJson<boolean>(key, false));
  if (!me || hidden || conns === null) return null;
  const connected = conns.some((c) => c.status === 'accepted');
  const own = state.players.find((p) => p.id === adapter.myId) ?? null;
  const prog = profileProgress(me, own);
  const profileDone = prog.done === prog.total;
  const profileStep: Step = {
    title: t('guideProfile'),
    text: t(me.kind === 'coach' ? 'guideProfileTextCoach' : 'guideProfileText'),
    done: profileDone,
    action: { label: t('completeProfileBtn'), to: 'profile' },
  };
  const steps: Step[] =
    me.kind === 'family'
      ? [
          profileStep,
          { title: t('guideF1'), text: t('guideF1Text'), done: connected },
          me.holder === 'player'
            ? { title: t('guideF3'), text: t('guideF3Text'), done: state.matches.length > 0 || state.logs.length > 0 }
            : { title: t('guideF2'), text: t('guideF2Text'), done: push === 'on' || push === 'unsupported' || !me.notifyLive },
        ]
      : [
          profileStep,
          { title: t('guideC1'), text: t('guideC1Text'), done: state.players.length > 0 },
          { title: t('guideC2'), text: t('guideC2Text'), done: state.plans.some((p) => p.owner === 'coach') },
        ];
  const doneN = steps.filter((s) => s.done).length;
  if (doneN === steps.length) return null;
  const next = steps.find((s) => !s.done);
  return (
    <Card className="mb-5 p-5" data-testid="guide">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t('guideEyebrow', { n: doneN, total: steps.length })}</p>
          <h2 className="font-display text-2xl leading-tight">{t(me.kind === 'coach' ? 'guideTitleCoach' : 'guideTitleFamily')}</h2>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold text-muted hover:bg-sunken"
          onClick={() => {
            writeJson(key, true);
            setHidden(true);
          }}
          data-testid="guide-hide"
        >
          {t('guideHide')}
        </button>
      </div>
      <div className="mb-3 flex gap-1" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={i} className={cx('h-1.5 flex-1 rounded-full', s.done ? 'bg-accent' : 'bg-sunken')} />
        ))}
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3" data-testid={`guide-step-${i + 1}`} data-done={s.done}>
            <span
              className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold', s.done ? 'bg-accent text-accent-ink' : 'border-2 border-line text-muted')}
              aria-hidden="true"
            >
              {s.done ? '✓' : formatNum(lang, i + 1)}
            </span>
            <div className="min-w-0">
              <p className={cx('font-semibold', s.done && 'text-muted line-through decoration-1')}>{s.title}</p>
              {!s.done && <p className="text-[13.5px] text-muted">{s.text}</p>}
              {!s.done && s === next && s.action && (
                <a href={`#${s.action.to}`} className="mt-2 inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink" data-testid="guide-action">
                  {s.action.label} →
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ---- match alerts on this phone ---- */
/** Family, once connected: offer notifications at the moment they make sense. */
export function NotifyPrompt() {
  const { state, t, lang, toast, adapter } = useStore();
  const me = useMe();
  const social = getSocial();
  const { conns } = useSocialState();
  const [push, setPush] = usePushState();
  const key = `tennis-progress:notify-asked:${adapter.myId ?? ''}`;
  const [asked, setAsked] = useState(() => readJson<boolean>(key, false));
  const [busy, setBusy] = useState(false);
  // Parents want to know when their child's match starts; a player holding their own account is on court.
  if (!me || !social || me.kind !== 'family' || me.holder === 'player' || asked || !me.notifyLive) return null;
  if (!(conns ?? []).some((c) => c.status === 'accepted')) return null;
  if (push !== 'off' && push !== 'install') return null;
  const player = state.players.find((p) => p.id === adapter.myId)?.name || me.displayName;
  const dismiss = () => {
    writeJson(key, true);
    setAsked(true);
  };
  return (
    <Card className="mb-5 p-5" data-testid="notify-prompt">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-2xl" aria-hidden="true">
          🔔
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug">{t('notifyPromptTitle', { name: player })}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">{t('notifyPromptText')}</p>
        </div>
      </div>
      {push === 'install' && (
        <div className="mt-3">
          <InstallGuide />
        </div>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button onClick={dismiss} data-testid="notify-later">
          {t(push === 'install' ? 'gotIt' : 'notNow')}
        </Button>
        {push === 'off' && (
          <Button
            variant="primary"
            disabled={busy}
            data-testid="notify-enable"
            onClick={async () => {
              setBusy(true);
              try {
                const r = await enablePush(social.savePush, lang);
                setPush(r);
                if (r === 'on') {
                  toast(t('pushOnToast'));
                  dismiss();
                } else if (r === 'denied') {
                  toast(t('pushDenied'), 'warn');
                  dismiss();
                } else if (r === 'off') toast(t('pushDismissed'), 'warn');
              } catch {
                toast(t('pushFailed'), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('pushTurnOn')}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ---- "the match has started" while the app is open ---- */
const SEEN_KEY = 'tennis-progress:live-seen';
const RECENT_MS = 6 * 3600 * 1000;

/** A live match someone else started for a player I follow: offer to follow it, once per match. */
export function LiveAlert({ route }: { route: string }) {
  const { state, dispatch, t, lang, toast, adapter } = useStore();
  const me = useMe();
  const social = getSocial();
  const { conns } = useSocialState();
  const [seen, setSeen] = useState<string[]>(() => readJson<string[]>(SEEN_KEY, []));
  const [push, setPush] = usePushState();
  if (!me || !social || !me.notifyLive) return null;
  const myId = adapter.myId;
  const now = Date.now();
  // The family's own player, or players this coach is connected to (not everyone the admin can see).
  const follows = (pid: string) =>
    me.kind === 'family' ? pid === myId && me.holder !== 'player' : (conns ?? []).some((c) => c.status === 'accepted' && c.playerId === pid);
  const m: Match | undefined = state.matches.find(
    (x) =>
      x.status === 'live' &&
      follows(x.playerId) &&
      !!x.scorerId &&
      x.scorerId !== myId &&
      x.createdBy !== myId &&
      now - Date.parse(x.createdAt) < RECENT_MS &&
      !seen.includes(x.id) &&
      route !== `match-${x.id}`,
  );
  if (!m) return null;
  const player = state.players.find((p) => p.id === m.playerId)?.name ?? '';
  const mark = () => {
    const next = [...seen, m.id].slice(-60);
    writeJson(SEEN_KEY, next);
    setSeen(next);
  };
  return (
    <Modal open onClose={mark} title={t('liveAlertTitle', { name: player })}>
      <div className="flex flex-col gap-4" data-testid="live-alert">
        <div className="flex items-center gap-3 rounded-2xl bg-bad-soft p-3">
          <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-bad" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('vsName', { name: m.opponent || t('opponent') })}</p>
            <p className="text-[13px] text-muted">{t(m.scorerRole === 'parent' ? 'liveByFamily' : 'liveByCoach')}</p>
          </div>
          <span className="num font-mono text-lg font-semibold" dir="ltr">
            {scoreLine(m, t)}
          </span>
        </div>
        {push === 'off' && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3 text-[13.5px]">
            <span className="min-w-0 flex-1 text-muted">{t('liveAlertPush')}</span>
            <Button
              size="sm"
              data-testid="live-alert-push"
              onClick={async () => {
                try {
                  const r = await enablePush(social.savePush, lang);
                  setPush(r);
                  if (r === 'on') toast(t('pushOnToast'));
                  else if (r === 'denied') toast(t('pushDenied'), 'warn');
                  else if (r === 'off') toast(t('pushDismissed'), 'warn');
                } catch {
                  toast(t('pushFailed'), 'error');
                }
              }}
            >
              {t('pushTurnOn')}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={mark} data-testid="live-alert-later">
            {t('later')}
          </Button>
          <Button
            variant="primary"
            data-testid="live-alert-follow"
            onClick={() => {
              mark();
              if (state.settings.activePlayerId !== m.playerId) dispatch({ type: 'setActivePlayer', id: m.playerId });
              navigate(`match-${m.id}`);
            }}
          >
            {t('followLive')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
