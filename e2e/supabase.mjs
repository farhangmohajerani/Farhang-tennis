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
/** kind: 'coach' | 'parent' (the family button). Accepts the privacy notice (and the guardian line for a family). */
async function signUp(page, { email, kind, username, name, year, discoverable }) {
  await page.getByTestId('tab-up').click();
  await page.getByTestId(`kind-${kind}`).click();
  await page.fill('#sb-username', username);
  await page.fill('#sb-name', name);
  if (year) await page.fill('#sb-birthyear', String(year));
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('consent-privacy').check();
  if (kind === 'parent') await page.getByTestId('consent-guardian').check();
  if (discoverable) await page.getByTestId('consent-discoverable').check();
  await page.getByTestId('sign-up').click();
}
/** A fake device registered for notifications (the push service itself is not called in tests). */
const P256 = 'B' + 'A'.repeat(86);
const AUTH = 'C'.repeat(22);
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
await step('nothing is made before the privacy notice is accepted; the notice opens from the form', async () => {
  await owner.fill('#sb-username', 'farhang');
  await owner.fill('#sb-name', 'Farhang');
  assert.equal(await owner.getByTestId('sign-up').isDisabled(), true, 'privacy notice not accepted yet');
  assert.equal(await owner.getByTestId('consent-guardian').count(), 0, 'coaches are not asked the guardian line');
  await owner.getByTestId('open-privacy').click();
  await owner.getByTestId('privacy-notice').getByText('Who can see it').waitFor();
  await owner.getByTestId('privacy-close').click();
  assert.equal(await owner.getByTestId('consent-privacy').isChecked(), false, 'reading the notice does not tick the box');
  await owner.getByTestId('consent-privacy').check();
  assert.equal(mock.users.size, 0);
});
await step('the owner signs up with username @farhang and becomes the admin (who also works as a coach)', async () => {
  await owner.getByTestId('sign-up').click();
  await owner.getByTestId('find-players-card').waitFor();
  assert.equal(await owner.locator('#role-select option').count(), 3);
  assert.equal(mock.staff.get(idOf(OWNER))?.role, 'admin');
  assert.equal(mock.profiles.get(idOf(OWNER))?.username, 'farhang');
  assert.ok(mock.profiles.get(idOf(OWNER))?.consent_at, 'consent recorded');
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
await step('a family must confirm a parent or guardian makes the account', async () => {
  await yaman.getByTestId('tab-up').click();
  await yaman.getByTestId('kind-parent').click();
  await yaman.fill('#sb-username', 'yaman');
  await yaman.fill('#sb-name', 'Yaman Rad');
  await yaman.fill('#sb-birthyear', '2014');
  await yaman.fill('#sb-email', 'yaman@example.com');
  await yaman.fill('#sb-password', 'password123');
  await yaman.getByTestId('consent-privacy').check();
  assert.equal(await yaman.getByTestId('sign-up').isDisabled(), true, 'guardian line not ticked');
  assert.equal(await yaman.getByTestId('consent-discoverable').isChecked(), false, 'not findable by name unless chosen');
  await yaman.getByTestId('tab-in').click();
  assert.equal(mock.users.size, 2);
});
await step('a family signs up: one account = one player, created at once, with a simple home', async () => {
  await yaman.reload();
  await signUp(yaman, { email: 'yaman@example.com', kind: 'parent', username: 'yaman', name: 'Yaman Rad', year: 2014 });
  await yaman.getByTestId('family-home').waitFor();
  await yaman.getByTestId('find-coach-card').waitFor();
  await yaman.getByTestId('guide').getByText('Connect with your coach').waitFor();
  await yaman.getByText('Yaman Rad').first().waitFor();
  const id = idOf('yaman@example.com');
  const doc = mock.docs.get(`academy/data/players/${id}`);
  assert.equal(doc.data.birthYear, 2014);
  assert.equal(doc.data.username, 'yaman');
  assert.equal(doc.data.accountId, id);
  assert.equal(doc.data.aiConsent, false, 'AI analysis is off until the family allows it');
  const prof = mock.profiles.get(id);
  assert.equal(prof.guardian, true);
  assert.equal(prof.discoverable, false);
  const nav = await yaman.locator('nav[aria-label="Main mobile"]').innerText();
  assert.ok(!nav.includes('Planner'), 'families do not plan');
  assert.ok(nav.includes('Home') && nav.includes('Plan'), 'family labels');
  assert.equal(await yaman.locator('#role-select').count(), 0, 'one role: no role picker');
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
await step('families are private: a coach finds Yaman only by the exact username, then sends a request', async () => {
  await hamed.getByTestId('open-people').click();
  const m = dlg(hamed);
  await m.getByTestId('people-search-input').fill('far');
  await m.getByTestId('no-results').waitFor();
  await m.getByTestId('people-search-input').fill('yam');
  await m.getByTestId('no-results').waitFor();
  await m.getByTestId('people-search-input').fill('Yaman R');
  await m.getByTestId('no-results').waitFor();
  await m.getByTestId('people-search-input').fill('yaman');
  await m.getByTestId('hit-yaman').waitFor();
  assert.equal(await m.getByTestId('hit-yaman.b').count(), 0, 'yaman.b is not findable by a prefix');
  await m.getByText(/The family approves your request/).waitFor();
  await m.getByTestId('request-yaman').click();
  await hamed.getByText(/Request sent to/).first().waitFor();
  await m.getByTestId('hit-yaman').getByText('Request sent').waitFor();
  await m.getByTestId('req-out-yaman').waitFor();
  const c = mock.connections.get(`${idOf('hamed@example.com')}|${idOf('yaman@example.com')}`);
  assert.equal(c.status, 'pending');
  assert.equal(c.requested_by, 'coach');
  await hamed.keyboard.press('Escape');
});
await step('the family sees the request and first reads exactly what the coach may do, then allows it', async () => {
  await yaman.reload();
  await yaman.getByTestId('requests-count').getByText('1').waitFor();
  await yaman.getByTestId('req-in-hamed').getByText(/wants to be your coach/).waitFor();
  await yaman.getByTestId('accept-hamed').click();
  const sheet = yaman.getByTestId('allow-sheet');
  await sheet.getByText(/See Yaman Rad’s profile, training plans/).waitFor();
  await sheet.getByText('Your email address and password').waitFor();
  assert.equal(await sheet.getByTestId('allow-ai').isChecked(), false, 'AI analysis is off by default');
  await yaman.getByTestId('allow-cancel').click();
  assert.equal(mock.connections.get(`${idOf('hamed@example.com')}|${idOf('yaman@example.com')}`).status, 'pending', '"Not now" changes nothing');
  await yaman.getByTestId('accept-hamed').click();
  await yaman.getByTestId('allow-ai').check();
  await yaman.getByTestId('allow-confirm').click();
  await yaman.getByText(/Connected with/).first().waitFor();
  assert.equal(mock.docs.get(`academy/data/players/${idOf('yaman@example.com')}`).data.aiConsent, true, 'AI analysis allowed with it');
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
  const plan = docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === idOf('yaman@example.com'))[0];
  assert.equal(plan.data.createdBy, idOf('hamed@example.com'), 'the plan records who made it');
  assert.equal(plan.data.createdByName, 'Hamed Karimi');
  await yaman.goto(URL_ + '#dashboard');
  await yaman.getByTestId('family-next').getByTestId('next-session-title').waitFor({ timeout: 15000 });
  await yaman.getByTestId('family-coaches').getByText('Hamed Karimi').waitFor();
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
  await alya.getByTestId('allow-sheet').getByText(/Once connected, Hamed Karimi can/).waitFor();
  await alya.getByTestId('allow-confirm').click();
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
await step('the family creates an account (findable by name, by choice); the coach finds and connects', async () => {
  await signUp(sara, { email: 'sara@example.com', kind: 'parent', username: 'sara.k', name: 'Sara Kamali', year: 2015, discoverable: true });
  await sara.getByTestId('find-coach-card').waitFor();
  assert.equal(mock.profiles.get(idOf('sara@example.com')).discoverable, true);
  await hamed.goto(URL_ + '#dashboard');
  await hamed.getByTestId('open-people').click();
  await dlg(hamed).getByTestId('people-search-input').fill('Sara K');
  await dlg(hamed).getByTestId('request-sara.k').click();
  await dlg(hamed).getByTestId('req-out-sara.k').waitFor();
  await sara.reload();
  await sara.getByTestId('accept-hamed').click();
  await sara.getByTestId('allow-confirm').click();
  await sara.getByText(/Connected with/).first().waitFor();
});
await step('moving a player without an account needs the family’s yes: the coach asks, the family allows', async () => {
  const sid = idOf('sara@example.com');
  await hamed.waitForFunction(() => document.querySelectorAll('[data-testid^="player-row-"]').length === 4, null, { timeout: 15000 });
  await dlg(hamed).getByTestId(`link-${saraOffline.data.id}`).click();
  await dlg(hamed).locator(`#link-${saraOffline.data.id}`).selectOption(sid);
  await dlg(hamed).getByRole('button', { name: 'Ask the family' }).click();
  await dlg(hamed).getByRole('button', { name: 'Send the request?' }).click();
  await hamed.getByText(/Request sent — /).first().waitFor();
  await dlg(hamed).getByTestId(`link-pending-${saraOffline.data.id}`).waitFor();
  assert.equal(mock.docs.get(saraOffline.path).data.archived, undefined, 'nothing moved yet');
  assert.equal(mock.as('hamed@example.com').rpc('merge_offline_player', { p_offline: saraOffline.data.id, p_username: 'sara.k' }).error, 'not_allowed', 'a coach cannot move it directly');
  await sara.reload();
  await sara.getByTestId('requests-count').getByText('1').waitFor();
  const card = sara.getByTestId('link-requests');
  await card.getByText(/kept records for “Sara Offline”/).waitFor();
  await card.getByRole('button', { name: 'Allow and add' }).click();
  await sara.getByText(/Done: 1 records moved into your account/).waitFor();
  await hamed.getByTestId(`player-row-${saraOffline.data.id}`).waitFor({ state: 'detached', timeout: 15000 });
  assert.equal(mock.docs.get(saraOffline.path).data.archived, true);
  assert.equal(docsOf((d) => d.path.startsWith('academy/data/plans/') && d.data.playerId === sid).length, 1);
  await hamed.keyboard.press('Escape');
  await sara.goto(URL_ + '#dashboard');
  await sara.getByTestId('family-next').getByTestId('next-session-title').waitFor({ timeout: 15000 });
});

/* ---------- live score both ways ---------- */
await step('the coach starts a live match: the family gets one notification and an in-app "follow live?"', async () => {
  // Yaman's phone registered for notifications (Settings → Turn on).
  assert.deepEqual(mock.as('yaman@example.com').rpc('save_push_subscription', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/yaman-phone', p_p256dh: P256, p_auth: AUTH, p_lang: 'en', p_user_agent: 'test' }), { ok: true });
  assert.equal(mock.as('yaman@example.com').rpc('save_push_subscription', { p_endpoint: 'http://insecure', p_p256dh: P256, p_auth: AUTH, p_lang: 'en', p_user_agent: '' }).error, 'bad_subscription');
  assert.equal(mock.as('yaman@example.com').rpc('save_push_subscription', { p_endpoint: 'https://evil.example.com/hook', p_p256dh: P256, p_auth: AUTH, p_lang: 'en', p_user_agent: '' }).error, 'bad_subscription', 'only real push services');
  await yaman.goto(URL_ + '#dashboard');
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
  for (let i = 0; i < 50 && !mock.pushes.length; i++) await hamed.waitForTimeout(200);
  assert.equal(mock.pushes.length, 1, 'one notification, however many points are saved');
  assert.equal(mock.pushes[0].endpoint, 'https://fcm.googleapis.com/fcm/send/yaman-phone');
  assert.match(mock.pushes[0].message.title, /Yaman Rad’s match has started/);
  assert.match(mock.pushes[0].message.body, /vs Live Opp · Hamed Karimi is keeping score/);
  assert.match(mock.pushes[0].message.url, /^https:\/\/example\.com\/app\/#match-/, 'opens the app’s own address');
  assert.equal(mock.pushes[0].vapidPublic, mock.appKeys.get('vapid_public')?.value, 'signed with the key pair the server made and kept');
  assert.equal(mock.pushes[0].subject, 'https://example.com/app/');
  assert.equal(mock.appKeys.get('vapid_private')?.value.length, 43, 'the private key stays on the server (P-256 scalar)');
  const alert = yaman.getByTestId('live-alert');
  await alert.getByText('vs Live Opp').waitFor({ timeout: 15000 });
  await yaman.getByTestId('live-alert-follow').click();
  await yaman.getByTestId('scoreboard').waitFor();
  await yaman.getByTestId('points-p').getByText('30').waitFor({ timeout: 15000 });
  assert.equal(await yaman.getByTestId('point-composer').count(), 0, 'the coach is scoring; the family follows');
  await hamed.getByTestId('p-stroke-fh').click();
  await hamed.getByTestId('p-winner').click();
  await yaman.getByTestId('points-p').getByText('40').waitFor({ timeout: 15000 });
});
await step('the family charts their own match; the coach is alerted and follows it live (the admin is not)', async () => {
  await hamed.goto(URL_ + '#dashboard');
  await owner.goto(URL_ + '#dashboard');
  await yaman.goto(URL_ + '#matches');
  await yaman.getByTestId('new-match').click();
  await yaman.fill('#m-opponent', 'Family Opp');
  await yaman.getByTestId('match-submit').click();
  await yaman.getByTestId('point-composer').waitFor();
  await yaman.getByTestId('p-stroke-fh').click();
  await yaman.getByTestId('p-winner').click();
  await hamed.getByTestId('live-alert').getByText('vs Family Opp').waitFor({ timeout: 15000 });
  await hamed.getByTestId('live-alert').getByText('The family is keeping score').waitFor();
  await hamed.getByTestId('live-alert-follow').click();
  await hamed.getByTestId('points-p').getByText('15').waitFor({ timeout: 15000 });
  const m = docsOf((d) => d.path.startsWith('academy/data/matches/') && d.data.opponent === 'Family Opp')[0];
  assert.equal(m.data.scorerRole, 'parent');
  assert.equal(m.data.playerId, idOf('yaman@example.com'));
  assert.equal(m.data.createdBy, idOf('yaman@example.com'));
  assert.ok(mock.matchNotes.has(m.data.id), 'announced once (the coach has no device registered)');
  await owner.waitForTimeout(800);
  assert.equal(await owner.getByTestId('live-alert').count(), 0, 'the admin is not connected to Yaman');
});
await step('the family removes the match it charted; it disappears for the coach too', async () => {
  const m = docsOf((d) => d.path.startsWith('academy/data/matches/') && d.data.opponent === 'Family Opp')[0];
  await yaman.goto(URL_ + `#match-${m.data.id}`);
  await yaman.getByTestId('finish-early').click();
  await yaman.getByTestId('reason-retired').check();
  await yaman.getByTestId('finish-winner-p').check();
  await yaman.getByTestId('confirm-finish').click();
  await yaman.getByTestId('final-score').waitFor();
  await yaman.getByRole('button', { name: 'Delete match' }).click({ timeout: 15000 });
  await yaman.getByRole('button', { name: 'Delete match?' }).click();
  await yaman.getByText('Match deleted').first().waitFor();
  assert.ok(mock.docs.get(m.path).data.deletedAt, 'hidden, not erased');
  await hamed.goto(URL_ + '#matches');
  await hamed.waitForTimeout(6000);
  assert.equal(await hamed.getByText('Family Opp').count(), 0);
  assert.equal(mock.as('yaman@example.com').rpc('family_delete_match', { p_id: docsOf((d) => d.path.startsWith('academy/data/matches/') && d.data.opponent === 'Live Opp')[0].data.id }).error, 'not_found', 'not the coach’s match');
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
  await yaman.getByTestId('family-next').getByTestId('next-session-title').waitFor();
});
await step('after a family said no, the same coach can ask again only after 30 days', async () => {
  await hamed.getByTestId('open-people').click();
  await dlg(hamed).getByTestId('people-search-input').fill('yaman');
  await dlg(hamed).getByTestId('request-yaman').click();
  await hamed.getByText(/They said no recently. You can ask again from/).first().waitFor();
  assert.equal(mock.connections.get(`${idOf('hamed@example.com')}|${idOf('yaman@example.com')}`).status, 'removed');
  await hamed.keyboard.press('Escape');
});
await step('Settings: the family changes its name and username, turns on being found by name', async () => {
  await yaman.goto(URL_ + '#dashboard');
  await yaman.getByTestId('open-settings').click();
  const st = yaman.getByTestId('settings');
  await st.getByTestId('settings-name').fill('Yaman Rad-Ahmadi');
  await st.getByTestId('settings-save-name').click();
  await yaman.getByText('Saved.').first().waitFor();
  await st.getByTestId('settings-username').fill('alya');
  await st.getByText(/This username is taken/).waitFor();
  assert.equal(await st.getByTestId('settings-save-username').isDisabled(), true);
  await st.getByTestId('settings-username').fill('yaman.rad');
  await st.getByText(/Available/).waitFor();
  await st.getByTestId('settings-save-username').click();
  await yaman.getByText(/Your username is now/).first().waitFor();
  await st.getByTestId('settings-discoverable').click();
  for (let i = 0; i < 25 && !mock.profiles.get(idOf('yaman@example.com')).discoverable; i++) await yaman.waitForTimeout(200);
  const prof = mock.profiles.get(idOf('yaman@example.com'));
  assert.equal(prof.username, 'yaman.rad');
  assert.equal(prof.display_name, 'Yaman Rad-Ahmadi');
  assert.equal(prof.discoverable, true);
  assert.equal(mock.docs.get(`academy/data/players/${idOf('yaman@example.com')}`).data.name, 'Yaman Rad-Ahmadi', 'the player shows the new name');
  assert.equal(await st.getByTestId('settings-ai').getAttribute('aria-checked'), 'true');
  await st.getByTestId('settings-notify').click();
  for (let i = 0; i < 25 && mock.profiles.get(idOf('yaman@example.com')).notify_live; i++) await yaman.waitForTimeout(200);
  assert.equal(mock.profiles.get(idOf('yaman@example.com')).notify_live, false, 'match alerts off');
  await st.getByTestId('settings-notify').click();
  await yaman.keyboard.press('Escape');
  const found = mock.as('reza@example.com').rpc('search_people', { p_query: 'Yaman R' });
  assert.deepEqual(found.map((h) => h.username), ['yaman.rad'], 'now findable by name');
});

/* ---------- admin ---------- */
await step('the admin sees every member and every player', async () => {
  await owner.goto(URL_ + '#admin');
  await owner.getByTestId('members-panel').waitFor();
  for (const u of ['farhang', 'hamed', 'reza', 'yaman.rad', 'yaman.b', 'alya', 'sara.k']) await owner.getByTestId(`member-${u}`).waitFor();
  await owner.getByText('3 coaches · 4 families').waitFor();
  await owner.goto(URL_ + '#dashboard');
  await owner.waitForFunction(() => document.querySelectorAll('#player-select option').length === 4, null, { timeout: 15000 });
});
await step('the admin verifies a coach: families see the badge', async () => {
  await owner.goto(URL_ + '#admin');
  await owner.getByTestId('verify-hamed').click();
  await owner.getByText(/is now verified/).first().waitFor();
  assert.equal(mock.profiles.get(idOf('hamed@example.com')).verified, true);
  assert.equal(await owner.getByTestId('block-farhang').count(), 0, 'staff cannot be paused');
  await alya.goto(URL_ + '#dashboard');
  await alya.reload();
  await alya.getByTestId('family-coaches').getByTestId('verified').waitFor({ timeout: 15000 });
});
await step('the admin pauses an account: it sees only a "paused" screen until resumed', async () => {
  await owner.getByTestId('block-reza').click();
  await owner.getByText(/is paused/).first().waitFor();
  await reza.reload();
  await reza.getByTestId('blocked').getByText('This account is paused').waitFor();
  assert.deepEqual(mock.as('alya@example.com').rpc('search_people', { p_query: 'reza' }), [], 'a paused coach is not listed');
  await owner.getByTestId('block-reza').click();
  await owner.getByText(/can use the app again/).first().waitFor();
  await reza.reload();
  await reza.getByTestId('find-players-card').waitFor();
});
await step('the admin deletes a member’s account from the list', async () => {
  const id = idOf('dup@example.com');
  await owner.getByTestId('member-yaman.b').getByRole('button', { name: 'Delete account' }).click();
  await owner.getByTestId('member-yaman.b').getByRole('button', { name: /Delete .*yaman\.b.* and all their data\?/ }).click();
  await owner.getByText(/was deleted/).first().waitFor();
  assert.equal(mock.users.has('dup@example.com'), false);
  assert.equal(mock.docs.has(`academy/data/players/${id}`), false);
  await owner.getByTestId('member-yaman.b').waitFor({ state: 'detached' });
});
await step('only whoever made a record deletes it (another coach of the same player cannot)', async () => {
  await fetch('http://localhost:4300/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'nima@example.com', password: 'password123' }) });
  const nima = mock.as('nima@example.com');
  assert.deepEqual(nima.rpc('register_profile_v2', { p_username: 'nima', p_display_name: 'Nima', p_kind: 'coach', p_birth_year: null, p_discoverable: true, p_guardian: false, p_consent: 'privacy-2026-11' }), { ok: true, username: 'nima' });
  const aid = idOf('alya@example.com');
  mock.connections.set(`${idOf('nima@example.com')}|${aid}`, { coach_id: idOf('nima@example.com'), family_id: aid, status: 'accepted', requested_by: 'family', created_at: new Date().toISOString(), responded_at: new Date().toISOString(), closed_by: null });
  const path = 'academy/data/tournaments/t-hamed';
  mock.docs.set(path, { path, parent: 'academy/data/tournaments', data: { id: 't-hamed', playerId: aid, createdBy: idOf('hamed@example.com') }, updated_at: new Date().toISOString() });
  assert.equal(nima.canDelete(path), false, 'another coach cannot delete it');
  assert.equal(mock.as('hamed@example.com').canDelete(path), true, 'its maker can');
  assert.equal(nima.canInsert('academy/data/plans/fake', { id: 'fake', playerId: aid, createdBy: idOf('hamed@example.com') }), false, 'nobody signs a record as someone else');
  assert.equal(nima.canInsert('academy/data/plans/ok', { id: 'ok', playerId: aid, createdBy: idOf('nima@example.com') }), true);
  mock.docs.delete(path);
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
  assert.equal(await old.getByTestId('setup-save').isDisabled(), true, 'consent first');
  await old.getByTestId('consent-privacy').check();
  await old.getByTestId('consent-guardian').check();
  await old.getByTestId('setup-save').click();
  await old.getByTestId('find-coach-card').waitFor();
  assert.ok(mock.docs.has(`academy/data/players/${idOf('old@example.com')}`));
});
await step('an account from before consent was asked accepts it once at the next sign-in', async () => {
  await fetch('http://localhost:4300/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'legacy@example.com', password: 'password123' }) });
  const lid = idOf('legacy@example.com');
  mock.profiles.set(lid, { user_id: lid, username: 'legacy', display_name: 'Legacy Kid', kind: 'family', created_at: new Date().toISOString(), discoverable: false, blocked: false, verified: false, notify_live: true, guardian: false, consent_version: null, consent_at: null });
  const p = await person();
  await p.fill('#sb-email', 'legacy@example.com');
  await p.fill('#sb-password', 'password123');
  await p.getByTestId('sign-in').click();
  await p.getByTestId('consent-gate').waitFor();
  assert.equal(await p.getByTestId('consent-accept').isDisabled(), true);
  await p.getByTestId('consent-privacy').check();
  await p.getByTestId('consent-guardian').check();
  await p.getByTestId('consent-accept').click();
  await p.getByTestId('family-home').waitFor();
  assert.ok(mock.profiles.get(lid).consent_at);
  assert.equal(mock.profiles.get(lid).guardian, true);
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
