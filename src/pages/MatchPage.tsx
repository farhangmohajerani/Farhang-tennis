import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { formatDate, type DictKey } from '../lib/i18n';
import {
  courtOf,
  decodePoint,
  EMPTY_DRAFT,
  encodePoint,
  gameLabel,
  netImplied,
  other,
  replay,
  serverOf,
  statsFromReplay,
  type Engine,
  type Point,
  type PointCtx,
  type PointDraft,
  type Side,
} from '../lib/match';
import { RALLY_STROKES, RETURN_STROKES, screenPoint, seedOf, type ComposerSeed, type StrokeDef, type StrokePick, type Zone } from '../lib/pointEntry';
import { RALLY, SERVE_DIRS, WINGS, type Match, type PointEnd } from '../types';
import { Badge, Button, Card, cx, Empty, Modal, PageHeader } from '../components/ui';
import { courtLabel, dirLabel, names, pointText, rallyLabel, roundLabel, Scoreboard, shortName, shotLabel, StatsTable, surfaceLabel, useCanEdit, wingLabel } from '../components/MatchBits';
import { MatchReport } from './MatchReport';
import { MatchForm } from './MatchSetup';

export function MatchPage({ id }: { id: string }) {
  const { state, t } = useStore();
  const m = state.matches.find((x) => x.id === id);
  if (!m) {
    return (
      <div className="py-10">
        <Empty>
          {t('matchNotFound')} <a className="font-semibold text-accent" href={href('matches')}>{t('nav_matches')} →</a>
        </Empty>
      </div>
    );
  }
  return m.mode === 'live' && m.status === 'live' ? <MatchLive m={m} /> : <MatchReport m={m} />;
}

/** "Practice match · Hard" / "Regional Open · Quarter-final · Clay" */
export function MatchContext({ m }: { m: Match }) {
  const { state, t, lang } = useStore();
  const tour = m.tournamentId ? state.tournaments.find((x) => x.id === m.tournamentId) : undefined;
  const parts = [formatDate(lang, m.date, { weekday: 'short', day: 'numeric', month: 'short' }), m.kind === 'practice' ? t('kind_practiceMatch') : tour?.name ?? t('kind_official')];
  if (m.round) parts.push(roundLabel(t, m.round));
  if (m.surface) parts.push(surfaceLabel(t, m.surface) + (m.indoor ? ` (${t('indoor')})` : ''));
  return <>{parts.join(' · ')}</>;
}

type Tr = ReturnType<typeof useStore>['t'];

/** "Forehand", "FH slice", "Overhead". */
function strokeName(t: Tr, s: StrokeDef): string {
  if (!s.wing) return shotLabel(t, s.shot);
  if (s.shot === 'drive') return wingLabel(t, s.wing);
  return t('strokeCombo', { wing: t(`wingShort_${s.wing}` as DictKey), shot: shotLabel(t, s.shot) });
}

function Chip({ on, testid, onClick, children, locked }: { on: boolean; testid: string; onClick: () => void; children: ReactNode; locked?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testid}
      disabled={locked}
      onClick={onClick}
      className={cx(
        'min-h-9 rounded-full border px-3 py-1 text-[13px] font-semibold leading-tight transition active:scale-[0.97]',
        on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink',
        locked && 'cursor-default opacity-80',
      )}
    >
      {children}
    </button>
  );
}

function StrokeButton({ on, testid, label, onClick }: { on: boolean; testid: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-expanded={on}
      data-testid={testid}
      onClick={onClick}
      className={cx(
        'ui-bidi min-h-11 rounded-xl border px-2 py-1.5 text-[14px] font-semibold leading-tight transition active:scale-[0.97]',
        on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink',
      )}
    >
      {label}
    </button>
  );
}

/** A result button: green when the point goes to the player, red when it goes to the opponent. Tapping it saves the point. */
function Outcome({ win, testid, label, quiet, onClick }: { win: Side; testid: string; label: string; quiet?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-win={win}
      onClick={onClick}
      className={cx(
        'ui-bidi rounded-2xl border px-2 py-1.5 text-center font-semibold leading-tight transition active:scale-[0.97]',
        quiet ? 'min-h-11 text-[13px]' : 'min-h-[52px] text-[14px] sm:text-[15px]',
        win === 'p' ? 'border-good/30 bg-good-soft text-good' : 'border-bad/30 bg-bad-soft text-bad',
      )}
    >
      {label}
    </button>
  );
}

function Section({ title, help, aside, testid, children }: { title: string; help?: string; aside?: ReactNode; testid: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="ui-bidi text-[13.5px] font-bold">{title}</h3>
          {help && <span className="ui-bidi text-[12px] text-muted">{help}</span>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * One point, in the order it is played: the serve (ace, unreturned serve, double fault), the return
 * (forehand / backhand, drive / slice), then the rally (who hit the last shot, and which shot).
 * Tapping a stroke opens its results right below it; tapping a result saves the point.
 * The first serve is assumed — tap "Fault" when it missed. Mounted afresh for every point.
 */
function PointComposer({ e, nm, seed, onPoint }: { e: Engine; nm: Record<Side, string>; seed: ComposerSeed | null; onPoint: (p: Point, oppNet: boolean) => void }) {
  const { t } = useStore();
  const [d, setD] = useState<PointDraft>(seed?.draft ?? EMPTY_DRAFT);
  const [pick, setPick] = useState<StrokePick | null>(seed?.pick ?? null);
  const panel = useRef<HTMLDivElement>(null);
  // The results open right below the stroke; make sure they are on screen (iPad portrait, phones).
  // (Braces matter: newer browsers return a promise from scrollIntoView, which must not become the effect's cleanup.)
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pick?.zone, pick?.key]);
  const server = serverOf(e);
  const receiver = other(server);
  const court = courtOf(e);
  const name = (s: Side) => shortName(nm[s]);
  const set = (patch: Partial<PointDraft>) => setD((x) => ({ ...x, ...patch }));
  const save = (actor: Side, end: PointEnd, stroke?: StrokeDef) => {
    const r = screenPoint(d, actor, end, stroke);
    onPoint(r.point, r.oppNet);
  };
  const choose = (zone: Zone, s: StrokeDef) => {
    if (pick?.zone === zone && pick.key === s.key) {
      setPick(null);
      return;
    }
    setPick({ zone, key: s.key });
    if (!s.wing) set({ wing: null });
  };
  const isOn = (zone: Zone, s: StrokeDef) => pick?.zone === zone && pick.key === s.key;

  /** The results of the chosen stroke, opened right below its buttons. */
  const results = (zone: Zone) => {
    if (pick?.zone !== zone) return null;
    const s = (zone === 'return' ? RETURN_STROKES : RALLY_STROKES).find((x) => x.key === pick.key);
    if (!s) return null;
    const actor: Side = zone === 'return' ? receiver : zone;
    const implied = zone === 'return' ? { p: false, o: false } : netImplied(actor, s.shot);
    return (
      <div ref={panel} className="scroll-mb-4 rounded-2xl border border-accent/40 bg-accent-soft p-2.5" data-testid={`results-${zone}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="ui-bidi text-[13.5px] font-semibold">{t('resultsTitle', { name: name(actor), stroke: strokeName(t, s) })}</p>
          <button type="button" aria-label={t('cancel')} onClick={() => setPick(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted" data-testid="results-close">
            ✕
          </button>
        </div>
        {zone !== 'return' && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {!s.wing && (
              <>
                {WINGS.map((w) => (
                  <Chip key={w} on={d.wing === w} testid={`wing-${w}`} onClick={() => set({ wing: d.wing === w ? null : w })}>
                    {wingLabel(t, w)}
                  </Chip>
                ))}
                <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
              </>
            )}
            {RALLY.map((r) => (
              <Chip key={r} on={d.rally === r} testid={`rally-${r}`} onClick={() => set({ rally: d.rally === r ? null : r })}>
                {rallyLabel(t, r)}
              </Chip>
            ))}
            <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
            {(['p', 'o'] as Side[]).map((x) => (
              <Chip key={x} on={implied[x] || (x === 'p' ? d.netP : d.netO)} locked={implied[x]} testid={`net-${x}`} onClick={() => set(x === 'p' ? { netP: !d.netP } : { netO: !d.netO })}>
                {t('atNetShort', { name: name(x) })}
              </Chip>
            ))}
          </div>
        )}
        {zone === 'return' ? (
          <div className="grid grid-cols-2 gap-1.5">
            <Outcome win={server} testid="ret-error" label={t('end_returnError')} onClick={() => save(receiver, 'returnError', s)} />
            <Outcome win={receiver} testid="ret-winner" label={t('end_returnWinner')} onClick={() => save(receiver, 'returnWinner', s)} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            <Outcome win={actor} testid={`${actor}-winner`} label={t('end_winner')} onClick={() => save(actor, 'winner', s)} />
            <Outcome win={other(actor)} testid={`${actor}-forcedError`} label={t('end_forcedError')} onClick={() => save(actor, 'forcedError', s)} />
            <Outcome win={other(actor)} testid={`${actor}-unforcedError`} label={t('end_unforcedError')} onClick={() => save(actor, 'unforcedError', s)} />
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="@container p-3 sm:p-4" as="div">
      <div className="flex flex-col gap-3" data-testid="point-composer">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="ui-bidi text-sm" data-testid="serve-status">
              <span className="eyebrow me-1">{t('serving')}</span>
              <strong>{name(server)}</strong>
              {court && (
                <>
                  {' · '}
                  <span className="font-semibold text-accent" data-testid="court-side">{courtLabel(t, court)}</span>
                </>
              )}
            </p>
            <div role="radiogroup" aria-label={t('serveNumber')} className="flex gap-1 rounded-full border border-line bg-sunken p-1">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={d.serve === n}
                  data-testid={`serve-${n}`}
                  // The direction belongs to the serve that started the point: a fault clears it.
                  onClick={() => setD((x) => ({ ...x, serve: n, dir: x.serve === n ? x.dir : null }))}
                  className={cx('min-h-9 rounded-full px-3.5 text-[13.5px] font-semibold', d.serve === n ? 'bg-band text-band-ink' : 'text-muted')}
                >
                  {n === 1 ? t('firstServe') : t('faultSecondServe')}
                </button>
              ))}
            </div>
          </div>
          <p className="ui-bidi text-[12px] text-muted">{t('composerHelp', { p: name('p'), o: name('o') })}</p>
        </div>

        <div className="grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] @4xl:gap-6">
          <div className="flex flex-col gap-3">
            <Section
              title={t('serveBy', { name: name(server) })}
              testid="sec-serve"
              aside={
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="me-0.5 text-[12px] font-semibold text-muted">{t('serveDirTitle')}</span>
                  {SERVE_DIRS.map((x) => (
                    <Chip key={x} on={d.dir === x} testid={`dir-${x}`} onClick={() => set({ dir: d.dir === x ? null : x })}>
                      {dirLabel(t, x)}
                    </Chip>
                  ))}
                </div>
              }
            >
              <div className="grid grid-cols-3 gap-1.5">
                <Outcome win={server} testid={`${server}-ace`} label={t('end_ace')} onClick={() => save(server, 'ace')} />
                <Outcome win={server} testid={`${server}-serviceWinner`} label={t('end_serviceWinner')} onClick={() => save(server, 'serviceWinner')} />
                <Outcome win={receiver} testid={`${server}-doubleFault`} label={t('end_doubleFault')} onClick={() => save(server, 'doubleFault')} />
              </div>
            </Section>
            <Section title={t('returnBy', { name: name(receiver) })} help={t('returnStrokeHelp')} testid="sec-return">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {RETURN_STROKES.map((s) => (
                  <StrokeButton key={s.key} on={isOn('return', s)} testid={`ret-${s.key}`} label={strokeName(t, s)} onClick={() => choose('return', s)} />
                ))}
              </div>
              {results('return')}
            </Section>
          </div>

          <div className="border-t border-line pt-3 @4xl:border-s @4xl:border-t-0 @4xl:ps-6 @4xl:pt-0">
            <Section title={t('rallyWho')} help={t('rallyStrokeHelp')} testid="sec-rally">
              {(['p', 'o'] as Side[]).map((x) => (
                <div key={x} className="flex flex-col gap-1.5" data-testid={`rally-strokes-${x}`}>
                  <span className="ui-bidi flex items-center gap-1.5 text-[12.5px] font-bold">
                    <span className={cx('h-2 w-2 rounded-full', x === 'p' ? 'bg-accent' : 'bg-muted')} aria-hidden="true" />
                    {name(x)}
                  </span>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1.5">
                    {RALLY_STROKES.map((s) => (
                      <StrokeButton key={s.key} on={isOn(x, s)} testid={`${x}-stroke-${s.key}`} label={strokeName(t, s)} onClick={() => choose(x, s)} />
                    ))}
                  </div>
                  {results(x)}
                </div>
              ))}
            </Section>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3" data-testid="sec-other">
          <span className="ui-bidi text-[12.5px] font-bold">{t('notSeen')}</span>
          <div className="grid min-w-[14rem] flex-1 grid-cols-2 gap-1.5">
            {(['p', 'o'] as Side[]).map((s) => (
              <Outcome key={s} quiet win={s} testid={`${s}-other`} label={t('pointFor', { name: name(s) })} onClick={() => save(s, 'other')} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** What was saved for the point just played, with undo (which hands its details back for a fix). */
function LastPoint({ p, c, nm, count, onUndo }: { p: Point; c: PointCtx; nm: Record<Side, string>; count: number; onUndo: () => void }) {
  const { t } = useStore();
  const extra: string[] = [];
  if (p.serve === 2 && p.end !== 'doubleFault') extra.push(t('secondServe'));
  if (p.dir && p.end !== 'ace' && p.end !== 'serviceWinner') extra.push(dirLabel(t, p.dir));
  if (p.rally && p.end !== 'ace' && p.end !== 'serviceWinner' && p.end !== 'doubleFault' && p.end !== 'returnWinner' && p.end !== 'returnError') extra.push(rallyLabel(t, p.rally));
  if (p.net) extra.push(t('atNetShort', { name: shortName(nm.p) }));
  if (c.oppNet) extra.push(t('atNetShort', { name: shortName(nm.o) }));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-line bg-surface px-3 py-2">
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', p.win === 'p' ? 'bg-good' : 'bg-bad')} aria-hidden="true" />
      <span className="ui-bidi min-w-0 flex-1 text-sm">
        <span className="eyebrow me-1.5">{t('lastPoint')}</span>
        <strong data-testid="last-point">{pointText(p, c.server, nm, t)}</strong>
        {extra.length > 0 && <span className="text-muted" data-testid="last-point-extra"> · {extra.join(' · ')}</span>}
      </span>
      <span className="num text-[12px] text-muted">{t('pointsPlayed', { n: count })}</span>
      <Button size="sm" onClick={onUndo} data-testid="undo-point">
        ↶ {t('undoPoint')}
      </Button>
    </div>
  );
}

/** Score before a point, player first: "S2 · 3-2 · 30-15". */
export function ctxScore(c: PointCtx, noAd: boolean): string {
  let pts: string;
  if (c.tiebreak) pts = `${c.game.p}-${c.game.o}`;
  else {
    const call = ['0', '15', '30', '40'];
    const { p, o } = c.game;
    if (p >= 3 && o >= 3) pts = p === o ? (noAd ? '40-40*' : '40-40') : p > o ? 'AD-40' : '40-AD';
    else pts = `${call[p]}-${call[o]}`;
  }
  return `S${c.setIndex + 1} · ${c.games.p}-${c.games.o} · ${pts}`;
}

export function PointList({ ctx, nm, noAd, limit }: { ctx: PointCtx[]; nm: Record<Side, string>; noAd: boolean; limit?: number }) {
  const { t } = useStore();
  const rows = limit ? ctx.slice(-limit).reverse() : ctx;
  return (
    <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface text-sm" data-testid="point-list">
      {rows.map((c) => (
        <li key={c.index} className={cx('flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2', c.setWinner && 'bg-sunken')}>
          <span className="num w-8 shrink-0 font-mono text-[12px] text-muted">{c.index + 1}</span>
          <span className="num w-40 shrink-0 font-mono text-[12px] text-muted" dir="ltr">{ctxScore(c, noAd)}</span>
          <span className="w-14 shrink-0 text-[11px] font-semibold text-muted">{c.court ? t(`courtShort_${c.court}` as DictKey) : '—'}</span>
          <span className={cx('h-2 w-2 shrink-0 rounded-full', c.point.win === 'p' ? 'bg-good' : 'bg-bad')} aria-hidden="true" />
          <span className="ui-bidi min-w-[12rem] flex-1">
            {pointText(c.point, c.server, nm, t)}
            {c.point.serve === 2 && c.point.end !== 'doubleFault' && <span className="text-muted"> · {t('secondServe')}</span>}
          </span>
          {c.breakPoint && <Badge tone="warn">BP</Badge>}
          {c.gameWinner && !c.setWinner && <Badge>{t('gameTo', { name: shortName(nm[c.gameWinner]) })}</Badge>}
          {c.setWinner && <Badge tone="band">{t('setTo', { name: shortName(nm[c.setWinner]) })}</Badge>}
        </li>
      ))}
    </ol>
  );
}

function FinishModal({ m, nm, open, onClose }: { m: Match; nm: Record<Side, string>; open: boolean; onClose: () => void }) {
  const { dispatch, t, toast } = useStore();
  const [reason, setReason] = useState<'retired' | 'stopped'>('retired');
  const [winner, setWinner] = useState<Side | null>('p');
  return (
    <Modal open={open} onClose={onClose} title={t('finishEarly')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('endReason')}</span>
          {(['retired', 'stopped'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="radio" name="end-reason" checked={reason === r} onChange={() => setReason(r)} data-testid={`reason-${r}`} />
              {r === 'retired' ? t('reasonRetired') : t('reasonStopped')}
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('winnerLabel')}</span>
          {(['p', 'o'] as Side[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="radio" name="end-winner" checked={winner === s} onChange={() => setWinner(s)} data-testid={`finish-winner-${s}`} />
              {nm[s]}
            </label>
          ))}
          {reason === 'stopped' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="end-winner" checked={winner === null} onChange={() => setWinner(null)} data-testid="finish-winner-none" />
              {t('noWinner')}
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            data-testid="confirm-finish"
            onClick={() => {
              dispatch({ type: 'saveMatch', match: { ...m, status: 'done', endReason: reason, winner: reason === 'retired' && !winner ? 'p' : winner } });
              toast(t('matchEnded'));
              onClose();
            }}
          >
            {t('confirmEnd')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function EditMatchModal({ m, open, onClose }: { m: Match; open: boolean; onClose: () => void }) {
  const { dispatch, t, toast } = useStore();
  return (
    <Modal open={open} onClose={onClose} title={t('editDetails')} wide>
      <MatchForm
        key={m.updatedAt}
        initial={m}
        editing
        onCancel={onClose}
        onSubmit={(next) => {
          dispatch({ type: 'saveMatch', match: next });
          toast(t('saved'));
          onClose();
        }}
      />
    </Modal>
  );
}

function MatchLive({ m }: { m: Match }) {
  const { state, dispatch, t, toast } = useStore();
  const canEdit = useCanEdit();
  const player = state.players.find((p) => p.id === m.playerId);
  const nm = names(m, player?.name ?? t('player'), t);
  const r = useMemo(() => replay(m), [m]);
  const st = useMemo(() => statsFromReplay(r), [r]);
  const [finishing, setFinishing] = useState(false);
  const [editing, setEditing] = useState(false);
  /** The last point handed back to the point screen by undo, so it can be corrected. */
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  const e = r.engine;

  const addPoint = (p: Point, oppNet: boolean) => {
    const n = m.points.length;
    const next: Match = { ...m, points: [...m.points, encodePoint(p)], oppNet: [...m.oppNet.filter((i) => i < n), ...(oppNet ? [n] : [])] };
    const done = replay(next).engine.winner;
    if (done) Object.assign(next, { status: 'done', winner: done, endReason: 'completed' });
    setSeed(null);
    dispatch({ type: 'saveMatch', match: next });
    if (done) toast(t('matchOverToast', { name: nm[done] }));
  };
  const undo = () => {
    const i = m.points.length - 1;
    if (i < 0) return;
    setSeed(seedOf(decodePoint(m.points[i]), m.oppNet.includes(i)));
    dispatch({ type: 'saveMatch', match: { ...m, points: m.points.slice(0, -1), oppNet: m.oppNet.filter((k) => k < i) } });
    toast(t('pointUndoneFix'));
  };
  const last = r.points[r.points.length - 1];
  const lastCtx = r.ctx[r.ctx.length - 1];
  const P = st.p;
  const label = gameLabel(e);

  return (
    <div>
      <PageHeader eyebrow={<MatchContext m={m} />} title={t('vsName', { name: nm.o })}>
        <Badge tone="bad"><span className="live-dot" aria-hidden="true" /> {t('live')}</Badge>
        {canEdit && (
          <>
            <Button size="sm" onClick={() => setEditing(true)} data-testid="edit-match">{t('editDetails')}</Button>
            <Button size="sm" variant="danger" onClick={() => setFinishing(true)} data-testid="finish-early">{t('finishEarly')}</Button>
          </>
        )}
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="live-sticky z-20">
            <Scoreboard e={e} live nm={nm} compact={canEdit} />
          </div>
          {canEdit ? (
            <>
              {last && lastCtx && <LastPoint p={last} c={lastCtx} nm={nm} count={r.ctx.length} onUndo={undo} />}
              <PointComposer key={m.points.length} e={e} nm={nm} seed={seed} onPoint={addPoint} />
            </>
          ) : (
            <p className="rounded-xl bg-sunken p-3 text-sm text-muted">{t('liveFollowHelp')}</p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2" data-testid="live-tiles">
            <Tile label={t('st_firstIn')} value={P.servicePoints ? `${Math.round((P.firstIn / P.servicePoints) * 100)}%` : '—'} sub={`${P.firstIn}/${P.servicePoints}`} />
            <Tile label={`${t('st_aces')} / ${t('st_dfShort')}`} value={`${P.aces} / ${P.doubleFaults}`} />
            <Tile label={`${t('st_winners')} / ${t('st_ueShort')}`} value={`${P.winners} / ${P.unforcedErrors}`} />
            <Tile label={t('st_total')} value={st.points ? `${P.pointsWon}–${st.o.pointsWon}` : '—'} sub={label.deuce ? t('deuce') : undefined} />
          </div>
          {r.ctx.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-xl">{t('recentPoints')}</h2>
              <PointList ctx={r.ctx} nm={nm} noAd={m.format.noAd} limit={8} />
            </section>
          )}
          {st.points > 0 && (
            <details className="rounded-2xl border border-line bg-surface p-3">
              <summary className="cursor-pointer font-semibold">{t('liveStats')}</summary>
              <div className="mt-3">
                <StatsTable st={st} nm={nm} />
              </div>
            </details>
          )}
        </div>
      </div>

      {canEdit && <FinishModal m={m} nm={nm} open={finishing} onClose={() => setFinishing(false)} />}
      {canEdit && editing && <EditMatchModal m={m} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-sunken p-3">
      <span className="eyebrow">{label}</span>
      <span className="num font-mono text-xl font-medium">{value}</span>
      {sub && <span className="num text-[12px] text-muted">{sub}</span>}
    </div>
  );
}
