/**
 * Shared-academy smoke test: runs the built single-file app with a simulated claude.ai
 * `db`/`user` runtime (one in-memory store shared by two browser pages through the test).
 *   node e2e/shared.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';

const server = await serve(new URL('../dist', import.meta.url).pathname, 4198);
const URL_ = 'http://localhost:4198/tennis-progress.html';
const browser = await chromium.launch();
const store = new Map();
const pages = [];
const presence = new Map(); // role -> presence object (simulated room)

async function openAs(role) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\./, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.exposeFunction('__dbWrite', (path, body) => {
    if (body === null) store.delete(path); else store.set(path, body);
    for (const p of pages) p.evaluate(([path, body]) => window.__dbApply(path, body), [path, body]).catch(() => {});
  });
  await page.exposeFunction('__dbDump', () => [...store.entries()]);
  await page.exposeFunction('__setPresence', (r, obj) => { presence.set(r, obj); });
  await page.exposeFunction('__getPeers', () => [...presence.entries()].map(([r, p]) => ({ r, p })));
  await page.addInitScript((role) => {
    const local = new Map();
    const colls = new Map(), docs = new Map();
    const parent = (p) => p.split('/').slice(0, -1).join('/');
    // Simulated access rules: a viewer reads only family/u_viewer/...
    const visible = (path) => role !== 'viewer' || path.startsWith('family/u_viewer/');
    const snap = (path) => ({ id: path.split('/').pop(), exists: local.has(path), data: () => local.get(path), metadata: { fromCache: false, hasPendingWrites: false } });
    const fire = (path) => { colls.get(parent(path))?.forEach((f) => f()); docs.get(path)?.forEach((f) => f()); };
    window.__dbApply = (path, body) => { if (!visible(path)) return; if (body === null) local.delete(path); else local.set(path, body); fire(path); };
    const ready = window.__dbDump().then((entries) => entries.forEach(([k, v]) => visible(k) && local.set(k, v)));
    const db = {
      doc: (path) => ({
        set: async (d) => { await window.__dbWrite(path, JSON.parse(JSON.stringify(d))); },
        delete: async () => { await window.__dbWrite(path, null); },
        onSnapshot: (n) => { const f = () => n(snap(path)); (docs.get(path) ?? docs.set(path, new Set()).get(path)).add(f); ready.then(f); return () => docs.get(path).delete(f); },
      }),
      collection: (path) => ({
        onSnapshot: (n) => { const f = () => n({ docs: [...local.keys()].filter((k) => parent(k) === path).sort().map(snap) }); (colls.get(path) ?? colls.set(path, new Set()).get(path)).add(f); ready.then(f); return () => colls.get(path).delete(f); },
      }),
    };
    const user = { isOwner: async () => role === 'owner', canEdit: async () => role !== 'viewer', id: async () => 'u_' + role, profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: i === 'u_viewer' ? 'Selin (parent)' : '' }])) };
    let peerCache = [];
    setInterval(() => window.__getPeers().then((list) => (peerCache = list.map(({ r, p }) => ({ by: 'u_' + r, isMe: r === role, kind: 'viewer', presence: p, peer: r, sameTab: r === role, guest: false })))), 100);
    const room = { presence: async (obj) => window.__setPresence(role, obj), peers: () => peerCache };
    window.claude = { use: async (n) => (n === 'db' ? db : n === 'user' ? user : n === 'room' ? room : null) };
  }, role);
  await page.goto(URL_);
  pages.push(page);
  return page;
}

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };

const owner = await openAs('owner');
await step('empty academy shows first-player onboarding with Shared badge', async () => {
  await owner.getByText('Add your first player').waitFor();
  await owner.getByText('Shared academy', { exact: true }).waitFor();
  assert.equal(await owner.locator('#role-select option').count(), 3);
});
await step('owner adds a player; it is stored as one document', async () => {
  await owner.locator('[id^="pl-name-"]').fill('Ela Demir');
  await owner.getByTestId('save-player').click();
  await owner.getByText('Build a 10-session plan').waitFor();
  assert.equal([...store.keys()].filter((k) => k.startsWith('academy/data/players/')).length, 1);
});
const coach = await openAs('coach');
await step('a coach sees the player, cannot choose admin', async () => {
  await coach.getByText('Ela Demir').first().waitFor();
  assert.equal(await coach.locator('#role-select option').count(), 2);
});
await step('coach builds a plan; owner sees it live', async () => {
  await coach.goto(URL_ + '#planner');
  await coach.getByTestId('generate-plan').click();
  await coach.getByTestId('save-plan').click();
  await owner.goto(URL_ + '#dashboard');
  await owner.getByText(/0 of 10 sessions completed/).waitFor();
});
await step('owner logs a result; coach sees it on Progress', async () => {
  await owner.goto(URL_ + '#session');
  await owner.locator('#planner-sessions, main').first().waitFor();
  // add a drill to session 1 via the drill page first
  await owner.goto(URL_ + '#drill-fh-006');
  await owner.getByRole('button', { name: '+ Add to session' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await owner.goto(URL_ + '#session');
  await owner.fill('#fh-006-eligible', '10');
  await owner.fill('#fh-006-attempts', '8');
  await owner.fill('#fh-006-decisions', '6');
  await owner.fill('#fh-006-successful', '3');
  await owner.getByTestId('save-log-fh-006').click();
  await coach.goto(URL_ + '#progress');
  await coach.getByRole('link', { name: 'Forehand Depth Zones' }).first().waitFor();
});
await step('reload keeps everything (data lives in the shared store)', async () => {
  await coach.reload();
  await coach.getByRole('link', { name: 'Forehand Depth Zones' }).first().waitFor();
});
await step('coach adds a second player (Deniz)', async () => {
  await coach.goto(URL_ + '#dashboard');
  await coach.getByTestId('manage-players').click();
  await coach.getByTestId('open-add-player').click();
  await coach.getByRole('dialog').locator('[id^="pl-name-"]').last().fill('Deniz Kaya');
  await coach.getByRole('dialog').getByTestId('save-player').click();
  await coach.getByRole('dialog').getByText('Deniz Kaya').waitFor();
  await coach.keyboard.press('Escape');
});
const viewer = await openAs('viewer');
let code;
await step('a parent (Viewer) sees a connection code and no academy data', async () => {
  await viewer.getByTestId('parent-connect').waitFor();
  code = (await viewer.getByTestId('pair-code').innerText()).trim();
  assert.match(code, /^\d{6}$/);
  assert.equal(await viewer.locator('#role-select option').count(), 1);
  assert.ok(!(await viewer.locator('main').innerText()).includes('Ela Demir'));
});
await step('coach connects the parent to Ela with the code', async () => {
  await coach.waitForTimeout(300);
  await coach.getByTestId('manage-players').click();
  const elaId = [...store.keys()].find((k) => k.startsWith('academy/data/players/') && store.get(k).name === 'Ela Demir').split('/').pop();
  await coach.getByTestId(`parents-${elaId}`).click();
  await coach.locator(`#pair-${elaId}`).fill('000000');
  await coach.getByTestId(`connect-parent-${elaId}`).click();
  await coach.getByText(/No open page shows that code/).waitFor();
  await coach.locator(`#pair-${elaId}`).fill(code);
  await coach.getByTestId(`connect-parent-${elaId}`).click();
  await coach.getByText(/Parent connected to Ela Demir/).waitFor();
  await coach.getByText('Selin (parent)').waitFor();
});
await step('the parent now follows Ela only, read-only', async () => {
  await viewer.getByText('Ela Demir').first().waitFor();
  assert.ok(!(await viewer.locator('body').innerText()).includes('Deniz Kaya'));
  const nav = await viewer.locator('nav[aria-label="Main mobile"]').innerText();
  assert.ok(!nav.includes('Planner') && !nav.includes('Session'));
  await viewer.goto(URL_ + '#progress');
  await viewer.getByRole('link', { name: 'Forehand Depth Zones' }).first().waitFor();
  await viewer.goto(URL_ + '#parent');
  await viewer.getByTestId('parent-calendar').waitFor();
  assert.equal(await viewer.getByTestId('start-own-plan').count(), 0);
});
await step('new results reach the parent live', async () => {
  await owner.goto(URL_ + '#session');
  await owner.fill('#fh-006-eligible', '12');
  await owner.fill('#fh-006-attempts', '12');
  await owner.fill('#fh-006-decisions', '11');
  await owner.fill('#fh-006-successful', '9');
  await owner.getByTestId('save-log-fh-006').click();
  await viewer.goto(URL_ + '#dashboard');
  await viewer.waitForFunction(() => document.body.innerText.includes('Forehand Depth Zones'));
  const fam = [...store.keys()].filter((k) => k.startsWith('family/u_viewer/players/'));
  assert.equal(fam.length, 1);
  assert.equal(store.get(fam[0]).logs.length, 2);
});
console.log(`\n${passed} passed. Documents in store: ${store.size}`);
await browser.close();
server.close();
