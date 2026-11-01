/**
 * End-to-end tests against a built app (node scripts/build.mjs, then serve dist/).
 *   node e2e/e2e.mjs [chromium|mobile|webkit|all]   (serves dist/ itself; or set BASE=<url>)
 * Covers: library count/search/filters, drill details, session assignment, planner
 * reorder/save, KPI logging + validation, reload persistence, RTL, admin CRUD + import/export,
 * parent plan sharing, role guards. WebKit run uses the iPhone 13 device profile.
 */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { serve } from '../scripts/serve.mjs';

let server = null;
if (!process.env.BASE) server = await serve(new URL('../dist', import.meta.url).pathname, 4199);
const BASE = process.env.BASE ?? 'http://localhost:4199';
const which = process.argv[2] ?? 'all';
let passed = 0;
const failures = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}

async function run(engineName) {
  // 'webkit' = real WebKit + iPhone 13 profile; 'mobile' = Chromium with the iPhone 13 profile
  // (viewport, touch, DPR, Safari UA) for environments without a WebKit binary.
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  void defaultBrowserType;
  const ctxOpts = engineName === 'desktop' || engineName === 'chromium' ? { viewport: { width: 1280, height: 900 } } : iphone;
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const go = async (hash) => {
    await page.goto(`${BASE}/#${hash}`);
    await page.waitForSelector('main');
  };
  const setRole = (r) => page.selectOption('#role-select', r);
  const toast = (re) => page.getByRole('status').getByText(re).first().waitFor({ timeout: 4000 });
  const mobile = engineName === 'webkit' || engineName === 'mobile';

  console.log(`\n[${engineName}${mobile ? ' · iPhone 13 profile' : ''}]`);
  await go('dashboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('main');

  await step('dashboard shows next session, plan progress and KPI tiles', async () => {
    assert.match(await page.getByTestId('next-session-title').innerText(), /Session \d+/);
    assert.match(await page.getByTestId('plan-progress').innerText(), /of 10 sessions completed/);
    assert.equal(await page.locator('[data-kpi]').count(), 3);
  });

  await step('library shows all 200 seeded drills', async () => {
    await go('library');
    assert.equal(await page.locator('[data-drill-id]').count(), 200);
    assert.match(await page.getByTestId('result-count').innerText(), /200 of 200/);
  });

  await step('search narrows results', async () => {
    await page.fill('#drill-search', 'drop shot');
    const n = await page.locator('[data-drill-id]').count();
    assert.ok(n > 0 && n < 200, `got ${n}`);
    assert.ok(await page.locator('[data-drill-id="tp-001"]').count());
    await page.fill('#drill-search', 'zzzz-no-match');
    await page.getByText('No drills match these filters.').waitFor();
    await page.fill('#drill-search', '');
  });

  await step('category, level and duration filters work and combine', async () => {
    await page.getByTestId('cat-serve').click();
    assert.equal(await page.locator('[data-drill-id]').count(), 25);
    await page.selectOption('#level-filter', 'beginner');
    const n = await page.locator('[data-drill-id]').count();
    assert.ok(n > 0 && n < 25);
    for (const id of await page.locator('[data-drill-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-drill-id')))) assert.ok(id.startsWith('sv-'));
    await page.selectOption('#duration-filter', 'long');
    assert.equal(await page.locator('[data-drill-id]').count(), 0);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    assert.equal(await page.locator('[data-drill-id]').count(), 200);
    await page.getByTestId('cat-tactical').click();
    assert.equal(await page.locator('[data-drill-id]').count(), 30);
  });

  await step('drill details show every protocol section', async () => {
    await go('drill-tp-001');
    assert.equal(await page.getByTestId('drill-title').innerText(), 'Deep Topspin + Drop Shot');
    for (const h of ['Setup', 'Step-by-step', 'Coaching cues', 'Common mistakes → corrections', 'Progression', 'Regression', 'Safety']) await page.getByRole('heading', { name: h, exact: true }).waitFor();
    for (const label of ['Eligible opportunity', 'KPI definitions', 'Measurement protocol', 'Scoring (provisional star thresholds)']) await page.getByText(label, { exact: true }).first().waitFor();
    await page.getByTestId('video-placeholder').waitFor();
    assert.match(await page.locator('main').innerText(), /intelligent but unsuccessful drop still receives decision credit/i);
  });

  await step('assign a drill to a session from the drill page', async () => {
    await go('drill-sv-001');
    await page.getByRole('button', { name: '+ Add to session' }).click();
    const dialog = page.getByRole('dialog');
    const opt = await dialog.locator('#ats-session option').nth(1).getAttribute('value');
    await dialog.locator('#ats-session').selectOption(opt);
    await dialog.locator('#ats-reason').fill('Toss consistency before the tournament');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await toast(/Added to session/);
    await go('parent');
    await page.getByText('Toss Consistency Target Ring').first().waitFor();
    await page.getByText('Toss consistency before the tournament').first().waitFor();
  });

  await step('planner: edit, reorder drills, save, and move sessions off tournament days', async () => {
    await go('planner');
    const s5 = page.locator('[data-session-index="5"]');
    // the planner opens the next planned session by default; make sure session 5 is open
    if (!(await s5.locator('[aria-expanded="true"]').count())) await s5.locator('[aria-expanded]').first().click();
    const items = () => s5.locator('[data-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item')));
    const before = await items();
    await s5.locator('[data-item]').nth(1).getByRole('button', { name: 'Move up' }).click();
    const after = await items();
    assert.deepEqual(after, [before[1], before[0], ...before.slice(2)]);
    await s5.locator('input[id^="title-"]').fill('Serve foundation (edited)');
    await s5.locator('input[id^="pick-"]').fill('kick serve');
    await s5.getByRole('button', { name: /Kick Serve Return/ }).click();
    assert.equal((await items()).length, before.length + 1);
    await page.getByTestId('unsaved-bar').waitFor();
    await page.getByTestId('reschedule').click();
    await page.getByText('No tournament conflicts.').waitFor();
    await page.getByTestId('save-plan').click();
    await toast(/Plan saved/);
    await page.getByTestId('unsaved-bar').waitFor({ state: 'detached' });
  });

  await step('session execution: validation, live KPIs, save, delete', async () => {
    await go('session');
    const prefix = await page.locator('[id$="-eligible"]').first().getAttribute('id');
    const drillId = prefix.replace(/-eligible$/, '');
    const fill = async (field, v) => page.fill(`#${drillId}-${field}`, String(v));
    await fill('eligible', 10);
    await fill('attempts', 8);
    await fill('decisions', 9);
    await page.getByText('Correct decisions cannot exceed attempts.').waitFor();
    assert.equal(await page.getByTestId(`save-log-${drillId}`).isDisabled(), true);
    await fill('decisions', 6);
    await fill('successful', 3);
    assert.equal(await page.getByTestId('kpi-attempt').first().innerText(), '80%');
    assert.equal(await page.getByTestId('kpi-decision').first().innerText(), '75%');
    assert.equal(await page.getByTestId('kpi-execution').first().innerText(), '50%');
    await page.getByTestId(`save-log-${drillId}`).click();
    await toast(/Result saved/);
    assert.equal(await page.locator('[data-log-id]').count(), 1);
    // zero denominators → insufficient data, never NaN
    await fill('eligible', 0);
    await fill('attempts', 0);
    await fill('decisions', 0);
    await fill('successful', 0);
    assert.match(await page.getByTestId('kpi-decision').first().innerText(), /Insufficient data/);
    assert.ok(!(await page.locator('main').innerText()).includes('NaN'));
    // delete needs a two-step confirmation (window.confirm is unavailable in sandboxed viewers)
    await page.getByTestId(`save-log-${drillId}`).isDisabled();
    await fill('eligible', 4);
    await fill('attempts', 4);
    await fill('decisions', 3);
    await fill('successful', 2);
    await page.getByTestId(`save-log-${drillId}`).click();
    assert.equal(await page.locator('[data-log-id]').count(), 2);
    const last = page.locator('[data-log-id]').last();
    await last.getByRole('button', { name: 'Delete', exact: true }).click();
    await last.getByRole('button', { name: 'Delete result?' }).click();
    await toast(/Result deleted/);
    assert.equal(await page.locator('[data-log-id]').count(), 1);
  });

  await step('changes persist across reload', async () => {
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('main');
    assert.equal(await page.locator('[data-log-id]').count(), 1);
    await go('planner');
    await page.locator('[data-session-index="5"]').getByText('Serve foundation (edited)').waitFor();
    await page.getByText('No tournament conflicts.').waitFor();
  });

  await step('complete session updates plan progress', async () => {
    await go('dashboard');
    const before = Number((await page.getByTestId('plan-progress').innerText()).match(/\d+/)[0]);
    await go('session');
    await page.getByTestId('complete-session').click();
    await toast(/Session marked completed/);
    await go('dashboard');
    assert.match(await page.getByTestId('plan-progress').innerText(), new RegExp(`${before + 1} of 10`));
  });

  await step('Persian RTL toggle', async () => {
    await page.getByTestId('lang-toggle').click();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'fa');
    await page.locator('a', { hasText: 'داشبورد' }).locator('visible=true').first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}`);
    await page.reload();
    await page.waitForSelector('main');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await page.getByTestId('lang-toggle').click();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
  });

  await step('role guards: parent cannot plan; admin page admin-only', async () => {
    await setRole('parent');
    await go('planner');
    assert.equal(await page.getByTestId('planner-sessions').count(), 0);
    await go('library');
    assert.equal(await page.getByRole('button', { name: '+ Add to session' }).count(), 0);
    await go('admin');
    assert.equal(await page.getByTestId('admin-list').count(), 0);
  });

  await step('parent: start a self-guided plan and share it with the coach', async () => {
    await go('parent');
    await page.getByTestId('start-own-plan').click();
    await page.getByTestId('share-plan').click();
    await page.getByText(/Shared with Coach/).first().waitFor();
  });

  await step('admin: create, edit, archive, restore and delete a drill', async () => {
    await setRole('admin');
    await go('admin');
    await page.getByTestId('new-drill').click();
    const ed = page.getByTestId('drill-editor');
    await ed.getByRole('button', { name: 'Save' }).click();
    await page.getByText(/field\(s\) need attention/).waitFor();
    await ed.locator('#ed-name').fill('E2E Custom Lob Drill');
    await ed.locator('#ed-objective').fill('Practice deep defensive lobs under pressure.');
    await ed.locator('#ed-setup').fill('Coach feeds wide balls from the opposite baseline.');
    await ed.locator('#ed-courtLayout').fill('Full court; deep zone past the service line.');
    await ed.locator('#ed-stepsText').fill('Coach feeds wide\nPlayer lobs deep\nRecover to center');
    await ed.locator('#ed-cuesText').fill('Open the face');
    await ed.locator('#ed-mistakesText').fill('Lob lands short => Lift with the legs and finish higher');
    await ed.locator('#ed-eligibility').fill('A ball that pulls the player beyond the sideline.');
    await ed.locator('#ed-kpi-attempt').fill('Player lobs.');
    await ed.locator('#ed-kpi-decision').fill('Lob chosen when stretched.');
    await ed.locator('#ed-kpi-execution').fill('Lob lands past the service line.');
    await ed.locator('#ed-progression').fill('Live net player smashes short lobs.');
    await ed.locator('#ed-regression').fill('Slower feeds.');
    await ed.locator('#ed-safety').fill('Clear the back fence area.');
    await page.getByTestId('save-drill').click();
    await toast(/Drill saved/);
    await page.fill('#admin-search', 'E2E Custom');
    const row = page.getByTestId('admin-list').locator('li').first();
    await row.getByText('E2E Custom Lob Drill').waitFor();
    await row.getByRole('button', { name: /^Edit / }).click();
    await page.locator('#ed-name').fill('E2E Custom Lob Drill v2');
    await page.getByTestId('save-drill').click();
    await row.getByText('E2E Custom Lob Drill v2').waitFor();
    await row.getByRole('button', { name: 'Archive' }).click();
    await toast(/Drill archived/);
    await row.getByRole('button', { name: 'Restore' }).click();
    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Delete?' }).click();
    await toast(/Custom drill deleted/);
    assert.equal(await page.getByTestId('admin-list').locator('li').count(), 0);
    await page.fill('#admin-search', '');
  });

  await step('admin: export JSON/CSV and re-import them', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
    for (const [btn, ext] of [['export-json', 'json'], ['export-csv', 'csv']]) {
      let file = path.join(tmp, `drills.${ext}`);
      if (!mobile) {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(btn).click()]);
        await dl.saveAs(file);
      } else {
        await page.getByTestId(btn).click();
        fs.writeFileSync(file, await page.locator('textarea[readonly]').inputValue());
      }
      const text = fs.readFileSync(file, 'utf8');
      if (ext === 'json') assert.equal(JSON.parse(text).count, 200);
      else assert.equal(text.split(/\r?\n/).filter((l) => /^[a-z]{2}-\d{3},/.test(l)).length, 200);
      await page.getByTestId('import-file').setInputFiles(file);
      await page.getByTestId('import-result').getByText(/0 added, 200 updated, 0 rejected/).waitFor();
    }
    // a file with one bad row
    const bad = path.join(tmp, 'bad.json');
    const good = JSON.parse(fs.readFileSync(path.join(tmp, 'drills.json'), 'utf8')).drills[0];
    fs.writeFileSync(bad, JSON.stringify([{ ...good, id: 'custom-imported1', name: 'Imported drill' }, { ...good, id: 'nope', durationMin: 0 }]));
    await page.getByTestId('import-file').setInputFiles(bad);
    await page.getByTestId('import-result').getByText(/1 added, 0 updated, 1 rejected/).waitFor();
    assert.equal(await page.getByTestId('admin-stat-Drills').innerText(), '201');
  });

  await step('admin: star thresholds are editable and applied', async () => {
    await page.selectOption('#threshold-level', 'beginner');
    await page.fill('#th-beginner-decision-0', '42');
    await page.getByRole('button', { name: 'Apply level defaults to all drills of this level' }).click();
    await toast(/Updated \d+ drills/);
    await go('drill-fh-001');
    await page.getByRole('cell', { name: '≥42%' }).waitFor();
  });

  await step('matches: record, season statistics and match list from the demo', async () => {
    await setRole('coach');
    await go('matches');
    assert.match(await page.getByTestId('record').innerText(), /2–1/);
    assert.equal(await page.getByTestId('season-stats').locator(':scope > div').count(), 8);
    assert.equal(await page.getByTestId('match-list').locator('[data-match-id]').count(), 3);
    await page.getByTestId('tab-tournaments').click();
    await page.getByTestId('upcoming-tournaments').waitFor();
    assert.equal(await page.getByTestId('past-tournaments').locator('[data-tournament-id]').count(), 1);
  });

  await step('tournament goals: evaluated from matches, add, mark and remove goals', async () => {
    await go('tournament-tour-demo-past');
    await page.getByText('Reached: Round of 16').first().waitFor();
    assert.ok(await page.locator('[data-goal-status="met"]').count() >= 1);
    assert.ok(await page.locator('[data-goal-status="missed"]').count() >= 1);
    await go('tournament-tour-demo');
    const goals = () => page.getByTestId('goal-list').locator(':scope > li').count();
    const before = await goals();
    await page.getByTestId('goal-kind-stat').click();
    await page.selectOption('#goal-metric', 'doubleFaults');
    assert.equal(await page.inputValue('#goal-op'), 'lte');
    await page.fill('#goal-value', '3');
    await page.getByTestId('add-goal').click();
    assert.equal(await goals(), before + 1);
    await page.getByText('Double faults ≤ 3 per match').waitFor();
    await page.getByTestId('goal-kind-custom').click();
    await page.fill('#goal-text', 'Breathe between points');
    await page.getByTestId('add-goal').click();
    assert.equal(await goals(), before + 2);
    const custom = page.locator('[data-goal-kind="custom"]').last();
    await custom.getByTestId('mark-true').click();
    await page.locator('[data-goal-kind="custom"][data-goal-status="met"]').last().waitFor();
    await page.getByRole('button', { name: 'Remove Breathe between points' }).click();
    assert.equal(await goals(), before + 1);
    await page.getByTestId('aim-training').click();
    assert.equal(await page.getByTestId('aim-training').getAttribute('aria-checked'), 'true');
  });

  let liveId = '';
  await step('match tracker: serve, fault, double fault, winner, detail, undo, reload', async () => {
    await go('newmatch');
    await page.fill('#m-opponent', 'Test Opponent');
    await page.getByTestId('preset-oneSet').click();
    await page.selectOption('#m-games', '4');
    await page.getByTestId('match-submit').click();
    await page.getByTestId('scoreboard').waitFor();
    liveId = page.url().split('#match-')[1];
    const pts = async () => [await page.getByTestId('points-p').innerText(), await page.getByTestId('points-o').innerText()];
    await page.getByTestId('ace').click();
    assert.deepEqual(await pts(), ['15', '0']);
    await page.getByTestId('fault').click();
    assert.match(await page.getByTestId('serve-status').innerText(), /2nd serve/);
    await page.getByTestId('double-fault').click();
    assert.deepEqual(await pts(), ['15', '15']);
    await page.getByTestId('serve-in').click();
        await page.getByTestId('p-winner-fh').click();
    assert.deepEqual(await pts(), ['30', '15']);
    assert.match(await page.getByTestId('court-side').innerText(), /Ad court/); // 4th point of the game
    assert.match(await page.getByTestId('last-point').innerText(), /Winner · Forehand$/);
    await page.getByTestId('type-volley').click();
    assert.match(await page.getByTestId('last-point').innerText(), /Winner · Forehand · Volley/);
    assert.equal(await page.getByTestId('net-toggle').getAttribute('aria-pressed'), 'true', 'a volley means the player was at the net');
    await page.getByTestId('wing-bh').click();
    assert.match(await page.getByTestId('last-point').innerText(), /Backhand · Volley/);
    await page.getByTestId('rally-mid').click();
    await page.getByTestId('dir-t').click();
    assert.equal(await page.getByTestId('dir-t').getAttribute('aria-pressed'), 'true');
    await page.getByTestId('undo-point').click();
    assert.deepEqual(await pts(), ['15', '15']);
    await page.getByTestId('serve-in').click();
    await page.getByTestId('p-unforcedError-bh').click(); // opponent's unforced error
    assert.deepEqual(await pts(), ['30', '15']);
    await page.reload();
    await page.getByTestId('scoreboard').waitFor();
    assert.deepEqual(await pts(), ['30', '15']);
  });

  await step('match tracker: the set is won 4-0, the report shows score and statistics', async () => {
    for (let i = 0; i < 40 && !(await page.getByTestId('final-score').count()); i++) {
      await page.getByTestId('serve-in').click();
      await page.getByTestId('p-winner-fh').click();
    }
    await page.getByTestId('final-score').waitFor();
    assert.equal(await page.getByTestId('score-line').innerText(), '4-0');
    await page.getByTestId('stats-table').waitFor();
    const aces = await page.getByTestId('stats-table').getByRole('row').filter({ hasText: 'Aces' }).innerText();
    assert.match(aces, /^\s*1\b/);
    await page.getByTestId('momentum').waitFor();
    await page.getByTestId('detailed-analysis').waitFor();
    const deuce = await page.getByTestId('serve-won-deuce').innerText();
    const ad = await page.getByTestId('serve-won-ad').innerText();
    assert.match(deuce, /\d+%/);
    assert.match(ad, /\d+%/);
    assert.match(await page.getByTestId('ret-err-bh').innerText(), /^\d+$/);
    await page.getByTestId('who-o').click();
    assert.equal(await page.getByTestId('who-o').getAttribute('aria-checked'), 'true');
    await page.getByTestId('who-p').click();
    await page.getByTestId('reopen-match').click(); // undo the match-winning point
    await page.getByTestId('scoreboard').waitFor();
    await page.getByTestId('serve-in').click();
    await page.getByTestId('p-winner-fh').click();
    await page.getByTestId('final-score').waitFor();
    await page.fill('#match-notes', 'Served well at 30-30.');
    await page.getByTestId('save-match-notes').click();
    await page.reload();
    await page.getByTestId('final-score').waitFor();
    assert.equal(await page.inputValue('#match-notes'), 'Served well at 30-30.');
  });

  await step('final score only: tie-break notation and the tournament result goal', async () => {
    await go('newmatch-tour-demo');
    assert.equal(await page.getByTestId('mt-official').getAttribute('aria-checked'), 'true');
    assert.equal(await page.inputValue('#m-tournament'), 'tour-demo');
    await page.selectOption('#m-round', 'QF');
    await page.fill('#m-opponent', 'Score Only');
    await page.getByTestId('mode-score').click();
    await page.fill('#set-0-p', '7');
    await page.fill('#set-0-o', '6');
    await page.fill('#set-0-tb', '5');
    await page.fill('#set-1-p', '6');
    await page.fill('#set-1-o', '3');
    assert.match(await page.getByTestId('score-winner').innerText(), /Winner: Ela Demir/);
    await page.getByTestId('match-submit').click();
    await page.getByTestId('final-score').waitFor();
    assert.equal(await page.getByTestId('score-line').innerText(), '7-6(5) 6-3');
    await go('tournament-tour-demo');
    await page.getByText('Reached: Semi-final').first().waitFor();
    await page.locator('[data-goal-kind="outcome"][data-goal-status="met"]').waitFor();
    assert.equal(await page.getByTestId('tournament-matches').locator('[data-match-id]').count(), 1);
  });

  await step('end a match early (retirement)', async () => {
    await go('newmatch');
    await page.fill('#m-opponent', 'Retires');
    await page.getByTestId('match-submit').click();
    await page.getByTestId('serve-in').click();
    await page.getByTestId('p-winner-fh').click();
    await page.getByTestId('finish-early').click();
    await page.getByTestId('reason-retired').check();
    await page.getByTestId('finish-winner-p').check();
    await page.getByTestId('confirm-finish').click();
    await page.getByTestId('final-score').waitFor();
    assert.match(await page.getByTestId('score-line').innerText(), /ret\./);
  });

  await step('parent: matches and tournaments are read-only', async () => {
    await setRole('parent');
    await go('matches');
    assert.equal(await page.getByTestId('new-match').count(), 0);
    await go(`match-${liveId}`);
    await page.getByTestId('final-score').waitFor();
    assert.equal(await page.getByTestId('edit-match').count(), 0);
    assert.equal(await page.locator('#match-notes').count(), 0);
    await page.getByText('Served well at 30-30.').waitFor();
    await go('tournament-tour-demo');
    assert.equal(await page.getByTestId('goal-adder').count(), 0);
    assert.equal(await page.getByTestId('add-goal').count(), 0);
    await go('newmatch');
    await page.getByText('Only coaches can add or chart matches.').waitFor();
    await go('parent');
    await page.getByTestId('parent-compete').waitFor();
    await setRole('coach');
  });

  await step('Persian: match and tournament pages', async () => {
    await page.getByTestId('lang-toggle').click();
    for (const r of ['matches', 'tournaments', 'tournament-tour-demo', 'match-match-demo-1', 'newmatch']) {
      await go(r);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(o <= 0, `${r} overflows by ${o}px in Persian`);
    }
    await go('matches');
    await page.getByText('مسابقه‌ها و تورنمنت‌ها').first().waitFor();
    await page.getByTestId('lang-toggle').click();
  });

  await step('no horizontal overflow on any page', async () => {
    for (const r of ['dashboard', 'library', 'drill-fh-005', 'planner', 'session', 'parent', 'progress', 'admin', 'matches', 'tournaments', 'tournament-tour-demo', 'match-match-demo-1', 'newmatch']) {
      await go(r);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(o <= 0, `${r} overflows by ${o}px`);
    }
  });

  await step('no uncaught page errors', async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
}

for (const e of which === 'all' ? ['chromium', 'mobile'] : [which]) await run(e);
console.log(`\n${passed} passed, ${failures.length} failed`);
server?.close();
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
