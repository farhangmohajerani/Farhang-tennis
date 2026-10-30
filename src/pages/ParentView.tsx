import { useStore } from '../lib/store';
import { KPI_KEYS, type Plan } from '../types';
import { catLabel, formatDate, type DictKey } from '../lib/i18n';
import { href } from '../lib/router';
import { activePlayer, drillMap, plansForPlayer, primaryPlan } from '../lib/reducer';
import { findConflicts, todayISO } from '../lib/schedule';
import { stats } from '../lib/selectors';
import { uid } from '../lib/id';
import { Badge, Button, Card, cx, Empty, KpiTile, PageHeader, SectionTitle } from '../components/ui';
import { ParentConnect } from '../components/ParentLink';

export function ParentView() {
  const { state, dispatch, t, lang, toast, adapter } = useStore();
  const player = activePlayer(state);
  if (!player) return <Empty>No player.</Empty>;
  const plan = primaryPlan(state, player.id);
  const drills = drillMap(state);
  const today = todayISO();
  const coach = state.people.find((p) => p.id === player.coachId);
  const ownPlan = plansForPlayer(state, player.id).find((p) => p.owner === 'parent');
  const conflicts = plan ? findConflicts(plan.sessions, state.tournaments) : [];
  const levels = state.settings.levelDefaults[player.level];

  const startOwn = () => {
    if (!plan) return;
    const copy: Plan = {
      ...structuredClone(plan),
      id: uid('plan'),
      name: `${player.name} — self-guided`,
      owner: 'parent',
      sharedWithCoachId: null,
      createdAt: new Date().toISOString(),
      sessions: plan.sessions.map((s) => ({ ...structuredClone(s), id: uid('sess'), status: 'planned', coachNote: '' })),
    };
    dispatch({ type: 'savePlan', plan: copy });
    toast(t('planSaved'));
  };

  return (
    <div>
      <PageHeader eyebrow={t('readOnly')} title={t('parentTitle')} />
      <p className="-mt-2 mb-6 max-w-[65ch] text-[17px]">{t('parentIntro', { name: player.name })}</p>

      {player.goals && (
        <Card className="mb-6 p-5">
          <div className="eyebrow mb-1">{t('goals')}</div>
          <p>{player.goals}</p>
          {plan?.priority && (
            <>
              <div className="eyebrow mt-3 mb-1">{t('priority')}</div>
              <p className="font-semibold">{plan.priority}</p>
            </>
          )}
        </Card>
      )}

      <SectionTitle>{t('calendar')}</SectionTitle>
      {!plan ? (
        <Empty>{t('noUpcoming')}</Empty>
      ) : (
        <ol className="relative flex flex-col gap-3 border-s-2 border-line ps-5" data-testid="parent-calendar">
          {plan.sessions.map((s) => {
            const sl = state.logs.filter((l) => l.sessionId === s.id);
            const st = stats(sl);
            const c = conflicts.find((x) => x.session.id === s.id);
            const isNext = s.status === 'planned' && s.date >= today && plan.sessions.find((x) => x.status === 'planned' && x.date >= today)?.id === s.id;
            return (
              <li key={s.id} className="relative">
                <span className={cx('absolute -start-[29px] top-5 h-4 w-4 rounded-full border-2 border-bg', s.status === 'completed' ? 'bg-accent' : isNext ? 'bg-band' : 'bg-line')} aria-hidden="true" />
                <Card className={cx('p-4', isNext && 'border-accent')} as="article">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num font-mono text-[13px] text-muted">{formatDate(lang, s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <h3 className="font-semibold">
                      {s.index}. {s.title}
                    </h3>
                    <Badge tone={s.status === 'completed' ? 'good' : s.status === 'skipped' ? 'warn' : 'neutral'}>{t(`status_${s.status}` as DictKey)}</Badge>
                    {s.kind !== 'training' && <Badge tone="accent">{t(`kind_${s.kind}` as DictKey)}</Badge>}
                    {isNext && <Badge tone="band">{t('nextSession')}</Badge>}
                    {c && <Badge tone="warn">{t('conflict', { t: c.tournament.name })}</Badge>}
                  </div>
                  {s.focus && <p className="mt-1 text-sm text-muted">{s.focus}</p>}
                  <h4 className="eyebrow mt-3 mb-1">{t('whatAndWhy')}</h4>
                  <ul className="flex flex-col gap-1.5">
                    {s.items.map((it) => {
                      const d = drills.get(it.drillId);
                      return (
                        <li key={it.drillId} className="text-sm">
                          <a href={href(`drill-${it.drillId}`)} className="font-semibold text-accent">
                            {d?.name ?? it.drillId}
                          </a>
                          {d && <span className="text-muted"> · {catLabel(lang, d.category)} · {d.durationMin}′</span>}
                          <div className="text-muted">{it.reason}</div>
                        </li>
                      );
                    })}
                  </ul>
                  {s.coachNote && (
                    <blockquote className="mt-3 rounded-xl bg-sunken p-3 text-sm">
                      <span className="eyebrow block">{t('coachNote')}</span>
                      {s.coachNote}
                    </blockquote>
                  )}
                  {sl.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {KPI_KEYS.map((k) => (
                        <KpiTile key={k} k={k} r={st.kpis[k]} levels={levels[k]} compact />
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {adapter.kind === 'artifact' && adapter.maxRole === 'parent' && (
        <section className="mt-8">
          <p className="mb-2 text-sm text-muted">{t('addAnotherChild')}</p>
          <ParentConnect compact />
        </section>
      )}
      {adapter.kind !== 'artifact' && (
      <section className="mt-8">
        <SectionTitle>{t('ownPlan')}</SectionTitle>
        <Card className="p-5">
          <p className="mb-3 text-sm text-muted">{t('ownPlanHelp')}</p>
          {!ownPlan ? (
            <Button variant="primary" onClick={startOwn} disabled={!plan} data-testid="start-own-plan">
              {t('startOwnPlan')}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <strong>{ownPlan.name}</strong>
              <span className="num text-sm text-muted">{ownPlan.sessions.length} {t('sessions')}</span>
              {ownPlan.sharedWithCoachId ? (
                <>
                  <Badge tone="good">{t('sharedWith', { name: coach?.name ?? '' })}</Badge>
                  <Button size="sm" onClick={() => dispatch({ type: 'savePlan', plan: { ...ownPlan, sharedWithCoachId: null } })}>
                    {t('unshare')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="share-plan"
                  onClick={() => {
                    dispatch({ type: 'savePlan', plan: { ...ownPlan, sharedWithCoachId: player.coachId } });
                    toast(t('sharedWith', { name: coach?.name ?? '' }));
                  }}
                >
                  {t('shareWithCoach')}
                </Button>
              )}
            </div>
          )}
        </Card>
      </section>
      )}
    </div>
  );
}
