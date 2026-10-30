import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { Plan, Session } from '../types';
import { catLabel, formatDate, type DictKey } from '../lib/i18n';
import { href, navigate } from '../lib/router';
import { activePlayer, drillMap, plansForPlayer, primaryPlan } from '../lib/reducer';
import { findConflicts, generateDates, rescheduleAroundTournaments, taperWarnings, todayISO } from '../lib/schedule';
import { uid } from '../lib/id';
import { Badge, Button, Card, ConfirmButton, cx, Empty, Field, Icon, inputCls, PageHeader, SectionTitle } from '../components/ui';
import { matchesQuery } from './Library';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
// 2023-01-01 was a Sunday: day n of that week has getDay() === n.
const wdLabel = (lang: string, n: number) => new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { weekday: 'short' }).format(new Date(2023, 0, 1 + n));

function renumber(sessions: Session[]): Session[] {
  return sessions.map((s, i) => ({ ...s, index: i + 1 }));
}

export function Planner({ planId }: { planId: string }) {
  const { state, dispatch, t, lang, toast } = useStore();
  const player = activePlayer(state);
  const plans = player ? plansForPlayer(state, player.id) : [];
  const stored = plans.find((p) => p.id === planId) ?? (player ? primaryPlan(state, player.id) : undefined);
  const [draft, setDraft] = useState<Plan | null>(stored ? structuredClone(stored) : null);
  const [openId, setOpenId] = useState<string | null>(() => stored?.sessions.find((s) => s.status === 'planned')?.id ?? null);
  const [gen, setGen] = useState({ start: todayISO(), days: [2, 4, 6] });

  // Re-sync draft when switching plans or when the stored plan changes and the draft is clean.
  const storedJSON = stored ? JSON.stringify(stored) : '';
  const dirty = !!draft && JSON.stringify(draft) !== storedJSON;
  useEffect(() => {
    if (!stored) {
      setDraft((d) => (d && !plans.some((p) => p.id === d.id) && d.sessions.length ? d : null));
      return;
    }
    setDraft((d) => (!d || d.id !== stored.id || !dirtyRef(d, storedJSON) ? structuredClone(stored) : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.id, storedJSON]);

  if (state.settings.role === 'parent') {
    return (
      <div className="py-10">
        <Empty>
          {t('plannerTitle')}: {t('role_coach')} / {t('role_admin')}. <a className="font-semibold text-accent" href={href('parent')}>{t('nav_parent')} →</a>
        </Empty>
      </div>
    );
  }
  if (!player) return <Empty>No player.</Empty>;

  const drills = drillMap(state);
  const tournaments = state.tournaments.filter((x) => x.playerId === player.id);
  const conflicts = draft ? findConflicts(draft.sessions, tournaments) : [];
  const tapers = draft ? taperWarnings(draft.sessions, tournaments) : [];

  const update = (fn: (p: Plan) => Plan) => setDraft((d) => (d ? fn(d) : d));
  const updateSession = (id: string, patch: Partial<Session>) => update((p) => ({ ...p, sessions: p.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const moveSession = (i: number, dir: -1 | 1) =>
    update((p) => {
      const arr = [...p.sessions];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return p;
      // Swap content, keep each slot's date so the calendar stays chronological.
      const a = arr[i];
      const b = arr[j];
      arr[i] = { ...b, date: a.date };
      arr[j] = { ...a, date: b.date };
      return { ...p, sessions: renumber(arr) };
    });

  const save = () => {
    if (!draft) return;
    const sorted = { ...draft, sessions: renumber(draft.sessions) };
    dispatch({ type: 'savePlan', plan: sorted });
    toast(t('planSaved'));
    if (sorted.id !== stored?.id) navigate(`planner-${sorted.id}`);
  };

  const generate = () => {
    const dates = generateDates(gen.start, 10, gen.days, tournaments);
    const plan: Plan = {
      id: uid('plan'),
      playerId: player.id,
      name: `${player.name} — ${formatDate('en', dates[0], { day: 'numeric', month: 'short' })} block`,
      priority: '',
      owner: 'coach',
      sharedWithCoachId: null,
      createdAt: new Date().toISOString(),
      sessions: dates.map((date, i) => ({
        id: uid('sess'),
        index: i + 1,
        date,
        title: i === 0 ? 'Baseline assessment' : i === 9 ? 'Re-test vs baseline' : `${t('session')} ${i + 1}`,
        focus: '',
        items: [],
        status: 'planned',
        coachNote: '',
        kind: i === 0 || i === 9 ? 'baseline' : i === 8 ? 'match-eval' : 'training',
      })),
    };
    setDraft(plan);
    setOpenId(plan.sessions[0].id);
  };

  return (
    <div>
      <PageHeader eyebrow={player.name} title={t('plannerTitle')}>
        {plans.length > 1 && (
          <select aria-label={t('planName')} className={cx(inputCls, 'w-auto')} value={draft?.id ?? ''} onChange={(e) => navigate(`planner-${e.target.value}`)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.owner === 'parent' ? `(${t('role_parent')})` : ''}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      {dirty && (
        <div className="sticky z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent bg-accent-soft p-3" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 60px)' }} data-testid="unsaved-bar">
          <span className="text-sm font-semibold text-accent">●&nbsp;{t('unsaved')}</span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" onClick={() => setDraft(stored ? structuredClone(stored) : null)}>
              {t('cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={save} data-testid="save-plan">
              {t('save')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!draft ? (
            <Empty>{t('noUpcoming')}</Empty>
          ) : (
            <>
              <Card className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label={t('planName')} htmlFor="plan-name">
                  <input id="plan-name" className={inputCls} value={draft.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} />
                </Field>
                <Field label={t('priority')} htmlFor="plan-priority">
                  <input id="plan-priority" className={inputCls} value={draft.priority} onChange={(e) => update((p) => ({ ...p, priority: e.target.value }))} />
                </Field>
              </Card>

              <ol className="flex flex-col gap-3" data-testid="planner-sessions">
                {draft.sessions.map((s, i) => (
                  <SessionEditor
                    key={s.id}
                    s={s}
                    open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                    first={i === 0}
                    last={i === draft.sessions.length - 1}
                    conflict={conflicts.find((c) => c.session.id === s.id)?.tournament.name}
                    taper={tapers.find((c) => c.session.id === s.id)?.tournament.name}
                    onPatch={(patch) => updateSession(s.id, patch)}
                    onMove={(dir) => moveSession(i, dir)}
                    onRemove={() => update((p) => ({ ...p, sessions: renumber(p.sessions.filter((x) => x.id !== s.id)) }))}
                    drillName={(id) => drills.get(id)?.name ?? id}
                    drillMinutes={(id) => drills.get(id)?.durationMin ?? 0}
                  />
                ))}
              </ol>
              <Button
                onClick={() => {
                  const last = draft.sessions[draft.sessions.length - 1];
                  const date = last ? generateDates(last.date > todayISO() ? last.date : todayISO(), 2, gen.days, tournaments)[1] : todayISO();
                  const s: Session = { id: uid('sess'), index: draft.sessions.length + 1, date, title: `${t('session')} ${draft.sessions.length + 1}`, focus: '', items: [], status: 'planned', coachNote: '', kind: 'training' };
                  update((p) => ({ ...p, sessions: [...p.sessions, s] }));
                  setOpenId(s.id);
                }}
              >
                + {t('addSession')}
              </Button>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <SectionTitle>{t('tournaments')}</SectionTitle>
            <TournamentEditor playerId={player.id} />
            <div className="mt-3 flex flex-col gap-2 text-[13px]">
              {conflicts.length === 0 ? (
                <p className="text-good">✓ {t('noConflicts')}</p>
              ) : (
                <>
                  {conflicts.map((c) => (
                    <p key={c.session.id} className="font-semibold text-warn">
                      {t('session')} {c.session.index}: {t('conflict', { t: c.tournament.name })}
                    </p>
                  ))}
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="reschedule"
                    onClick={() => {
                      if (!draft) return;
                      const moved = rescheduleAroundTournaments(draft.sessions, tournaments);
                      const n = moved.filter((m, i) => m.date !== [...draft.sessions].sort((a, b) => a.index - b.index)[i].date).length;
                      update((p) => ({ ...p, sessions: moved }));
                      toast(t('rescheduled', { n }));
                    }}
                  >
                    {t('rescheduleAll')}
                  </Button>
                </>
              )}
              {tapers.map((c) => (
                <p key={'tp' + c.session.id} className="text-muted">
                  {t('session')} {c.session.index}: {t('taper', { t: c.tournament.name })}
                </p>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle>{t('newPlan')}</SectionTitle>
            <p className="mb-3 text-[13px] text-muted">{t('newPlanHelp')}</p>
            <Field label={t('startDate')} htmlFor="gen-start">
              <input id="gen-start" type="date" className={inputCls} value={gen.start} onChange={(e) => setGen((g) => ({ ...g, start: e.target.value }))} />
            </Field>
            <fieldset className="mt-3">
              <legend className="mb-1 text-[13px] font-semibold">{t('weekdays')}</legend>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((w) => {
                  const on = gen.days.includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGen((g) => ({ ...g, days: on ? g.days.filter((x) => x !== w) : [...g.days, w] }))}
                      className={cx('h-8 w-11 rounded-full border text-[12px] font-semibold', on ? 'border-accent bg-accent text-accent-ink' : 'border-line')}
                    >
                      {wdLabel(lang, w)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Button className="mt-3 w-full" onClick={generate} disabled={!gen.days.length || !gen.start} data-testid="generate-plan">
              {t('create')}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function dirtyRef(d: Plan, storedJSON: string) {
  return JSON.stringify(d) !== storedJSON;
}

function SessionEditor(props: {
  s: Session;
  open: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
  conflict?: string;
  taper?: string;
  onPatch: (p: Partial<Session>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  drillName: (id: string) => string;
  drillMinutes: (id: string) => number;
}) {
  const { s, open, onPatch } = props;
  const { t, lang } = useStore();
  const minutes = s.items.reduce((a, i) => a + props.drillMinutes(i.drillId), 0);
  const moveItem = (i: number, dir: -1 | 1) => {
    const arr = [...s.items];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onPatch({ items: arr });
  };
  return (
    <li className={cx('rounded-2xl border bg-surface', props.conflict ? 'border-warn' : 'border-line')} data-session-index={s.index}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={props.onToggle} aria-expanded={open}>
          <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-band font-mono text-sm text-band-ink">{s.index}</span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{s.title}</span>
            <span className="num block text-[12px] text-muted">
              {formatDate(lang, s.date)} · {s.items.length} · {t('totalTime', { n: minutes })}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {s.status !== 'planned' && <Badge tone={s.status === 'completed' ? 'good' : 'warn'}>{t(`status_${s.status}` as DictKey)}</Badge>}
          {props.conflict && <Badge tone="warn">!</Badge>}
          <button type="button" className="h-8 w-8 rounded-full text-muted hover:bg-sunken disabled:opacity-30" disabled={props.first} onClick={() => props.onMove(-1)} aria-label={`${t('moveUp')} ${s.index}`}>
            <Icon.up className="mx-auto h-4 w-4" />
          </button>
          <button type="button" className="h-8 w-8 rounded-full text-muted hover:bg-sunken disabled:opacity-30" disabled={props.last} onClick={() => props.onMove(1)} aria-label={`${t('moveDown')} ${s.index}`}>
            <Icon.down className="mx-auto h-4 w-4" />
          </button>
        </div>
      </div>
      {props.conflict && <p className="px-4 pb-2 text-[13px] font-semibold text-warn">{t('conflict', { t: props.conflict })}</p>}
      {props.taper && <p className="px-4 pb-2 text-[13px] text-muted">{t('taper', { t: props.taper })}</p>}
      {open && (
        <div className="border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('title')} htmlFor={`title-${s.id}`}>
              <input id={`title-${s.id}`} className={inputCls} value={s.title} onChange={(e) => onPatch({ title: e.target.value })} />
            </Field>
            <Field label={t('date')} htmlFor={`date-${s.id}`}>
              <input id={`date-${s.id}`} type="date" className={inputCls} value={s.date} onChange={(e) => e.target.value && onPatch({ date: e.target.value })} />
            </Field>
            <Field label={t('kind')} htmlFor={`kind-${s.id}`}>
              <select id={`kind-${s.id}`} className={inputCls} value={s.kind} onChange={(e) => onPatch({ kind: e.target.value as Session['kind'] })}>
                {(['baseline', 'training', 'match-eval'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`kind_${k}` as DictKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('status')} htmlFor={`status-${s.id}`}>
              <select id={`status-${s.id}`} className={inputCls} value={s.status} onChange={(e) => onPatch({ status: e.target.value as Session['status'] })}>
                {(['planned', 'completed', 'skipped'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`status_${k}` as DictKey)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('focus')} htmlFor={`focus-${s.id}`}>
                <input id={`focus-${s.id}`} className={inputCls} value={s.focus} onChange={(e) => onPatch({ focus: e.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t('coachNote')} htmlFor={`note-${s.id}`}>
                <textarea id={`note-${s.id}`} rows={2} className={inputCls} value={s.coachNote} onChange={(e) => onPatch({ coachNote: e.target.value })} />
              </Field>
            </div>
          </div>

          <h4 className="eyebrow mt-5 mb-2">{t('nav_library')}</h4>
          {s.items.length === 0 && <Empty>{t('addDrill')} ↓</Empty>}
          <ol className="flex flex-col gap-2">
            {s.items.map((it, i) => (
              <li key={it.drillId} className="rounded-xl border border-line bg-sunken p-3" data-item={it.drillId}>
                <div className="flex items-start gap-2">
                  <span className="num font-mono text-[12px] text-muted">{i + 1}.</span>
                  <a href={href(`drill-${it.drillId}`)} className="min-w-0 flex-1 font-semibold hover:text-accent">
                    {props.drillName(it.drillId)} <span className="num font-normal text-muted">· {props.drillMinutes(it.drillId)}′</span>
                  </a>
                  <button type="button" className="h-7 w-7 rounded-full text-muted hover:bg-surface disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={t('moveUp')}>
                    <Icon.up className="mx-auto h-4 w-4" />
                  </button>
                  <button type="button" className="h-7 w-7 rounded-full text-muted hover:bg-surface disabled:opacity-30" disabled={i === s.items.length - 1} onClick={() => moveItem(i, 1)} aria-label={t('moveDown')}>
                    <Icon.down className="mx-auto h-4 w-4" />
                  </button>
                  <button type="button" className="h-7 w-7 rounded-full text-bad hover:bg-bad-soft" onClick={() => onPatch({ items: s.items.filter((x) => x.drillId !== it.drillId) })} aria-label={`${t('remove')} ${props.drillName(it.drillId)}`}>
                    <Icon.x className="mx-auto h-4 w-4" />
                  </button>
                </div>
                <label className="mt-2 block">
                  <span className="sr-only">{t('whyDrill')}</span>
                  <input
                    className={cx(inputCls, 'text-sm')}
                    placeholder={t('whyDrill')}
                    value={it.reason}
                    onChange={(e) => onPatch({ items: s.items.map((x) => (x.drillId === it.drillId ? { ...x, reason: e.target.value } : x)) })}
                  />
                </label>
              </li>
            ))}
          </ol>
          <DrillPicker exclude={s.items.map((i) => i.drillId)} onPick={(id, objective) => onPatch({ items: [...s.items, { drillId: id, reason: objective }] })} sessionId={s.id} />
          <div className="mt-4 flex justify-end">
            <ConfirmButton label={t('removeSession')} confirmLabel={`${t('removeSession')}?`} onConfirm={props.onRemove} />
          </div>
        </div>
      )}
    </li>
  );
}

function DrillPicker({ exclude, onPick, sessionId }: { exclude: string[]; onPick: (id: string, objective: string) => void; sessionId: string }) {
  const { state, t, lang } = useStore();
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim().length < 2 ? [] : state.drills.filter((d) => !d.archived && !exclude.includes(d.id) && matchesQuery(d, q.trim())).slice(0, 8)), [q, state.drills, exclude]);
  return (
    <div className="mt-3">
      <label htmlFor={`pick-${sessionId}`} className="text-[13px] font-semibold">
        + {t('addDrill')}
      </label>
      <input id={`pick-${sessionId}`} type="search" className={cx(inputCls, 'mt-1')} placeholder={t('searchDrills')} value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="mt-1 flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
          {results.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent-soft"
                onClick={() => {
                  onPick(d.id, d.objective);
                  setQ('');
                }}
              >
                <span className="min-w-0 flex-1 font-semibold">{d.name}</span>
                <span className="shrink-0 text-[12px] text-muted">{catLabel(lang, d.category)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TournamentEditor({ playerId }: { playerId: string }) {
  const { state, dispatch, t, lang } = useStore();
  const [f, setF] = useState({ name: '', start: '', end: '' });
  const list = state.tournaments.filter((x) => x.playerId === playerId);
  const valid = f.name.trim() && f.start && f.end && f.end >= f.start;
  return (
    <div>
      <ul className="mb-3 flex flex-col gap-1.5">
        {list.map((x) => (
          <li key={x.id} className="flex items-center gap-2 text-sm">
            <Icon.trophy className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
            <span className="num shrink-0 text-[12px] text-muted">
              {formatDate(lang, x.start, { day: 'numeric', month: 'short' })}–{formatDate(lang, x.end, { day: 'numeric', month: 'short' })}
            </span>
            <button type="button" className="h-7 w-7 rounded-full text-bad hover:bg-bad-soft" onClick={() => dispatch({ type: 'removeTournament', id: x.id })} aria-label={`${t('remove')} ${x.name}`}>
              <Icon.x className="mx-auto h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          dispatch({ type: 'addTournament', tournament: { id: uid('tour'), playerId, name: f.name.trim(), start: f.start, end: f.end } });
          setF({ name: '', start: '', end: '' });
        }}
      >
        <input aria-label={t('tournamentName')} placeholder={t('tournamentName')} className={cx(inputCls, 'col-span-2')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} id="tour-name" />
        <label className="text-[12px] font-semibold">
          {t('start')}
          <input type="date" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end || e.target.value })} id="tour-start" />
        </label>
        <label className="text-[12px] font-semibold">
          {t('end')}
          <input type="date" className={inputCls} value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} id="tour-end" />
        </label>
        <Button type="submit" size="sm" className="col-span-2" disabled={!valid}>
          + {t('addTournament')}
        </Button>
      </form>
    </div>
  );
}
