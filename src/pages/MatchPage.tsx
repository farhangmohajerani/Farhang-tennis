import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { formatDate, type DictKey } from '../lib/i18n';
import {
  composePoint,
  courtOf,
  decodePoint,
  draftOf,
  EMPTY_DRAFT,
  encodePoint,
  gameLabel,
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
import { RALLY, SERVE_DIRS, WINGS, type Match, type PointEnd, type ShotType } from '../types';
import { Badge, Button, Card, cx, Empty, Modal, PageHeader } from '../components/ui';
import { courtLabel, dirLabel, names, pointText, rallyLabel, roundLabel, Scoreboard, shortName, shotLabel, StatsTable, strokeText, surfaceLabel, useCanEdit, wingLabel } from '../components/MatchBits';
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

const COMPOSER_SHOTS: ShotType[] = ['drive', 'slice', 'volley', 'halfVolley', 'drop', 'lob', 'approach', 'pass', 'overhead'];

function Chip({ on, testid, onClick, children }: { on: boolean; testid: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testid}
      onClick={onClick}
      className={cx(
        'min-h-10 rounded-full border px-3 py-1.5 text-[13.5px] font-semibold leading-tight transition active:scale-[0.97]',
        on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:items-start">
      <span className="ui-bidi text-[12px] font-semibold text-muted sm:pt-2.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** A result button: green when the point goes to the player, red when it goes to the opponent. */
function Outcome({ win, testid, label, quiet, onClick }: { win: Side; testid: string; label: string; quiet?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-win={win}
      onClick={onClick}
      className={cx(
        'ui-bidi rounded-2xl border px-2 py-1.5 text-center font-semibold leading-tight transition active:scale-[0.97]',
        quiet ? 'min-h-11 text-[13px]' : 'min-h-[56px] text-[13.5px] sm:text-[14.5px]',
        win === 'p' ? 'border-good/30 bg-good-soft text-good' : 'border-bad/30 bg-bad-soft text-bad',
      )}
    >
      {label}
    </button>
  );
}

function OutcomeRow({ label, testid, children }: { label: string; testid: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:items-center sm:gap-2 @4xl:grid-cols-[5.5rem_minmax(0,1fr)]" data-row={testid}>
      <span className="ui-bidi text-[12.5px] font-bold leading-tight">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">{children}</div>
    </div>
  );
}

/** "2nd serve · T · Forehand · Volley · 5–8 shots · Ela at the net" — what the next tap will save. */
function draftText(d: PointDraft, nm: Record<Side, string>, t: ReturnType<typeof useStore>['t']): string {
  const parts: string[] = [d.serve === 1 ? t('firstServe') : t('secondServe')];
  if (d.dir) parts.push(dirLabel(t, d.dir));
  const stroke = strokeText(t, d.shot === 'overhead' ? null : d.wing, d.shot);
  if (stroke) parts.push(stroke);
  if (d.rally) parts.push(rallyLabel(t, d.rally));
  if (d.netP) parts.push(t('atNetShort', { name: shortName(nm.p) }));
  if (d.netO) parts.push(t('atNetShort', { name: shortName(nm.o) }));
  return parts.join(' · ');
}

/**
 * Everything for one point on one screen: pick any detail (serve, direction, forehand / backhand,
 * kind of shot, rally length, net) in any order, then tap how the point ended — that tap saves it.
 */
/** Mounted afresh for every point (keyed by the point count), starting from `seed` after an undo. */
function PointComposer({ e, nm, seed, onPoint }: { e: Engine; nm: Record<Side, string>; seed: PointDraft | null; onPoint: (p: Point, oppNet: boolean) => void }) {
  const { t } = useStore();
  const [d, setD] = useState<PointDraft>(seed ?? EMPTY_DRAFT);
  const server = serverOf(e);
  const receiver = other(server);
  const court = courtOf(e);
  const name = (s: Side) => shortName(nm[s]);
  const toggle = <K extends 'wing' | 'shot' | 'rally' | 'dir'>(k: K, v: NonNullable<PointDraft[K]>) => setD((x) => ({ ...x, [k]: x[k] === v ? null : v }) as PointDraft);
  const tap = (actor: Side, end: PointEnd) => {
    const r = composePoint(d, actor, end);
    onPoint(r.point, r.oppNet);
  };
  const dirty = d.serve !== 1 || d.wing || d.shot || d.rally || d.dir || d.netP || d.netO;

  return (
    <Card className="@container p-3 sm:p-4" as="div">
      <div className="flex flex-col gap-3" data-testid="point-composer">
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

        <div className="grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @4xl:gap-5">
          <div className="flex flex-col gap-3">
            <ChipRow label={t('serveDirLabel', { name: name(server) })}>
              {SERVE_DIRS.map((x) => (
                <Chip key={x} on={d.dir === x} testid={`dir-${x}`} onClick={() => toggle('dir', x)}>
                  {dirLabel(t, x)}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label={t('lastShot')}>
              {WINGS.map((w) => (
                <Chip key={w} on={d.wing === w} testid={`wing-${w}`} onClick={() => toggle('wing', w)}>
                  {wingLabel(t, w)}
                </Chip>
              ))}
              <span className="mx-0.5 w-px self-stretch bg-line" aria-hidden="true" />
              {COMPOSER_SHOTS.map((s) => (
                <Chip key={s} on={d.shot === s} testid={`type-${s}`} onClick={() => toggle('shot', s)}>
                  {shotLabel(t, s)}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label={t('rallyLen')}>
              {RALLY.map((r) => (
                <Chip key={r} on={d.rally === r} testid={`rally-${r}`} onClick={() => toggle('rally', r)}>
                  {rallyLabel(t, r)}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label={t('netLabel')}>
              <Chip on={d.netP} testid="net-p" onClick={() => setD((x) => ({ ...x, netP: !x.netP }))}>
                {t('atNetShort', { name: name('p') })}
              </Chip>
              <Chip on={d.netO} testid="net-o" onClick={() => setD((x) => ({ ...x, netO: !x.netO }))}>
                {t('atNetShort', { name: name('o') })}
              </Chip>
            </ChipRow>
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-3 @4xl:border-s @4xl:border-t-0 @4xl:ps-5 @4xl:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="ui-bidi text-[13px] font-semibold" data-testid="draft-summary">
                <span className="text-muted">{t('thisPoint')}: </span>
                {draftText(d, nm, t)}
              </p>
              {dirty && (
                <button type="button" className="text-[13px] font-semibold text-accent" onClick={() => setD(EMPTY_DRAFT)} data-testid="draft-clear">
                  {t('clearChoices')}
                </button>
              )}
            </div>
            <p className="ui-bidi text-[12px] text-muted">{t('howEndedHelp', { p: name('p'), o: name('o') })}</p>
            <OutcomeRow label={t('serveBy', { name: name(server) })} testid="serve">
              <Outcome win={server} testid={`${server}-ace`} label={t('end_ace')} onClick={() => tap(server, 'ace')} />
              <Outcome win={server} testid={`${server}-serviceWinner`} label={t('end_serviceWinner')} onClick={() => tap(server, 'serviceWinner')} />
              <Outcome win={receiver} testid={`${server}-doubleFault`} label={t('end_doubleFault')} onClick={() => tap(server, 'doubleFault')} />
            </OutcomeRow>
            <OutcomeRow label={t('returnBy', { name: name(receiver) })} testid="return">
              <Outcome win={receiver} testid={`${receiver}-returnWinner`} label={t('end_returnWinner')} onClick={() => tap(receiver, 'returnWinner')} />
              <Outcome win={server} testid={`${receiver}-returnError`} label={t('end_returnError')} onClick={() => tap(receiver, 'returnError')} />
            </OutcomeRow>
            {(['p', 'o'] as Side[]).map((s) => (
              <OutcomeRow key={s} label={name(s)} testid={`rally-${s}`}>
                <Outcome win={s} testid={`${s}-winner`} label={t('end_winner')} onClick={() => tap(s, 'winner')} />
                <Outcome win={other(s)} testid={`${s}-forcedError`} label={t('end_forcedError')} onClick={() => tap(s, 'forcedError')} />
                <Outcome win={other(s)} testid={`${s}-unforcedError`} label={t('end_unforcedError')} onClick={() => tap(s, 'unforcedError')} />
              </OutcomeRow>
            ))}
            <OutcomeRow label={t('notSeen')} testid="other">
              {(['p', 'o'] as Side[]).map((s) => (
                <Outcome key={s} quiet win={s} testid={`${s}-other`} label={t('pointFor', { name: name(s) })} onClick={() => tap(s, 'other')} />
              ))}
            </OutcomeRow>
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
  /** Details handed back to the point screen by undo, so the last point can be corrected. */
  const [seed, setSeed] = useState<PointDraft | null>(null);
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
    setSeed(draftOf(decodePoint(m.points[i]), m.oppNet.includes(i)));
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
            <Scoreboard e={e} live nm={nm} />
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
