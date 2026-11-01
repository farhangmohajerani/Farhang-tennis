/** Shared pieces for matches and tournaments: labels, scoreboard, statistics, momentum chart. */
import { useState, type ReactNode } from 'react';
import type { DictKey } from '../lib/i18n';
import { formatDate } from '../lib/i18n';
import { useStore } from '../lib/store';
import { href } from '../lib/router';
import {
  gameLabel,
  isBreakPoint,
  other,
  peek,
  scoreboardSets,
  serverOf,
  summary,
  type DisplaySet,
  type Engine,
  type MatchStats,
  type Point,
  type Side,
} from '../lib/match';
import type { GoalStatus } from '../lib/competition';
import { COURT_SIDES, SERVE_DIRS, type CourtSide, type Match, type PointEnd, type Rally, type Round, type ServeDir, type ShotType, type Surface, type Wing } from '../types';
import { Badge, cx } from './ui';

type T = (key: DictKey, vars?: Record<string, string | number>) => string;

export const roundLabel = (t: T, r: Round) => t(`round_${r}` as DictKey);
export const surfaceLabel = (t: T, s: Surface) => t(`surface_${s}` as DictKey);
export const shotLabel = (t: T, s: ShotType) => t(`shot_${s}` as DictKey);
export const wingLabel = (t: T, w: Wing) => t(`wing_${w}` as DictKey);
export const dirLabel = (t: T, d: ServeDir) => t(`dir_${d}` as DictKey);
export const courtLabel = (t: T, c: CourtSide) => t(`court_${c}` as DictKey);

/** "Forehand · Volley" — drive is the default groundstroke and is not repeated. */
export function strokeText(t: T, wing: Wing | null, shot: ShotType | null): string {
  const parts: string[] = [];
  if (wing) parts.push(wingLabel(t, wing));
  if (shot && shot !== 'drive' && shot !== 'serve') parts.push(shotLabel(t, shot));
  if (!parts.length && shot === 'drive') parts.push(shotLabel(t, 'drive'));
  return parts.join(' · ');
}
export const rallyLabel = (t: T, r: Rally) => t(`rally_${r}` as DictKey);
export const endLabel = (t: T, e: PointEnd) => t(`end_${e}` as DictKey);

/** First name for compact buttons ("Ela Demir" → "Ela"). */
export const shortName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function useCanEdit(): boolean {
  const { state, adapter } = useStore();
  return state.settings.role !== 'parent' && adapter.canWrite !== false;
}

export function names(m: Match, playerName: string, t: T): Record<Side, string> {
  return { p: playerName, o: m.opponent.trim() || t('opponent') };
}

/** "6-3 4-6 [10-7]" with the retired / stopped suffix. */
export function scoreLine(m: Match, t: T): string {
  const s = summary(m);
  const suffix = m.status === 'done' && m.endReason === 'retired' ? ` ${t('retShort')}` : m.status === 'done' && m.endReason === 'stopped' ? ` (${t('stoppedShort')})` : '';
  return (s.text || '0-0') + suffix;
}

export function ResultBadge({ m }: { m: Match }) {
  const { t } = useStore();
  if (m.status === 'live') return <Badge tone="bad"><span className="live-dot" aria-hidden="true" /> {t('live')}</Badge>;
  const w = summary(m).winner;
  if (w === 'p') return <Badge tone="good">{t('won')}</Badge>;
  if (w === 'o') return <Badge tone="bad">{t('lost')}</Badge>;
  return <Badge>{t('noResult')}</Badge>;
}

/** One line in a match list. */
export function MatchRow({ m, showTournament = true }: { m: Match; showTournament?: boolean }) {
  const { state, t, lang } = useStore();
  const tour = m.tournamentId ? state.tournaments.find((x) => x.id === m.tournamentId) : undefined;
  return (
    <li>
      <a href={href(`match-${m.id}`)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-sunken" data-match-id={m.id}>
        <span className="num w-20 shrink-0 text-[13px] text-muted">{formatDate(lang, m.date, { day: 'numeric', month: 'short' })}</span>
        <ResultBadge m={m} />
        <span className="num font-mono text-[15px] font-semibold" dir="ltr">{scoreLine(m, t)}</span>
        <span className="ui-bidi min-w-[9rem] flex-1 truncate">
          {t('vsName', { name: m.opponent.trim() || t('opponent') })}
          {m.opponentRating && <span className="text-muted"> · {m.opponentRating}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {m.kind === 'practice' ? (
            <Badge>{t('kind_practiceMatch')}</Badge>
          ) : (
            <Badge tone="accent">
              {showTournament && tour ? `${tour.name}${m.round ? ' · ' : ''}` : ''}
              {m.round ? roundLabel(t, m.round) : !tour || !showTournament ? t('kind_official') : ''}
            </Badge>
          )}
          {m.surface && <Badge>{surfaceLabel(t, m.surface)}</Badge>}
          <Badge tone={m.mode === 'live' ? 'band' : 'neutral'}>{m.mode === 'live' ? t('charted') : t('scoreOnly')}</Badge>
        </span>
      </a>
    </li>
  );
}

export function GoalChip({ status }: { status: GoalStatus }) {
  const { t } = useStore();
  const tone = status === 'met' ? 'good' : status === 'missed' ? 'bad' : status === 'pending' ? 'warn' : 'neutral';
  const icon = status === 'met' ? '✓' : status === 'missed' ? '✕' : status === 'pending' ? '…' : '•';
  return (
    <Badge tone={tone} className="shrink-0">
      {icon} {t(`goalStatus_${status}` as DictKey)}
    </Badge>
  );
}

/* ---------- scoreboard ---------- */

export function Scoreboard({ e, live, nm, compact }: { e: Engine; live: boolean; nm: Record<Side, string>; compact?: boolean }) {
  const { t } = useStore();
  const sets: DisplaySet[] = scoreboardSets(e);
  const label = gameLabel(e);
  const server = serverOf(e);
  const showPoints = live && !e.winner;
  const chips: ReactNode[] = [];
  if (showPoints) {
    const mp = (['p', 'o'] as Side[]).find((s) => peek(e, s).match);
    const sp = !mp && (['p', 'o'] as Side[]).find((s) => peek(e, s).set);
    if (mp) chips.push(<Badge key="mp" tone="warn">{t('matchPointFor', { name: shortName(nm[mp]) })}</Badge>);
    else if (sp) chips.push(<Badge key="sp" tone="warn">{t('setPointFor', { name: shortName(nm[sp]) })}</Badge>);
    if (isBreakPoint(e)) chips.push(<Badge key="bp" tone="warn">{t('breakPointFor', { name: shortName(nm[other(server)]) })}</Badge>);
    if (label.deuce) chips.push(<Badge key="d">{e.format.noAd ? t('decidingPoint') : t('deuce')}</Badge>);
    if (e.tb) chips.push(<Badge key="tb" tone="accent">{e.tb.target === 10 ? t('matchTiebreak') : t('tiebreak')}</Badge>);
  }
  return (
    <div className={cx('rounded-2xl bg-band text-band-ink', compact ? 'p-3' : 'p-3 md:p-4')} data-testid="scoreboard">
      <table className="num w-full border-separate border-spacing-y-1" dir="ltr">
        <tbody>
          {(['p', 'o'] as Side[]).map((side) => (
            <tr key={side} data-side={side}>
              <td className="max-w-0 pe-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', showPoints && server === side ? 'bg-[#d9f24a]' : 'bg-transparent')} aria-label={showPoints && server === side ? t('serving') : undefined} />
                  <span className={cx('truncate font-semibold', compact ? 'text-[15px]' : 'text-[15px] md:text-[17px]', e.winner === side && 'underline decoration-2 underline-offset-4')}>{nm[side]}</span>
                </span>
              </td>
              {sets.map((s, i) => (
                <td key={i} className={cx('w-8 text-center font-mono md:w-9', compact ? 'text-lg' : 'text-xl md:text-2xl', s.done && s[side] < s[other(side)] && 'text-band-muted')} data-testid={`set-${i}-${side}`}>
                  {s[side]}
                  {s.tb !== null && s[side] < s[other(side)] && <sup className="ms-0.5 text-[11px]">{s.tb}</sup>}
                </td>
              ))}
              {showPoints && (
                <td className="w-14 ps-2 md:w-16">
                  <span className={cx('block rounded-lg bg-band-ink/10 text-center font-mono font-semibold', compact ? 'py-0.5 text-lg' : 'py-0.5 text-xl md:py-1 md:text-2xl')} data-testid={`points-${side}`}>
                    {label[side]}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {chips.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" data-testid="score-chips">{chips}</div>}
    </div>
  );
}

/* ---------- statistics ---------- */

type Pair = [number, number];
const pctText = ([a, b]: Pair) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function StatRow({ label, p, o, pct, invert }: { label: string; p: number | Pair; o: number | Pair; pct?: boolean; invert?: boolean }) {
  const val = (x: number | Pair) => (Array.isArray(x) ? (x[1] > 0 ? x[0] / x[1] : null) : x);
  const vp = val(p);
  const vo = val(o);
  const max = pct ? 1 : Math.max(vp ?? 0, vo ?? 0, 1);
  const better = vp === null || vo === null || vp === vo ? null : (vp > vo) !== !!invert ? 'p' : 'o';
  const cell = (x: number | Pair, side: Side) => {
    const v = side === 'p' ? vp : vo;
    return (
      <td className="w-[38%] px-2 py-1.5 align-middle">
        <div className={cx('flex items-baseline gap-1.5', side === 'p' ? 'justify-end' : 'justify-start')}>
          <span className={cx('font-mono text-[15px]', better === side && 'font-bold')}>{Array.isArray(x) ? pctText(x) : x}</span>
          {Array.isArray(x) && x[1] > 0 && <span className="text-[11px] text-muted">{x[0]}/{x[1]}</span>}
        </div>
        <div className={cx('mt-1 flex h-1.5 overflow-hidden rounded-full bg-sunken', side === 'p' ? 'justify-end' : 'justify-start')}>
          <span className={cx('h-full rounded-full', side === 'p' ? 'bg-accent' : 'bg-muted')} style={{ width: `${v === null ? 0 : Math.min(100, (v / max) * 100)}%` }} />
        </div>
      </td>
    );
  };
  return (
    <tr className="border-b border-line last:border-0">
      {cell(p, 'p')}
      <th scope="row" className="px-1 py-1.5 text-center text-[12px] font-semibold text-muted">{label}</th>
      {cell(o, 'o')}
    </tr>
  );
}

export function StatsTable({ st, nm }: { st: MatchStats; nm: Record<Side, string> }) {
  const { t } = useStore();
  const P = st.p;
  const O = st.o;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface" data-testid="stats-table">
      <table className="num w-full table-fixed text-sm" dir="ltr">
        <thead>
          <tr className="border-b border-line">
            <th className="px-2 py-2 text-end font-semibold">{shortName(nm.p)}</th>
            <th className="px-1 py-2" />
            <th className="px-2 py-2 text-start font-semibold">{shortName(nm.o)}</th>
          </tr>
        </thead>
        <tbody>
          <StatRow label={t('st_aces')} p={P.aces} o={O.aces} />
          <StatRow label={t('st_df')} p={P.doubleFaults} o={O.doubleFaults} invert />
          <StatRow label={t('st_firstIn')} p={[P.firstIn, P.servicePoints]} o={[O.firstIn, O.servicePoints]} pct />
          <StatRow label={t('st_firstWon')} p={[P.firstWon, P.firstIn]} o={[O.firstWon, O.firstIn]} pct />
          <StatRow label={t('st_secondWon')} p={[P.secondWon, P.secondPlayed]} o={[O.secondWon, O.secondPlayed]} pct />
          <StatRow label={t('st_bpSaved')} p={[P.bpSaved, P.bpFaced]} o={[O.bpSaved, O.bpFaced]} pct />
          <StatRow label={t('st_svcGames')} p={[P.serviceGamesWon, P.serviceGames]} o={[O.serviceGamesWon, O.serviceGames]} pct />
          <StatRow label={t('st_retWon')} p={[P.returnWon, P.returnPoints]} o={[O.returnWon, O.returnPoints]} pct />
          <StatRow label={t('st_ret1')} p={[P.returnFirstWon, P.returnFirstPlayed]} o={[O.returnFirstWon, O.returnFirstPlayed]} pct />
          <StatRow label={t('st_ret2')} p={[P.returnSecondWon, P.returnSecondPlayed]} o={[O.returnSecondWon, O.returnSecondPlayed]} pct />
          <StatRow label={t('st_bpConv')} p={[P.bpConverted, P.bpChances]} o={[O.bpConverted, O.bpChances]} pct />
          <StatRow label={t('st_winners')} p={P.winners} o={O.winners} />
          <StatRow label={t('st_svcWinners')} p={P.serviceWinners} o={O.serviceWinners} />
          <StatRow label={t('st_ue')} p={P.unforcedErrors} o={O.unforcedErrors} invert />
          <StatRow label={t('st_fe')} p={P.forcedErrors} o={O.forcedErrors} invert />
          <StatRow label={t('st_retErr')} p={P.returnErrors} o={O.returnErrors} invert />
          <StatRow label={t('st_total')} p={[P.pointsWon, st.points]} o={[O.pointsWon, st.points]} pct />
        </tbody>
      </table>
    </div>
  );
}

type Pair2 = [number, number];
const pctCell = ([a, b]: Pair2) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function Frac({ v }: { v: Pair2 }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono text-[15px] font-semibold">{pctCell(v)}</span> <span className="text-[11px] text-muted">{v[0]}/{v[1]}</span>
    </span>
  );
}

function Panel({ title, help, children, testid }: { title: string; help?: string; children: ReactNode; testid?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" data-testid={testid}>
      <h3 className="font-semibold">{title}</h3>
      {help && <p className="mt-0.5 text-[12px] text-muted">{help}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Deuce / ad court, returns by wing, rally shots by kind, serve direction, rally length — for either player. */
export function DetailedAnalysis({ st, nm }: { st: MatchStats; nm: Record<Side, string> }) {
  const { t } = useStore();
  const [who, setWho] = useState<Side>('p');
  const C = st.court[who];
  const R = st.returns[who];
  const rows = Object.values(st.strokes[who])
    .filter((r) => !r.ret)
    .sort((a, b) => b.winners + b.forced + b.unforced - (a.winners + a.forced + a.unforced));
  const dirs = st.serveDir[who];
  const anyDir = COURT_SIDES.some((c) => SERVE_DIRS.some((d) => dirs[c][d].played > 0));
  const name = shortName(nm[who]);
  return (
    <section data-testid="detailed-analysis">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl leading-tight">{t('detailTitle')}</h2>
        <div role="radiogroup" aria-label={t('detailTitle')} className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {(['p', 'o'] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={who === s}
              onClick={() => setWho(s)}
              data-testid={`who-${s}`}
              className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', who === s ? 'bg-band text-band-ink' : 'text-muted')}
            >
              {shortName(nm[s])}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t('courtTitle')} help={t('courtHelp', { name })} testid="court-sides">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-[12px] text-muted">
                <th className="py-1 text-start font-semibold" />
                {COURT_SIDES.map((c) => (
                  <th key={c} className="py-1 text-end font-semibold">{courtLabel(t, c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 text-start font-semibold">{t('servePtsWon')}</th>
                {COURT_SIDES.map((c) => (
                  <td key={c} className="py-2 text-end" data-testid={`serve-won-${c}`}><Frac v={[C[c].serveWon, C[c].servePlayed]} /></td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 text-start font-normal text-muted">{t('st_firstIn')}</th>
                {COURT_SIDES.map((c) => (
                  <td key={c} className="py-2 text-end"><Frac v={[C[c].firstIn, C[c].servePlayed]} /></td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 text-start font-normal text-muted">{t('st_aces')} / {t('st_dfShort')}</th>
                {COURT_SIDES.map((c) => (
                  <td key={c} className="py-2 text-end font-mono">{C[c].aces} / {C[c].doubleFaults}</td>
                ))}
              </tr>
              <tr className="border-t-2 border-line">
                <th scope="row" className="py-2 text-start font-semibold">{t('returnPtsWon')}</th>
                {COURT_SIDES.map((c) => (
                  <td key={c} className="py-2 text-end" data-testid={`return-won-${c}`}><Frac v={[C[c].returnWon, C[c].returnPlayed]} /></td>
                ))}
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title={t('returnsTitle')} help={t('returnsHelp', { name })} testid="returns-by-wing">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-[12px] text-muted">
                <th className="py-1 text-start font-semibold" />
                <th className="py-1 text-end font-semibold text-good">{t('end_returnWinner')}</th>
                <th className="py-1 text-end font-semibold text-bad">{t('end_returnError')}</th>
              </tr>
            </thead>
            <tbody>
              {(['fh', 'bh', 'unknown'] as const)
                .filter((w) => w !== 'unknown' || R.unknown.winners + R.unknown.errors > 0)
                .map((w) => (
                  <tr key={w} className="border-t border-line">
                    <th scope="row" className="py-2 text-start font-semibold">{w === 'unknown' ? t('wingUnknown') : wingLabel(t, w)}</th>
                    <td className="py-2 text-end font-mono" data-testid={`ret-win-${w}`}>{R[w].winners}</td>
                    <td className="py-2 text-end font-mono" data-testid={`ret-err-${w}`}>{R[w].errors}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>

        <Panel title={t('shotsTitle')} help={t('shotsHelp', { name })} testid="shots-by-kind">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">{t('noStrokes')}</p>
          ) : (
            <table className="num w-full text-sm">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th className="py-1 text-start font-semibold">{t('stroke')}</th>
                  <th className="py-1 text-end font-semibold text-good">{t('colWinners')}</th>
                  <th className="py-1 text-end font-semibold text-warn">{t('colForced')}</th>
                  <th className="py-1 text-end font-semibold text-bad">{t('colUnforced')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.wing}:${r.shot}`} className="border-t border-line" data-stroke={`${r.wing ?? '-'}:${r.shot ?? '-'}`}>
                    <th scope="row" className="py-1.5 text-start font-semibold">{strokeText(t, r.wing, r.shot) || t('wingUnknown')}</th>
                    <td className="py-1.5 text-end font-mono">{r.winners}</td>
                    <td className="py-1.5 text-end font-mono">{r.forced}</td>
                    <td className="py-1.5 text-end font-mono">{r.unforced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {who === 'p' && st.net.played > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-sm">
              <span className="font-semibold">{t('st_netWon')}:</span> <Frac v={[st.net.won, st.net.played]} />
            </p>
          )}
        </Panel>

        <Panel title={t('serveDirTitle')} help={t('serveDirHelp', { name })} testid="serve-direction">
          {!anyDir ? (
            <p className="text-sm text-muted">{t('serveDirEmpty')}</p>
          ) : (
            <table className="num w-full text-sm">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th className="py-1 text-start font-semibold" />
                  {SERVE_DIRS.map((d) => (
                    <th key={d} className="py-1 text-end font-semibold">{dirLabel(t, d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COURT_SIDES.map((c) => (
                  <tr key={c} className="border-t border-line">
                    <th scope="row" className="py-2 text-start font-semibold">{courtLabel(t, c)}</th>
                    {SERVE_DIRS.map((d) => (
                      <td key={d} className="py-2 text-end">
                        <span className="font-mono">{dirs[c][d].played}</span>
                        {dirs[c][d].played > 0 && <span className="block text-[11px] text-muted">{t('wonPct', { pct: pctCell([dirs[c][d].won, dirs[c][d].played]) })}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t('rallyTitle')} help={t('rallyHelp', { name })} testid="rally-breakdown">
          <ul className="flex flex-col gap-2.5">
            {(['short', 'mid', 'long'] as Rally[]).map((r) => {
              const x = st.rally[r];
              const won = who === 'p' ? x.won : x.played - x.won;
              const v = x.played ? won / x.played : null;
              return (
                <li key={r} className="num grid grid-cols-[72px_1fr_auto] items-center gap-2 text-sm">
                  <span className="font-semibold">{rallyLabel(t, r)}</span>
                  <span className="flex h-2.5 overflow-hidden rounded-full bg-sunken">
                    <span className="h-full rounded-full bg-accent" style={{ width: `${v === null ? 0 : v * 100}%` }} />
                  </span>
                  <span className="font-mono text-[13px]">
                    {v === null ? '—' : `${Math.round(v * 100)}%`} <span className="text-muted">{won}/{x.played}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </section>
  );
}

/** Running point difference across the match; set ends marked. */
export function MomentumChart({ st, name }: { st: MatchStats; name: string }) {
  const { t } = useStore();
  const m = st.momentum;
  if (m.length < 2) return null;
  const W = 640;
  const H = 150;
  const pad = 12;
  // Scale to the data: the zero line sits where it falls between the lowest and highest point.
  const hi = Math.max(2, ...m);
  const lo = Math.min(-2, ...m);
  const x = (i: number) => pad + (i / (m.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - 2 * pad);
  const zero = y(0);
  const path = m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(m.length - 1).toFixed(1)} ${zero.toFixed(1)} L${x(0).toFixed(1)} ${zero.toFixed(1)} Z`;
  return (
    <figure className="rounded-2xl border border-line bg-surface p-4" data-testid="momentum">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{t('momentumTitle')}</span>
        <span className="text-[12px] text-muted">{t('momentumHelp', { name: shortName(name) })}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('momentumTitle')} dir="ltr">
        <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="var(--tp-muted)" strokeWidth="1" strokeOpacity="0.5" />
        {st.setEnds.slice(0, -1).map((i, k) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={pad / 2} y2={H - pad / 2} stroke="var(--tp-line)" strokeDasharray="3 4" />
            <text x={x(i) + 4} y={pad + 4} fontSize="11" fill="var(--tp-muted)">{`S${k + 2}`}</text>
          </g>
        ))}
        <path d={area} fill="var(--tp-accent)" fillOpacity="0.12" />
        <path d={path} fill="none" stroke="var(--tp-accent)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </figure>
  );
}

/** "Ela: Winner · Forehand · Volley" / "Deniz: Ace · T" — who ended the point and how. */
export function pointText(p: Point, server: Side, nm: Record<Side, string>, t: T): string {
  const by: Side | null =
    p.end === 'ace' || p.end === 'serviceWinner' || p.end === 'doubleFault'
      ? server
      : p.end === 'returnWinner' || p.end === 'returnError'
        ? other(server)
        : p.end === 'winner'
          ? p.win
          : p.end === 'forcedError' || p.end === 'unforcedError'
            ? other(p.win)
            : null;
  if (!by) return t('pointFor', { name: shortName(nm[p.win]) });
  const serveEnd = p.end === 'ace' || p.end === 'serviceWinner';
  const detail = serveEnd ? (p.dir ? dirLabel(t, p.dir) : '') : strokeText(t, p.wing, p.shot);
  return `${shortName(nm[by])}: ${endLabel(t, p.end)}${detail ? ` · ${detail}` : ''}`;
}
