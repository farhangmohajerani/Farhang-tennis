/**
 * One match as a single HTML file anyone can open on a phone, tablet or computer — and print or save
 * as PDF: result, every statistic for both players, winners and errors by stroke, momentum, set by
 * set, point by point, the coach's notes and AI analysis. The match data itself travels inside too.
 * Plain text and inline SVG only: no scripts run, no fonts or images are fetched.
 */
import type { Match, Tournament } from '../types';
import { statsFromReplay, summary, type MatchStats, type Side } from './match';
import { formatDate, translate, type DictKey, type Lang } from './i18n';
import { ctxScore, formatText, names, pointText, roundLabel, rowsOf, scoreLine, shortName, statSections, surfaceLabel, type GroupKey } from '../components/MatchBits';

type T = (key: DictKey, vars?: Record<string, string | number>) => string;
type Pair = [number, number];

export interface ExportContext {
  lang: Lang;
  playerName: string;
  tournament?: Tournament;
  exportedAt?: Date;
}

const SIDES: Side[] = ['p', 'o'];
const ACCENT = '#2f7f8c';
const ACCENT_2 = '#7fb9c2';
const MUTED = '#56677d';
const MUTED_2 = '#9aa8b8';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = ([a, b]: Pair) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function contextLine(m: Match, c: ExportContext, t: T): string {
  const parts = [formatDate(c.lang, m.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })];
  parts.push(m.kind === 'practice' ? t('kind_practiceMatch') : c.tournament?.name ?? t('kind_official'));
  if (m.round) parts.push(roundLabel(t, m.round));
  if (m.surface) parts.push(surfaceLabel(t, m.surface) + (m.indoor ? ` (${t('indoor')})` : ''));
  return parts.join(' · ');
}

function resultText(m: Match, t: T): { text: string; tone: 'good' | 'bad' | 'live' | 'none' } {
  if (m.status === 'live') return { text: t('live'), tone: 'live' };
  const w = summary(m).winner;
  if (w === 'p') return { text: t('won'), tone: 'good' };
  if (w === 'o') return { text: t('lost'), tone: 'bad' };
  return { text: t('noResult'), tone: 'none' };
}

function scoreTable(m: Match, nm: Record<Side, string>): string {
  const s = summary(m);
  const rows = SIDES.map((side) => {
    const cells = s.sets
      .map((x) => {
        const lost = x.done && x[side] < x[side === 'p' ? 'o' : 'p'];
        const tb = x.tb !== null && lost ? `<sup>${x.tb}</sup>` : '';
        return `<td class="${lost ? 'dim' : ''}">${x[side]}${tb}</td>`;
      })
      .join('');
    const won = s.winner === side;
    return `<tr><th scope="row" class="${won ? 'winner' : ''}">${won ? '✓ ' : ''}${esc(nm[side])}</th>${cells}</tr>`;
  }).join('');
  return `<table class="score" dir="ltr"><tbody>${rows}</tbody></table>`;
}

function tile(label: string, value: string, sub = ''): string {
  return `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv" dir="ltr">${esc(value)}</div>${sub ? `<div class="ts" dir="ltr">${esc(sub)}</div>` : ''}</div>`;
}

function tiles(st: MatchStats, t: T): string {
  const P = st.p;
  const O = st.o;
  return `<div class="tiles">${[
    tile(t('st_total'), `${P.pointsWon}–${O.pointsWon}`, st.points ? pct([P.pointsWon, st.points]) : ''),
    tile(t('st_winners'), `${P.winners}–${O.winners}`),
    tile(t('st_ue'), `${P.unforcedErrors}–${O.unforcedErrors}`),
    tile(`${t('st_aces')} / ${t('st_dfShort')}`, `${P.aces} / ${P.doubleFaults}`),
    tile(t('st_firstIn'), pct([P.firstIn, P.servicePoints]), `${P.firstIn}/${P.servicePoints}`),
    tile(t('st_bpConv'), `${P.bpConverted}/${P.bpChances}`, P.bpChances ? pct([P.bpConverted, P.bpChances]) : ''),
  ].join('')}</div>`;
}

function statsTable(st: MatchStats, nm: Record<Side, string>, t: T): string {
  const val = (x: number | Pair) => (Array.isArray(x) ? (x[1] > 0 ? x[0] / x[1] : null) : x);
  const body = statSections(st, t)
    .map((sec) => {
      const rows = sec.rows
        .map((r) => {
          const vp = val(r.p);
          const vo = val(r.o);
          const max = r.pct ? 1 : Math.max(vp ?? 0, vo ?? 0, 1);
          const better = vp === null || vo === null || vp === vo ? null : (vp > vo) !== !!r.invert ? 'p' : 'o';
          const cell = (x: number | Pair, side: Side) => {
            const v = side === 'p' ? vp : vo;
            const text = Array.isArray(x) ? `${pct(x)}${x[1] > 0 ? ` <small>${x[0]}/${x[1]}</small>` : ''}` : String(x);
            const w = v === null ? 0 : Math.min(100, (v / max) * 100);
            return `<td class="${side} ${better === side ? 'best' : ''}"><div class="v">${text}</div><div class="bar ${side}"><i style="width:${w.toFixed(1)}%"></i></div></td>`;
          };
          return `<tr>${cell(r.p, 'p')}<th scope="row">${esc(r.label)}</th>${cell(r.o, 'o')}</tr>`;
        })
        .join('');
      return `<tr class="sec"><th colspan="3">${esc(sec.title)}</th></tr>${rows}`;
    })
    .join('');
  return `<table class="stats" dir="ltr"><thead><tr><th class="p">${esc(shortName(nm.p))}</th><th></th><th class="o">${esc(shortName(nm.o))}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function strokeBars(st: MatchStats, nm: Record<Side, string>, t: T): string {
  const groupLabel: Record<GroupKey, string> = { serve: t('grpServe'), return: t('grpReturn'), rally: t('grpRally') };
  const data = {
    winners: { p: rowsOf(st, 'p', 'winners', t), o: rowsOf(st, 'o', 'winners', t) },
    errors: { p: rowsOf(st, 'p', 'errors', t), o: rowsOf(st, 'o', 'errors', t) },
  };
  const panels = (['winners', 'errors'] as const).flatMap((kind) => {
    const max = Math.max(1, ...SIDES.flatMap((s) => data[kind][s].flatMap((g) => g.rows.map((r) => r.a + r.b))));
    return SIDES.map((side) => {
      const groups = data[kind][side];
      const total = groups.reduce((n, g) => n + g.rows.reduce((k, r) => k + r.a + r.b, 0), 0);
      const main = side === 'p' ? ACCENT : MUTED;
      const light = side === 'p' ? ACCENT_2 : MUTED_2;
      const body = groups.length
        ? groups
            .map(
              (g) =>
                `<div class="grp">${esc(groupLabel[g.key])}</div>` +
                g.rows
                  .map((r) => {
                    const n = r.a + r.b;
                    const w = (n / max) * 100;
                    const a = n ? (r.a / n) * w : 0;
                    const b = n ? (r.b / n) * w : 0;
                    return `<div class="brow"><span class="bl">${esc(r.label)}</span><span class="bt"><i style="width:${a.toFixed(1)}%;background:${main}"></i>${r.b ? `<i style="width:${b.toFixed(1)}%;background:${light}"></i>` : ''}</span><span class="bv">${r.b ? `${r.a}+${r.b}` : r.a}</span></div>`;
                  })
                  .join(''),
            )
            .join('')
        : `<p class="muted">${esc(t(kind === 'winners' ? 'noWinnersYet' : 'noErrorsYet'))}</p>`;
      const legend =
        kind === 'errors' && groups.some((g) => g.rows.some((r) => r.b > 0))
          ? `<p class="legend"><b style="background:${main}"></b>${esc(t('colUnforced'))} <b style="background:${light}"></b>${esc(t('colForced'))}</p>`
          : '';
      return `<figure class="panel"><figcaption><span>${esc(t(kind === 'winners' ? 'winnersOf' : 'errorsOf', { name: shortName(nm[side]) }))}</span><span class="muted">${esc(t('totalN', { n: total }))}</span></figcaption>${legend}${body}</figure>`;
    });
  });
  return `<div class="grid2">${panels.join('')}</div>`;
}

function momentum(st: MatchStats, nm: Record<Side, string>, t: T): string {
  const m = st.momentum;
  if (m.length < 2) return '';
  const W = 640;
  const H = 150;
  const pad = 12;
  const hi = Math.max(2, ...m);
  const lo = Math.min(-2, ...m);
  const x = (i: number) => pad + (i / (m.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - 2 * pad);
  const zero = y(0);
  const path = m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(m.length - 1).toFixed(1)} ${zero.toFixed(1)} L${x(0).toFixed(1)} ${zero.toFixed(1)} Z`;
  const sets = st.setEnds
    .slice(0, -1)
    .map((i, k) => `<line x1="${x(i)}" x2="${x(i)}" y1="${pad / 2}" y2="${H - pad / 2}" stroke="#d6dfe8" stroke-dasharray="3 4"/><text x="${x(i) + 4}" y="${pad + 4}" font-size="11" fill="${MUTED}">S${k + 2}</text>`)
    .join('');
  return `<figure class="panel"><figcaption><span>${esc(t('momentumTitle'))}</span><span class="muted">${esc(t('momentumHelp', { name: shortName(nm.p) }))}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('momentumTitle'))}" dir="ltr"><line x1="${pad}" x2="${W - pad}" y1="${zero}" y2="${zero}" stroke="${MUTED}" stroke-opacity="0.5"/>${sets}<path d="${area}" fill="${ACCENT}" fill-opacity="0.12"/><path d="${path}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round"/></svg></figure>`;
}

function setBySet(m: Match, nm: Record<Side, string>, t: T): string {
  const s = summary(m);
  const r = s.replay;
  if (!r || !r.ctx.length) return '';
  const idxs = [...new Set(r.ctx.map((c) => c.setIndex))];
  if (idxs.length < 2) return '';
  const head = `<tr><th></th>${idxs.map((i) => `<th>${esc(t('reportSetN', { n: i + 1 }))}</th>`).join('')}</tr>`;
  const per = idxs.map((i) => statsFromReplay(r, i));
  const line = (label: string, f: (x: MatchStats, i: number) => string) => `<tr><th scope="row">${esc(label)}</th>${per.map((x, k) => `<td>${f(x, idxs[k])}</td>`).join('')}</tr>`;
  const games = (i: number) => {
    const set = s.sets[i];
    return set ? `${set.p}–${set.o}` : '—';
  };
  const body = [
    line(t('reportGames'), (_, i) => games(i)),
    line(t('st_total'), (x) => `${x.p.pointsWon}–${x.o.pointsWon}`),
    line(t('st_winners'), (x) => `${x.p.winners}–${x.o.winners}`),
    line(t('st_ue'), (x) => `${x.p.unforcedErrors}–${x.o.unforcedErrors}`),
    line(`${t('st_aces')} / ${t('st_dfShort')}`, (x) => `${x.p.aces}/${x.p.doubleFaults} – ${x.o.aces}/${x.o.doubleFaults}`),
    line(t('st_firstIn'), (x) => `${pct([x.p.firstIn, x.p.servicePoints])} – ${pct([x.o.firstIn, x.o.servicePoints])}`),
    line(t('st_bpConv'), (x) => `${x.p.bpConverted}/${x.p.bpChances} – ${x.o.bpConverted}/${x.o.bpChances}`),
  ].join('');
  return `<section><h2>${esc(t('reportSets'))}</h2><p class="muted">${esc(shortName(nm.p))} – ${esc(shortName(nm.o))}</p><div class="scroll"><table class="sets" dir="ltr"><thead>${head}</thead><tbody>${body}</tbody></table></div></section>`;
}

function pointLog(m: Match, nm: Record<Side, string>, t: T): string {
  const r = summary(m).replay;
  if (!r || !r.ctx.length) return '';
  const rows = r.ctx
    .map((c) => {
      const tags = [c.breakPoint ? '<b class="tag warn">BP</b>' : '', c.setWinner ? `<b class="tag band">${esc(t('setTo', { name: shortName(nm[c.setWinner]) }))}</b>` : c.gameWinner ? `<b class="tag">${esc(t('gameTo', { name: shortName(nm[c.gameWinner]) }))}</b>` : ''].join('');
      const second = c.point.serve === 2 && c.point.end !== 'doubleFault' ? ` · ${esc(t('secondServe'))}` : '';
      return `<tr class="${c.setWinner ? 'setend' : ''}"><td class="n">${c.index + 1}</td><td class="sc" dir="ltr">${esc(ctxScore(c, m.format.noAd))}</td><td><i class="dot ${c.point.win}"></i>${esc(pointText(c.point, c.server, nm, t))}${second} ${tags}</td></tr>`;
    })
    .join('');
  return `<section class="log"><h2>${esc(t('pointByPoint'))} <span class="muted">(${r.ctx.length})</span></h2><table class="points"><tbody>${rows}</tbody></table></section>`;
}

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f4f7fa;color:#0c1f38;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Vazirmatn",Tahoma,"Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:980px;margin:0 auto;padding:20px 16px 40px}
.top{background:#0c1f38;color:#f4f7fa;border-radius:20px;padding:20px}
.brand{font-weight:800;letter-spacing:.02em;color:#9fb4c8;font-size:13px}
.meta{color:#9fb4c8;font-size:13px;margin-top:2px}
h1{font-size:26px;line-height:1.2;margin:8px 0 12px}
h2{font-size:19px;margin:0 0 10px}
.result{display:inline-block;border-radius:999px;padding:2px 12px;font-weight:700;font-size:13px;margin-bottom:10px}
.result.good{background:#dff1e6;color:#2b7d52}.result.bad{background:#f8e1de;color:#a93d35}.result.live{background:#f8e1de;color:#a93d35}.result.none{background:#eaf0f5;color:#56677d}
table.score{border-collapse:separate;border-spacing:0 4px;font-variant-numeric:tabular-nums}
table.score th{text-align:left;font-weight:600;padding-right:16px;font-size:17px}
table.score th.winner{text-decoration:underline;text-underline-offset:4px}
table.score td{width:34px;text-align:center;font:600 22px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}
table.score td.dim{color:#8ea4ba}
table.score sup{font-size:11px;margin-left:1px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{background:rgba(244,247,250,.12);border-radius:999px;padding:2px 10px;font-size:12.5px}
section{margin-top:22px}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px}
.tile{background:#fff;border:1px solid #d6dfe8;border-radius:14px;padding:10px 12px}
.tl{font-size:11.5px;font-weight:700;color:#56677d}
.tv{font:600 20px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
.ts{font-size:12px;color:#56677d}
.muted{color:#56677d;font-size:12.5px;font-weight:400}
table.stats{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d6dfe8;border-radius:16px;overflow:hidden;table-layout:fixed;font-variant-numeric:tabular-nums}
table.stats thead th{padding:8px;font-size:14px;border-bottom:1px solid #d6dfe8}
table.stats thead th.p{text-align:right}table.stats thead th.o{text-align:left}
table.stats tr.sec th{background:#eaf0f5;font-size:12px;padding:6px;text-align:center}
table.stats tbody th{font-size:12.5px;font-weight:600;color:#56677d;text-align:center;padding:6px 4px;width:30%}
table.stats td{padding:6px 10px;width:35%;border-top:1px solid #eef2f6}
table.stats td.p{text-align:right}table.stats td.o{text-align:left}
table.stats td .v{font:14.5px ui-monospace,SFMono-Regular,Menlo,monospace}
table.stats td.best .v{font-weight:800}
table.stats small{font-size:11px;color:#56677d;font-family:inherit}
.bar{height:6px;border-radius:999px;background:#eaf0f5;margin-top:4px;display:flex;overflow:hidden}
.bar.p{justify-content:flex-end}.bar i{display:block;height:100%;border-radius:999px}
.bar.p i{background:${ACCENT}}.bar.o i{background:${MUTED}}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.panel{margin:0;background:#fff;border:1px solid #d6dfe8;border-radius:16px;padding:12px 14px;break-inside:avoid}
figcaption{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;font-weight:700;margin-bottom:6px}
.grp{font-size:11.5px;font-weight:700;color:#56677d;margin:8px 0 4px}
.brow{display:grid;grid-template-columns:minmax(0,9rem) minmax(0,1fr) auto;gap:8px;align-items:center;font-size:13px;margin:3px 0}
.bl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt{display:flex;gap:2px;height:12px;direction:ltr}.bt i{display:block;height:100%;border-radius:2px}
.bv{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#56677d}
.legend{font-size:12px;color:#56677d;margin:0 0 4px}.legend b{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 4px;vertical-align:-1px}
svg{width:100%;height:auto;display:block}
.scroll{overflow-x:auto}
table.sets{border-collapse:collapse;background:#fff;border:1px solid #d6dfe8;min-width:100%;font-variant-numeric:tabular-nums}
table.sets th,table.sets td{padding:6px 10px;border-top:1px solid #eef2f6;text-align:center;font-size:13.5px;white-space:nowrap}
table.sets tbody th{text-align:left;color:#56677d;font-weight:600}
.text{background:#fff;border:1px solid #d6dfe8;border-radius:16px;padding:14px 16px}
.text p{margin:0 0 10px}.text p:last-child{margin:0}
table.points{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d6dfe8;font-size:13px}
table.points td{padding:5px 8px;border-top:1px solid #eef2f6;vertical-align:top}
table.points td.n{width:36px;color:#56677d;font-family:ui-monospace,Menlo,monospace}
table.points td.sc{width:150px;color:#56677d;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
table.points tr.setend td{background:#eaf0f5}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-inline-end:6px;vertical-align:0}
.dot.p{background:#2b7d52}.dot.o{background:#a93d35}
.tag{display:inline-block;font-size:11px;border-radius:999px;padding:0 7px;background:#eaf0f5;color:#0c1f38;margin-inline-start:4px;font-weight:700}
.tag.warn{background:#f8ecd6;color:#9a6512}.tag.band{background:#0c1f38;color:#f4f7fa}
footer{margin-top:28px;color:#56677d;font-size:12px;text-align:center}
[dir=rtl] table.score th{text-align:right}
[dir=rtl] .tv,[dir=rtl] .ts{text-align:right}
.text p[dir=auto]{text-align:start}
@media (max-width:640px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.grid2{grid-template-columns:1fr}h1{font-size:22px}table.points td.sc{width:auto}}
@media print{body{background:#fff}.sheet{max-width:none;padding:0}.top{border-radius:12px}section{break-inside:auto}.keep{break-inside:avoid}h2{break-after:avoid}.log{break-before:page}.panel,.tile,table.stats tr{break-inside:avoid}}
@page{size:A4;margin:12mm}
`;

/** The whole report as one HTML document. */
export function matchReportHtml(m: Match, c: ExportContext): string {
  const t: T = (k, v) => translate(c.lang, k, v);
  const dir = c.lang === 'fa' ? 'rtl' : 'ltr';
  const nm = names(m, c.playerName, t);
  const s = summary(m);
  const st = s.replay && s.replay.ctx.length ? statsFromReplay(s.replay) : null;
  const res = resultText(m, t);
  const chips = [formatText(m.format, t), m.opponentRating, m.opponentHand === 'left' ? t('leftHanded') : '', m.mode === 'score' ? t('modeScore') : ''].filter(Boolean);
  const title = `${nm.p} ${t('vsName', { name: nm.o })}`;
  const ai = m.ai?.text?.trim();
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map((p) => `<p dir="auto">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('');
  const exported = c.exportedAt ?? new Date();
  const data = JSON.stringify({ app: '21GRAM Tennis', kind: 'match', version: 1, player: c.playerName, tournament: c.tournament?.name ?? null, match: m }).replace(/</g, '\\u003c');
  const parts = [
    `<header class="top"><div class="brand">21GRAM Tennis · ${esc(t('matchReport'))}</div><div class="meta">${esc(contextLine(m, c, t))}</div><h1>${esc(title)}</h1><div class="result ${res.tone}">${esc(res.text)}</div>${scoreTable(m, nm)}<div class="chips">${chips.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></header>`,
    st ? tiles(st, t) : '',
    st ? `<section><h2>${esc(t('reportStats'))}</h2>${statsTable(st, nm, t)}</section>` : '',
    st ? `<section class="keep"><h2>${esc(t('reportStrokes'))}</h2>${strokeBars(st, nm, t)}</section>` : '',
    st && st.momentum.length > 1 ? `<section>${momentum(st, nm, t)}</section>` : '',
    setBySet(m, nm, t),
    ai ? `<section><h2>${esc(t('aiTitle'))}</h2><div class="text">${paragraphs(ai)}</div></section>` : '',
    m.notes.trim() ? `<section><h2>${esc(t('matchNotes'))}</h2><div class="text">${paragraphs(m.notes.trim())}</div></section>` : '',
    pointLog(m, nm, t),
    `<footer>${esc(t('reportFooter', { date: formatDate(c.lang, exported.toISOString().slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }) }))}</footer>`,
  ];
  return `<!doctype html>
<html lang="${c.lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="21GRAM Tennis">
<title>${esc(`${title} · ${m.date} · 21GRAM Tennis`)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="sheet">
${parts.filter(Boolean).join('\n')}
</main>
<script type="application/json" id="tennis-match">${data}</script>
</body>
</html>
`;
}

/** A few lines for a message: result, score and the key numbers. */
export function matchSummaryText(m: Match, c: ExportContext): string {
  const t: T = (k, v) => translate(c.lang, k, v);
  const nm = names(m, c.playerName, t);
  const s = summary(m);
  const st = s.replay && s.replay.ctx.length ? statsFromReplay(s.replay) : null;
  const lines = [`🎾 ${nm.p} ${t('vsName', { name: nm.o })} — ${resultText(m, t).text}`, `${scoreLine(m, t)}`, contextLine(m, c, t)];
  if (st) {
    const P = st.p;
    const O = st.o;
    lines.push(
      '',
      `${t('st_total')}: ${P.pointsWon}–${O.pointsWon}`,
      `${t('st_winners')}: ${P.winners}–${O.winners} · ${t('st_ue')}: ${P.unforcedErrors}–${O.unforcedErrors}`,
      `${t('st_aces')}: ${P.aces} · ${t('st_df')}: ${P.doubleFaults} · ${t('st_firstIn')}: ${pct([P.firstIn, P.servicePoints])}`,
      `${t('st_bpConv')}: ${P.bpConverted}/${P.bpChances} · ${t('st_bpSaved')}: ${P.bpSaved}/${P.bpFaced}`,
    );
  }
  lines.push('', '21GRAM Tennis');
  return lines.join('\n');
}

/** "21gram-Alya-vs-Deniz-2026-11-02.html" — letters and digits of any script, nothing else. */
export function matchFileName(m: Match, playerName: string, ext = 'html'): string {
  const clean = (s: string) => s.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const opp = clean(m.opponent) || 'match';
  return `21gram-${clean(playerName) || 'player'}-vs-${opp}-${m.date}.${ext}`;
}
