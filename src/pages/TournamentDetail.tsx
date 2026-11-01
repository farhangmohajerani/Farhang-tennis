import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { href, navigate } from '../lib/router';
import { formatDate, type DictKey } from '../lib/i18n';
import { drillMap, primaryPlan } from '../lib/reducer';
import { addDays, findConflicts, taperWarnings, todayISO } from '../lib/schedule';
import { uid } from '../lib/id';
import { daysBetween, evaluateTournament, phaseOf, PREP_DAYS, type GoalEval } from '../lib/competition';
import { METRIC_META, metricValue } from '../lib/match';
import { GOAL_METRICS, MATCH_ROUNDS, ROUNDS, SURFACES, type Goal, type GoalMetric, type Round, type Tournament } from '../types';
import { Badge, Button, Card, ConfirmButton, cx, Empty, Field, Icon, inputCls, PageHeader, SectionTitle } from '../components/ui';
import { GoalChip, MatchRow, roundLabel, surfaceLabel, useCanEdit } from '../components/MatchBits';
import { Seg } from './MatchSetup';
import { matchesQuery } from './Library';

type T = ReturnType<typeof useStore>['t'];

export function metricLabel(t: T, m: GoalMetric) {
  return t(`metric_${m}` as DictKey);
}

export function fmtMetric(m: GoalMetric, v: number): string {
  return METRIC_META[m].unit === 'pct' ? `${Math.round(v)}%` : (Math.round(v * 10) / 10).toString();
}

export function goalTitle(g: Goal, t: T, drillName: (id: string) => string): string {
  switch (g.kind) {
    case 'outcome':
      return g.round === 'W' ? t('goalWinTitle') : t('goalReach', { round: roundLabel(t, g.round) });
    case 'stat': {
      const unit = METRIC_META[g.metric].unit === 'pct' ? '%' : ` ${t('perMatchUnit')}`;
      return `${metricLabel(t, g.metric)} ${g.op === 'gte' ? '≥' : '≤'} ${g.value}${unit}`;
    }
    case 'drill':
      return `${drillName(g.drillId)}${g.target !== null ? ` · ${t('execTarget', { n: g.target })}` : ''}`;
    case 'custom':
      return g.text;
  }
}

export function goalActual(g: Goal, ev: GoalEval, t: T, matches: number): string {
  switch (g.kind) {
    case 'outcome':
      return ev.reached ? t('reachedRound', { round: roundLabel(t, ev.reached) }) : t('noResultYet');
    case 'stat':
      return ev.actual === null ? t('noChartedData') : t('actualSoFar', { v: fmtMetric(g.metric, ev.actual), n: matches });
    case 'drill':
      return ev.logs ? t('practisedN', { n: ev.logs, pct: ev.actual === null ? '—' : `${Math.round(ev.actual)}%` }) : t('notPractisedYet');
    case 'custom':
      return '';
  }
}

function GoalAdder({ onAdd }: { onAdd: (g: Goal) => void }) {
  const { state, t } = useStore();
  const [kind, setKind] = useState<Goal['kind']>('outcome');
  const [round, setRound] = useState<Round>('QF');
  const [metric, setMetric] = useState<GoalMetric>('firstServeIn');
  const [op, setOp] = useState<'gte' | 'lte'>(METRIC_META.firstServeIn.op);
  const [value, setValue] = useState(String(METRIC_META.firstServeIn.value));
  const [q, setQ] = useState('');
  const [drillId, setDrillId] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const drills = drillMap(state);
  const results = useMemo(() => (q.trim().length < 2 ? [] : state.drills.filter((d) => !d.archived && matchesQuery(d, q.trim())).slice(0, 6)), [q, state.drills]);
  const num = Number(value);
  const ok = kind === 'outcome' || (kind === 'stat' && value.trim() !== '' && Number.isFinite(num) && num >= 0) || (kind === 'drill' && !!drillId) || (kind === 'custom' && text.trim().length > 0);

  const add = () => {
    if (!ok) return;
    const id = uid('goal');
    if (kind === 'outcome') onAdd({ id, kind, round });
    else if (kind === 'stat') onAdd({ id, kind, metric, op, value: num });
    else if (kind === 'drill' && drillId) {
      const tg = parseInt(target, 10);
      onAdd({ id, kind, drillId, target: Number.isFinite(tg) ? Math.max(0, Math.min(100, tg)) : null });
      setDrillId(null);
      setQ('');
      setTarget('');
    } else if (kind === 'custom') {
      onAdd({ id, kind, text: text.trim(), achieved: null });
      setText('');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3" data-testid="goal-adder">
      <span className="text-[13px] font-semibold">+ {t('addGoal')}</span>
      <Seg
        label={t('addGoal')}
        value={kind}
        onChange={setKind}
        options={(['outcome', 'stat', 'drill', 'custom'] as const).map((k) => ({ value: k, label: t(`goal_${k}` as DictKey), testid: `goal-kind-${k}` }))}
      />
      {kind === 'outcome' && (
        <Field label={t('targetRound')} htmlFor="goal-round">
          <select id="goal-round" className={inputCls} value={round} onChange={(e) => setRound(e.target.value as Round)}>
            {ROUNDS.filter((r) => r !== 'Q' && r !== 'RR').map((r) => (
              <option key={r} value={r}>
                {r === 'W' ? t('goalWinTitle') : t('goalReach', { round: roundLabel(t, r) })}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind === 'stat' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_120px]">
          <Field label={t('metric')} htmlFor="goal-metric">
            <select
              id="goal-metric"
              className={inputCls}
              value={metric}
              onChange={(e) => {
                const mm = e.target.value as GoalMetric;
                setMetric(mm);
                setOp(METRIC_META[mm].op);
                setValue(String(METRIC_META[mm].value));
              }}
            >
              {GOAL_METRICS.map((mm) => (
                <option key={mm} value={mm}>
                  {metricLabel(t, mm)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('comparison')} htmlFor="goal-op">
            <select id="goal-op" className={inputCls} value={op} onChange={(e) => setOp(e.target.value as 'gte' | 'lte')}>
              <option value="gte">≥ {t('atLeast')}</option>
              <option value="lte">≤ {t('atMost')}</option>
            </select>
          </Field>
          <Field label={METRIC_META[metric].unit === 'pct' ? t('valuePct') : t('valuePerMatch')} htmlFor="goal-value">
            <input id="goal-value" inputMode="decimal" className={cx(inputCls, 'num font-mono')} value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
        </div>
      )}
      {kind === 'drill' && (
        <div className="flex flex-col gap-2">
          {drillId ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sunken p-2.5 text-sm">
              <span className="min-w-0 flex-1 font-semibold">{drills.get(drillId)?.name ?? drillId}</span>
              <Button size="sm" variant="ghost" onClick={() => setDrillId(null)}>{t('change')}</Button>
            </div>
          ) : (
            <Field label={t('focusDrill')} htmlFor="goal-drill-q">
              <input id="goal-drill-q" type="search" className={inputCls} placeholder={t('searchDrills')} value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
          )}
          {!drillId && results.length > 0 && (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
              {results.map((d) => (
                <li key={d.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent-soft" onClick={() => setDrillId(d.id)}>
                    <span className="min-w-0 flex-1 font-semibold">{d.name}</span>
                    <span className="shrink-0 font-mono text-[12px] text-muted">{d.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label={`${t('execTargetLabel')} (${t('optional')})`} htmlFor="goal-target">
            <input id="goal-target" inputMode="numeric" className={cx(inputCls, 'num w-32 font-mono')} value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} placeholder="%" />
          </Field>
          <p className="text-[12px] text-muted">{t('drillGoalHelp', { n: PREP_DAYS / 7 })}</p>
        </div>
      )}
      {kind === 'custom' && (
        <Field label={t('goalText')} htmlFor="goal-text">
          <input id="goal-text" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('goalTextHint')} />
        </Field>
      )}
      <Button variant="primary" className="self-start" disabled={!ok} onClick={add} data-testid="add-goal">
        {t('addGoal')}
      </Button>
    </div>
  );
}

function TournamentEditForm({ tour, onDone }: { tour: Tournament; onDone: () => void }) {
  const { dispatch, t, toast } = useStore();
  const [f, setF] = useState(tour);
  const valid = f.name.trim() && f.start && f.end && f.end >= f.start;
  return (
    <Card className="mb-5 p-5">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          dispatch({ type: 'upsertTournament', tournament: { ...f, name: f.name.trim(), location: f.location.trim(), category: f.category.trim() } });
          toast(t('tournamentSaved'));
          onDone();
        }}
        data-testid="tournament-form"
      >
        <div className="sm:col-span-2">
          <Field label={t('tournamentName')} htmlFor="tf-name">
            <input id="tf-name" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
        </div>
        <Field label={t('start')} htmlFor="tf-start">
          <input id="tf-start" type="date" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} />
        </Field>
        <Field label={t('end')} htmlFor="tf-end">
          <input id="tf-end" type="date" className={inputCls} value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </Field>
        <Field label={t('location')} htmlFor="tf-location">
          <input id="tf-location" className={inputCls} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label={t('tournamentCategory')} hint={t('tournamentCategoryHint')} htmlFor="tf-category">
          <input id="tf-category" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[13px] font-semibold">{t('surface')}</span>
          <Seg label={t('surface')} value={f.surface ?? ('' as const)} onChange={(v) => setF({ ...f, surface: v || null })} options={SURFACES.map((s) => ({ value: s, label: surfaceLabel(t, s), testid: `tf-surface-${s}` }))} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={f.indoor} onChange={(e) => setF({ ...f, indoor: e.target.checked })} />
          {t('indoor')}
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button onClick={onDone}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid} data-testid="save-tournament">{t('save')}</Button>
        </div>
      </form>
    </Card>
  );
}

function TextCard({ id, label, hint, value, canEdit, onSave }: { id: string; label: string; hint?: string; value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const { t } = useStore();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Field label={label} htmlFor={id}>
      {canEdit ? (
        <>
          <textarea id={id} rows={3} className={inputCls} value={v} placeholder={hint} onChange={(e) => setV(e.target.value)} />
          <span className="flex justify-end">
            <Button size="sm" variant="primary" disabled={v === value} onClick={() => onSave(v)} data-testid={`save-${id}`}>
              {t('save')}
            </Button>
          </span>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{value || '—'}</p>
      )}
    </Field>
  );
}

export function TournamentDetail({ id }: { id: string }) {
  const { state, dispatch, t, lang, toast } = useStore();
  const canEdit = useCanEdit();
  const tour = state.tournaments.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const today = todayISO();
  const ev = useMemo(() => (tour ? evaluateTournament(state, tour, today) : null), [state, tour, today]);
  if (!tour || !ev) {
    return (
      <div className="py-10">
        <Empty>
          {t('tournamentNotFound')} <a className="font-semibold text-accent" href={href('tournaments')}>{t('tab_tournaments')} →</a>
        </Empty>
      </div>
    );
  }
  const drills = drillMap(state);
  const drillName = (d: string) => drills.get(d)?.name ?? d;
  const save = (patch: Partial<Tournament>) => dispatch({ type: 'upsertTournament', tournament: { ...tour, ...patch } });
  const phase = phaseOf(tour, today);
  const daysTo = daysBetween(today, tour.start);
  const plan = primaryPlan(state, tour.playerId);
  const prepFrom = addDays(tour.start, -21);
  const prepSessions = plan ? plan.sessions.filter((s) => s.date >= prepFrom && s.date < tour.start) : [];
  const tapers = plan ? taperWarnings(plan.sessions, [tour]) : [];
  const conflicts = plan ? findConflicts(plan.sessions, [tour]) : [];
  const met = ev.evals.filter((x) => x.ev.status === 'met').length;
  const st = ev.stats;

  return (
    <div>
      <PageHeader
        eyebrow={`${formatDate(lang, tour.start, { day: 'numeric', month: 'short' })}–${formatDate(lang, tour.end, { day: 'numeric', month: 'short', year: 'numeric' })}${tour.location ? ` · ${tour.location}` : ''}`}
        title={tour.name}
      >
        {canEdit && !editing && (
          <Button size="sm" onClick={() => setEditing(true)} data-testid="edit-tournament">
            {t('edit')}
          </Button>
        )}
        {canEdit && (
          <a href={href(`newmatch-${tour.id}`)} className="inline-flex h-8 items-center rounded-full bg-accent px-3 text-[13px] font-semibold text-accent-ink" data-testid="add-match-here">
            + {t('addMatchHere')}
          </a>
        )}
      </PageHeader>

      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={phase === 'live' ? 'bad' : phase === 'upcoming' ? 'accent' : 'neutral'}>
          {phase === 'live' && <span className="live-dot" aria-hidden="true" />}
          {phase === 'upcoming' ? (daysTo === 1 ? t('startsTomorrow') : t('startsIn', { n: daysTo })) : phase === 'live' ? t('inProgress') : t('finished')}
        </Badge>
        {tour.category && <Badge>{tour.category}</Badge>}
        {tour.surface && <Badge>{surfaceLabel(t, tour.surface)}</Badge>}
        <Badge>{tour.indoor ? t('indoor') : t('outdoor')}</Badge>
        {ev.reached && <Badge tone="band">{t('reachedRound', { round: roundLabel(t, ev.reached) })}</Badge>}
        {(ev.record.won > 0 || ev.record.lost > 0) && <Badge>{t('recordWL', { w: ev.record.won, l: ev.record.lost })}</Badge>}
      </div>

      {editing && <TournamentEditForm tour={tour} onDone={() => setEditing(false)} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-5">
            <SectionTitle>{t('aimTitle')}</SectionTitle>
            {canEdit ? (
              <Seg
                label={t('aimTitle')}
                value={tour.aim}
                onChange={(aim) => save({ aim })}
                options={(['result', 'training', 'both'] as const).map((a) => ({ value: a, label: t(`aim_${a}` as DictKey), testid: `aim-${a}` }))}
              />
            ) : (
              <p className="font-semibold">{t(`aim_${tour.aim}` as DictKey)}</p>
            )}
            <p className="mt-2 text-sm text-muted">{t(`aimHelp_${tour.aim}` as DictKey)}</p>
          </Card>

          <Card className="p-5">
            <SectionTitle aside={tour.goals.length > 0 && <span className="num text-sm text-muted" data-testid="goals-met">{t('goalsMet', { met, n: tour.goals.length })}</span>}>
              {t('goalsTitle')}
            </SectionTitle>
            {tour.goals.length === 0 && <p className="mb-3 text-sm text-muted">{t('noGoalsYet')}</p>}
            <ul className="mb-4 flex flex-col gap-2" data-testid="goal-list">
              {ev.evals.map(({ goal: g, ev: e }) => (
                <li key={g.id} className="rounded-xl border border-line p-3" data-goal-kind={g.kind} data-goal-status={e.status}>
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="eyebrow mt-0.5 w-full sm:w-28 sm:shrink-0">{t(`goal_${g.kind}` as DictKey)}</span>
                    <span className="ui-bidi min-w-0 flex-1 font-semibold">
                      {g.kind === 'drill' ? (
                        <a href={href(`drill-${g.drillId}`)} className="hover:text-accent">
                          {goalTitle(g, t, drillName)}
                        </a>
                      ) : (
                        goalTitle(g, t, drillName)
                      )}
                    </span>
                    <GoalChip status={e.status} />
                    {canEdit && (
                      <button type="button" className="h-7 w-7 rounded-full text-bad hover:bg-bad-soft" aria-label={`${t('remove')} ${goalTitle(g, t, drillName)}`} onClick={() => save({ goals: tour.goals.filter((x) => x.id !== g.id) })}>
                        <Icon.x className="mx-auto h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {goalActual(g, e, t, st.matches) && <p className="ui-bidi num mt-1 text-[13px] text-muted sm:ms-[120px]">{goalActual(g, e, t, st.matches)}</p>}
                  {g.kind === 'custom' && canEdit && (
                    <div className="mt-2 flex flex-wrap gap-1.5 sm:ms-[120px]">
                      {([true, false, null] as const).map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          aria-pressed={g.achieved === v}
                          onClick={() => save({ goals: tour.goals.map((x) => (x.id === g.id && x.kind === 'custom' ? { ...x, achieved: v } : x)) })}
                          className={cx('rounded-full border px-3 py-1 text-[13px] font-semibold', g.achieved === v ? 'border-accent bg-accent text-accent-ink' : 'border-line')}
                          data-testid={`mark-${String(v)}`}
                        >
                          {v === true ? t('markAchieved') : v === false ? t('markNotAchieved') : t('markUndecided')}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && <GoalAdder onAdd={(g) => save({ goals: [...tour.goals, g] })} />}
          </Card>

          <Card className="p-5">
            <SectionTitle aside={canEdit && <a href={href(`newmatch-${tour.id}`)} className="text-sm font-semibold text-accent">+ {t('addMatchHere')}</a>}>
              {t('tournamentMatches')}
            </SectionTitle>
            {ev.matches.length === 0 ? (
              <Empty>{t('noMatchesHere')}</Empty>
            ) : (
              <ul className="-mx-5 flex flex-col divide-y divide-line border-y border-line" data-testid="tournament-matches">
                {ev.matches.map((m) => (
                  <MatchRow key={m.id} m={m} showTournament={false} />
                ))}
              </ul>
            )}
            {st.matches > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="tournament-stats">
                {(['firstServeIn', 'firstServeWon', 'doubleFaults', 'unforcedErrors'] as GoalMetric[]).map((mm) => {
                  const v = metricValue(mm, st);
                  return (
                    <div key={mm} className="flex flex-col gap-0.5 rounded-xl bg-sunken p-3">
                      <span className="eyebrow">{metricLabel(t, mm)}</span>
                      <span className="num font-mono text-xl">{v === null ? '—' : fmtMetric(mm, v)}</span>
                      <span className="text-[11px] text-muted">{METRIC_META[mm].unit === 'perMatch' ? t('perMatchUnit') : t('chartedMatchesN', { n: st.matches })}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-5">
            <SectionTitle>{t('prepTitle')}</SectionTitle>
            <ul className="mb-4 flex flex-col gap-2 text-sm">
              <li className="num">
                {phase === 'upcoming' ? (daysTo === 1 ? t('startsTomorrow') : t('startsIn', { n: daysTo })) : phase === 'live' ? t('inProgress') : t('finished')}
              </li>
              <li className="num">{t('prepSessions', { done: prepSessions.filter((s) => s.status === 'completed').length, total: prepSessions.length })}</li>
              {tapers.map((x) => (
                <li key={x.session.id} className="text-warn">
                  {t('session')} {x.session.index}: {t('taper', { t: tour.name })}
                </li>
              ))}
              {conflicts.map((x) => (
                <li key={'c' + x.session.id} className="font-semibold text-warn">
                  {t('session')} {x.session.index}: {t('conflict', { t: tour.name })}{' '}
                  {canEdit && <a href={href('planner')} className="underline">{t('nav_planner')} →</a>}
                </li>
              ))}
            </ul>
            <TextCard id="prep-notes" label={t('prepNotes')} hint={t('prepNotesHint')} value={tour.notes} canEdit={canEdit} onSave={(notes) => { save({ notes }); toast(t('saved')); }} />
          </Card>

          <Card className="p-5">
            <SectionTitle>{t('reviewTitle')}</SectionTitle>
            <div className="flex flex-col gap-4">
              <Field label={t('resultRound')} hint={t('resultRoundHint')} htmlFor="t-result">
                {canEdit ? (
                  <select id="t-result" className={inputCls} value={tour.result ?? ''} onChange={(e) => save({ result: (e.target.value || null) as Round | null })}>
                    <option value="">{t('fromMatches')}</option>
                    {[...MATCH_ROUNDS, 'W' as const].map((r) => (
                      <option key={r} value={r}>
                        {r === 'W' ? t('goalWinTitle') : roundLabel(t, r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm">{ev.reached ? roundLabel(t, ev.reached) : '—'}</p>
                )}
              </Field>
              <TextCard id="review" label={t('reviewLabel')} hint={t('reviewHint')} value={tour.review} canEdit={canEdit} onSave={(review) => { save({ review }); toast(t('saved')); }} />
            </div>
          </Card>
        </div>
      </div>

      {canEdit && (
        <div className="mt-8 flex justify-end border-t border-line pt-4">
          <ConfirmButton
            label={t('deleteTournament')}
            confirmLabel={`${t('deleteTournament')}?`}
            onConfirm={() => {
              dispatch({ type: 'removeTournament', id: tour.id });
              toast(t('tournamentDeleted'));
              navigate('tournaments');
            }}
          />
        </div>
      )}
    </div>
  );
}
