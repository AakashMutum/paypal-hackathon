import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolCallSchema, TurnSchema } from '../src/investigator/protocol.js';

const why = 'Check the registry.';

test('all four tools have a valid call shape', () => {
  const calls = [
    { tool: 'lookup_registry', input: { by: 'name', query: 'Veloura' }, why },
    { tool: 'fetch_page_section', input: { hint: 'about' }, why },
    { tool: 'compare_offers', input: { productQuery: 'trail jacket' }, why },
    { tool: 'get_domain_report', input: { domain: 'veloura-outdoor.example' }, why },
  ];

  for (const call of calls) {
    assert.equal(ToolCallSchema.safeParse(call).success, true, JSON.stringify(call));
  }
});

test('a finish turn is valid', () => {
  assert.equal(TurnSchema.safeParse({ action: 'finish', why: 'Enough evidence.' }).success, true);
});

test('a turn that adds a decision is rejected', () => {
  const turn = { action: 'finish', why: 'Enough evidence.', decision: 'ALLOW' };
  assert.equal(TurnSchema.safeParse(turn).success, false);
});

test('a call that adds an extra field is rejected', () => {
  const call = {
    tool: 'lookup_registry',
    input: { by: 'name', query: 'Veloura', url: 'https://evil.example' },
    why,
  };
  assert.equal(ToolCallSchema.safeParse(call).success, false);
});

test('an unknown tool is rejected', () => {
  assert.equal(
    ToolCallSchema.safeParse({ tool: 'pay_now', input: {}, why }).success,
    false
  );
});

test('an empty call list is rejected', () => {
  assert.equal(TurnSchema.safeParse({ action: 'call_tools', calls: [] }).success, false);
});

test('up to ten calls are accepted so the loop can truncate', () => {
  const calls = Array.from({ length: 10 }, (_, index) => ({
    tool: 'lookup_registry',
    input: { by: 'name', query: `Brand ${index}` },
    why,
  }));
  assert.equal(TurnSchema.safeParse({ action: 'call_tools', calls }).success, true);
  assert.equal(
    TurnSchema.safeParse({ action: 'call_tools', calls: [...calls, calls[0]] }).success,
    false
  );
});

test('reason strings are bounded', () => {
  assert.equal(TurnSchema.safeParse({ action: 'finish', why: 'no' }).success, false);
  assert.equal(TurnSchema.safeParse({ action: 'finish', why: 'x'.repeat(141) }).success, false);
});

test('section hints are restricted to the six known sections', () => {
  assert.equal(
    ToolCallSchema.safeParse({ tool: 'fetch_page_section', input: { hint: 'pricing' }, why }).success,
    false
  );
});

test('registry queries and offer prices are bounded', () => {
  assert.equal(
    ToolCallSchema.safeParse({ tool: 'lookup_registry', input: { by: 'name', query: 'a' }, why }).success,
    false
  );
  assert.equal(
    ToolCallSchema.safeParse({
      tool: 'compare_offers',
      input: { productQuery: 'jacket', maxPrice: -5 },
      why,
    }).success,
    false
  );
});
