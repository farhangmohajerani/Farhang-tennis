/**
 * After a deploy, a page still running the old bundle offers "New version ready · Update".
 *   node e2e/update.mjs   (builds into e2e/.upd-build itself)
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../scripts/serve.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, '.upd-build');
const env = { ...process.env, OUT_DIR: dir, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
const built = spawnSync(process.execPath, [path.join(here, '..', 'scripts', 'build.mjs')], { env, encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr);
const indexFile = path.join(dir, 'index.html');
const first = /app\.js\?v=(\w+)/.exec(fs.readFileSync(indexFile, 'utf8'))?.[1];
assert.ok(first, 'index.html names a stamped app.js');
assert.match(fs.readFileSync(indexFile, 'utf8'), new RegExp(`app\\.css\\?v=${first}`));

const server = await serve(dir, 4202);
const browser = await chromium.launch();
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log('  ✓ ' + name);
};
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await step('the footer shows which build is running; no banner when up to date', async () => {
  await page.goto('http://localhost:4202/#library');
  await page.getByTestId('build-id').waitFor();
  assert.match(await page.getByTestId('build-id').innerText(), new RegExp(first.slice(0, 6)));
  await page.waitForTimeout(3600);
  assert.equal(await page.getByTestId('update-banner').count(), 0);
});

const next = 'abcdef1234';
await step('a new deploy shows "New version ready" when the app comes back to the front', async () => {
  fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replaceAll(`?v=${first}`, `?v=${next}`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByTestId('update-banner').waitFor({ timeout: 5000 });
  assert.match(await page.getByTestId('update-banner').innerText(), /New version ready/);
});

await step('tapping it loads the new build and keeps the page', async () => {
  await page.getByTestId('update-banner').click();
  await page.waitForURL(new RegExp(`\\?v=${next}#library$`));
  await page.getByTestId('build-id').getByText(next.slice(0, 6)).waitFor();
  await page.waitForTimeout(3600);
  assert.equal(await page.getByTestId('update-banner').count(), 0);
  assert.deepEqual(errors, []);
});

await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed`);
