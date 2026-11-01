import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { formatDate, type DictKey } from '../lib/i18n';
import { bare, courtOf, decodePoint, encodePoint, gameLabel, other, replay, serverOf, statsFromReplay, type Engine, type Point, type PointCtx, type Side } from '../lib/match';
import type { Match, PointEnd, Rally, ServeDir, ShotType, Wing } from '../types';
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

function Big({ tone, testid, onClick, children }: { tone: 'primary' | 'good' | 'bad' | 'neutral'; testid: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={cx(
        'min-h-[54px] rounded-2xl border px-3 py-2 text-[15px] font-semibold leading-tight transition active:scale-[0.98]',
        tone === 'primary' && 'border-accent bg-accent text-accent-ink',
        tone === 'good' && 'border-good/30 bg-good-soft text-good',
        tone === 'bad' && 'border-bad/30 bg-bad-soft text-bad',
        tone === 'neutral' && 'border-line bg-surface text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Serve → outcome with forehand / backhand: two taps for most points. */
function PointEntry({ e, nm, count, onPoint }: { e: Engine; nm: Record<Side, string>; count: number; onPoint: (p: Point) => void }) {
  const { t } = useStore();
  const [stage, setStage] = useState<'serve1' | 'serve2' | 'rally'>('serve1');
  const [serveNo, setServeNo] = useState<1 | 2>(1);
  useEffect(() => setStage('serve1'), [count]);
  const server = serverOf(e);
  const receiver = other(server);
  const court = courtOf(e);
  const tone = (side: Side) => (side === 'p' ? 'good' : 'bad');
  const point = (p: Point) => {
    setStage('serve1');
    onPoint(p);
  };
  const n: 1 | 2 = stage === 'serve2' ? 2 : 1;

  const column = (side: Side) => {
    const loser = other(side);
    const items: { end: PointEnd; label: string }[] = [
      { end: 'winner', label: t('winnerBtn') },
      ...(side === receiver ? [{ end: 'returnWinner' as const, label: t('end_returnWinner') }] : []),
      { end: 'forcedError', label: t('errBy', { name: shortName(nm[loser]), err: t('end_forcedError') }) },
      { end: 'unforcedError', label: t('errBy', { name: shortName(nm[loser]), err: t('end_unforcedError') }) },
      ...(loser === receiver ? [{ end: 'returnError' as const, label: t('errBy', { name: shortName(nm[loser]), err: t('end_returnError') }) }] : []),
    ];
    return (
      <div className="flex min-w-0 flex-col gap-2" data-column={side}>
        <div className={cx('rounded-full py-1 text-center text-[13px] font-bold', side === 'p' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad')}>{t('pointTo', { name: shortName(nm[side]) })}</div>
        {items.map((it) => {
          const ret = it.end === 'returnWinner' || it.end === 'returnError';
          return (
            <div key={it.end} className={cx('rounded-2xl border p-1.5', side === 'p' ? 'border-good/30 bg-good-soft' : 'border-bad/30 bg-bad-soft')} data-row={`${side}-${it.end}`}>
              <div className={cx('ui-bidi px-1.5 pb-1 text-[12.5px] font-bold leading-tight', side === 'p' ? 'text-good' : 'text-bad')}>{it.label}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(['fh', 'bh'] as Wing[]).map((w) => (
                  <button
                    key={w}
                    type="button"
                    data-testid={`${side}-${it.end}-${w}`}
                    onClick={() => point(bare(side, serveNo, it.end, { wing: w, shot: 'drive', rally: ret ? 'short' : null }))}
                    className={cx('min-h-[46px] rounded-xl bg-surface px-1.5 text-[14px] font-semibold leading-tight transition active:scale-[0.97]', side === 'p' ? 'text-good' : 'text-bad')}
                  >
                    <span className="sm:hidden">{t(`wingShort_${w}` as DictKey)}</span>
                    <span className="hidden sm:inline">{wingLabel(t, w)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <Big tone={tone(side)} testid={`${side}-other`} onClick={() => point(bare(side, serveNo, 'other'))}>
          {t('otherPoint')}
        </Big>
      </div>
    );
  };

  return (
    <Card className="p-4" as="div">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="ui-bidi text-sm" data-testid="serve-status">
          <span className="eyebrow me-1">{t('serving')}</span>
          <strong>{shortName(nm[server])}</strong> · {stage === 'rally' ? (serveNo === 1 ? t('firstServe') : t('secondServe')) : n === 1 ? t('firstServe') : t('secondServe')}
          {court && (
            <>
              {' · '}
              <span className="font-semibold text-accent" data-testid="court-side">{courtLabel(t, court)}</span>
            </>
          )}
        </p>
        {stage !== 'serve1' && (
          <Button size="sm" variant="ghost" onClick={() => setStage(stage === 'rally' ? (serveNo === 2 ? 'serve2' : 'serve1') : 'serve1')} data-testid="entry-back">
            {t('back')}
          </Button>
        )}
      </div>
      {stage !== 'rally' ? (
        <div className="grid grid-cols-2 gap-2">
          <Big
            tone="primary"
            testid="serve-in"
            onClick={() => {
              setServeNo(n);
              setStage('rally');
            }}
          >
            {n === 1 ? t('serveIn1') : t('serveIn2')}
          </Big>
          {n === 1 ? (
            <Big tone="neutral" testid="fault" onClick={() => setStage('serve2')}>
              {t('fault')}
            </Big>
          ) : (
            <Big tone={tone(receiver)} testid="double-fault" onClick={() => point(bare(receiver, 2, 'doubleFault', { shot: 'serve', rally: 'short' }))}>
              {t('end_doubleFault')}
            </Big>
          )}
          <Big tone={tone(server)} testid="ace" onClick={() => point(bare(server, n, 'ace', { shot: 'serve', rally: 'short' }))}>
            {t('end_ace')}
          </Big>
          <Big tone={tone(server)} testid="service-winner" onClick={() => point(bare(server, n, 'serviceWinner', { shot: 'serve', rally: 'short' }))}>
            {t('end_serviceWinner')}
          </Big>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {column('p')}
          {column('o')}
        </div>
      )}
    </Card>
  );
}

const RALLY_SHOTS: ShotType[] = ['drive', 'slice', 'drop', 'lob', 'approach', 'pass', 'volley', 'halfVolley', 'overhead'];

/** Detail for the point just recorded: wing, kind of shot, rally length, net, serve direction. */
function LastPointDetail({ p, c, nm, onChange }: { p: Point; c: PointCtx; nm: Record<Side, string>; onChange: (patch: Partial<Point>) => void }) {
  const { t } = useStore();
  const serveEnd = p.end === 'ace' || p.end === 'serviceWinner' || p.end === 'doubleFault';
  const returnEnd = p.end === 'returnWinner' || p.end === 'returnError';
  const rallyEnd = p.end === 'winner' || p.end === 'forcedError' || p.end === 'unforcedError';
  const chip = (sel: boolean, label: string, testid: string, onClick: () => void) => (
    <button
      key={testid}
      type="button"
      aria-pressed={sel}
      data-testid={testid}
      onClick={onClick}
      className={cx('min-h-9 rounded-full border px-3 py-1 text-[13px] font-semibold', sel ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface')}
    >
      {label}
    </button>
  );
  const row = (label: string, children: ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-full shrink-0 text-[12px] font-semibold text-muted sm:w-28">{label}</span>
      {children}
    </div>
  );
  return (
    <Card className="p-4" as="div">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="eyebrow">
          {t('lastPoint')}
          {c.court && <> · {courtLabel(t, c.court)}</>}
        </span>
        <span className="ui-bidi text-sm font-semibold" data-testid="last-point">{pointText(p, c.server, nm, t)}</span>
      </div>
      <div className="flex flex-col gap-3">
        {(rallyEnd || returnEnd) &&
          row(
            t('wingLabel'),
            (['fh', 'bh'] as Wing[]).map((w) => chip(p.wing === w, wingLabel(t, w), `wing-${w}`, () => onChange({ wing: p.wing === w ? null : w, shot: p.shot === 'overhead' ? 'drive' : p.shot }))),
          )}
        {(rallyEnd || returnEnd) &&
          row(
            t('stroke'),
            (returnEnd ? (['drive', 'slice'] as ShotType[]) : RALLY_SHOTS).map((s) =>
              chip(p.shot === s, shotLabel(t, s), `type-${s}`, () => onChange({ shot: p.shot === s ? null : s, ...(s === 'overhead' ? { wing: null } : {}), ...(s === 'volley' || s === 'halfVolley' || s === 'overhead' ? { net: true } : {}) })),
            ),
          )}
        {rallyEnd && row(t('rallyLen'), (['short', 'mid', 'long'] as Rally[]).map((r) => chip(p.rally === r, rallyLabel(t, r), `rally-${r}`, () => onChange({ rally: p.rally === r ? null : r }))))}
        {rallyEnd && row(t('netLabel'), chip(p.net, t('atNet', { name: shortName(nm.p) }), 'net-toggle', () => onChange({ net: !p.net })))}
        {p.end !== 'doubleFault' &&
          row(
            t('serveDirLabel', { name: shortName(nm[c.server]) }),
            (['wide', 'body', 't'] as ServeDir[]).map((d) => chip(p.dir === d, dirLabel(t, d), `dir-${d}`, () => onChange({ dir: p.dir === d ? null : d }))),
          )}
        {serveEnd && p.end === 'doubleFault' && <p className="text-[13px] text-muted">{t('noDetailNeeded')}</p>}
      </div>
    </Card>
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
          <span className="ui-bidi min-w-0 flex-1">
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
  const e = r.engine;

  const savePoints = (points: string[]) => {
    const next: Match = { ...m, points };
    const done = replay(next).engine.winner;
    if (done) Object.assign(next, { status: 'done', winner: done, endReason: 'completed' });
    dispatch({ type: 'saveMatch', match: next });
    if (done) toast(t('matchOverToast', { name: nm[done] }));
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="live-sticky z-20">
            <Scoreboard e={e} live nm={nm} />
          </div>
          {canEdit ? (
            <>
              <PointEntry e={e} nm={nm} count={m.points.length} onPoint={(p) => savePoints([...m.points, encodePoint(p)])} />
              {last && lastCtx && (
                <LastPointDetail
                  p={last}
                  c={lastCtx}
                  nm={nm}
                  onChange={(patch) => {
                    const pts = [...m.points];
                    pts[pts.length - 1] = encodePoint({ ...decodePoint(pts[pts.length - 1]), ...patch });
                    dispatch({ type: 'saveMatch', match: { ...m, points: pts } });
                  }}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!m.points.length}
                  onClick={() => {
                    dispatch({ type: 'saveMatch', match: { ...m, points: m.points.slice(0, -1) } });
                    toast(t('pointUndone'));
                  }}
                  data-testid="undo-point"
                >
                  ↶ {t('undoPoint')}
                </Button>
                <span className="num text-[13px] text-muted">{t('pointsPlayed', { n: r.ctx.length })}</span>
              </div>
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
