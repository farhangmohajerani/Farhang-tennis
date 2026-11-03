/**
 * Live score, point by point: one device charts, another follows. After every point the follower's
 * scoreboard (names, sets, games, points, server, chips) must equal the scorer's; the delay is measured.
 *   OUT_DIR=e2e/.sb-build SUPABASE_URL=http://localhost:4300 SUPABASE_ANON_KEY=test node scripts/build.mjs
 *   node e2e/live-sync.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';
import { startMockSupabase } from './mock-supabase.mjs';

const OWNER = 'owner@example.com';
const mock = await startMockSupabase(4300, OWNER);
const site = await serve(new URL('./.sb-build', import.meta.url).pathname, 4301);
const URL_ = 'http://localhost:4301/';
const POINTS = Number(process.env.POINTS ?? 40);
const browser = await chromium.launch();
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log('  ✓ ' + name);
};
async function person(viewport = { width: 820, height: 1180 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/fonts\./, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto(URL_);
  return page;
}
async function signUp(page, { email, kind, username, name, year }) {
  await page.getByTestId('tab-up').click();
  await page.getByTestId(`kind-${kind}`).click();
  await page.fill('#sb-username', username);
  await page.fill('#sb-name', name);
  if (year) await page.fill('#sb-birthyear', String(year));
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('consent-privacy').check();
  if (kind === 'parent') await page.getByTestId('consent-guardian').check();
  await page.getByTestId('sign-up').click();
  await page.locator('main').waitFor();
}
/** Everything a follower should see: per row its text and the serving dot, plus the chips. */
const board = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('[data-testid="scoreboard"]');
    if (!b) return null;
    const rows = [...b.querySelectorAll('tr')].map((r) => `${r.querySelector('[aria-label]') ? '●' : '○'} ${r.innerText.replace(/\s+/g, ' ').trim()}`);
    const chips = b.querySelector('[data-testid="score-chips"]')?.innerText.replace(/\s+/g, ' ').trim() ?? '';
    return `${rows.join(' | ')}${chips ? ` [${chips}]` : ''}`;
  });
const serverSide = (page) => page.evaluate(() => document.querySelector('[data-testid="scoreboard"] tr:has([aria-label])')?.getAttribute('data-side') ?? null);

/** One point with a varied ending; returns a short label. */
async function playPoint(page, i) {
  const s = await serverSide(page);
  const kinds = ['rally-w', 'rally-ue', 'ace', 'rally-fe', 'return-err', 'df', 'rally-w', 'rally-ue'];
  const kind = kinds[i % kinds.length];
  const side = i % 3 === 0 ? 'o' : 'p';
  const stroke = ['fh', 'bh', 'fh-volley', 'bh-slice'][i % 4];
  if (kind === 'ace' && s) {
    await page.getByTestId(`${s}-ace`).click();
    return `${s} ace`;
  }
  if (kind === 'df' && s) {
    await page.getByTestId('serve-2').click();
    await page.getByTestId(`${s}-doubleFault`).click();
    return `${s} double fault`;
  }
  if (kind === 'return-err') {
    await page.getByTestId('ret-bh').click();
    await page.getByTestId('ret-error').click();
    return 'return error';
  }
  const outcome = kind === 'rally-w' ? 'winner' : kind === 'rally-fe' ? 'forcedError' : 'unforcedError';
  await page.getByTestId(`${side}-stroke-${stroke}`).click();
  await page.getByTestId(`${side}-${outcome}`).click();
  return `${side} ${stroke} ${outcome}`;
}

/** Waits until the follower shows exactly what the scorer shows; returns the delay in ms. */
async function sameBoard(scorer, follower, label) {
  const want = await board(scorer);
  const t0 = Date.now();
  for (;;) {
    const got = await board(follower);
    if (got === want) return Date.now() - t0;
    if (Date.now() - t0 > 15000) throw new Error(`follower out of sync after "${label}"\n  scorer:   ${want}\n  follower: ${got}`);
    await follower.waitForTimeout(50);
  }
}

// "owner" here is a coach (not the admin): the database's connection rules decide what each side sees.
const owner = await person();
await step('setup: a coach and the family of Alya connect by username', async () => {
  await signUp(owner, { email: 'coach@example.com', kind: 'coach', username: 'hamed', name: 'Hamed Coach' });
  globalThis.fam = await person({ width: 390, height: 844 });
  await signUp(fam, { email: 'parent@example.com', kind: 'parent', username: 'alya', name: 'Alya', year: 2013 });
  await fam.getByTestId('find-coach-card').getByTestId('people-search-input').fill('hamed');
  await fam.getByTestId('request-hamed').click();
  await fam.getByTestId('allow-confirm').click();
  await fam.getByTestId('req-out-hamed').waitFor();
  await owner.reload();
  await owner.getByTestId('accept-alya').click();
  await owner.getByText('Build a 10-session plan').waitFor({ timeout: 15000 });
  assert.equal(mock.staff.size, 0, 'neither is the admin');
});

const delays = [];
await step(`coach charts ${POINTS} points; after each one the parent's scoreboard matches exactly`, async () => {
  await owner.goto(URL_ + '#newmatch');
  await owner.fill('#m-opponent', 'Live Opp');
  await owner.getByTestId('match-submit').click();
  await owner.getByTestId('scoreboard').waitFor();
  await fam.goto(URL_ + '#matches');
  // The family is asked once whether to follow the match that just started.
  await fam.getByTestId('live-alert-follow').click({ timeout: 15000 });
  await fam.getByTestId('scoreboard').waitFor();
  assert.equal(await fam.getByTestId('point-composer').count(), 0, 'the follower cannot chart');
  delays.push(await sameBoard(owner, fam, 'start'));
  for (let i = 0; i < POINTS; i++) {
    const label = await playPoint(owner, i);
    delays.push(await sameBoard(owner, fam, `#${i + 1} ${label}`));
  }
});

await step('undo on the scorer is undone on the follower too', async () => {
  await owner.getByTestId('undo-point').click();
  delays.push(await sameBoard(owner, fam, 'undo'));
  await owner.getByTestId('undo-point').click();
  delays.push(await sameBoard(owner, fam, 'undo 2'));
});

const report = (name, list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const avg = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  console.log(`  ${name}: ${list.length} updates, average ${avg} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted.at(-1)} ms`);
};
const coachToParent = [...delays];
delays.length = 0;

await step('a parent starts a match for their child; the coach sees it live and cannot chart it', async () => {
  await fam.goto(URL_ + '#matches');
  await fam.getByTestId('new-match').click();
  await fam.fill('#m-opponent', 'Parent Opp');
  await fam.getByTestId('match-submit').click();
  await fam.getByTestId('point-composer').waitFor();
  await owner.goto(URL_ + '#matches');
  await owner.getByTestId('live-alert').getByText('vs Parent Opp').waitFor({ timeout: 15000 });
  await owner.getByTestId('live-alert-follow').click();
  await owner.getByTestId('live-follow').getByText(/A parent is scoring/).waitFor();
  assert.equal(await owner.getByTestId('point-composer').count(), 0, 'the coach follows; only the scorer charts');
  await owner.getByTestId('take-over').waitFor();
  delays.push(await sameBoard(fam, owner, 'parent start'));
});

await step(`the parent charts ${Math.round(POINTS * 0.75)} points; after each one the coach's scoreboard matches exactly`, async () => {
  for (let i = 0; i < Math.round(POINTS * 0.75); i++) {
    const label = await playPoint(fam, i + 1);
    delays.push(await sameBoard(fam, owner, `parent #${i + 1} ${label}`));
  }
  await fam.getByTestId('undo-point').click();
  delays.push(await sameBoard(fam, owner, 'parent undo'));
  const m = [...mock.docs.values()].find((d) => d.path.startsWith('academy/data/matches/') && d.data.opponent === 'Parent Opp');
  assert.equal(m.data.scorerRole, 'parent');
});
await step('the parent reloads in the middle of the match and carries on charting', async () => {
  await fam.reload();
  await fam.getByTestId('point-composer').waitFor({ timeout: 15000 });
  delays.push(await sameBoard(fam, owner, 'after reload'));
  const label = await playPoint(fam, 2);
  delays.push(await sameBoard(fam, owner, `after reload: ${label}`));
});
const parentToCoach = [...delays];

await step('the coach takes over: the coach charts, the parent now follows read-only', async () => {
  await owner.getByTestId('take-over').click();
  await owner.getByTestId('point-composer').waitFor();
  await fam.getByTestId('live-follow').getByText(/The coach is scoring/).waitFor({ timeout: 15000 });
  assert.equal(await fam.getByTestId('point-composer').count(), 0);
  const before = await board(owner);
  await playPoint(owner, 0);
  assert.notEqual(await board(owner), before);
  await sameBoard(owner, fam, 'after take over');
});

console.log('');
report('coach → parent', coachToParent);
report('parent → coach', parentToCoach);
console.log(`  final board: ${await board(owner)}`);
await browser.close();
mock.server.close();
site.close();
console.log(`\n${passed} passed`);
