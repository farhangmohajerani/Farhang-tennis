/**
 * Supabase-mode end-to-end test against e2e/mock-supabase.mjs.
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
async function person(url = URL_) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\./, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e));
  await page.goto(url);
  return page;
}
async function signUp(page, email, kind = 'parent') {
  await page.getByTestId('tab-up').click();
  await page.getByTestId(`kind-${kind}`).click();
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('sign-up').click();
  await page.locator('main').waitFor();
}

async function signUpRaw(page, email, kind) {
  await page.getByTestId('tab-up').click();
  await page.getByTestId(`kind-${kind}`).click();
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('sign-up').click();
}
const owner = await person();
await step('owner signs up and becomes admin', async () => {
  await signUp(owner, OWNER, 'coach');
  await owner.getByText('Add your first player').waitFor();
  assert.equal(await owner.locator('#role-select option').count(), 3);
  assert.equal(mock.staff.size, 1);
});
await step('owner adds a player and invites a coach', async () => {
  await owner.locator('[id^="pl-name-"]').fill('Alya');
  await owner.getByTestId('save-player').click();
  await owner.getByText('Build a 10-session plan').waitFor();
  await owner.goto(URL_ + '#admin');
  await owner.fill('#invite-email', 'coach@example.com');
  await owner.getByTestId('invite-coach').click();
  await owner.getByTestId('team-list').getByText('coach@example.com').waitFor();
  await owner.getByText(/Invited coach@example.com — code \d{6}/).waitFor();
  await owner.waitForFunction(() => /^\d{6}$/.test(document.querySelector('[data-testid="invite-code-coach@example.com"]')?.textContent?.trim() ?? ''));
  globalThis.coachCode = (await owner.getByTestId('invite-code-coach@example.com').innerText()).trim();
  assert.equal(globalThis.coachCode, mock.invites.get('coach@example.com').code);
});
const coach = await person();
await step('invited coach signs up with that email, types the invite code and sees the player', async () => {
  await signUpRaw(coach, 'coach@example.com', 'coach');
  await coach.getByTestId('pending-coach').waitFor();
  assert.equal(mock.staff.size, 1, 'the email alone gives no access');
  await coach.locator('#staff-code').fill('000000');
  await coach.getByTestId('staff-code-submit').click();
  await coach.getByTestId('staff-code-msg').getByText(/not right/).waitFor();
  await coach.locator('#staff-code').fill(globalThis.coachCode);
  await coach.getByTestId('staff-code-submit').click();
  await coach.getByText('Alya').first().waitFor();
  assert.equal(await coach.locator('#role-select option').count(), 2);
  assert.ok(mock.invites.get('coach@example.com').used_at, 'the invite is used up');
});
await step('someone who signs up with an invited email but has no code gets no access', async () => {
  await owner.fill('#invite-email', 'coach3@example.com');
  await owner.getByTestId('invite-coach').click();
  await owner.getByTestId('invite-code-coach3@example.com').waitFor();
  const squatter = await person();
  await signUpRaw(squatter, 'coach3@example.com', 'coach');
  await squatter.getByTestId('pending-coach').waitFor();
  await squatter.reload();
  await squatter.getByTestId('pending-coach').waitFor();
  assert.ok(![...mock.staff.values()].some((x) => x.email === 'coach3@example.com'), 'not staff');
  await squatter.close();
});
await step('coach builds a plan; owner sees it after the next poll', async () => {
  await coach.goto(URL_ + '#planner');
  await coach.getByTestId('generate-plan').click();
  await coach.getByTestId('save-plan').click();
  await owner.goto(URL_ + '#dashboard');
  await owner.getByText(/0 of 10 sessions completed/).waitFor({ timeout: 15000 });
});
await step('coach cannot change the drill library (blocked by rules)', async () => {
  assert.equal(await coach.locator('a[href="#admin"]').count(), 0);
});
const parent = await person();
let code;
await step('a parent signs up, sees only a connection code', async () => {
  await signUp(parent, 'parent@example.com');
  await parent.getByTestId('parent-connect').waitFor();
  await parent.waitForFunction(() => /^\d{6}$/.test(document.querySelector('[data-testid="pair-code"]')?.textContent?.trim() ?? ''));
  code = (await parent.getByTestId('pair-code').innerText()).trim();
  assert.ok(!(await parent.locator('body').innerText()).includes('Alya'));
});
await step('coach connects the parent from the top-bar button (parent page need not be open)', async () => {
  await parent.close();
  await coach.goto(URL_ + '#dashboard');
  await coach.getByTestId('open-connect-parent').click();
  await coach.getByTestId('connect-parent-modal').waitFor();
  assert.equal(await coach.evaluate(() => document.activeElement?.id), 'connect-code');
  // A code pasted with spaces, as people often send it, still gives all six digits.
  await coach.locator('#connect-code').fill(' 111 111 ');
  assert.equal(await coach.locator('#connect-code').inputValue(), '111111');
  await coach.getByTestId('connect-parent-submit').click();
  await coach.getByText(/No parent account has this code/).waitFor();
  await coach.locator('#connect-code').fill(code);
  await coach.getByTestId('connect-parent-submit').click();
  await coach.getByText(/Parent connected to Alya/).waitFor();
  await coach.getByTestId('connect-parent-modal').getByText('parent@example.com').waitFor();
  assert.equal(await coach.locator('#connect-code').inputValue(), '');
  assert.ok([...mock.docs.keys()].some((k) => k.startsWith('family/')));
  await coach.keyboard.press('Escape');
  await coach.getByTestId('manage-players').click();
  await coach.locator('[data-testid^="parents-"]').first().getByText(/Connect parents · 1/).waitFor();
  await coach.keyboard.press('Escape');
});
await step('parent signs in again and follows Alya read-only', async () => {
  const p2 = await person();
  await p2.fill('#sb-email', 'parent@example.com');
  await p2.fill('#sb-password', 'password123');
  await p2.getByTestId('sign-in').click();
  await p2.getByText('Alya').first().waitFor();
  const nav = await p2.locator('nav[aria-label="Main mobile"]').innerText();
  assert.ok(!nav.includes('Planner'));
  await p2.goto(URL_ + '#parent');
  await p2.getByTestId('parent-calendar').waitFor();
});
let inviteCode;
await step('coach makes a code for Alya under "Code for parent"', async () => {
  await coach.goto(URL_ + '#dashboard');
  await coach.getByTestId('open-connect-parent').click();
  await coach.getByTestId('tab-invite').click();
  await coach.waitForFunction(() => /^\d{6}$/.test(document.querySelector('[data-testid="invite-code"]')?.textContent?.trim() ?? ''));
  inviteCode = (await coach.getByTestId('invite-code').innerText()).trim();
  await coach.getByText(/Valid until/).waitFor();
  // Same code when opened again; "New code" (two taps) replaces it.
  await coach.keyboard.press('Escape');
  await coach.getByTestId('open-connect-parent').click();
  await coach.getByTestId('tab-invite').click();
  await coach.getByTestId('invite-code').getByText(inviteCode).waitFor();
  await coach.getByRole('button', { name: 'New code' }).click();
  await coach.getByRole('button', { name: /Old code stops working/ }).click();
  await coach.waitForFunction((old) => { const c = document.querySelector('[data-testid="invite-code"]')?.textContent?.trim() ?? ''; return /^\d{6}$/.test(c) && c !== old; }, inviteCode);
  const old = inviteCode;
  inviteCode = (await coach.getByTestId('invite-code').innerText()).trim();
  assert.notEqual(inviteCode, old);
  await coach.keyboard.press('Escape');
  globalThis.__oldInvite = old;
});
const parent2 = await person();
await step('a new parent types the coach\'s code under "Connect coach" and follows Alya at once', async () => {
  await signUp(parent2, 'parent2@example.com');
  await parent2.getByTestId('coach-code-form').waitFor();
  await parent2.locator('#coach-code').fill(globalThis.__oldInvite);
  await parent2.getByTestId('coach-code-submit').click();
  await parent2.getByTestId('coach-code-msg').getByText(/not valid or has expired/).waitFor();
  await parent2.locator('#coach-code').fill(inviteCode);
  await parent2.getByTestId('coach-code-submit').click();
  await parent2.getByText('Connected to Alya').first().waitFor();
  await parent2.getByText('Alya').first().waitFor();
  await parent2.getByTestId('parent-connect').waitFor({ state: 'detached', timeout: 10000 });
  const p2 = mock.users.get('parent2@example.com');
  const pdoc = [...mock.docs.values()].find((d) => d.path.startsWith('academy/data/players/') && d.data.name === 'Alya');
  assert.ok(pdoc.data.parentIds.includes(p2.id));
  assert.ok(mock.docs.has(`family/${p2.id}/players/${pdoc.data.id}`));
});
await step('the coach sees the new parent; the parent has "Connect coach" in the top bar', async () => {
  await coach.getByTestId('open-connect-parent').click();
  await coach.getByTestId('connect-parent-modal').getByText('parent2@example.com').waitFor({ timeout: 15000 });
  await coach.keyboard.press('Escape');
  await parent2.getByTestId('open-connect-coach').click();
  await parent2.getByTestId('connect-coach-modal').waitFor();
  await parent2.waitForFunction(() => /^\d{6}$/.test(document.querySelector('[data-testid="my-pair-code"]')?.textContent?.trim() ?? ''));
  await parent2.keyboard.press('Escape');
  assert.equal(await coach.getByTestId('open-connect-coach').count(), 0);
});
await step('reload keeps the coach signed in with data', async () => {
  await coach.reload();
  await coach.getByText('Alya').first().waitFor();
  await coach.getByTestId('sign-out').click();
  await coach.getByTestId('sign-in').waitFor();
});
await step('wrong password shows a clear message', async () => {
  const p = await person();
  await p.fill('#sb-email', OWNER);
  await p.fill('#sb-password', 'wrongpassword');
  await p.getByTestId('sign-in').click();
  await p.getByTestId('auth-message').getByText(/Wrong email or password/).waitFor();
});
await step('confirmation link opens a welcome page, then the app', async () => {
  const s = mock.linkFor(OWNER);
  const p = await person(`${URL_}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_at=${s.expires_at}&type=signup`);
  await p.getByTestId('welcome').getByText('Congratulations').waitFor();
  await p.getByRole('button', { name: 'Open the app' }).click();
  await p.getByText('Alya').first().waitFor();
});
await step('reset link asks for a new password, which then works for sign-in', async () => {
  const s = mock.linkFor('parent@example.com');
  const p = await person(`${URL_}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_at=${s.expires_at}&type=recovery`);
  await p.fill('#sb-newpass', 'newpassword9');
  await p.getByTestId('save-new-password').click();
  await p.getByText('Alya').first().waitFor();
  const q = await person();
  await q.fill('#sb-email', 'parent@example.com');
  await q.fill('#sb-password', 'newpassword9');
  await q.getByTestId('sign-in').click();
  await q.getByText('Alya').first().waitFor();
});
await step('an expired email link shows a helpful message', async () => {
  const p = await person(`${URL_}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`);
  await p.getByTestId('auth-message').getByText(/expired/).waitFor();
});
await step('sign-up asks coach or parent before creating the account', async () => {
  const p = await person();
  await p.getByTestId('tab-up').click();
  await p.fill('#sb-email', 'someone@example.com');
  await p.fill('#sb-password', 'password123');
  await p.getByTestId('sign-up').click();
  await p.getByTestId('auth-message').getByText(/coach or a parent/).waitFor();
});
await step('an uninvited coach waits for approval; the admin approves; the coach gets in', async () => {
  const c2 = await person();
  await signUpRaw(c2, 'newcoach@example.com', 'coach');
  await c2.getByTestId('pending-coach').waitFor();
  await owner.goto(URL_ + '#dashboard');
  await owner.reload();
  await owner.getByTestId('requests-banner').click();
  await owner.getByTestId('approve-newcoach@example.com').click();
  await owner.getByText(/newcoach@example.com is now a coach/).waitFor();
  await c2.reload();
  await c2.getByText('Alya').first().waitFor();
});
await step('admin charts a match; the linked parent follows the live score', async () => {
  await owner.goto(URL_ + '#newmatch');
  await owner.fill('#m-opponent', 'Live Opp');
  await owner.getByTestId('match-submit').click();
  await owner.getByTestId('scoreboard').waitFor();
  for (let i = 0; i < 2; i++) {
    await owner.getByTestId('p-stroke-fh').click();
    await owner.getByTestId('p-winner').click();
  }
  assert.equal(await owner.getByTestId('points-p').innerText(), '30');
  const fam = await person();
  await fam.fill('#sb-email', 'parent@example.com');
  await fam.fill('#sb-password', 'newpassword9');
  await fam.getByTestId('sign-in').click();
  await fam.getByText('Alya').first().waitFor();
  await fam.goto(URL_ + '#matches');
  await fam.getByTestId('live-banner').getByText('vs Live Opp').waitFor({ timeout: 15000 });
  await fam.getByTestId('live-banner').click();
  await fam.getByTestId('scoreboard').waitFor();
  assert.equal(await fam.getByTestId('points-p').innerText(), '30');
  assert.equal(await fam.getByTestId('point-composer').count(), 0, 'parents cannot chart');
  await owner.getByTestId('p-stroke-fh').click();
  await owner.getByTestId('p-winner').click();
  await fam.getByTestId('points-p').getByText('40').waitFor({ timeout: 15000 });
  assert.ok([...mock.docs.keys()].some((k) => k.startsWith('academy/data/matches/')));
});
let famPage;
const parentId = () => mock.users.get('parent@example.com').id;
await step('subscriptions on: a parent without a plan sees Pro drills locked; the admin gives a Family plan', async () => {
  const planned = new Set([...mock.docs.values()].filter((d) => d.path.startsWith('academy/data/plans/')).flatMap((d) => d.data.sessions.flatMap((x) => x.items.map((i) => i.drillId))));
  const pro = ['fh-004', 'fh-005', 'fh-008'].find((id) => !planned.has(id));
  await owner.goto(URL_ + '#admin');
  await owner.getByTestId('paywall-toggle').click();
  for (let i = 0; i < 75 && ![...mock.docs.values()].some((d) => d.path.startsWith(`family/${parentId()}/`) && d.data.paywall === true); i++) await owner.waitForTimeout(200);
  assert.ok(mock.docs.get('academy/config').data.paywall, 'academy setting saved');
  const fam = await person();
  await fam.fill('#sb-email', 'parent@example.com');
  await fam.fill('#sb-password', 'newpassword9');
  await fam.getByTestId('sign-in').click();
  await fam.getByText('Alya').first().waitFor();
  await fam.goto(URL_ + '#drill-' + pro);
  await fam.getByTestId('pro-card').waitFor();
  await owner.getByTestId(`plan-${parentId()}`).selectOption('year');
  await owner.getByTestId(`plan-status-${parentId()}`).getByText(/Family plan until/).waitFor();
  assert.equal(mock.subs.get(parentId()).plan, 'family');
  await fam.reload();
  await fam.getByTestId('drill-title').waitFor();
  assert.equal(await fam.getByTestId('pro-card').count(), 0, 'the Family plan opens Pro drills');
  famPage = fam;
});
await step('a parent deletes the account inside the app', async () => {
  const id = parentId();
  await famPage.getByTestId('delete-account').click();
  await famPage.fill('[data-testid="delete-confirm-input"]', 'DELETE');
  await famPage.getByTestId('delete-account-confirm').click();
  await famPage.getByText('Your account has been deleted.').waitFor();
  assert.equal(mock.users.has('parent@example.com'), false);
  assert.equal([...mock.docs.keys()].some((k) => k.startsWith(`family/${id}/`)), false, 'family copies removed');
  const alya = [...mock.docs.values()].find((d) => d.path.startsWith('academy/data/players/') && d.data.name === 'Alya');
  assert.ok(!alya.data.parentIds.includes(id), 'link to the player removed');
  assert.ok(alya.data.parentIds.includes(mock.users.get('parent2@example.com').id), 'the other parent stays linked');
});
await step('a coach changes the password; the new one works, the old one does not', async () => {
  await coach.goto(URL_ + '#dashboard');
  await coach.fill('#sb-email', 'coach@example.com');
  await coach.fill('#sb-password', 'password123');
  await coach.getByTestId('sign-in').click();
  await coach.getByText('Alya').first().waitFor();
  await coach.getByTestId('change-password').click();
  await coach.getByTestId('new-password').fill('12345678');
  await coach.getByText(/At least 10 characters/).waitFor();
  assert.equal(await coach.getByTestId('save-password').isDisabled(), true, 'a weak password is refused');
  await coach.getByTestId('new-password').fill('Grass-court-77');
  await coach.getByTestId('new-password-again').fill('Grass-court-78');
  assert.equal(await coach.getByTestId('save-password').isDisabled(), true, 'they must match');
  await coach.getByTestId('new-password-again').fill('Grass-court-77');
  await coach.getByTestId('save-password').click();
  await coach.getByText('Password changed').waitFor();
  const again = await person();
  await again.fill('#sb-email', 'coach@example.com');
  await again.fill('#sb-password', 'password123');
  await again.getByTestId('sign-in').click();
  await again.getByTestId('auth-message').getByText(/Wrong email or password/).waitFor();
  await again.fill('#sb-password', 'Grass-court-77');
  await again.getByTestId('sign-in').click();
  await again.getByText('Alya').first().waitFor();
});
console.log(`\n${passed} passed`);
await browser.close();
mock.server.close();
site.close();
