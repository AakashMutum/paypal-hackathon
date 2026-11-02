import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import type { LlmRequest } from '../src/llm/client.js';
import { FakeLlm, ScriptedProvider } from '../src/llm/fakeLlm.js';

const Schema = z.object({ ok: z.boolean() }).strict();

function request(schemaName: string): LlmRequest<{ ok: boolean }> {
  return {
    tier: 'fast',
    system: 'sys',
    user: 'user',
    schema: Schema,
    schemaName,
    maxOutputTokens: 50,
    timeoutMs: 1000,
  };
}

test('the fake client returns scripted data', async () => {
  const client = new FakeLlm([{ data: { ok: true } }]);
  const result = await client.generateJson(request('A'));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { ok: true });
});

test('the fake client can match on schema name', async () => {
  const client = new FakeLlm([
    { match: (req) => req.schemaName === 'A', data: { ok: true } },
    { match: (req) => req.schemaName === 'B', data: { ok: false } },
  ]);

  const a = await client.generateJson(request('A'));
  const b = await client.generateJson(request('B'));
  assert.equal(a.ok && a.data.ok, true);
  assert.equal(b.ok && b.data.ok, false);
});

test('an unscripted call is a provider error, never a throw', async () => {
  const client = new FakeLlm([]);
  const result = await client.generateJson(request('A'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'provider');
});

test('the fake client can script an error code', async () => {
  const client = new FakeLlm([{ error: 'timeout' }]);
  const result = await client.generateJson(request('A'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'timeout');
});

test('the fake client records every request it saw', async () => {
  const client = new FakeLlm([{ data: { ok: true } }]);
  await client.generateJson(request('A'));
  await client.generateJson(request('B'));
  assert.deepEqual(client.calls.map((call) => call.schemaName), ['A', 'B']);
});

// ------------------------------------------------------------- raw provider

test('the scripted provider returns the text it was given', async () => {
  const provider = new ScriptedProvider([{ text: 'hello' }]);
  const response = await provider.complete({
    tier: 'fast',
    system: 's',
    user: 'u',
    maxOutputTokens: 10,
    timeoutMs: 100,
  });
  assert.equal(response.text, 'hello');
  assert.equal(provider.calls.length, 1);
});

test('the scripted provider can throw', async () => {
  const provider = new ScriptedProvider([{ error: new Error('boom') }]);
  await assert.rejects(
    () =>
      provider.complete({ tier: 'fast', system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 100 }),
    /boom/
  );
});

test('an unmatched provider call throws instead of inventing a reply', async () => {
  const provider = new ScriptedProvider([{ match: () => false, text: 'x' }]);
  await assert.rejects(() =>
    provider.complete({ tier: 'fast', system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 100 })
  );
});
