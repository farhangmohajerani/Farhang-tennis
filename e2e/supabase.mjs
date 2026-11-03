/**
 * Supabase-mode end-to-end test (usernames and connections) against e2e/mock-supabase.mjs.
 *   OUT_DIR=e2e/.sb-build SUPABASE_URL=http://localhost:4300 SUPABASE_ANON_KEY=test node scripts/build.mjs
 *   node e2e/supabase.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';
import { startMockSupabase } from './mock-supabase.mjs';

const OWNER = 'owner@example.com';
const mock = await startMockSupabase(4300, OWNER);
const site = await serve(new URL('./.sb-build', import.meta.url).pathname, 4301);
const URL_ = 'http://localhost:4301/';
const browser = await chromium.launch();
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log('  ✓ ' + name);
};
async function person(url = URL_, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/fonts\./, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e));
  await page.goto(url);
  return page;
}
/** kind: 'coach' | 'parent' (the family button). */
async function signUp(page, { email, kind, username, name, year }) {
  await page.getByTestId('tab-up').click();
  await page.getByTestId(`kind-${kind}`).click();
  await page.fill('#sb-username', username);
  await page.fill('#sb-name', name);
  if (year) await page.fill('#sb-birthyear', String(year));
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('sign-up').click();
}
async function signIn(page, email, password = 'password123') {
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', password);
  await page.getByTestId('sign-in').click();
  await page.locator('main').waitFor();
}
const idOf = (email) => mock.users.get(email).id;
/** The open modal (the dashboard can show the same search and requests behind it). */
const dlg = (page) => page.getByRole('dialog');
/** The player is in the top bar (as the only player, or among the choices). */
const hasPlayer = (page, name) => page.locator('#player-select option, main ~ * strong, header ~ div strong').filter({ hasText: name }).first().waitFor({ state: 'attached', timeout: 15000 });
const docsOf = (pred) => [...mock.docs.values()].filter(pred);
const players = (page) => page.evaluate(() => [...document.querySelectorAll('#player-select option')].map((o) => o.textContent));

/* ---------- accounts ---------- */
const owner = await person();
await step('sign-up asks coach or family, a username and a name before the account is made', async () => {
  await owner.getByTestId('tab-up').click();
  await owner.fill('#sb-email', OWNER);
  await owner.fill('#sb-password', 'password123');
  assert.equal(await owner.getByTestId('sign-up').isDisabled(), true, 'no kind yet');
  await owner.getByTestId('kind-coach').click();
  await owner.fill('#sb-username', 'Far Hang!');
  assert.equal(await owner.locator('#sb-username').inputValue(), 'farhang', 'only a–z, 0–9, . and _ are kept, in lower case');
  await owner.fill('#sb-username', 'fa');
  assert.equal(await owner.getByTestId('sign-up').isDisabled(), true, 'a 2-letter username is too short');
  assert.equal(mock.users.size, 0);
});
await step('the owner signs up with username @farhang and becomes the admin (who also works as a coach)', async () => {
  await owner.fill('#sb-username', 'farhang');
  await owner.fill('#sb-name', 'Farhang');
  await owner.getByTestId('sign-up').click();
  await owner.getByTestId('find-players-card').waitFor();
  assert.equal(await owner.locator('#role-select option').count(), 3);
  assert.equal(mock.staff.get(idOf(OWNER))?.role, 'admin');
  assert.equal(mock.profiles.get(idOf(OWNER))?.username, 'farhang');
  await owner.getByTestId('footer-username').getByText('@farhang').waitFor();
});
const hamed = await person();
await step('a coach signs up freely (no approval) and lands on "Find your players"', async () => {
  await signUp(hamed, { email: 'hamed@example.com', kind: 'coach', username: 'hamed', name: 'Hamed Karimi' });
  await hamed.getByTestId('find-players-card').waitFor();
  await hamed.getByTestId('my-username').getByText('@hamed').waitFor();
  assert.equal(await hamed.locator('#role-select option').count(), 2, 'coach and parent preview');
  assert.equal(mock.staff.size, 1, 'coaches are not staff');
});
const yaman = await person();
await step('a family signs up: one account = one player, created at once', async () => {
  await signUp(yaman, { email: 'yaman@example.com', kind: 'parent', username: 'yaman', name: 'Yaman Rad', year: 2014 });
  await yaman.getByTestId('find-coach-card').waitFor();
  await yaman.getByText('Yaman Rad').first().waitFor();
  const id = idOf('yaman@example.com');
  const doc = mock.docs.get(`academy/data/players/${id}`);
  assert.equal(doc.data.birthYear, 2014);
  assert.equal(doc.data.username, 'yaman');
  assert.equal(doc.data.accountId, id);
  const nav = await yaman.locator('nav[aria-label="Main mobile"]').innerText();
  assert.ok(!nav.includes('Planner'), 'families do not plan');
});
await step('a username is taken: the new account picks another one on the next screen', async () => {
  const dup = await person();
  await signUp(dup, { email: 'dup@example.com', kind: 'parent', username: 'yaman', name: 'Other Yaman', year: 2013 });
  await dup.getByTestId('profile-setup').waitFor();
  await dup.getByTestId('username-hint').getByText(/taken/).waitFor();
  assert.equal(await dup.getByTestId('setup-save').isDisabled(), true);
  await dup.fill('#sb-username', 'yaman.b');
  await dup.getByTestId('username-hint').getByText(/Available/).waitFor();
  await dup.getByTestId('setup-save').click();
  await dup.getByText('Other Yaman').first().waitFor();
  assert.equal(mock.profiles.get(idOf('dup@example.com')).username, 'yaman.b');
  await dup.close();
});

/* ---------- connecting ---------- */
await step('the coach searches "yam" in Players and sends Yaman a request (only families are listed)', async () => {
  await hamed.getByTestId('open-people').click();
  const m = dlg(hamed);
  await m.getByTestId('people-search-input').fill('far');
  await m.getByTestId('no-results').waitFor();
  await m.getByTestId('people-search-input').fill('yam');
  await m.getByTestId('hit-yaman').waitFor();
  await m.getByTestId('hit-yaman.b').waitFor();
  await m.getByTestId('request-yaman').click();
  await hamed.getByText(/Request sent to/).first().waitFor();
  await m.getByTestId('hit-yaman').getByText('Request sent').waitFor();
  await m.getByTestId('req-out-yaman').waitFor();
  const c = mock.connections.get(`${idOf('hamed@example.com')}|${idOf('yaman@example.com')}`);
  assert.equal(c.status, 'pending');
  assert.equal(c.requested_by, 'coach');
  await hamed.keyboard.press('Escape');
});
await step('the family sees the request (badge and dashboard) and accepts it', async () => {
  await yaman.reload();
  await yaman.getByTestId('requests-count').getByText('1').waitFor();
  await yaman.getByTestId('req-in-hamed').getByText(/wants to be your coach/).waitFor();
  await yaman.getByTestId('accept-hamed').click();
  await yaman.getByText(/Connected with/).first().waitFor();
  await yaman.getByTestId('requests-count').waitFor({ state: 'detached' });
  await yaman.getByTestId('find-coach-card').waitFor({ state: 'detached' });
  assert.equal(mock.connections.get(`${idOf('hamed@example.com')}|${idOf('yaman@example.com')}`).status, 'accepted');
});
await step('the coach gets the player without reloading, and builds a plan; the family sees it', async () => {
  await hamed.getByText('Yaman Rad').first().waitFor({ timeout: 15000 });
  await hamed.goto(URL_ + '#planner');
  await hamed.getByTestId('generate-plan').click();
  await hamed.getByTestId('save-plan').click();
  for (let i = 0; i < 50 && !docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === idOf('yaman@example.com')).length; i++) await hamed.waitForTimeout(200);
  await yaman.goto(URL_ + '#dashboard');
  await yaman.getByText(/0 of 10 sessions completed/).waitFor({ timeout: 15000 });
});
const alya = await person();
await step('another family finds the coach under "My coaches"; the coach accepts in Players', async () => {
  await signUp(alya, { email: 'alya@example.com', kind: 'parent', username: 'alya', name: 'Alya Moradi', year: 2012 });
  await alya.getByTestId('find-coach-card').waitFor();
  await alya.getByTestId('open-coaches').click();
  const am = dlg(alya);
  await am.getByTestId('no-coach').waitFor();
  await am.getByTestId('people-search-input').fill('yam');
  await am.getByTestId('no-results').waitFor();
  await am.getByTestId('people-search-input').fill('Hamed K');
  await am.getByTestId('request-hamed').click();
  await am.getByTestId('req-out-hamed').waitFor();
  await alya.keyboard.press('Escape');
  await hamed.goto(URL_ + '#dashboard');
  await hamed.reload();
  await hamed.getByTestId('requests-count').getByText('1').waitFor();
  await hamed.getByTestId('open-people').click();
  await dlg(hamed).getByTestId('req-in-alya').getByText(/wants to be your player/).waitFor();
  await dlg(hamed).getByTestId('accept-alya').click();
  await hamed.getByText(/Connected with/).first().waitFor();
  await hamed.keyboard.press('Escape');
  await hamed.waitForFunction(() => document.querySelectorAll('#player-select option').length === 2, null, { timeout: 15000 });
  assert.deepEqual((await players(hamed)).sort(), ['Alya Moradi', 'Yaman Rad']);
  await alya.reload();
  await alya.getByTestId('open-coaches').click();
  await dlg(alya).getByTestId('coach-hamed').waitFor();
  await alya.keyboard.press('Escape');
});
const reza = await person();
await step('a coach who is not connected sees none of these players and cannot write to them', async () => {
  await signUp(reza, { email: 'reza@example.com', kind: 'coach', username: 'reza', name: 'Reza Coach' });
  await reza.getByTestId('find-players-card').waitFor();
  const r = mock.as('reza@example.com');
  assert.deepEqual(r.read().filter((p) => p.startsWith('academy/data/')), []);
  const yid = idOf('yaman@example.com');
  assert.equal(r.canInsert('academy/data/plans/x1', { id: 'x1', playerId: yid }), false);
  assert.equal(r.canUpdate(`academy/data/players/${yid}`, { ...mock.docs.get(`academy/data/players/${yid}`).data, goals: 'x' }), false);
  // Families read their own player only and write nothing directly.
  const y = mock.as('yaman@example.com');
  assert.ok(y.read().every((p) => !p.startsWith('academy/data/') || p.endsWith(yid) || mock.docs.get(p).data.playerId === yid));
  assert.equal(y.read().includes(`academy/data/players/${idOf('alya@example.com')}`), false);
  assert.equal(y.canInsert('academy/data/plans/x2', { id: 'x2', playerId: yid }), false);
  assert.equal(y.rpc('family_save_match', { p_match: { id: 'm-x', playerId: idOf('alya@example.com'), points: [] } }).error, 'not_linked');
});

/* ---------- a player without an account, linked later ---------- */
let saraOffline;
await step('the coach adds a player without an account: only that coach sees it', async () => {
  await hamed.getByTestId('open-people').click();
  await dlg(hamed).getByTestId('open-add-player').click();
  await dlg(hamed).getByText(/Only you see a player without an account/).waitFor();
  await dlg(hamed).locator('[id^="pl-name-"]').fill('Sara Offline');
  await dlg(hamed).getByTestId('save-player').click();
  await dlg(hamed).getByText('Sara Offline').first().waitFor();
  for (let i = 0; i < 50 && !saraOffline; i++) {
    saraOffline = docsOf((d) => d.path.startsWith('academy/data/players/') && d.data.name === 'Sara Offline')[0];
    if (!saraOffline) await hamed.waitForTimeout(200);
  }
  assert.equal(saraOffline.data.ownerId, idOf('hamed@example.com'));
  assert.equal(mock.as('reza@example.com').read().includes(saraOffline.path), false);
  assert.ok(mock.as(OWNER).read().includes(saraOffline.path), 'the admin sees everything');
  await hamed.keyboard.press('Escape');
  await hamed.goto(URL_ + '#planner');
  await hamed.getByTestId('generate-plan').click();
  await hamed.getByTestId('save-plan').click();
  for (let i = 0; i < 50 && !docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === saraOffline.data.id).length; i++) await hamed.waitForTimeout(200);
  assert.equal(docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === saraOffline.data.id).length, 1);
});
const sara = await person();
await step('the family creates an account; the coach connects and links the player: everything moves over', async () => {
  await signUp(sara, { email: 'sara@example.com', kind: 'parent', username: 'sara.k', name: 'Sara Kamali', year: 2015 });
  await sara.getByTestId('find-coach-card').waitFor();
  await hamed.goto(URL_ + '#dashboard');
  await hamed.getByTestId('open-people').click();
  await dlg(hamed).getByTestId('people-search-input').fill('sara');
  await dlg(hamed).getByTestId('request-sara.k').click();
  await dlg(hamed).getByTestId('req-out-sara.k').waitFor();
  await sara.reload();
  await sara.getByTestId('accept-hamed').click();
  await sara.getByText(/Connected with/).first().waitFor();
  const sid = idOf('sara@example.com');
  await hamed.waitForFunction(() => document.querySelectorAll('[data-testid^="player-row-"]').length === 4, null, { timeout: 15000 });
  await dlg(hamed).getByTestId(`link-${saraOffline.data.id}`).click();
  await dlg(hamed).locator(`#link-${saraOffline.data.id}`).selectOption(sid);
  await dlg(hamed).getByRole('button', { name: 'Link and move everything' }).click();
  await dlg(hamed).getByRole('button', { name: 'Move everything?' }).click();
  await hamed.getByText(/Linked: 1 records moved to/).waitFor();
  await hamed.getByTestId(`player-row-${saraOffline.data.id}`).waitFor({ state: 'detached', timeout: 15000 });
  assert.equal(mock.docs.get(saraOffline.path).data.archived, true);
  assert.equal(docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === sid).length, 1);
  await hamed.keyboard.press('Escape');
  await sara.goto(URL_ + '#dashboard');
  await sara.getByText(/0 of 10 sessions completed/).waitFor({ timeout: 15000 });
});

/* ---------- live score both ways ---------- */
await step('the coach charts a match; the family follows the live score', async () => {
  await hamed.goto(URL_ + '#dashboard');
  await hamed.locator('#player-select').selectOption(idOf('yaman@example.com'));
  await hamed.goto(URL_ + '#newmatch');
  await hamed.fill('#m-opponent', 'Live Opp');
  await hamed.getByTestId('match-submit').click();
  await hamed.getByTestId('scoreboard').waitFor();
  for (let i = 0; i < 2; i++) {
    await hamed.getByTestId('p-stroke-fh').click();
    await hamed.getByTestId('p-winner').click();
  }
  await yaman.goto(URL_ + '#matches');
  await yaman.getByTestId('live-banner').filter({ hasText: 'Live Opp' }).click({ timeout: 15000 });
  await yaman.getByTestId('scoreboard').waitFor();
  await yaman.getByTestId('points-p').getByText('30').waitFor({ timeout: 15000 });
  assert.equal(await yaman.getByTestId('point-composer').count(), 0, 'the coach is scoring; the family follows');
  await hamed.getByTestId('p-stroke-fh').click();
  await hamed.getByTestId('p-winner').click();
  await yaman.getByTestId('points-p').getByText('40').waitFor({ timeout: 15000 });
});
await step('the family charts their own match; the coach follows it live', async () => {
  await yaman.goto(URL_ + '#matches');
  await yaman.getByTestId('new-match').click();
  await yaman.fill('#m-opponent', 'Family Opp');
  await yaman.getByTestId('match-submit').click();
  await yaman.getByTestId('point-composer').waitFor();
  await yaman.getByTestId('p-stroke-fh').click();
  await yaman.getByTestId('p-winner').click();
  await hamed.goto(URL_ + '#matches');
  await hamed.getByTestId('live-banner').filter({ hasText: 'Family Opp' }).click({ timeout: 15000 });
  await hamed.getByTestId('points-p').getByText('15').waitFor({ timeout: 15000 });
  const m = docsOf((d) => d.path.startsWith('academy/data/matches/') && d.data.opponent === 'Family Opp')[0];
  assert.equal(m.data.scorerRole, 'parent');
  assert.equal(m.data.playerId, idOf('yaman@example.com'));
});

/* ---------- disconnecting ---------- */
await step('the family disconnects: the coach loses the player at once (nothing is deleted)', async () => {
  const before = docsOf((d) => d.data?.playerId === idOf('yaman@example.com')).length;
  await yaman.goto(URL_ + '#dashboard');
  await yaman.getByTestId('open-coaches').click();
  await dlg(yaman).getByTestId('coach-hamed').getByRole('button', { name: 'Disconnect' }).click();
  await dlg(yaman).getByTestId('coach-hamed').getByRole('button', { name: 'Disconnect?' }).click();
  await yaman.getByText(/Disconnected from/).first().waitFor();
  await dlg(yaman).getByTestId('no-coach').waitFor();
  await yaman.keyboard.press('Escape');
  await hamed.goto(URL_ + '#dashboard');
  await hamed.waitForFunction(() => ![...document.querySelectorAll('#player-select option')].some((o) => o.textContent === 'Yaman Rad'), null, { timeout: 15000 });
  assert.equal(mock.as('hamed@example.com').read().some((p) => p.endsWith(idOf('yaman@example.com'))), false);
  assert.equal(docsOf((d) => d.data?.playerId === idOf('yaman@example.com')).length, before, 'the family keeps everything');
  await yaman.getByText(/0 of 10 sessions completed/).waitFor();
});

/* ---------- admin ---------- */
await step('the admin sees every member and every player', async () => {
  await owner.goto(URL_ + '#admin');
  await owner.getByTestId('members-panel').waitFor();
  for (const u of ['farhang', 'hamed', 'reza', 'yaman', 'yaman.b', 'alya', 'sara.k']) await owner.getByTestId(`member-${u}`).waitFor();
  await owner.getByText('3 coaches · 4 families').waitFor();
  await owner.goto(URL_ + '#dashboard');
  await owner.waitForFunction(() => document.querySelectorAll('#player-select option').length === 4, null, { timeout: 15000 });
});
await step('subscriptions on: a family without a plan sees Pro drills locked; the admin gives a Family plan', async () => {
  const planned = new Set(docsOf((d) => d.path.startsWith('academy/data/plans/')).flatMap((d) => d.data.sessions.flatMap((x) => x.items.map((i) => i.drillId))));
  const pro = ['fh-004', 'fh-005', 'fh-008'].find((id) => !planned.has(id));
  await owner.goto(URL_ + '#admin');
  await owner.getByTestId('paywall-toggle').click();
  for (let i = 0; i < 50 && !mock.docs.get('academy/config')?.data.paywall; i++) await owner.waitForTimeout(200);
  assert.ok(mock.docs.get('academy/config').data.paywall, 'academy setting saved');
  await alya.goto(URL_ + '#drill-' + pro);
  await alya.reload();
  await alya.getByTestId('pro-card').waitFor({ timeout: 15000 });
  const aid = idOf('alya@example.com');
  await owner.getByTestId(`plan-${aid}`).selectOption('year');
  await owner.getByTestId(`plan-status-${aid}`).getByText(/Family plan until/).waitFor();
  assert.equal(mock.subs.get(aid).plan, 'family');
  await alya.reload();
  await alya.getByTestId('drill-title').waitFor();
  assert.equal(await alya.getByTestId('pro-card').count(), 0, 'the Family plan opens Pro drills');
  await owner.getByTestId('paywall-toggle').click();
});

/* ---------- older accounts and sign-in screens ---------- */
await step('an account made before usernames chooses one at its next sign-in', async () => {
  await fetch('http://localhost:4300/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'old@example.com', password: 'password123' }) });
  const old = await person();
  await old.fill('#sb-email', 'old@example.com');
  await old.fill('#sb-password', 'password123');
  await old.getByTestId('sign-in').click();
  await old.getByTestId('profile-setup').waitFor();
  await old.getByTestId('setup-kind-family').click();
  await old.fill('#sb-username', 'hamed');
  await old.getByTestId('username-hint').getByText(/taken/).waitFor();
  await old.fill('#sb-username', 'oldparent');
  await old.fill('#sb-name', 'Old Player');
  await old.getByTestId('username-hint').getByText(/Available/).waitFor();
  await old.getByTestId('setup-save').click();
  await old.getByTestId('find-coach-card').waitFor();
  assert.ok(mock.docs.has(`academy/data/players/${idOf('old@example.com')}`));
});
await step('wrong password shows a clear message', async () => {
  const p = await person();
  await p.fill('#sb-email', OWNER);
  await p.fill('#sb-password', 'wrongpassword');
  await p.getByTestId('sign-in').click();
  await p.getByTestId('auth-message').getByText(/Wrong email or password/).waitFor();
});
await step('confirmation link opens a welcome page, then the app', async () => {
  const s = mock.linkFor('hamed@example.com');
  const p = await person(`${URL_}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_at=${s.expires_at}&type=signup`);
  await p.getByTestId('welcome').getByText('Congratulations').waitFor();
  await p.getByRole('button', { name: 'Open the app' }).click();
  await hasPlayer(p, 'Alya Moradi');
});
await step('reset link asks for a new password, which then works for sign-in', async () => {
  const s = mock.linkFor('alya@example.com');
  const p = await person(`${URL_}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_at=${s.expires_at}&type=recovery`);
  await p.fill('#sb-newpass', 'newpassword9');
  await p.getByTestId('save-new-password').click();
  await p.getByText('Alya Moradi').first().waitFor();
  const q = await person();
  await signIn(q, 'alya@example.com', 'newpassword9');
  await q.getByText('Alya Moradi').first().waitFor();
});
await step('an expired email link shows a helpful message', async () => {
  const p = await person(`${URL_}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`);
  await p.getByTestId('auth-message').getByText(/expired/).waitFor();
});
await step('a coach changes the password; the new one works, the old one does not', async () => {
  await hamed.goto(URL_ + '#dashboard');
  await hamed.getByTestId('change-password').click();
  await hamed.getByTestId('new-password').fill('12345678');
  await hamed.getByText(/At least 10 characters/).waitFor();
  assert.equal(await hamed.getByTestId('save-password').isDisabled(), true, 'a weak password is refused');
  await hamed.getByTestId('new-password').fill('Grass-court-77');
  await hamed.getByTestId('new-password-again').fill('Grass-court-77');
  await hamed.getByTestId('save-password').click();
  await hamed.getByText('Password changed').waitFor();
  const again = await person();
  await again.fill('#sb-email', 'hamed@example.com');
  await again.fill('#sb-password', 'password123');
  await again.getByTestId('sign-in').click();
  await again.getByTestId('auth-message').getByText(/Wrong email or password/).waitFor();
  await signIn(again, 'hamed@example.com', 'Grass-court-77');
  await hasPlayer(again, 'Alya Moradi');
});
await step('a family deletes the account inside the app: their player, data and connections go', async () => {
  const id = idOf('sara@example.com');
  await sara.goto(URL_ + '#dashboard');
  await sara.getByTestId('delete-account').click();
  await sara.fill('[data-testid="delete-confirm-input"]', 'DELETE');
  await sara.getByTestId('delete-account-confirm').click();
  await sara.getByText('Your account has been deleted.').waitFor();
  assert.equal(mock.users.has('sara@example.com'), false);
  assert.equal(mock.docs.has(`academy/data/players/${id}`), false);
  assert.equal(docsOf((d) => d.data?.playerId === id).length, 0);
  assert.equal([...mock.connections.values()].some((c) => c.family_id === id), false);
  assert.equal(mock.profiles.has(id), false);
});
await step('a coach deletes the account: their players without an account go, connected families keep everything', async () => {
  const id = idOf('reza@example.com');
  await reza.goto(URL_ + '#dashboard');
  await reza.reload();
  await reza.locator('[id^="pl-name-"]').fill('Reza Kid');
  await reza.getByTestId('save-player').click();
  await reza.getByText('Build a 10-session plan').waitFor();
  await reza.goto(URL_ + '#planner');
  await reza.getByTestId('generate-plan').click();
  await reza.getByTestId('save-plan').click();
  let kid;
  for (let i = 0; i < 50 && !(kid && docsOf((d) => d.data?.playerId === kid.data.id).length); i++) {
    kid = docsOf((d) => d.path.startsWith('academy/data/players/') && d.data.name === 'Reza Kid')[0];
    await reza.waitForTimeout(200);
  }
  const others = docsOf((d) => d.path.startsWith('academy/data/') && d.data?.ownerId !== id && d.data?.playerId !== kid.data.id).length;
  await reza.goto(URL_ + '#dashboard');
  await reza.getByTestId('delete-account').click();
  await reza.fill('[data-testid="delete-confirm-input"]', 'DELETE');
  await reza.getByTestId('delete-account-confirm').click();
  await reza.getByText('Your account has been deleted.').waitFor();
  assert.equal(mock.users.has('reza@example.com'), false);
  assert.equal(mock.profiles.has(id), false);
  assert.equal(mock.docs.has(kid.path), false, 'the player without an account is gone');
  assert.equal(docsOf((d) => d.data?.playerId === kid.data.id).length, 0, 'and its plan');
  assert.equal(docsOf((d) => d.path.startsWith('academy/data/')).length, others, 'nothing else was touched');
});
await step('the only admin cannot delete their account', async () => {
  await owner.goto(URL_ + '#dashboard');
  await owner.getByTestId('delete-account').click();
  await owner.fill('[data-testid="delete-confirm-input"]', 'DELETE');
  await owner.getByTestId('delete-account-confirm').click();
  await owner.getByText(/only admin/).waitFor();
  assert.ok(mock.users.has(OWNER));
  await owner.keyboard.press('Escape');
});
console.log(`\n${passed} passed`);
await browser.close();
mock.server.close();
site.close();
