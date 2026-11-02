import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import type { LlmRequest } from '../src/llm/client.js';
import {
  buildRepairMessage,
  createJsonClient,
  extractJsonObject,
  parseJsonWithSchema,
} from '../src/llm/json.js';
import { ScriptedProvider } from '../src/llm/fakeLlm.js';

const AnswerSchema = z.object({ answer: z.number() }).strict();
const LooseSchema = z.object({ answer: z.number(), note: z.string().optional() }).strict();

function makeRequest<T>(schema: z.ZodType<T>, overrides: Partial<LlmRequest<T>> = {}): LlmRequest<T> {
  return {
    tier: 'fast',
    system: 'You are a test.',
    user: 'Return the answer.',
    schema,
    schemaName: 'TestSchema',
    maxOutputTokens: 100,
    timeoutMs: 1000,
    ...overrides,
  };
}

// ------------------------------------------------------------- extraction

test('a plain JSON object is parsed', () => {
  assert.deepEqual(extractJsonObject('{"answer":42}'), { answer: 42 });
});

test('a fenced JSON block is parsed', () => {
  assert.deepEqual(extractJsonObject('```json\n{"answer":42}\n```'), { answer: 42 });
  assert.deepEqual(extractJsonObject('```\n{"answer":42}\n```'), { answer: 42 });
});

test('prose around the object is ignored', () => {
  const text = 'Sure, here is the result:\n{"answer":42}\nHope that helps.';
  assert.deepEqual(extractJsonObject(text), { answer: 42 });
});

test('nested objects are preserved', () => {
  const parsed = extractJsonObject('{"a":{"b":{"c":1}}}') as { a: { b: { c: number } } };
  assert.equal(parsed.a.b.c, 1);
});

test('braces inside strings do not confuse the extractor', () => {
  assert.deepEqual(extractJsonObject('{"answer":1,"note":"use { and } carefully"}'), {
    answer: 1,
    note: 'use { and } carefully',
  });
});

test('empty or brace-free text is reported as invalid JSON', () => {
  assert.equal(extractJsonObject(''), undefined);
  assert.equal(extractJsonObject('   '), undefined);
  assert.equal(extractJsonObject('no object here'), undefined);
  assert.equal(extractJsonObject(null), undefined);
  assert.equal(extractJsonObject(42), undefined);
});

test('malformed JSON is reported as invalid', () => {
  assert.equal(extractJsonObject('{"answer": }'), undefined);
  assert.equal(extractJsonObject('{answer:42}'), undefined);
});

// ------------------------------------------------------------- schema validation

test('a valid object passes its schema', () => {
  const result = parseJsonWithSchema('{"answer":42}', AnswerSchema);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.answer, 42);
});

test('a schema violation reports the failing path', () => {
  const result = parseJsonWithSchema('{"answer":"forty-two"}', AnswerSchema);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'schema');
    assert.match(result.issues, /answer/);
  }
});

test('extra fields are rejected by a strict schema', () => {
  const result = parseJsonWithSchema('{"answer":42,"decision":"ALLOW"}', AnswerSchema);
  assert.equal(result.ok, false);
});

test('optional fields are still accepted', () => {
  const result = parseJsonWithSchema('{"answer":1,"note":"ok"}', LooseSchema);
  assert.equal(result.ok, true);
});

// ------------------------------------------------------------- repair loop

test('one invalid reply is repaired with a single follow-up call', async () => {
  const provider = new ScriptedProvider([
    { match: (request) => !request.user.includes('previous reply was invalid'), text: 'not json' },
    { match: (request) => request.user.includes('previous reply was invalid'), text: '{"answer":42}' },
  ]);
  const client = createJsonClient(provider);

  const result = await client.generateJson(makeRequest(AnswerSchema));
  assert.equal(result.ok, true);
  assert.equal(provider.calls.length, 2);
  if (result.ok) assert.equal(result.data.answer, 42);

  const repairRequest = provider.calls[1];
  assert.ok(repairRequest.user.includes('Return the answer.'));
  assert.ok(repairRequest.user.includes('Return only the corrected JSON object.'));
  assert.equal(repairRequest.system, 'You are a test.');
});

test('a schema violation is repaired too', async () => {
  const provider = new ScriptedProvider([
    { match: (request) => !request.user.includes('previous reply was invalid'), text: '{"answer":"nope"}' },
    { match: (request) => request.user.includes('previous reply was invalid'), text: '{"answer":7}' },
  ]);
  const result = await createJsonClient(provider).generateJson(makeRequest(AnswerSchema));
  assert.equal(result.ok, true);
  assert.equal(provider.calls.length, 2);
});

test('two invalid replies stop after exactly one repair', async () => {
  const provider = new ScriptedProvider([{ text: 'still not json' }]);
  const result = await createJsonClient(provider).generateJson(makeRequest(AnswerSchema));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'invalid_json');
  assert.equal(provider.calls.length, 2);
});

test('a failed repair reports the schema error and issues', async () => {
  const provider = new ScriptedProvider([
    { match: (request) => !request.user.includes('previous reply was invalid'), text: '{"answer":"one"}' },
    { match: (request) => request.user.includes('previous reply was invalid'), text: '{"answer":false}' },
  ]);
  const result = await createJsonClient(provider).generateJson(makeRequest(AnswerSchema));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'schema');
    assert.match(result.detail ?? '', /answer/);
  }
  assert.equal(provider.calls.length, 2);
});

test('the repair message contains the original user message and the issues', () => {
  const message = buildRepairMessage('original', 'answer: Expected number');
  assert.match(message, /^original/);
  assert.match(message, /answer: Expected number/);
  assert.match(message, /Return only the corrected JSON object\.$/);
});

// ------------------------------------------------------------- failures

test('a provider exception becomes a provider error', async () => {
  const provider = new ScriptedProvider([{ error: new Error('socket closed') }]);
  const result = await createJsonClient(provider).generateJson(makeRequest(AnswerSchema));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'provider');
    assert.match(result.detail ?? '', /socket closed/);
  }
});

test('a slow provider times out', async () => {
  const provider = new ScriptedProvider([{ text: '{"answer":1}', delayMs: 100 }]);
  const result = await createJsonClient(provider).generateJson(
    makeRequest(AnswerSchema, { timeoutMs: 10 })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'timeout');
});

test('an already aborted signal never calls the provider', async () => {
  const provider = new ScriptedProvider([{ text: '{"answer":1}' }]);
  const controller = new AbortController();
  controller.abort();

  const result = await createJsonClient(provider).generateJson(
    makeRequest(AnswerSchema, { signal: controller.signal })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'aborted');
  assert.equal(provider.calls.length, 0);
});

test('usage is passed through on success', async () => {
  const provider = new ScriptedProvider([
    { text: '{"answer":1}', usage: { inputTokens: 12, outputTokens: 3 } },
  ]);
  const result = await createJsonClient(provider).generateJson(makeRequest(AnswerSchema));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3 });
});

test('latency is reported and never negative', async () => {
  let clock = 0;
  const provider = new ScriptedProvider([{ text: '{"answer":1}' }]);
  const client = createJsonClient(provider, { now: () => (clock += 5) });
  const result = await client.generateJson(makeRequest(AnswerSchema));
  assert.ok(result.latencyMs >= 0);
});

test('parse failures are logged without prompt content', async () => {
  const events: Record<string, unknown>[] = [];
  const provider = new ScriptedProvider([{ text: 'nope' }]);
  await createJsonClient(provider, { log: (event) => events.push(event) }).generateJson(
    makeRequest(AnswerSchema)
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].evt, 'llm_parse_failed');
  assert.equal(events[0].schemaName, 'TestSchema');
  assert.equal(events[0].attempt, 0);
  assert.equal(events[1].attempt, 1);
  assert.equal(JSON.stringify(events).includes('nope'), false);
});
