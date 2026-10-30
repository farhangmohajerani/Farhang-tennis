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
async function person() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\./, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e));
  await page.goto(URL_);
  return page;
}
async function signUp(page, email) {
  await page.fill('#sb-email', email);
  await page.fill('#sb-password', 'password123');
  await page.getByTestId('sign-up').click();
  await page.locator('main').waitFor();
}

const owner = await person();
await step('owner signs up and becomes admin', async () => {
  await signUp(owner, OWNER);
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
});
const coach = await person();
await step('invited coach signs up with that email and sees the player', async () => {
  await signUp(coach, 'coach@example.com');
  await coach.getByText('Alya').first().waitFor();
  assert.equal(await coach.locator('#role-select option').count(), 2);
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
await step('coach connects the parent with the code (parent page need not be open)', async () => {
  await parent.close();
  await coach.goto(URL_ + '#dashboard');
  await coach.getByTestId('manage-players').click();
  const btn = coach.locator('[data-testid^="parents-"]').first();
  await btn.click();
  await coach.locator('[id^="pair-"]').first().fill('111111');
  await coach.locator('[data-testid^="connect-parent-"]').first().click();
  await coach.getByText(/No parent account has this code/).waitFor();
  await coach.locator('[id^="pair-"]').first().fill(code);
  await coach.locator('[data-testid^="connect-parent-"]').first().click();
  await coach.getByText(/Parent connected to Alya/).waitFor();
  await coach.getByText('parent@example.com').waitFor();
  assert.ok([...mock.docs.keys()].some((k) => k.startsWith('family/')));
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
await step('reload keeps the coach signed in with data', async () => {
  await coach.reload();
  await coach.getByText('Alya').first().waitFor();
  await coach.getByTestId('sign-out').click();
  await coach.getByTestId('sign-in').waitFor();
});
console.log(`\n${passed} passed`);
await browser.close();
mock.server.close();
site.close();
