import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { href, navigate } from '../lib/router';
import { formatDate, type DictKey } from '../lib/i18n';
import { activePlayer } from '../lib/reducer';
import { todayISO } from '../lib/schedule';
import { uid } from '../lib/id';
import { chartedStats, daysBetween, evaluateTournament, makeTournament, matchesOfPlayer, phaseOf } from '../lib/competition';
import { METRIC_META, metricValue, summary } from '../lib/match';
import { SURFACES, type GoalMetric, type Tournament } from '../types';
import { Badge, Button, Card, cx, Empty, Field, Icon, inputCls, PageHeader, SectionTitle } from '../components/ui';
import { MatchRow, roundLabel, scoreLine, surfaceLabel, useCanEdit } from '../components/MatchBits';
import { Seg } from './MatchSetup';
import { fmtMetric, metricLabel } from './TournamentDetail';

const SEASON_METRICS: GoalMetric[] = ['firstServeIn', 'firstServeWon', 'secondServeWon', 'returnPointsWon', 'breakPointsSaved', 'doubleFaults', 'winners', 'unforcedErrors'];

function TournamentCard({ tour }: { tour: Tournament }) {
  const { state, t, lang } = useStore();
  const today = todayISO();
  const ev = evaluateTournament(state, tour, today);
  const phase = phaseOf(tour, today);
  const days = daysBetween(today, tour.start);
  const met = ev.evals.filter((x) => x.ev.status === 'met').length;
  return (
    <li>
      <a href={href(`tournament-${tour.id}`)} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-accent" data-tournament-id={tour.id}>
        <div className="flex flex-wrap items-center gap-2">
          <Icon.trophy className="h-5 w-5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{tour.name}</span>
          <Badge tone={phase === 'live' ? 'bad' : phase === 'upcoming' ? 'accent' : 'neutral'}>
            {phase === 'upcoming' ? (days === 1 ? t('startsTomorrow') : t('startsIn', { n: days })) : phase === 'live' ? t('inProgress') : t('finished')}
          </Badge>
        </div>
        <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>
            {formatDate(lang, tour.start, { day: 'numeric', month: 'short' })}–{formatDate(lang, tour.end, { day: 'numeric', month: 'short' })}
          </span>
          {tour.category && <span>{tour.category}</span>}
          {tour.surface && <span>{surfaceLabel(t, tour.surface)}</span>}
          <span>{t(`aim_${tour.aim}` as DictKey)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tour.goals.length > 0 && <Badge tone={met === tour.goals.length ? 'good' : 'neutral'}>{t('goalsMet', { met, n: tour.goals.length })}</Badge>}
          {ev.reached && <Badge tone="band">{t('reachedRound', { round: roundLabel(t, ev.reached) })}</Badge>}
          {(ev.record.won > 0 || ev.record.lost > 0) && <Badge>{t('recordWL', { w: ev.record.won, l: ev.record.lost })}</Badge>}
        </div>
      </a>
    </li>
  );
}

function NewTournament({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { dispatch, t, toast } = useStore();
  const [f, setF] = useState({ name: '', start: '', end: '', category: '', surface: null as Tournament['surface'] });
  const valid = f.name.trim() && f.start && f.end && f.end >= f.start;
  return (
    <Card className="mb-5 p-5">
      <form
        className="grid gap-3 sm:grid-cols-2"
        data-testid="new-tournament"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const tour = makeTournament({ id: uid('tour'), playerId, name: f.name.trim(), start: f.start, end: f.end, category: f.category.trim(), surface: f.surface });
          dispatch({ type: 'addTournament', tournament: tour });
          toast(t('tournamentSaved'));
          navigate(`tournament-${tour.id}`);
        }}
      >
        <div className="sm:col-span-2">
          <Field label={t('tournamentName')} htmlFor="nt-name">
            <input id="nt-name" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
          </Field>
        </div>
        <Field label={t('start')} htmlFor="nt-start">
          <input id="nt-start" type="date" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end && f.end >= e.target.value ? f.end : e.target.value })} />
        </Field>
        <Field label={t('end')} htmlFor="nt-end">
          <input id="nt-end" type="date" className={inputCls} value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('tournamentCategory')} hint={t('tournamentCategoryHint')} htmlFor="nt-category">
            <input id="nt-category" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[13px] font-semibold">{t('surface')}</span>
          <Seg label={t('surface')} value={f.surface ?? ('' as const)} onChange={(v) => setF({ ...f, surface: v || null })} options={SURFACES.map((s) => ({ value: s, label: surfaceLabel(t, s), testid: `nt-surface-${s}` }))} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid} data-testid="create-tournament">
            {t('createTournament')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function Compete({ tab }: { tab: 'matches' | 'tournaments' }) {
  const { state, t } = useStore();
  const player = activePlayer(state);
  const canEdit = useCanEdit();
  const [adding, setAdding] = useState(false);
  const matches = useMemo(() => (player ? matchesOfPlayer(state, player.id).reverse() : []), [state, player]);
  if (!player) return <div className="py-10"><Empty>{t('noPlayerYet')}</Empty></div>;
  const today = todayISO();
  const tournaments = state.tournaments.filter((x) => x.playerId === player.id);
  const upcoming = tournaments.filter((x) => x.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  const past = tournaments.filter((x) => x.end < today).sort((a, b) => b.start.localeCompare(a.start));
  const live = matches.filter((m) => m.status === 'live');
  const record = matches.reduce(
    (acc, m) => {
      const w = summary(m).winner;
      if (w === 'p') acc.won++;
      else if (w === 'o') acc.lost++;
      return acc;
    },
    { won: 0, lost: 0 },
  );
  const st = chartedStats(matches);

  return (
    <div>
      <PageHeader eyebrow={player.name} title={t('competeTitle')}>
        {canEdit && tab === 'matches' && (
          <a href={href('newmatch')} className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink" data-testid="new-match">
            + {t('newMatch')}
          </a>
        )}
        {canEdit && tab === 'tournaments' && !adding && (
          <Button variant="primary" onClick={() => setAdding(true)} data-testid="open-new-tournament">
            + {t('addTournament')}
          </Button>
        )}
      </PageHeader>

      <nav className="mb-5 flex gap-1 rounded-full border border-line bg-surface p-1" aria-label={t('competeTitle')}>
        {(['matches', 'tournaments'] as const).map((k) => (
          <a
            key={k}
            href={href(k)}
            aria-current={tab === k ? 'page' : undefined}
            className={cx('flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold', tab === k ? 'bg-band text-band-ink' : 'text-muted hover:text-ink')}
            data-testid={`tab-${k}`}
          >
            {t(`tab_${k}` as DictKey)}
            <span className="num ms-1.5 text-[12px] opacity-70">{k === 'matches' ? matches.length : tournaments.length}</span>
          </a>
        ))}
      </nav>

      {tab === 'matches' ? (
        <div className="flex flex-col gap-6">
          {live.map((m) => (
            <a key={m.id} href={href(`match-${m.id}`)} className="flex flex-wrap items-center gap-3 rounded-2xl border border-bad/40 bg-bad-soft p-4" data-testid="live-banner">
              <Badge tone="bad"><span className="live-dot" aria-hidden="true" /> {t('live')}</Badge>
              <span className="font-semibold">{t('vsName', { name: m.opponent || t('opponent') })}</span>
              <span className="num font-mono font-semibold" dir="ltr">{scoreLine(m, t)}</span>
              <span className="ms-auto text-sm font-semibold text-bad">{canEdit ? t('continueCharting') : t('followLive')} →</span>
            </a>
          ))}

          <section>
            <SectionTitle aside={<span className="num text-sm text-muted" data-testid="record">{t('recordLabel')}: {t('recordWL', { w: record.won, l: record.lost })}</span>}>
              {t('seasonStats')}
            </SectionTitle>
            {st.matches === 0 ? (
              <Empty>{t('noChartedYet')}</Empty>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="season-stats">
                  {SEASON_METRICS.map((mm) => {
                    const v = metricValue(mm, st);
                    return (
                      <div key={mm} className="flex flex-col gap-0.5 rounded-xl bg-sunken p-3">
                        <span className="eyebrow">{metricLabel(t, mm)}</span>
                        <span className="num font-mono text-xl font-medium">{v === null ? '—' : fmtMetric(mm, v)}</span>
                        {METRIC_META[mm].unit === 'perMatch' && <span className="text-[11px] text-muted">{t('perMatchUnit')}</span>}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[12px] text-muted">{t('chartedMatchesN', { n: st.matches })}</p>
              </>
            )}
          </section>

          <section>
            <SectionTitle>{t('allMatches')}</SectionTitle>
            {matches.length === 0 ? (
              <Empty>
                {t('noMatches')}
                {canEdit && (
                  <>
                    {' '}
                    <a href={href('newmatch')} className="font-semibold text-accent">{t('newMatch')} →</a>
                  </>
                )}
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" data-testid="match-list">
                {matches.map((m) => (
                  <MatchRow key={m.id} m={m} />
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {adding && <NewTournament playerId={player.id} onClose={() => setAdding(false)} />}
          <p className="max-w-[65ch] text-sm text-muted">{t('tournamentsIntro')}</p>
          <section>
            <SectionTitle>{t('upcomingT')}</SectionTitle>
            {upcoming.length === 0 ? (
              <Empty>{t('noTournaments')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2" data-testid="upcoming-tournaments">
                {upcoming.map((x) => (
                  <TournamentCard key={x.id} tour={x} />
                ))}
              </ul>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <SectionTitle>{t('pastT')}</SectionTitle>
              <ul className="grid gap-3 md:grid-cols-2" data-testid="past-tournaments">
                {past.map((x) => (
                  <TournamentCard key={x.id} tour={x} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
