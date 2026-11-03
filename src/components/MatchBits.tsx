/** Shared pieces for matches and tournaments: labels, scoreboard, statistics, momentum chart. */
import type { ReactNode } from 'react';
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
  strokeKey,
  summary,
  type DisplaySet,
  type Engine,
  type MatchStats,
  type Point,
  type PointCtx,
  type Side,
} from '../lib/match';
import type { GoalStatus } from '../lib/competition';
import { COURT_SIDES, SERVE_DIRS, type CourtSide, type Match, type MatchFormat, type PointEnd, type Rally, type Round, type ServeDir, type ShotType, type Surface, type Wing } from '../types';
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

/** "Best of 3 · Short sets · Match tie-break · No-ad" */
export function formatText(f: MatchFormat, t: T): string {
  const parts = [f.sets === 1 ? t('oneSetOpt') : t('bestOf', { n: f.sets })];
  if (f.games === 4) parts.push(t('shortSetsLabel'));
  if (f.sets > 1 && f.finalSet === 'mtb') parts.push(t('finalMtb'));
  parts.push(f.noAd ? t('noAdShort') : t('adShort'));
  return parts.join(' · ');
}

/** "S2 · 3-4 · 30-40" — the score before a point. */
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

export function useCanEdit(): boolean {
  const { state, adapter } = useStore();
  return state.settings.role !== 'parent' && adapter.canWrite !== false;
}

/**
 * Online version: whoever made a plan, result, tournament or match deletes it. The admin may delete
 * anything, and older records without a maker stay open to the player's coaches.
 */
export function useCanDelete(): (doc: { createdBy?: string }) => boolean {
  const { state, adapter } = useStore();
  const staff = state.settings.role !== 'parent' && adapter.canWrite !== false;
  return (doc) => {
    if (!staff) return false;
    if (!adapter.social || adapter.maxRole === 'admin') return true;
    return !doc.createdBy || doc.createdBy === adapter.myId;
  };
}

/** May start a new match: coaches, and parents who chart their own child's matches. */
export function useCanChart(): boolean {
  const { state, adapter } = useStore();
  const staff = state.settings.role !== 'parent' && adapter.canWrite !== false;
  return staff || (state.settings.role === 'parent' && !!adapter.canChart);
}

export interface MatchRights {
  /** May enter points, finish, reopen and edit details. */
  canEdit: boolean;
  /** Someone else is charting this live match right now. */
  lockedBy: 'coach' | 'parent' | null;
  /** A coach may take the scoring over. */
  canTakeOver: boolean;
  /** Whoever started it (online version), any coach otherwise; a family removes only matches it charted. */
  canDelete: boolean;
}

/** One person charts a match at a time (its scorer); everyone else follows read-only. */
export function useMatchRights(m: Match): MatchRights {
  const { state, adapter } = useStore();
  const role = state.settings.role;
  const me = adapter.myId ?? null;
  const staff = role !== 'parent' && adapter.canWrite !== false;
  const canDeleteDoc = useCanDelete();
  const mine = !!me && m.scorerId === me;
  const someoneElse = !!m.scorerId && !mine;
  const live = m.status === 'live';
  if (staff) {
    const locked = live && someoneElse;
    return { canEdit: !locked, lockedBy: locked ? m.scorerRole ?? 'coach' : null, canTakeOver: locked, canDelete: canDeleteDoc(m) };
  }
  // A family removes a match it charted itself (online version).
  const familyMade = role === 'parent' && !!adapter.social && !!me && (m.createdBy === me || mine);
  if (role === 'parent' && adapter.canChart && mine) return { canEdit: true, lockedBy: null, canTakeOver: false, canDelete: familyMade };
  return { canEdit: false, lockedBy: live && m.scorerId ? m.scorerRole ?? 'coach' : null, canTakeOver: false, canDelete: familyMade };
}

/** Scorer fields for a match this viewer starts or takes over. */
export function useScorer(): Pick<Match, 'scorerId' | 'scorerRole'> {
  const { state, adapter } = useStore();
  const id = adapter.myId ?? undefined;
  return id ? { scorerId: id, scorerRole: state.settings.role === 'parent' ? 'parent' : 'coach' } : {};
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

/** Coaches with several players: live matches of the players not selected right now. */
export function LiveElsewhere() {
  const { state, dispatch, t } = useStore();
  const active = state.settings.activePlayerId;
  const live = state.matches.filter((m) => m.status === 'live' && m.playerId !== active);
  if (!live.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="live-elsewhere">
      {live.map((m) => (
        <a
          key={m.id}
          href={href(`match-${m.id}`)}
          onClick={() => dispatch({ type: 'setActivePlayer', id: m.playerId })}
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-bad/40 bg-bad-soft p-3 text-sm"
          data-testid="live-elsewhere-item"
        >
          <Badge tone="bad">
            <span className="live-dot" aria-hidden="true" /> {t('live')}
          </Badge>
          <span className="font-semibold">{state.players.find((p) => p.id === m.playerId)?.name ?? t('player')}</span>
          <span className="min-w-0 flex-1 truncate">{t('vsName', { name: m.opponent || t('opponent') })}</span>
          <span className="num font-mono font-semibold" dir="ltr">
            {scoreLine(m, t)}
          </span>
        </a>
      ))}
    </div>
  );
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

function StatRow({ label, p, o, pct, invert, testid }: { label: string; p: number | Pair; o: number | Pair; pct?: boolean; invert?: boolean; testid?: string }) {
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
    <tr className="border-b border-line last:border-0" data-stat={testid}>
      {cell(p, 'p')}
      <th scope="row" className="px-1 py-1.5 text-center text-[12px] font-semibold text-muted">{label}</th>
      {cell(o, 'o')}
    </tr>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="border-b border-line bg-sunken">
      <th colSpan={3} scope="colgroup" className="px-3 py-1.5 text-center text-[12px] font-bold text-ink">
        {label}
      </th>
    </tr>
  );
}

export interface StatLine {
  label: string;
  p: number | Pair;
  o: number | Pair;
  pct?: boolean;
  /** Lower is better (errors). */
  invert?: boolean;
  testid?: string;
}

/** The statistics rows, by section — used by the table here and by the exported report. */
export function statSections(st: MatchStats, t: T): { title: string; rows: StatLine[] }[] {
  const P = st.p;
  const O = st.o;
  const svcWon = (x: MatchStats['p']): Pair => [x.firstWon + x.secondWon, x.servicePoints];
  return [
    {
      title: t('secServe'),
      rows: [
        { label: t('st_aces'), p: P.aces, o: O.aces },
        { label: t('st_df'), p: P.doubleFaults, o: O.doubleFaults, invert: true },
        { label: t('st_firstIn'), p: [P.firstIn, P.servicePoints], o: [O.firstIn, O.servicePoints], pct: true },
        { label: t('st_firstWon'), p: [P.firstWon, P.firstIn], o: [O.firstWon, O.firstIn], pct: true },
        { label: t('st_secondWon'), p: [P.secondWon, P.secondPlayed], o: [O.secondWon, O.secondPlayed], pct: true },
        { label: t('st_svcPtsWon'), p: svcWon(P), o: svcWon(O), pct: true, testid: 'svc-pts' },
        { label: t('st_svcWinners'), p: P.serviceWinners, o: O.serviceWinners },
        { label: t('st_bpSaved'), p: [P.bpSaved, P.bpFaced], o: [O.bpSaved, O.bpFaced], pct: true },
        { label: t('st_svcGames'), p: [P.serviceGamesWon, P.serviceGames], o: [O.serviceGamesWon, O.serviceGames], pct: true },
      ],
    },
    {
      title: t('secReturn'),
      rows: [
        { label: t('st_retWon'), p: [P.returnWon, P.returnPoints], o: [O.returnWon, O.returnPoints], pct: true },
        { label: t('st_ret1'), p: [P.returnFirstWon, P.returnFirstPlayed], o: [O.returnFirstWon, O.returnFirstPlayed], pct: true },
        { label: t('st_ret2'), p: [P.returnSecondWon, P.returnSecondPlayed], o: [O.returnSecondWon, O.returnSecondPlayed], pct: true },
        { label: t('st_retIn1'), p: [P.returnIn1, P.returnFaced1], o: [O.returnIn1, O.returnFaced1], pct: true, testid: 'ret-in-1' },
        { label: t('st_retIn2'), p: [P.returnIn2, P.returnFaced2], o: [O.returnIn2, O.returnFaced2], pct: true, testid: 'ret-in-2' },
        { label: t('st_retErr'), p: P.returnErrors, o: O.returnErrors, invert: true },
        { label: t('st_bpConv'), p: [P.bpConverted, P.bpChances], o: [O.bpConverted, O.bpChances], pct: true },
        { label: t('st_retGames'), p: [P.returnGamesWon, P.returnGames], o: [O.returnGamesWon, O.returnGames], pct: true },
      ],
    },
    {
      title: t('secPoints'),
      rows: [
        { label: t('st_winners'), p: P.winners, o: O.winners },
        { label: t('st_ue'), p: P.unforcedErrors, o: O.unforcedErrors, invert: true },
        { label: t('st_fe'), p: P.forcedErrors, o: O.forcedErrors, invert: true },
        { label: t('st_netWon'), p: [st.net.p.won, st.net.p.played], o: [st.net.o.won, st.net.o.played], pct: true, testid: 'net' },
        ...(st.tbPoints > 0 ? [{ label: t('st_tbWon'), p: [P.tbPointsWon, st.tbPoints] as Pair, o: [O.tbPointsWon, st.tbPoints] as Pair, pct: true, testid: 'tb' }] : []),
        { label: t('st_maxPoints'), p: P.maxPointRun, o: O.maxPointRun, testid: 'max-points' },
        { label: t('st_maxGames'), p: P.maxGameRun, o: O.maxGameRun, testid: 'max-games' },
        { label: t('st_total'), p: [P.pointsWon, st.points], o: [O.pointsWon, st.points], pct: true },
      ],
    },
  ];
}

/**
 * Match statistics in the categories Grand Slam and ATP/WTA match pages use, plus what manual
 * charting adds (returns in play, unreturned serves, net points for both players).
 */
export function StatsTable({ st, nm }: { st: MatchStats; nm: Record<Side, string> }) {
  const { t } = useStore();
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
          {statSections(st, t).flatMap((sec) => [
            <SectionRow key={sec.title} label={sec.title} />,
            ...sec.rows.map((r) => <StatRow key={`${sec.title}-${r.label}`} {...r} />),
          ])}
        </tbody>
      </table>
    </div>
  );
}

const pctCell = ([a, b]: Pair) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function Frac({ v }: { v: Pair }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono text-[15px] font-semibold">{pctCell(v)}</span> <span className="text-[11px] text-muted">{v[0]}/{v[1]}</span>
    </span>
  );
}

function Panel({ title, help, children, testid }: { title: ReactNode; help?: string; children: ReactNode; testid?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-4" data-testid={testid}>
      <h3 className="ui-bidi font-semibold">{title}</h3>
      {help && <p className="mt-0.5 text-[12px] text-muted">{help}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/* ---------- winners and errors, one chart per player ---------- */

export interface Bar {
  key: string;
  label: string;
  /** Winners, or unforced errors (and serve / return errors, which are not split). */
  a: number;
  /** Forced errors (rally shots only). */
  b: number;
}
export type GroupKey = 'serve' | 'return' | 'rally';

export function rowsOf(st: MatchStats, side: Side, kind: 'winners' | 'errors', t: T): { key: GroupKey; rows: Bar[] }[] {
  const S = st[side];
  const strokes = Object.values(st.strokes[side]);
  // "Forehand", "FH · Slice", "Overhead": the short wing keeps two-part labels on one line.
  const label = (r: { wing: Wing | null; shot: ShotType | null }) =>
    r.wing && r.shot && r.shot !== 'drive' ? `${t(`wingShort_${r.wing}` as DictKey)} · ${shotLabel(t, r.shot)}` : strokeText(t, r.wing, r.shot) || t('wingUnknown');
  const serve: Bar[] = [];
  let ret: Bar[];
  let rally: Bar[];
  if (kind === 'winners') {
    if (S.aces) serve.push({ key: 'aces', label: t('st_aces'), a: S.aces, b: 0 });
    if (S.serviceWinners) serve.push({ key: 'unreturned', label: t('st_svcWinners'), a: S.serviceWinners, b: 0 });
    ret = strokes.filter((r) => r.ret && r.winners > 0).map((r) => ({ key: strokeKey(r), label: label(r), a: r.winners, b: 0 }));
    rally = strokes.filter((r) => !r.ret && r.winners > 0).map((r) => ({ key: strokeKey(r), label: label(r), a: r.winners, b: 0 }));
  } else {
    if (S.doubleFaults) serve.push({ key: 'df', label: t('st_df'), a: S.doubleFaults, b: 0 });
    // Return errors are kept as the return stroke's "unforced" count (they are not split forced / unforced).
    ret = strokes.filter((r) => r.ret && r.unforced > 0).map((r) => ({ key: strokeKey(r), label: label(r), a: r.unforced, b: 0 }));
    rally = strokes.filter((r) => !r.ret && r.forced + r.unforced > 0).map((r) => ({ key: strokeKey(r), label: label(r), a: r.unforced, b: r.forced }));
  }
  const byTotal = (x: Bar, y: Bar) => y.a + y.b - (x.a + x.b) || x.label.localeCompare(y.label);
  return (
    [
      { key: 'serve' as const, rows: serve },
      { key: 'return' as const, rows: ret.sort(byTotal) },
      { key: 'rally' as const, rows: rally.sort(byTotal) },
    ] satisfies { key: GroupKey; rows: Bar[] }[]
  ).filter((g) => g.rows.length > 0);
}

function BarChart({ side, kind, name, groups, max, testid }: { side: Side; kind: 'winners' | 'errors'; name: string; groups: { key: GroupKey; rows: Bar[] }[]; max: number; testid: string }) {
  const { t } = useStore();
  const main = side === 'p' ? 'bg-accent' : 'bg-muted';
  const light = side === 'p' ? 'bg-accent-2' : 'bg-muted-2';
  const total = groups.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.a + r.b, 0), 0);
  const groupLabel: Record<GroupKey, string> = { serve: t('grpServe'), return: t('grpReturn'), rally: t('grpRally') };
  const hasForced = groups.some((g) => g.rows.some((r) => r.b > 0));
  return (
    <figure className="min-w-0 rounded-2xl border border-line bg-surface p-4" data-testid={testid}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="ui-bidi font-semibold">{t(kind === 'winners' ? 'winnersOf' : 'errorsOf', { name })}</span>
        <span className="num text-[13px] text-muted" data-testid={`${testid}-total`}>
          {t('totalN', { n: total })}
        </span>
      </figcaption>
      {kind === 'errors' && hasForced && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={cx('h-2.5 w-2.5 rounded-[3px]', main)} aria-hidden="true" />
            {t('colUnforced')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cx('h-2.5 w-2.5 rounded-[3px]', light)} aria-hidden="true" />
            {t('colForced')}
          </span>
          <span>{t('ueFeOrder')}</span>
        </p>
      )}
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t(kind === 'winners' ? 'noWinnersYet' : 'noErrorsYet')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.key} data-group={g.key}>
              <p className="mb-1.5 text-[11.5px] font-bold text-muted">{groupLabel[g.key]}</p>
              <ul className="flex flex-col gap-1.5">
                {g.rows.map((r) => {
                  const n = r.a + r.b;
                  const value = r.b > 0 ? `${r.a}+${r.b}` : String(r.a);
                  const spoken = r.b > 0 ? `${r.label}: ${t('colUnforced')} ${r.a}, ${t('colForced')} ${r.b}` : `${r.label}: ${r.a}`;
                  return (
                    <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-[13px]" data-bar={r.key} aria-label={spoken} title={spoken}>
                      <span className="ui-bidi truncate">{r.label}</span>
                      <span className="flex h-3 min-w-0" aria-hidden="true">
                        <span className="flex h-full gap-[2px]" style={{ width: `${(n / max) * 100}%` }}>
                          {r.a > 0 && <span className={cx('h-full', main, r.b === 0 && 'rounded-e-[4px]')} style={{ flex: `${r.a} 1 0` }} />}
                          {r.b > 0 && <span className={cx('h-full rounded-e-[4px]', light)} style={{ flex: `${r.b} 1 0` }} />}
                        </span>
                      </span>
                      <span className="num min-w-[2.25rem] text-end font-mono text-[13px]" data-value>{value}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Four charts: each player's winners and each player's errors, on shared scales so lengths compare. */
export function WinnersErrorsCharts({ st, nm }: { st: MatchStats; nm: Record<Side, string> }) {
  const { t } = useStore();
  const data = {
    winners: { p: rowsOf(st, 'p', 'winners', t), o: rowsOf(st, 'o', 'winners', t) },
    errors: { p: rowsOf(st, 'p', 'errors', t), o: rowsOf(st, 'o', 'errors', t) },
  };
  const maxOf = (k: 'winners' | 'errors') => Math.max(1, ...(['p', 'o'] as Side[]).flatMap((s) => data[k][s].flatMap((g) => g.rows.map((r) => r.a + r.b))));
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="winners-errors">
      {(['winners', 'errors'] as const).flatMap((k) =>
        (['p', 'o'] as Side[]).map((s) => <BarChart key={`${k}-${s}`} side={s} kind={k} name={shortName(nm[s])} groups={data[k][s]} max={maxOf(k)} testid={`chart-${k}-${s}`} />),
      )}
    </div>
  );
}

/* ---------- serve and return by court, serve direction, rally length, net ---------- */

function CourtPanel({ st, side, nm }: { st: MatchStats; side: Side; nm: Record<Side, string> }) {
  const { t } = useStore();
  const C = st.court[side];
  return (
    <Panel title={shortName(nm[side])} testid={`court-${side}`}>
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
              <td key={c} className="py-2 text-end" data-testid={`serve-won-${side}-${c}`}><Frac v={[C[c].serveWon, C[c].servePlayed]} /></td>
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
              <td key={c} className="py-2 text-end" data-testid={`return-won-${side}-${c}`}><Frac v={[C[c].returnWon, C[c].returnPlayed]} /></td>
            ))}
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

function ServeDirPanel({ st, side, nm }: { st: MatchStats; side: Side; nm: Record<Side, string> }) {
  const { t } = useStore();
  const dirs = st.serveDir[side];
  const any = COURT_SIDES.some((c) => SERVE_DIRS.some((d) => dirs[c][d].played > 0));
  return (
    <Panel title={shortName(nm[side])} testid={`serve-dir-${side}`}>
      {!any ? (
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
  );
}

function SubHead({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-3">
      <h3 className="font-display text-xl leading-tight">{title}</h3>
      {help && <p className="mt-0.5 text-[12.5px] text-muted">{help}</p>}
    </div>
  );
}

/** Winners and errors for both players, serve and return by court, serve direction, rally length, net. */
export function DetailedAnalysis({ st, nm }: { st: MatchStats; nm: Record<Side, string> }) {
  const { t } = useStore();
  const sharePct = (won: number, played: number) => (played ? Math.round((won / played) * 100) : null);
  return (
    <section data-testid="detailed-analysis" className="flex flex-col gap-7">
      <div>
        <SubHead title={t('weTitle')} help={t('weHelp')} />
        <WinnersErrorsCharts st={st} nm={nm} />
      </div>
      <div>
        <SubHead title={t('courtTitle')} help={t('courtHelpBoth')} />
        <div className="grid gap-4 md:grid-cols-2" data-testid="court-sides">
          <CourtPanel st={st} side="p" nm={nm} />
          <CourtPanel st={st} side="o" nm={nm} />
        </div>
      </div>
      <div>
        <SubHead title={t('serveDirTitle')} help={t('serveDirHelpBoth')} />
        <div className="grid gap-4 md:grid-cols-2" data-testid="serve-direction">
          <ServeDirPanel st={st} side="p" nm={nm} />
          <ServeDirPanel st={st} side="o" nm={nm} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t('rallyTitle')} help={t('rallyHelpBoth')} testid="rally-breakdown">
          <ul className="flex flex-col gap-3">
            {(['short', 'mid', 'long'] as Rally[]).map((r) => {
              const x = st.rally[r];
              const v = sharePct(x.won, x.played);
              return (
                <li key={r} className="num text-sm" data-rally={r}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{rallyLabel(t, r)}</span>
                    <span className="ui-bidi text-[12.5px] text-muted">
                      {v === null ? t('noPointsShort') : `${shortName(nm.p)} ${v}% · ${shortName(nm.o)} ${100 - v}% · ${t('pointsPlayed', { n: x.played })}`}
                    </span>
                  </div>
                  <span className="flex h-2.5 overflow-hidden rounded-full bg-accent-soft" aria-hidden="true">
                    <span className="h-full rounded-e-[4px] bg-accent" style={{ width: `${v ?? 0}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title={t('st_netWon')} help={t('netHelp')} testid="net-points">
          <table className="num w-full text-sm">
            <tbody>
              {(['p', 'o'] as Side[]).map((s) => (
                <tr key={s} className="border-t border-line first:border-0">
                  <th scope="row" className="ui-bidi py-2 text-start font-semibold">{shortName(nm[s])}</th>
                  <td className="py-2 text-end" data-testid={`net-${s}`}>
                    {st.net[s].played ? <Frac v={[st.net[s].won, st.net[s].played]} /> : <span className="text-muted">{t('netNone')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
