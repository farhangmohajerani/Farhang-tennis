import { useStore } from '../lib/store';
import { KPI_KEYS } from '../types';
import { formatDate, type DictKey } from '../lib/i18n';
import { href } from '../lib/router';
import { activePlayer, drillMap, primaryPlan } from '../lib/reducer';
import { playerLogs, stats } from '../lib/selectors';
import { findConflicts, todayISO } from '../lib/schedule';
import { Badge, Card, Empty, Icon, KpiTile, PageHeader, SectionTitle } from '../components/ui';
import { PlayerForm } from '../components/Players';
import { ParentConnect } from '../components/ParentLink';

export function Dashboard() {
  const { state, t, lang, adapter } = useStore();
  const player = activePlayer(state);
  if (!player) {
    const canAdd = state.settings.role !== 'parent' && adapter.canWrite !== false;
    if (adapter.kind === 'artifact' && adapter.maxRole === 'parent') {
      return (
        <div className="py-6">
          <ParentConnect />
        </div>
      );
    }
    return (
      <div>
        <PageHeader eyebrow={t('appName')} title={t('firstPlayerTitle')} />
        <p className="-mt-2 mb-5 max-w-[65ch] text-muted">{t('firstPlayerHelp')}</p>
        {canAdd ? (
          <Card className="max-w-2xl p-5">
            <PlayerForm />
          </Card>
        ) : (
          <Empty>{t('noUpcoming')}</Empty>
        )}
      </div>
    );
  }
  const plan = primaryPlan(state, player.id);
  const drills = drillMap(state);
  const today = todayISO();
  const sessions = plan?.sessions ?? [];
  const upcoming = sessions.filter((s) => s.status === 'planned' && s.date >= today);
  const next = upcoming[0];
  const done = sessions.filter((s) => s.status === 'completed').length;
  const logs = playerLogs(state, player.id);
  const practice = stats(logs.filter((l) => l.context !== 'match'));
  const levels = state.settings.levelDefaults[player.level];
  const tournaments = state.tournaments.filter((x) => x.playerId === player.id && x.end >= today);
  const conflicts = plan ? findConflicts(plan.sessions, state.tournaments) : [];
  const isCoach = state.settings.role !== 'parent';

  return (
    <div>
      <PageHeader eyebrow={plan?.name} title={t('nav_dashboard')} />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <div className="bg-band p-5 text-band-ink">
            <div className="eyebrow !text-band-muted mb-1">{t('nextSession')}</div>
            {next ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 className="font-display text-[30px] leading-tight" data-testid="next-session-title">
                    {t('session')} {next.index} · {next.title}
                  </h2>
                  <span className="num text-band-muted">{formatDate(lang, next.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </div>
                <p className="mt-1 text-band-muted">{next.focus}</p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p>{sessions.length ? t('noUpcoming') : t('noPlanYet')}</p>
                {isCoach && (
                  <a href={href('planner')} className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
                    {t('buildPlan')} →
                  </a>
                )}
              </div>
            )}
          </div>
          {next && (
            <div className="p-5">
              <ol className="flex flex-col divide-y divide-line">
                {next.items.map((it, i) => {
                  const d = drills.get(it.drillId);
                  return (
                    <li key={it.drillId} className="flex gap-3 py-2.5">
                      <span className="num mt-0.5 font-mono text-[13px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <a href={href(`drill-${it.drillId}`)} className="font-semibold hover:text-accent">
                          {d?.name ?? it.drillId}
                        </a>
                        <p className="text-sm text-muted">{it.reason}</p>
                      </div>
                      <span className="num ms-auto shrink-0 text-[12px] text-muted">{d?.durationMin} {t('minutes')}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                {isCoach && (
                  <a href={href(`session-${next.id}`)} className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
                    {t('executeTitle')} →
                  </a>
                )}
                <a href={href('parent')} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-semibold">
                  {t('nav_parent')}
                </a>
              </div>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <SectionTitle>{t('planProgress')}</SectionTitle>
            <div className="num mb-2 text-sm" data-testid="plan-progress">{t('sessionsDone', { done, total: sessions.length })}</div>
            <div className="flex gap-1" aria-hidden="true">
              {sessions.map((s) => (
                <span key={s.id} title={`${s.index}`} className={`h-2.5 flex-1 rounded-full ${s.status === 'completed' ? 'bg-accent' : s.status === 'skipped' ? 'bg-warn' : 'bg-sunken'}`} />
              ))}
            </div>
            {conflicts.length > 0 && (
              <p className="mt-3 rounded-xl bg-warn-soft p-2.5 text-[13px] font-semibold text-warn">
                {conflicts.map((c) => `${t('session')} ${c.session.index}: ${t('conflict', { t: c.tournament.name })}`).join(' · ')}
                {isCoach && (
                  <>
                    {' '}
                    <a href={href('planner')} className="underline">{t('nav_planner')} →</a>
                  </>
                )}
              </p>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle>{t('tournaments')}</SectionTitle>
            {tournaments.length ? (
              <ul className="flex flex-col gap-2">
                {tournaments.map((x) => (
                  <li key={x.id} className="flex items-center gap-3">
                    <Icon.trophy className="h-5 w-5 text-accent" />
                    <span className="font-semibold">{x.name}</span>
                    <span className="num ms-auto text-[13px] text-muted">
                      {formatDate(lang, x.start, { day: 'numeric', month: 'short' })}–{formatDate(lang, x.end, { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </Card>
        </div>
      </div>

      <section className="mt-8">
        <SectionTitle aside={<a href={href('progress')} className="text-sm font-semibold text-accent">{t('nav_progress')} →</a>}>{t('kpiOverview')}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {KPI_KEYS.map((k) => (
            <KpiTile key={k} k={k} r={practice.kpis[k]} levels={levels[k]} />
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">{t('provisional')}</p>
      </section>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <section>
          <SectionTitle>{t('upcoming')}</SectionTitle>
          {upcoming.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
              {upcoming.slice(0, 6).map((s) => {
                const c = conflicts.find((x) => x.session.id === s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <span className="num w-24 shrink-0 text-[13px] text-muted">{formatDate(lang, s.date)}</span>
                    <span className="min-w-0 flex-1 font-semibold">
                      {s.index}. {s.title}
                    </span>
                    <Badge tone={s.kind === 'training' ? 'neutral' : 'accent'}>{t(`kind_${s.kind}` as DictKey)}</Badge>
                    {c && <Badge tone="warn">{t('conflict', { t: c.tournament.name })}</Badge>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>{t('noUpcoming')}</Empty>
          )}
        </section>
        <section>
          <SectionTitle>{t('recentLogs')}</SectionTitle>
          {logs.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
              {logs.slice(-6).reverse().map((l) => {
                const s = stats([l]);
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <span className="num w-24 shrink-0 text-[13px] text-muted">{formatDate(lang, l.date)}</span>
                    <a href={href(`drill-${l.drillId}`)} className="min-w-0 flex-1 font-semibold hover:text-accent">
                      {drills.get(l.drillId)?.name ?? l.drillId}
                    </a>
                    <span className="num font-mono text-[12px] text-muted">
                      D {s.kpis.decision.ok ? Math.round(s.kpis.decision.value * 100) + '%' : '—'} · X {s.kpis.execution.ok ? Math.round(s.kpis.execution.value * 100) + '%' : '—'}
                    </span>
                    <Badge tone={l.context === 'match' ? 'band' : l.context === 'baseline' ? 'warn' : 'neutral'}>{t(`ctx_${l.context}` as DictKey)}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>{t('noLogs')}</Empty>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
        <div className="eyebrow mb-2">{t('methodology')}</div>
        <p className="font-display text-xl leading-snug">{t('method_steps')}</p>
        <p className="mt-2 text-sm text-muted">{t('winLossNote')}</p>
      </section>
    </div>
  );
}
