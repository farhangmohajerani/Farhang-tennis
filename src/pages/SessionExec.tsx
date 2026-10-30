import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { ERROR_TYPES, KPI_KEYS, type Drill, type ErrorType, type Log, type Plan, type Session } from '../types';
import { formatDate, type DictKey } from '../lib/i18n';
import { href, navigate } from '../lib/router';
import { activePlayer, drillMap, primaryPlan } from '../lib/reducer';
import { computeKpis, isOverAttempting, validateCounts } from '../lib/kpi';
import { todayISO } from '../lib/schedule';
import { uid } from '../lib/id';
import { Badge, Button, Card, ConfirmButton, cx, Empty, Field, inputCls, KpiTile, NumberStepper, PageHeader } from '../components/ui';
import { stats } from '../lib/selectors';

export function SessionExec({ sessionId }: { sessionId: string }) {
  const { state, dispatch, t, lang, toast } = useStore();
  const player = activePlayer(state);
  const plan = player ? primaryPlan(state, player.id) : undefined;
  const today = todayISO();
  const session = plan?.sessions.find((s) => s.id === sessionId) ?? plan?.sessions.find((s) => s.status === 'planned' && s.date >= today) ?? plan?.sessions.find((s) => s.status === 'planned');

  if (state.settings.role === 'parent') {
    return (
      <div className="py-10">
        <Empty>
          {t('executeTitle')}: {t('role_coach')}. <a className="font-semibold text-accent" href={href('parent')}>{t('nav_parent')} →</a>
        </Empty>
      </div>
    );
  }
  if (!player || !plan || !session) return <div className="py-10"><Empty>{t('noUpcoming')}</Empty></div>;

  const drills = drillMap(state);
  const sessionLogs = state.logs.filter((l) => l.sessionId === session.id);

  return (
    <div>
      <PageHeader eyebrow={`${t('executeTitle')} · ${formatDate(lang, session.date, { weekday: 'long', day: 'numeric', month: 'long' })}`} title={`${session.index}. ${session.title}`}>
        <select aria-label={t('selectSession')} className={cx(inputCls, 'w-auto max-w-[70vw]')} value={session.id} onChange={(e) => navigate(`session-${e.target.value}`)} id="session-switch">
          {plan.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.index}. {s.title} · {formatDate(lang, s.date)}
            </option>
          ))}
        </select>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={session.status === 'completed' ? 'good' : session.status === 'skipped' ? 'warn' : 'accent'}>{t(`status_${session.status}` as DictKey)}</Badge>
        <Badge>{t(`kind_${session.kind}` as DictKey)}</Badge>
        {session.focus && <span className="text-sm text-muted">{session.focus}</span>}
        <div className="ms-auto flex gap-2">
          {session.status === 'completed' ? (
            <Button size="sm" onClick={() => dispatch({ type: 'setSessionStatus', planId: plan.id, sessionId: session.id, status: 'planned' })}>
              {t('reopen')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              data-testid="complete-session"
              onClick={() => {
                dispatch({ type: 'setSessionStatus', planId: plan.id, sessionId: session.id, status: 'completed' });
                toast(t('sessionCompleted'));
              }}
            >
              ✓ {t('markComplete')}
            </Button>
          )}
        </div>
      </div>

      {session.kind === 'match-eval' && <p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm text-accent">{t('winLossNote')}</p>}

      <div className="flex flex-col gap-4">
        {session.items.length === 0 && <Empty>{t('addDrill')} → <a className="font-semibold text-accent" href={href(`planner-${plan.id}`)}>{t('nav_planner')}</a></Empty>}
        {session.items.map((it, i) => {
          const d = drills.get(it.drillId);
          if (!d) return null;
          return <DrillLogger key={it.drillId} n={i + 1} drill={d} session={session} plan={plan} playerId={player.id} reason={it.reason} logs={sessionLogs.filter((l) => l.drillId === d.id)} />;
        })}
      </div>

      <CoachNote plan={plan} session={session} />
    </div>
  );
}

function CoachNote({ plan, session }: { plan: Plan; session: Session }) {
  const { dispatch, t, toast } = useStore();
  const [note, setNote] = useState(session.coachNote);
  useEffect(() => setNote(session.coachNote), [session.id, session.coachNote]);
  return (
    <Card className="mt-5 p-4">
      <Field label={t('coachNote')} htmlFor="coach-note">
        <textarea id="coach-note" rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={note === session.coachNote}
          onClick={() => {
            dispatch({ type: 'setSessionNote', planId: plan.id, sessionId: session.id, note });
            toast(t('saved'));
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

const emptyErrors = (): Record<ErrorType, number> => ({ net: 0, long: 0, wide: 0, wrongChoice: 0, late: 0, other: 0 });

function DrillLogger({ n, drill, session, playerId, reason, logs }: { n: number; drill: Drill; session: Session; plan: Plan; playerId: string; reason: string; logs: Log[] }) {
  const { dispatch, t, toast } = useStore();
  const defaultCtx: Log['context'] = session.kind === 'baseline' ? 'baseline' : session.kind === 'match-eval' ? 'match' : 'practice';
  const [open, setOpen] = useState(n === 1);
  const [ctx, setCtx] = useState<Log['context']>(defaultCtx);
  const [c, setC] = useState({ eligible: 0, attempts: 0, correctDecisions: 0, successful: 0 });
  const [errors, setErrors] = useState(emptyErrors());
  const [notes, setNotes] = useState('');
  const errs = validateCounts(c);
  const errFor = (field: string) => {
    const e = errs.find((x) => x.startsWith(field + ':'));
    if (!e) return undefined;
    const code = e.split(':')[1];
    return t(code === 'nonNegativeInt' ? 'validation_nonNegativeInt' : (`validation_${field}_${code}` as DictKey));
  };
  const live = computeKpis(c);
  const sum = stats(logs);
  const prefix = `${drill.id}`;

  return (
    <Card className="overflow-hidden" as="article">
      <button type="button" className="flex w-full items-start gap-3 p-4 text-start" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-band font-mono text-sm text-band-ink">{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{drill.name}</span>
          <span className="block text-sm text-muted">{reason}</span>
        </span>
        {logs.length > 0 && <Badge tone="good">✓ {logs.length}</Badge>}
      </button>
      {open && (
        <div className="border-t border-line p-4">
          <p className="mb-3 rounded-xl bg-sunken p-3 text-[13px]">
            <strong>{t('eligibility')}:</strong> {drill.eligibility}{' '}
            <a href={href(`drill-${drill.id}`)} className="font-semibold text-accent">
              {t('viewDrill')} →
            </a>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (errs.length) return;
              dispatch({
                type: 'addLog',
                log: { id: uid('log'), playerId, drillId: drill.id, sessionId: session.id, date: session.date, context: ctx, ...c, errors, notes: notes.trim(), createdAt: new Date().toISOString() },
              });
              toast(t('logSaved'));
              setC({ eligible: 0, attempts: 0, correctDecisions: 0, successful: 0 });
              setErrors(emptyErrors());
              setNotes('');
            }}
          >
            <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('context')}>
              {(['baseline', 'practice', 'match'] as const).map((x) => (
                <button key={x} type="button" role="radio" aria-checked={ctx === x} onClick={() => setCtx(x)} className={cx('rounded-full border px-3 py-1 text-[13px] font-semibold', ctx === x ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>
                  {t(`ctx_${x}` as DictKey)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <NumberStepper id={`${prefix}-eligible`} label={t('eligibleOpp')} value={c.eligible} onChange={(v) => setC({ ...c, eligible: v })} />
              <NumberStepper id={`${prefix}-attempts`} label={t('attempts')} value={c.attempts} onChange={(v) => setC({ ...c, attempts: v })} />
              <NumberStepper id={`${prefix}-decisions`} label={t('correctDecisions')} value={c.correctDecisions} onChange={(v) => setC({ ...c, correctDecisions: v })} invalid={!!errFor('correctDecisions')} />
              <NumberStepper id={`${prefix}-successful`} label={t('successfulExec')} value={c.successful} onChange={(v) => setC({ ...c, successful: v })} invalid={!!errFor('successful')} />
            </div>
            {errs.length > 0 && (
              <ul className="mt-2 text-[13px] font-semibold text-bad" role="alert">
                {Array.from(new Set(['correctDecisions', 'successful', 'eligible', 'attempts'].map(errFor).filter(Boolean))).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {isOverAttempting(c) && <p className="mt-2 rounded-xl bg-warn-soft p-2.5 text-[13px] font-semibold text-warn">{t('overAttempting')}</p>}

            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-accent">{t('errorTypes')}</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ERROR_TYPES.map((et) => (
                  <NumberStepper key={et} id={`${prefix}-err-${et}`} label={t(`err_${et}` as DictKey)} value={errors[et]} onChange={(v) => setErrors({ ...errors, [et]: v })} />
                ))}
              </div>
            </details>
            <div className="mt-3">
              <Field label={t('notes')} htmlFor={`${prefix}-notes`}>
                <textarea id={`${prefix}-notes`} rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>

            <h4 className="eyebrow mt-4 mb-2">{t('liveKpi')}</h4>
            <div className="grid grid-cols-3 gap-2">
              {KPI_KEYS.map((k) => (
                <KpiTile key={k} k={k} r={live[k]} levels={drill.thresholds[k]} compact />
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" variant="primary" disabled={errs.length > 0 || c.eligible + c.attempts === 0} data-testid={`save-log-${drill.id}`}>
                {t('logDrill')}
              </Button>
            </div>
          </form>

          {logs.length > 0 && (
            <div className="mt-4">
              <h4 className="eyebrow mb-2">{t('loggedFor')}</h4>
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {logs.map((l) => (
                  <li key={l.id} className="num flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]" data-log-id={l.id}>
                    <Badge tone={l.context === 'match' ? 'band' : l.context === 'baseline' ? 'warn' : 'neutral'}>{t(`ctx_${l.context}` as DictKey)}</Badge>
                    <span className="font-mono">
                      E{l.eligible} · A{l.attempts} · D{l.correctDecisions} · S{l.successful}
                    </span>
                    {l.notes && <span className="min-w-0 flex-1 truncate text-muted">{l.notes}</span>}
                    <span className="ms-auto">
                      <ConfirmButton
                        label={t('delete')}
                        confirmLabel={`${t('deleteLog')}?`}
                        onConfirm={() => {
                          dispatch({ type: 'deleteLog', id: l.id });
                          toast(t('logDeleted'));
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {KPI_KEYS.map((k) => (
                  <KpiTile key={k} k={k} r={sum.kpis[k]} levels={drill.thresholds[k]} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
