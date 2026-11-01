import { useState } from 'react';
import { useStore } from '../lib/store';
import { KPI_KEYS, type Drill, type KpiKey } from '../types';
import { catLabel, formatDate, kpiKey } from '../lib/i18n';
import { href } from '../lib/router';
import { activePlayer, drillMap } from '../lib/reducer';
import { baselineVsCurrent, playerLogs, stats, transferFor, type Stats } from '../lib/selectors';
import { computeKpis, delta, pct, starsFor, type Ratio } from '../lib/kpi';
import { Badge, Card, cx, Empty, PageHeader, SectionTitle, Stars } from '../components/ui';
import type { Log } from '../types';
import { matchesOfPlayer } from '../lib/competition';
import { matchStats, summary } from '../lib/match';
import { ResultBadge } from '../components/MatchBits';

export function Progress() {
  const { state, t, lang } = useStore();
  const player = activePlayer(state);
  if (!player) return <Empty>No player.</Empty>;
  const logs = playerLogs(state, player.id);
  const drills = drillMap(state);
  const drillIds = Array.from(new Set(logs.map((l) => l.drillId)));
  const withBaseline = drillIds.filter((id) => logs.some((l) => l.drillId === id && l.context === 'baseline'));
  const overall = transferFor(logs);
  const matchDrills = drillIds.filter((id) => logs.some((l) => l.drillId === id && l.context === 'match'));

  return (
    <div>
      <PageHeader eyebrow={player.name} title={t('progressTitle')} />
      <p className="-mt-2 mb-6 max-w-[65ch] text-sm text-muted">{t('winLossNote')}</p>

      <section>
        <SectionTitle>{t('baselineVsCurrent')}</SectionTitle>
        {withBaseline.length === 0 ? (
          <Empty>{t('noBaseline')}</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {withBaseline.map((id) => {
              const d = drills.get(id);
              const bc = baselineVsCurrent(logs, id);
              return d ? <BaselineCard key={id} drill={d} baseline={bc.baseline} current={bc.current} baselineDate={bc.baselineDate} /> : null;
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle>{t('byDrill')}</SectionTitle>
        {drillIds.length === 0 ? (
          <Empty>{t('noLogs')}</Empty>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="num w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-[12px] text-muted">
                  <th className="px-4 py-2 text-start font-semibold">Drill</th>
                  <th className="px-2 py-2 font-semibold">n</th>
                  {KPI_KEYS.map((k) => (
                    <th key={k} className="px-2 py-2 font-semibold">{t(kpiKey(k))}</th>
                  ))}
                  <th className="px-4 py-2 text-start font-semibold">{t('kpi_decision')} · trend</th>
                </tr>
              </thead>
              <tbody>
                {drillIds.map((id) => {
                  const d = drills.get(id);
                  const dl = logs.filter((l) => l.drillId === id && l.context !== 'match');
                  const s = stats(dl);
                  return (
                    <tr key={id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <a href={href(`drill-${id}`)} className="font-semibold hover:text-accent">{d?.name ?? id}</a>
                        {d && <div className="text-[12px] text-muted">{catLabel(lang, d.category)}</div>}
                      </td>
                      <td className="px-2 text-center font-mono">{dl.length}</td>
                      {KPI_KEYS.map((k) => (
                        <td key={k} className="px-2 text-center">
                          <div className="font-mono">{pct(s.kpis[k])}</div>
                          {d && <Stars n={starsFor(s.kpis[k], d.thresholds[k])} />}
                        </td>
                      ))}
                      <td className="px-4">
                        <Sparkline logs={dl} label={d?.name ?? id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MatchTrends playerId={player.id} />

      <section className="mt-10">
        <SectionTitle>{t('transferTitle')}</SectionTitle>
        <p className="mb-4 max-w-[65ch] text-sm text-muted">{t('transferHelp')}</p>
        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <Card className="p-5">
            <TransferBlock practice={overall.practice} match={overall.match} />
          </Card>
          <Card className="p-0">
            {matchDrills.length === 0 ? (
              <div className="p-5">
                <Empty>{t('noLogs')}</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {matchDrills.map((id) => {
                  const tr = transferFor(logs, id);
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <a href={href(`drill-${id}`)} className="min-w-0 flex-1 font-semibold hover:text-accent">{drills.get(id)?.name ?? id}</a>
                      <span className="num font-mono text-[13px] text-muted">
                        {t('practice')} {pct(tr.practice.kpis.decision)} → {t('match')} {pct(tr.match.kpis.decision)}
                      </span>
                      <TransferBadge v={tr.decision} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/** Charted matches over time: are serve and error numbers moving the right way? */
function MatchTrends({ playerId }: { playerId: string }) {
  const { state, t, lang } = useStore();
  const rows = matchesOfPlayer(state, playerId)
    .filter((m) => m.mode === 'live' && m.points.length > 0)
    .reverse()
    .slice(0, 12)
    .map((m) => ({ m, st: matchStats(m) }));
  if (!rows.length) return null;
  const pc = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + f(x), 0);
  const avg = (f: (x: (typeof rows)[number]) => number) => (Math.round((sum(f) / rows.length) * 10) / 10).toString();
  const head = [t('st_firstIn'), t('st_firstWon'), t('st_secondWon'), t('st_dfShort'), t('st_winners'), t('st_ueShort'), t('st_bpSaved')];
  return (
    <section className="mt-10">
      <SectionTitle aside={<a href={href('matches')} className="text-sm font-semibold text-accent">{t('nav_matches')} →</a>}>{t('matchTrendsTitle')}</SectionTitle>
      <p className="mb-4 max-w-[65ch] text-sm text-muted">{t('matchTrendsHelp')}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="num w-full min-w-[720px] text-sm" data-testid="match-trends">
          <thead>
            <tr className="border-b border-line text-[12px] text-muted">
              <th className="px-4 py-2 text-start font-semibold">{t('date')}</th>
              <th className="px-2 py-2 text-start font-semibold">{t('opponent')}</th>
              {head.map((h) => (
                <th key={h} className="px-2 py-2 text-center font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, st }) => (
              <tr key={m.id} className="border-b border-line">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <a href={href(`match-${m.id}`)} className="font-semibold hover:text-accent">{formatDate(lang, m.date, { day: 'numeric', month: 'short' })}</a>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <ResultBadge m={m} />
                    <span className="font-mono text-[12px]" dir="ltr">{summary(m).text}</span>
                    <span className="text-muted">{m.opponent}</span>
                  </span>
                </td>
                <td className="px-2 text-center font-mono">{pc(st.p.firstIn, st.p.servicePoints)}</td>
                <td className="px-2 text-center font-mono">{pc(st.p.firstWon, st.p.firstIn)}</td>
                <td className="px-2 text-center font-mono">{pc(st.p.secondWon, st.p.secondPlayed)}</td>
                <td className="px-2 text-center font-mono">{st.p.doubleFaults}</td>
                <td className="px-2 text-center font-mono">{st.p.winners}</td>
                <td className="px-2 text-center font-mono">{st.p.unforcedErrors}</td>
                <td className="px-2 text-center font-mono">{pc(st.p.bpSaved, st.p.bpFaced)}</td>
              </tr>
            ))}
            <tr className="bg-sunken font-semibold">
              <td className="px-4 py-2.5" colSpan={2}>{t('avgRow')}</td>
              <td className="px-2 text-center font-mono">{pc(sum((x) => x.st.p.firstIn), sum((x) => x.st.p.servicePoints))}</td>
              <td className="px-2 text-center font-mono">{pc(sum((x) => x.st.p.firstWon), sum((x) => x.st.p.firstIn))}</td>
              <td className="px-2 text-center font-mono">{pc(sum((x) => x.st.p.secondWon), sum((x) => x.st.p.secondPlayed))}</td>
              <td className="px-2 text-center font-mono">{avg((x) => x.st.p.doubleFaults)}</td>
              <td className="px-2 text-center font-mono">{avg((x) => x.st.p.winners)}</td>
              <td className="px-2 text-center font-mono">{avg((x) => x.st.p.unforcedErrors)}</td>
              <td className="px-2 text-center font-mono">{pc(sum((x) => x.st.p.bpSaved), sum((x) => x.st.p.bpFaced))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransferBadge({ v }: { v: number | null }) {
  const { t } = useStore();
  if (v === null) return <Badge>{t('insufficient')}</Badge>;
  const p = Math.round(v * 100);
  return (
    <Badge tone={p >= 90 ? 'good' : p >= 70 ? 'warn' : 'bad'}>
      {t('transfer')} {p}%
    </Badge>
  );
}

function TransferBlock({ practice, match }: { practice: Stats; match: Stats }) {
  const { t } = useStore();
  return (
    <div className="flex flex-col gap-4">
      {(['decision', 'execution'] as const).map((k) => {
        const p = practice.kpis[k];
        const m = match.kpis[k];
        const v = p.ok && m.ok && p.value > 0 ? m.value / p.value : null;
        return (
          <div key={k}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t(kpiKey(k))}</span>
              <TransferBadge v={v} />
            </div>
            <Dumbbell from={p} to={m} fromLabel={t('practice')} toLabel={t('match')} />
          </div>
        );
      })}
    </div>
  );
}

function BaselineCard({ drill, baseline, current, baselineDate }: { drill: Drill; baseline: Stats | null; current: Stats | null; baselineDate?: string }) {
  const { t, lang } = useStore();
  return (
    <Card className="p-5" as="article">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <a href={href(`drill-${drill.id}`)} className="font-semibold hover:text-accent">{drill.name}</a>
        {baselineDate && <span className="num text-[12px] text-muted">{t('baseline')}: {formatDate(lang, baselineDate)}</span>}
      </div>
      <div className="flex flex-col gap-3">
        {KPI_KEYS.map((k) => (
          <KpiCompare key={k} k={k} base={baseline?.kpis[k]} cur={current?.kpis[k]} />
        ))}
      </div>
      {!current && <p className="mt-3 text-[13px] text-muted">{t('current')}: {t('insufficient')}</p>}
    </Card>
  );
}

function KpiCompare({ k, base, cur }: { k: KpiKey; base?: Ratio; cur?: Ratio }) {
  const { t } = useStore();
  const dd = base && cur ? delta(cur, base) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{t(kpiKey(k))}</span>
        <span className={cx('num font-mono text-[13px] font-semibold', dd === null ? 'text-muted' : dd > 0 ? 'text-good' : dd < 0 ? 'text-bad' : 'text-muted')} data-testid={`delta-${k}`}>
          {dd === null ? '—' : `${dd > 0 ? '+' : ''}${dd.toFixed(0)} pp`}
        </span>
      </div>
      <Dumbbell from={base} to={cur} fromLabel={t('baseline')} toLabel={t('current')} />
    </div>
  );
}

/** Two values on one 0–100 % scale: hollow dot = before, filled accent dot = after. HTML so it stretches to any width. */
function Dumbbell({ from, to, fromLabel, toLabel }: { from?: Ratio; to?: Ratio; fromLabel: string; toLabel: string }) {
  const pos = (r?: Ratio) => (r && r.ok ? Math.min(r.value, 1) * 100 : null);
  const a = pos(from);
  const b = pos(to);
  return (
    <div>
      <div className="relative mx-[7px] h-[22px]" role="img" aria-label={`${fromLabel} ${from ? pct(from) : '—'} → ${toLabel} ${to ? pct(to) : '—'}`}>
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
        <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-line" style={{ insetInlineStart: '50%' }} />
        {a !== null && b !== null && (
          <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-accent/50" style={{ insetInlineStart: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
        )}
        {a !== null && (
          <span title={`${fromLabel}: ${pct(from!)}`} className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-muted bg-surface" style={{ insetInlineStart: `calc(${a}% - 7px)` }} />
        )}
        {b !== null && (
          <span title={`${toLabel}: ${pct(to!)}`} className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-surface bg-accent" style={{ insetInlineStart: `calc(${b}% - 7px)` }} />
        )}
      </div>
      <div className="num flex justify-between text-[11px] text-muted">
        <span>
          <span className="me-1 inline-block h-2 w-2 rounded-full border-2 border-muted align-middle" />
          {fromLabel} {from ? pct(from) : '—'}
        </span>
        <span>
          <span className="me-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
          {toLabel} {to ? pct(to) : '—'}
        </span>
      </div>
    </div>
  );
}

/** Decision accuracy per log, in date order, 0–100 % fixed scale. */
function Sparkline({ logs, label }: { logs: Log[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = logs.map((l) => ({ l, r: computeKpis(l).decision })).filter((p) => p.r.ok) as { l: Log; r: Extract<Ratio, { ok: true }> }[];
  if (pts.length === 0) return <span className="text-[12px] text-muted">—</span>;
  const W = 140;
  const H = 34;
  const xs = (i: number) => (pts.length === 1 ? W / 2 : 4 + (i * (W - 8)) / (pts.length - 1));
  const ys = (v: number) => H - 4 - v * (H - 8);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.r.value).toFixed(1)}`).join(' ');
  const area = `${d} L${xs(pts.length - 1).toFixed(1)},${H - 4} L${xs(0).toFixed(1)},${H - 4} Z`;
  const last = pts[pts.length - 1];
  const h = hover !== null ? pts[hover] : null;
  return (
    <div className="relative inline-flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label}: ${pts.map((p) => Math.round(p.r.value * 100) + '%').join(', ')}`} onMouseLeave={() => setHover(null)}>
        <line x1="4" x2={W - 4} y1={ys(0.5)} y2={ys(0.5)} stroke="var(--tp-line)" strokeWidth="1" strokeDasharray="2 3" />
        {pts.length > 1 && <path d={area} fill="var(--tp-accent)" opacity="0.12" />}
        {pts.length > 1 && <path d={d} fill="none" stroke="var(--tp-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => (
          <rect key={p.l.id} x={xs(i) - 8} y="0" width="16" height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        <circle cx={xs(pts.length - 1)} cy={ys(last.r.value)} r="4" fill="var(--tp-accent)" stroke="var(--tp-surface)" strokeWidth="2" />
        {h && hover !== null && <circle cx={xs(hover)} cy={ys(h.r.value)} r="4" fill="var(--tp-surface)" stroke="var(--tp-accent)" strokeWidth="2" />}
      </svg>
      <span className="num font-mono text-[12px] text-muted">{h ? `${h.l.date.slice(5)} · ${Math.round(h.r.value * 100)}%` : `${Math.round(last.r.value * 100)}%`}</span>
    </div>
  );
}
