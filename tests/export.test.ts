import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../src/data/demo';
import { matchFileName, matchReportHtml, matchSummaryText } from '../src/lib/matchExport';
import { statsFromReplay, summary } from '../src/lib/match';
import { MatchSchema, type Match } from '../src/types';

const state = createDemoState('2026-11-02');
const charted = state.matches.find((m) => m.mode === 'live' && m.status === 'done' && m.points.length > 20) as Match;
const player = state.players.find((p) => p.id === charted.playerId)!;

test('the report holds the result, every statistic and the point-by-point list', () => {
  const html = matchReportHtml(charted, { lang: 'en', playerName: player.name, exportedAt: new Date('2026-11-02T12:00:00Z') });
  const st = statsFromReplay(summary(charted).replay!);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.ok(html.includes(`${player.name} vs ${charted.opponent}`), 'title');
  for (const label of ['Aces', 'Double faults', 'Break points saved', 'Winners', 'Unforced errors', 'Total points won']) assert.ok(html.includes(label), label);
  assert.ok(html.includes(`${st.p.pointsWon}–${st.o.pointsWon}`), 'points won tile');
  assert.equal((html.match(/<td class="n">/g) ?? []).length, charted.points.length, 'one row per point');
  assert.ok(html.includes('Momentum'));
  assert.ok(!/<script(?![^>]*application\/json)/.test(html), 'no script runs in the file');
});

test('Persian report is right-to-left and keeps the numbers', () => {
  const html = matchReportHtml(charted, { lang: 'fa', playerName: player.name });
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.ok(html.includes('گزارش مسابقه'));
  assert.ok(html.includes('امتیاز به امتیاز'));
});

test('names and notes cannot inject markup; the match travels inside and parses back', () => {
  const evil: Match = { ...charted, opponent: '<img src=x onerror=alert(1)>', notes: '</script><script>alert(2)</script>' };
  const html = matchReportHtml(evil, { lang: 'en', playerName: 'A & B' });
  assert.ok(!html.includes('<img src=x'), 'opponent escaped');
  assert.ok(html.includes('A &amp; B'));
  const json = /<script type="application\/json" id="tennis-match">([\s\S]*?)<\/script>/.exec(html)![1];
  assert.ok(!json.includes('</script>'), 'cannot close the data block');
  const data = JSON.parse(json);
  assert.equal(data.kind, 'match');
  assert.deepEqual(MatchSchema.parse(data.match), MatchSchema.parse(evil));
});

test('summary text and file name', () => {
  const text = matchSummaryText(charted, { lang: 'en', playerName: player.name });
  assert.match(text, /^🎾 /);
  assert.ok(text.includes('Total points won'));
  assert.equal(matchFileName({ ...charted, opponent: 'Deniz K. / Club', date: '2026-11-02' }, 'Alya Naz'), '21gram-Alya-Naz-vs-Deniz-K-Club-2026-11-02.html');
  assert.equal(matchFileName({ ...charted, opponent: 'دنیز', date: '2026-11-02' }, 'آلیا'), '21gram-آلیا-vs-دنیز-2026-11-02.html');
});

test('a final-score-only match still exports', () => {
  const m = state.matches.find((x) => x.mode === 'score') as Match | undefined;
  if (!m) return;
  const html = matchReportHtml(m, { lang: 'en', playerName: player.name });
  assert.ok(html.includes('Final score only'));
  assert.ok(!html.includes('<td class="n">'));
});
