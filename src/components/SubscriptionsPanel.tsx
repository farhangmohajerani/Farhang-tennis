/** Admin: switch subscriptions on, see free / Pro drill counts, and give parents a Family plan (Supabase). */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { formatDate } from '../lib/i18n';
import { drillAccess, planActive, type MyPlan } from '../lib/access';
import { getTeam, type ParentAccount } from '../lib/team';
import { Card, cx, inputCls, SectionTitle } from './ui';

type Choice = 'none' | 'month' | 'year' | 'open';
const DAY = 86_400_000;

export function SubscriptionsPanel() {
  const { state, dispatch, t, lang, toast } = useStore();
  const team = getTeam();
  const paywall = state.settings.paywall;
  const active = state.drills.filter((d) => !d.archived);
  const free = active.filter((d) => drillAccess(d) === 'free').length;
  const parentIds = useMemo(() => [...new Set(state.players.flatMap((p) => p.parentIds ?? []))].sort(), [state.players]);
  const [parents, setParents] = useState<ParentAccount[] | null>(null);
  const [busy, setBusy] = useState('');
  const key = parentIds.join(',');

  const load = () => {
    if (!team || !parentIds.length) return setParents([]);
    team
      .parents(parentIds)
      .then(setParents)
      .catch(() => setParents([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [team, key]);

  const planText = (p: MyPlan | null) =>
    !p || !planActive(p) ? t('noPlan') : p.until === null ? t('planNoEnd') : t('planUntil', { date: formatDate(lang, p.until.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) });

  const choose = async (userId: string, c: Choice) => {
    if (!team) return;
    setBusy(userId);
    try {
      const until = c === 'month' ? new Date(Date.now() + 31 * DAY).toISOString() : c === 'year' ? new Date(Date.now() + 366 * DAY).toISOString() : null;
      await team.setPlan(userId, c === 'none' ? null : { plan: 'family', until });
      toast(t('saved'));
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 160) : String(e), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="p-5">
      <SectionTitle>{t('subsTitle')}</SectionTitle>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{t('paywallLabel')}</p>
          <p className="mt-0.5 text-[13px] text-muted">{t('paywallHelp')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={paywall}
          aria-label={t('paywallLabel')}
          data-testid="paywall-toggle"
          onClick={() => {
            dispatch({ type: 'setPaywall', on: !paywall });
            toast(t(paywall ? 'paywallTurnedOff' : 'paywallTurnedOn'));
          }}
          className={cx('relative h-8 w-14 shrink-0 rounded-full transition', paywall ? 'bg-accent' : 'bg-line')}
        >
          <span className={cx('absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all', paywall ? 'start-7' : 'start-1')} />
        </button>
      </div>
      <p className="num mt-3 text-[13px]" data-testid="access-counts">
        {t('accessCounts', { free, pro: active.length - free })}
      </p>
      <p className="mt-1 text-[12px] text-muted">{t('accessHowTo')}</p>

      {team && (
        <div className="mt-5 border-t border-line pt-4" data-testid="family-plans">
          <p className="font-semibold">{t('familyPlans')}</p>
          <p className="mt-0.5 text-[13px] text-muted">{t('familyPlansHelp')}</p>
          {parents === null ? (
            <p className="mt-3 text-sm text-muted">…</p>
          ) : parents.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('noParents')}</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {parents.map((p) => {
                const kids = state.players.filter((x) => x.parentIds?.includes(p.userId)).map((x) => x.name);
                return (
                  <li key={p.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-parent={p.userId}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" dir="ltr">{p.email || p.userId.slice(0, 8)}</p>
                      <p className="text-[12px] text-muted">
                        {t('parentOf', { names: kids.join(', ') })} · <span data-testid={`plan-status-${p.userId}`}>{planText(p.plan)}</span>
                      </p>
                    </div>
                    <select
                      className={cx(inputCls, 'w-auto py-1.5 text-[13px]')}
                      value=""
                      disabled={busy === p.userId}
                      aria-label={t('changePlan')}
                      data-testid={`plan-${p.userId}`}
                      onChange={(e) => void choose(p.userId, e.target.value as Choice)}
                    >
                      <option value="" disabled>
                        {t('changePlan')}
                      </option>
                      <option value="month">{t('planMonth')}</option>
                      <option value="year">{t('planYear')}</option>
                      <option value="open">{t('planOpen')}</option>
                      <option value="none">{t('removePlan')}</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
