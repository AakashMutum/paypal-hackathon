import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import type { LlmRequest } from '../src/llm/client.js';
import { FakeLlm } from '../src/llm/fakeLlm.js';
import { llmCacheKey, withRecordReplay } from '../src/llm/recordReplay.js';

const Schema = z.object({ answer: z.number() }).strict();

function request(overrides: Partial<LlmRequest<{ answer: number }>> = {}): LlmRequest<{ answer: number }> {
  return {
    tier: 'fast',
    system: 'system prompt',
    user: 'user message',
    schema: Schema,
    schemaName: 'AnswerSchema',
    maxOutputTokens: 100,
    timeoutMs: 1000,
    ...overrides,
  };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cg-llm-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('cache keys are stable and cover every request field', () => {
  const base = { tier: 'fast', schemaName: 'A', system: 's', user: 'u' };
  assert.equal(llmCacheKey(base), llmCacheKey({ ...base }));

  const variants = [
    { ...base, tier: 'strong' },
    { ...base, schemaName: 'B' },
    { ...base, system: 'other' },
    { ...base, user: 'other' },
  ];
  for (const variant of variants) {
    assert.notEqual(llmCacheKey(variant), llmCacheKey(base));
  }
  assert.equal(llmCacheKey(base).length, 64);
});

test('live mode passes straight through', async () => {
  const inner = new FakeLlm([{ data: { answer: 1 } }]);
  const client = withRecordReplay(inner, { mode: 'live', dir: 'unused' });
  const result = await client.generateJson(request());
  assert.equal(result.ok, true);
  assert.equal(inner.calls.length, 1);
});

test('record mode writes one file per distinct request', async () => {
  await withTempDir(async (dir) => {
    const inner = new FakeLlm([{ data: { answer: 5 } }]);
    const client = withRecordReplay(inner, { mode: 'record', dir });

    const result = await client.generateJson(request());
    assert.equal(result.ok, true);

    const files = await readdir(dir);
    assert.deepEqual(files, [`${llmCacheKey(request())}.json`]);
  });
});

test('replay mode returns the recorded answer without calling the model', async () => {
  await withTempDir(async (dir) => {
    const recorder = withRecordReplay(new FakeLlm([{ data: { answer: 5 } }]), { mode: 'record', dir });
    await recorder.generateJson(request());

    const inner = new FakeLlm([{ data: { answer: 999 } }]);
    const replay = withRecordReplay(inner, { mode: 'replay', dir });
    const result = await replay.generateJson(request());

    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, { answer: 5 });
    assert.equal(inner.calls.length, 0);
    assert.equal(result.latencyMs, 0);
  });
});

test('replay misses name the key and never call the model', async () => {
  await withTempDir(async (dir) => {
    const events: Record<string, unknown>[] = [];
    const inner = new FakeLlm([{ data: { answer: 1 } }]);
    const client = withRecordReplay(inner, { mode: 'replay', dir, log: (event) => events.push(event) });

    const result = await client.generateJson(request({ user: 'never recorded' }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'provider');
      assert.equal(result.detail, 'replay_miss');
    }
    assert.equal(inner.calls.length, 0);
    assert.equal(events[0].evt, 'llm_replay_miss');
    assert.equal(events[0].key, llmCacheKey(request({ user: 'never recorded' })));
  });
});

test('replay re-validates stored data against the schema', async () => {
  await withTempDir(async (dir) => {
    const key = llmCacheKey(request());
    await writeFile(
      join(dir, `${key}.json`),
      JSON.stringify({ key, result: { ok: true, data: { answer: 'not a number' } } }),
      'utf8'
    );

    const result = await withRecordReplay(new FakeLlm([]), { mode: 'replay', dir }).generateJson(request());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'schema');
  });
});

test('a corrupt recording is a provider error', async () => {
  await withTempDir(async (dir) => {
    const key = llmCacheKey(request());
    await writeFile(join(dir, `${key}.json`), 'not json at all', 'utf8');

    const result = await withRecordReplay(new FakeLlm([]), { mode: 'replay', dir }).generateJson(request());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'provider');
      assert.equal(result.detail, 'replay_corrupt');
    }
  });
});

test('failed results are recorded and replayed faithfully', async () => {
  await withTempDir(async (dir) => {
    const recorder = withRecordReplay(new FakeLlm([{ error: 'timeout' }]), { mode: 'record', dir });
    const recorded = await recorder.generateJson(request());
    assert.equal(recorded.ok, false);

    const replay = withRecordReplay(new FakeLlm([{ data: { answer: 1 } }]), { mode: 'replay', dir });
    const replayed = await replay.generateJson(request());
    assert.equal(replayed.ok, false);
    if (!replayed.ok) assert.equal(replayed.error, 'timeout');
  });
});
