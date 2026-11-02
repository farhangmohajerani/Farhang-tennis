import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiError, askCoach, cleanInsight, DEFAULT_MODELS, matchBrief, systemPrompt, type AiSettings } from '../src/lib/ai';
import { createDemoState } from '../src/data/demo';
import { MatchSchema } from '../src/types';

const demo = createDemoState('2026-11-02');
const match = demo.matches.find((m) => m.id === 'match-demo-1')!;
const settings = (provider: 'openai' | 'gemini'): AiSettings => ({ provider, keys: { [provider]: 'test-key' }, models: { ...DEFAULT_MODELS } });
const TWO = 'Tactical paragraph with 54% numbers.\n\nWeakness paragraph: backhand under pressure.';

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

test('the brief has the statistics, breakdowns and point log — and no names', () => {
  const b = matchBrief(match);
  for (const s of ['KEY STATISTICS', '1st serve in', 'Returns in play vs 2nd serve', 'WINNERS AND ERRORS BY SHOT', 'DEUCE / AD COURT', 'SERVE DIRECTION', 'RALLY LENGTH', 'POINT LOG', 'BP']) assert.ok(b.includes(s), s);
  const player = demo.players.find((p) => p.id === match.playerId)!.name;
  for (const name of [player, ...player.split(' '), match.opponent, ...match.opponent.split(' ')]) assert.ok(!b.includes(name), `no name: ${name}`);
  assert.equal(b.split('\n').filter((l) => / → [PO]$/.test(l)).length, match.points.length, 'every point in the log');
  assert.match(systemPrompt('fa'), /Persian/);
  assert.match(systemPrompt('en'), /exactly two paragraphs/);
});

test('OpenAI: the coach’s key, the chosen model, the language; two clean paragraphs back', async () => {
  const calls: Call[] = [];
  const ins = await askCoach(match, settings('openai'), 'fa', fakeFetch(200, { choices: [{ message: { content: `**Paragraph 1:** ${TWO}` } }] }, calls));
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, DEFAULT_MODELS.openai);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[1].content, /Write the debrief in Persian/);
  assert.equal(ins.text, TWO);
  assert.deepEqual([ins.provider, ins.lang, ins.points], ['openai', 'fa', match.points.length]);
  assert.ok(MatchSchema.safeParse({ ...match, ai: ins }).success, 'kept with the match');
});

test('Gemini: key in a header (not the URL), model in the path, text parts joined', async () => {
  const calls: Call[] = [];
  const ins = await askCoach(match, { ...settings('gemini'), models: { ...DEFAULT_MODELS, gemini: 'models/gemini-test' } }, 'en', fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'Tactics here.' }, { text: '\n\nWork on this.' }] } }] }, calls));
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.ok(!calls[0].url.includes('test-key'));
  assert.equal((calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
  const body = JSON.parse(String(calls[0].init.body));
  assert.ok(body.systemInstruction.parts[0].text.includes('tennis coach'));
  assert.equal(ins.text, 'Tactics here.\n\nWork on this.');
});

test('errors say what to fix: key, quota, model, network, empty', async () => {
  const kind = async (f: typeof fetch, provider: 'openai' | 'gemini' = 'openai') => {
    try {
      await askCoach(match, settings(provider), 'en', f);
      return 'none';
    } catch (e) {
      return e instanceof AiError ? e.kind : 'other';
    }
  };
  assert.equal(await kind(fakeFetch(401, { error: { message: 'Incorrect API key provided' } })), 'key');
  assert.equal(await kind(fakeFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), 'gemini'), 'key');
  assert.equal(await kind(fakeFetch(429, { error: { message: 'You exceeded your current quota' } })), 'quota');
  assert.equal(await kind(fakeFetch(404, { error: { message: 'The model does not exist' } })), 'model');
  assert.equal(await kind((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch), 'network');
  assert.equal(await kind(fakeFetch(200, { choices: [{ message: { content: '  ' } }] })), 'empty');
  assert.equal(await kind(fakeFetch(200, {}), 'gemini'), 'empty');
  await assert.rejects(askCoach(match, { ...settings('openai'), keys: {} }, 'en', fakeFetch(200, {})), (e: unknown) => e instanceof AiError && e.kind === 'key');
});

test('answers are tidied into exactly two paragraphs', () => {
  assert.equal(cleanInsight('# Debrief\n\n**Tactics**: one.\n\n- two\n\nthree'), 'Tactics: one.\n\ntwo three');
  assert.equal(cleanInsight('Line one\nLine two'), 'Line one\n\nLine two');
  assert.equal(cleanInsight('پاراگراف ۱: اول\n\nپاراگراف ۲: دوم'), 'اول\n\nدوم');
});
