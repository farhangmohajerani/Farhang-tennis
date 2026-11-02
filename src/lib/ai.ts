/**
 * AI Coach: a two-paragraph match debrief (tactics, then what to work on) written by the coach's own
 * OpenAI or Google Gemini model. The API key stays on this device (localStorage) and the request goes
 * straight from the browser to the provider, so the academy pays nothing. Only statistics and the
 * point log are sent — never the player's or the opponent's name.
 */
import type { Match, MatchInsight, ServeDir, ShotType, Wing } from '../types';
import { COURT_SIDES, RALLY, SERVE_DIRS } from '../types';
import { replay, setsText, statsFromReplay, summary, type MatchStats, type Point, type PointCtx, type Side, type SideStats } from './match';

export type AiProvider = 'openai' | 'gemini';
export const AI_PROVIDERS: AiProvider[] = ['openai', 'gemini'];
export const PROVIDER_NAME: Record<AiProvider, string> = { openai: 'OpenAI', gemini: 'Google Gemini' };
/** Low-cost current models (November 2026); the coach can type any other model name. */
export const DEFAULT_MODELS: Record<AiProvider, string> = { openai: 'gpt-6-luna', gemini: 'gemini-flash-latest' };
export const KEY_PAGES: Record<AiProvider, string> = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/apikey' };

export interface AiSettings {
  provider: AiProvider;
  keys: Partial<Record<AiProvider, string>>;
  models: Record<AiProvider, string>;
}

const STORE_KEY = 'tp.aiCoach';
const defaults = (): AiSettings => ({ provider: 'openai', keys: {}, models: { ...DEFAULT_MODELS } });

/** Settings of this device only — never synced to the academy database. */
export function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null') as Partial<AiSettings> | null;
    if (!raw) return defaults();
    const provider = AI_PROVIDERS.includes(raw.provider as AiProvider) ? (raw.provider as AiProvider) : 'openai';
    const keys: AiSettings['keys'] = {};
    for (const p of AI_PROVIDERS) if (typeof raw.keys?.[p] === 'string' && raw.keys[p]) keys[p] = raw.keys[p];
    const models = { ...DEFAULT_MODELS };
    for (const p of AI_PROVIDERS) if (typeof raw.models?.[p] === 'string' && raw.models[p]?.trim()) models[p] = raw.models[p]!.trim();
    return { provider, keys, models };
  } catch {
    return defaults();
  }
}

export function saveAiSettings(s: AiSettings): boolean {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const keyFor = (s: AiSettings) => s.keys[s.provider]?.trim() ?? '';

export type AiErrorKind = 'key' | 'quota' | 'model' | 'network' | 'blocked' | 'empty' | 'other';
export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message = '',
  ) {
    super(message || kind);
  }
}

/* ---------- what the model is told ---------- */

const END_EN: Record<Point['end'], string> = {
  ace: 'ace',
  serviceWinner: 'unreturned serve',
  doubleFault: 'double fault',
  returnWinner: 'return winner',
  returnError: 'return error',
  winner: 'winner',
  forcedError: 'forced error',
  unforcedError: 'unforced error',
  other: 'point (not seen)',
};
const SHOT_EN: Record<ShotType, string> = {
  drive: 'drive',
  slice: 'slice',
  drop: 'drop shot',
  lob: 'lob',
  approach: 'approach',
  pass: 'passing shot',
  volley: 'volley',
  halfVolley: 'half-volley',
  overhead: 'overhead',
  serve: 'serve',
};
const WING_EN: Record<Wing, string> = { fh: 'forehand', bh: 'backhand' };
const DIR_EN: Record<ServeDir, string> = { wide: 'wide', body: 'body', t: 'T' };
const RALLY_EN = { short: '0-4 shots', mid: '5-8 shots', long: '9+ shots' } as const;
const WHO: Record<Side, string> = { p: 'the player', o: 'the opponent' };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}% (${a}/${b})` : 'n/a');
const stroke = (wing: Wing | null, shot: ShotType | null) =>
  [wing ? WING_EN[wing] : '', shot && shot !== 'drive' && shot !== 'serve' ? SHOT_EN[shot] : ''].filter(Boolean).join(' ') || (shot === 'drive' ? 'drive' : 'shot not recorded');

function callScore(c: PointCtx, noAd: boolean): string {
  const { p, o } = c.game;
  let pts: string;
  if (c.tiebreak) pts = `TB ${p}-${o}`;
  else if (p >= 3 && o >= 3) pts = p === o ? (noAd ? 'deciding point' : 'deuce') : p > o ? 'AD player' : 'AD opponent';
  else pts = `${['0', '15', '30', '40'][p]}-${['0', '15', '30', '40'][o]}`;
  return `S${c.setIndex + 1} ${c.games.p}-${c.games.o} ${pts}`;
}

function pointLine(c: PointCtx, noAd: boolean, oppNet: boolean): string {
  const pt = c.point;
  const parts = [`${callScore(c, noAd)} | ${c.server === 'p' ? 'P' : 'O'} serves${c.court ? ` (${c.court} court)` : ''}${pt.serve === 2 && pt.end !== 'doubleFault' ? ', 2nd serve' : ''}${c.breakPoint ? ', BP' : ''}`];
  const by: Side | null =
    pt.end === 'ace' || pt.end === 'serviceWinner' || pt.end === 'doubleFault' ? c.server : pt.end === 'returnWinner' || pt.end === 'returnError' ? (c.server === 'p' ? 'o' : 'p') : pt.end === 'winner' ? pt.win : pt.end === 'forcedError' || pt.end === 'unforcedError' ? (pt.win === 'p' ? 'o' : 'p') : null;
  let what = by ? `${by === 'p' ? 'P' : 'O'} ${END_EN[pt.end]}` : `point to ${pt.win === 'p' ? 'P' : 'O'}`;
  if (pt.end === 'ace' || pt.end === 'serviceWinner') what += pt.dir ? ` (${DIR_EN[pt.dir]})` : '';
  else if (pt.end !== 'doubleFault' && pt.end !== 'other') what += `, ${stroke(pt.wing, pt.shot)}`;
  if (pt.rally && pt.end !== 'ace' && pt.end !== 'serviceWinner' && pt.end !== 'doubleFault') what += `, ${RALLY_EN[pt.rally]}`;
  const net = [pt.net ? 'P at net' : '', oppNet ? 'O at net' : ''].filter(Boolean).join(', ');
  return `${parts[0]}: ${what}${net ? `, ${net}` : ''} → ${pt.win === 'p' ? 'P' : 'O'}`;
}

function sideRows(P: SideStats, O: SideStats, st: MatchStats): string[] {
  const r = (label: string, a: string | number, b: string | number) => `- ${label}: ${a} | ${b}`;
  const svc = (x: SideStats) => pct(x.firstWon + x.secondWon, x.servicePoints);
  return [
    'Serve',
    r('Aces', P.aces, O.aces),
    r('Double faults', P.doubleFaults, O.doubleFaults),
    r('1st serve in', pct(P.firstIn, P.servicePoints), pct(O.firstIn, O.servicePoints)),
    r('1st serve points won', pct(P.firstWon, P.firstIn), pct(O.firstWon, O.firstIn)),
    r('2nd serve points won', pct(P.secondWon, P.secondPlayed), pct(O.secondWon, O.secondPlayed)),
    r('Service points won', svc(P), svc(O)),
    r('Unreturned serves', P.serviceWinners, O.serviceWinners),
    r('Break points saved', pct(P.bpSaved, P.bpFaced), pct(O.bpSaved, O.bpFaced)),
    r('Service games won', pct(P.serviceGamesWon, P.serviceGames), pct(O.serviceGamesWon, O.serviceGames)),
    'Return',
    r('Return points won', pct(P.returnWon, P.returnPoints), pct(O.returnWon, O.returnPoints)),
    r('Return points won vs 1st serve', pct(P.returnFirstWon, P.returnFirstPlayed), pct(O.returnFirstWon, O.returnFirstPlayed)),
    r('Return points won vs 2nd serve', pct(P.returnSecondWon, P.returnSecondPlayed), pct(O.returnSecondWon, O.returnSecondPlayed)),
    r('Returns in play vs 1st serve', pct(P.returnIn1, P.returnFaced1), pct(O.returnIn1, O.returnFaced1)),
    r('Returns in play vs 2nd serve', pct(P.returnIn2, P.returnFaced2), pct(O.returnIn2, O.returnFaced2)),
    r('Return errors', P.returnErrors, O.returnErrors),
    r('Break points won', pct(P.bpConverted, P.bpChances), pct(O.bpConverted, O.bpChances)),
    r('Return games won', pct(P.returnGamesWon, P.returnGames), pct(O.returnGamesWon, O.returnGames)),
    'Points',
    r('Winners (rally and return, aces not included)', P.winners, O.winners),
    r('Unforced errors', P.unforcedErrors, O.unforcedErrors),
    r('Forced errors', P.forcedErrors, O.forcedErrors),
    r('Net points won', pct(st.net.p.won, st.net.p.played), pct(st.net.o.won, st.net.o.played)),
    ...(st.tbPoints ? [r('Tie-break points won', pct(P.tbPointsWon, st.tbPoints), pct(O.tbPointsWon, st.tbPoints))] : []),
    r('Most points in a row', P.maxPointRun, O.maxPointRun),
    r('Most games in a row', P.maxGameRun, O.maxGameRun),
    r('Total points won', pct(P.pointsWon, st.points), pct(O.pointsWon, st.points)),
  ];
}

function strokeLines(st: MatchStats, side: Side): { winners: string; errors: string } {
  const S = st[side];
  const rows = Object.values(st.strokes[side]);
  const w = [S.aces ? `aces ${S.aces}` : '', S.serviceWinners ? `unreturned serves ${S.serviceWinners}` : ''];
  const e = [S.doubleFaults ? `double faults ${S.doubleFaults}` : ''];
  for (const r of rows.filter((x) => x.ret)) {
    if (r.winners) w.push(`return ${stroke(r.wing, r.shot)} ${r.winners}`);
    if (r.unforced) e.push(`return ${stroke(r.wing, r.shot)} ${r.unforced}`);
  }
  for (const r of rows.filter((x) => !x.ret).sort((a, b) => b.winners + b.forced + b.unforced - (a.winners + a.forced + a.unforced))) {
    if (r.winners) w.push(`${stroke(r.wing, r.shot)} ${r.winners}`);
    if (r.unforced || r.forced) e.push(`${stroke(r.wing, r.shot)} ${r.unforced} unforced + ${r.forced} forced`);
  }
  return { winners: w.filter(Boolean).join('; ') || 'none recorded', errors: e.filter(Boolean).join('; ') || 'none recorded' };
}

/** Everything the model gets about the match: context, statistics, breakdowns and the point log. No names. */
export function matchBrief(m: Match, maxPoints = 300): string {
  const r = replay(m);
  const st = statsFromReplay(r);
  const sum = summary(m);
  const f = m.format;
  const result =
    m.status === 'live'
      ? `in progress, score ${setsText(sum.sets) || '0-0'}`
      : `${sum.winner === 'p' ? 'the player won' : sum.winner === 'o' ? 'the opponent won' : 'no result'} ${setsText(sum.sets)}${m.endReason === 'retired' ? ' (retirement)' : m.endReason === 'stopped' ? ' (stopped)' : ''}`;
  const lines: string[] = [
    'MATCH',
    `- ${m.kind === 'practice' ? 'Practice match' : `Official match${m.round ? `, round ${m.round}` : ''}`}${m.surface ? `, ${m.surface} court${m.indoor ? ' (indoor)' : ''}` : ''}.`,
    `- Format: ${f.sets === 1 ? 'one set' : `best of ${f.sets} sets`}, ${f.games}-game sets${f.sets > 1 && f.finalSet === 'mtb' ? ', 10-point match tie-break instead of a final set' : ''}, ${f.noAd ? 'no-ad scoring' : 'advantage scoring'}.`,
    `- Result: ${result}. Charted points: ${st.points}. ${m.firstServer === 'p' ? 'The player' : 'The opponent'} served first.`,
    ...(m.opponentHand === 'left' ? ['- The opponent is left-handed.'] : []),
    ...(m.opponentRating.trim() ? [`- Opponent level: ${m.opponentRating.trim()}.`] : []),
    '',
    'KEY STATISTICS (the player | the opponent)',
    ...sideRows(st.p, st.o, st),
    '',
    'WINNERS AND ERRORS BY SHOT',
  ];
  for (const side of ['p', 'o'] as Side[]) {
    const s = strokeLines(st, side);
    lines.push(`- Winners, ${WHO[side]}: ${s.winners}`, `- Errors, ${WHO[side]}: ${s.errors}`);
  }
  lines.push('', 'DEUCE / AD COURT (serve points won; return points won)');
  for (const side of ['p', 'o'] as Side[]) {
    const C = st.court[side];
    lines.push(`- ${WHO[side]}: ${COURT_SIDES.map((c) => `${c} court serve ${pct(C[c].serveWon, C[c].servePlayed)}, return ${pct(C[c].returnWon, C[c].returnPlayed)}`).join('; ')}`);
  }
  lines.push('', 'SERVE DIRECTION (serves there; share of those points won by the server)');
  for (const side of ['p', 'o'] as Side[]) {
    const D = st.serveDir[side];
    const any = COURT_SIDES.some((c) => SERVE_DIRS.some((d) => D[c][d].played));
    lines.push(`- ${WHO[side]}: ${any ? COURT_SIDES.map((c) => `${c}: ${SERVE_DIRS.map((d) => `${DIR_EN[d]} ${D[c][d].played} (${pct(D[c][d].won, D[c][d].played)})`).join(', ')}`).join('; ') : 'not recorded'}`);
  }
  lines.push('', 'RALLY LENGTH (points won by the player)', `- ${RALLY.map((x) => `${RALLY_EN[x]}: ${pct(st.rally[x].won, st.rally[x].played)}`).join('; ')}`);
  const sets = [...new Set(r.ctx.map((c) => c.setIndex))];
  if (sets.length > 1) {
    lines.push('', 'BY SET (points won by the player)', `- ${sets.map((i) => { const s = statsFromReplay(r, i); return `set ${i + 1}: ${pct(s.p.pointsWon, s.points)}, unforced errors ${s.p.unforcedErrors} vs ${s.o.unforcedErrors}`; }).join('; ')}`);
  }
  const oppNet = new Set(m.oppNet);
  const shown = r.ctx.slice(-maxPoints);
  lines.push(
    '',
    `POINT LOG (${shown.length < r.ctx.length ? `last ${shown.length} of ${r.ctx.length} points` : 'every point'}, oldest first; score before the point with the player first; P = the player, O = the opponent; BP = break point; → who won the point)`,
    ...shown.map((c) => pointLine(c, f.noAd, oppNet.has(c.index))),
  );
  return lines.join('\n');
}

/** The coaching instructions. Output: exactly two plain paragraphs in the app's language. */
export function systemPrompt(lang: 'en' | 'fa'): string {
  const language = lang === 'fa' ? 'Persian (Farsi), natural and fluent' : 'English';
  const names = lang === 'fa' ? 'Call the charted player «بازیکن» and the other player «حریف».' : 'Call the charted player "the player" and the other player "the opponent".';
  return [
    'You are an elite tennis coach (WTA/ATP and ITF junior experience) writing a short debrief of a charted match for the player’s coach and parents.',
    'Use only the statistics and the point log you are given. Never invent numbers; every number you cite must come from the data. If the data is thin, say so briefly.',
    `Write in ${language}, in plain language a parent understands; use tennis terms only where they help. ${names}`,
    'Output exactly two paragraphs separated by one blank line — no title, no headings, no bullet points, no markdown, no greetings.',
    'Paragraph 1 — tactical analysis: what decided the match and the patterns that worked or failed (serve and return, deuce/ad court, serve direction, rally length, net play, pressure points such as break points), citing two or three numbers.',
    'Paragraph 2 — weaknesses and what to work on: the two or three most important weaknesses the data shows, each with one concrete training priority for the coming week.',
    'Each paragraph 70–110 words.',
  ].join('\n');
}

/** Two clean paragraphs: markdown, headings and labels removed; extra paragraphs folded into the second. */
export function cleanInsight(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').trim();
  t = t
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/^[ \t]*(paragraph[ \t]*\d+|پاراگراف[ \t]*\S+)[ \t]*[:：—-][ \t]*/gim, '');
  let paras = t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (paras.length === 1 && /\n/.test(t)) paras = t.split('\n').map((p) => p.trim()).filter(Boolean);
  if (paras.length > 2) paras = [paras[0], paras.slice(1).join(' ')];
  return paras.join('\n\n').slice(0, 6000);
}

export const insightParagraphs = (text: string): string[] => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

type Fetch = typeof fetch;

function httpError(status: number, message: string, statusText = ''): AiError {
  const m = `${message} ${statusText}`.toLowerCase();
  if (status === 401 || status === 403 || /api key|api_key|invalid.*key|permission/.test(m)) return new AiError('key', message);
  if (status === 404 || /model.*(not found|does not exist|not supported)|unknown model/.test(m)) return new AiError('model', message);
  if (status === 429 || /quota|rate limit|resource_exhausted|insufficient/.test(m)) return new AiError('quota', message);
  return new AiError('other', message || `HTTP ${status}`);
}

async function post(f: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; ok: boolean; json: Record<string, any> }> {
  let res: Response;
  try {
    res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    // Offline, or the provider refused the browser request (CORS).
    throw new AiError('network', e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, ok: res.ok, json };
}

async function callOpenAI(f: Fetch, key: string, model: string, system: string, user: string): Promise<string> {
  const r = await post(f, 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${key}` }, {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  if (!r.ok) throw httpError(r.status, String(r.json?.error?.message ?? ''), String(r.json?.error?.code ?? ''));
  const choice = r.json?.choices?.[0];
  if (choice?.message?.refusal) throw new AiError('blocked', String(choice.message.refusal));
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AiError('empty');
  return text;
}

async function callGemini(f: Fetch, key: string, model: string, system: string, user: string): Promise<string> {
  const id = model.replace(/^models\//, '');
  const r = await post(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`, { 'x-goog-api-key': key }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
  });
  if (!r.ok) throw httpError(r.status, String(r.json?.error?.message ?? ''), String(r.json?.error?.status ?? ''));
  if (r.json?.promptFeedback?.blockReason) throw new AiError('blocked', String(r.json.promptFeedback.blockReason));
  const parts = (r.json?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[];
  const text = parts.map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new AiError('empty');
  return text;
}

/** Ask the coach's own model for the debrief; returns what is kept with the match. */
export async function askCoach(m: Match, s: AiSettings, lang: 'en' | 'fa', f: Fetch = (...a) => fetch(...a)): Promise<MatchInsight> {
  const key = keyFor(s);
  if (!key) throw new AiError('key', 'no key');
  const model = s.models[s.provider]?.trim() || DEFAULT_MODELS[s.provider];
  const system = systemPrompt(lang);
  const user = `${lang === 'fa' ? 'Write the debrief in Persian.' : 'Write the debrief in English.'}\n\n${matchBrief(m)}`;
  const raw = s.provider === 'openai' ? await callOpenAI(f, key, model, system, user) : await callGemini(f, key, model, system, user);
  const text = cleanInsight(raw);
  if (!text) throw new AiError('empty');
  return { text, provider: s.provider, model, lang, points: replay(m).ctx.length, createdAt: new Date().toISOString() };
}
