import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REASONS,
  MAX_TOOL_TEXT,
  MAX_TRACE_LINES,
  clampText,
  formatCheckout,
  formatPolicy,
  formatVerdict,
  nextStepFor,
} from '../src/format.js';

function verdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'WARN',
    score: 61,
    confidence: 0.95,
    recommendedAction: 'WARN_DISPLAYED',
    summary: 'Several signals need a closer look.',
    explanation: {
      headline: 'Some details do not add up.',
      bullets: Array.from({ length: 6 }, (_, index) => ({
        text: `Reason number ${index + 1}.`,
        evidenceIds: [`EVD-REASON-${index + 1}`],
      })),
    },
    trace: Array.from({ length: 8 }, (_, index) => ({
      tool: `tool_${index + 1}`,
      result: `result ${index + 1}`,
    })),
    ...overrides,
  };
}

test('a verdict starts with the decision line and includes summary', () => {
  const text = formatVerdict(verdict());
  assert.match(text, /^Decision: WARN — 61\/100 \(confidence 0\.95\)/);
  assert.match(text, /Reasons:/);
  assert.match(text, /Reason number 1\. \((EVD-REASON-1)\)/);
});

test('at most four reasons are shown and citations are preserved', () => {
  const text = formatVerdict(verdict());
  assert.match(text, /Reason number 4/);
  assert.doesNotMatch(text, /Reason number 5/);

  const reasonLines = text.split('\n').filter((line) => line.startsWith('- Reason'));
  assert.equal(reasonLines.length, MAX_REASONS);
  assert.ok(reasonLines.every((line) => line.includes('EVD-REASON-')));
});

test('at most six checks are shown', () => {
  const text = formatVerdict(verdict());
  assert.match(text, /tool_6/);
  assert.doesNotMatch(text, /tool_7/);

  const checked = text.split('\n').filter((line) => line.startsWith('- tool_'));
  assert.equal(checked.length, MAX_TRACE_LINES);
});

test('falls back to the summary when no explanation bullets exist', () => {
  const text = formatVerdict(verdict({ explanation: undefined }));
  assert.match(text, /Reasons:/);
  assert.match(text, /Several signals need a closer look\./);
});

test('each recommended action maps to a plain next step', () => {
  assert.match(nextStepFor('PROCEED', 'ALLOW'), /proceed with the purchase/i);
  assert.match(nextStepFor('WARN_DISPLAYED', 'WARN'), /ask the buyer/i);
  assert.match(nextStepFor('CAPTURE_PAUSED', 'PAUSE'), /do not pay/i);
  assert.match(nextStepFor(undefined, undefined), /review/i);
});

test('checkout formatting covers every terminal status', () => {
  const captured = formatCheckout({
    checkoutId: 'chk-1',
    status: 'CAPTURED',
    verdict: verdict({ decision: 'ALLOW', recommendedAction: 'PROCEED' }),
  });
  assert.match(captured, /Checkout: CAPTURED/);
  assert.match(captured, /Decision: ALLOW/);
  assert.match(captured, /purchase completed/i);
  assert.doesNotMatch(captured, /Decision: ALLOW[\s\S]*Next step: stop/);

  const paused = formatCheckout({ checkoutId: 'chk-2', status: 'PAUSED' });
  assert.match(paused, /Checkout: PAUSED/);
  assert.match(paused, /do not pay/i);

  const human = formatCheckout({ checkoutId: 'chk-3', status: 'NEEDS_HUMAN_DECISION' });
  assert.match(human, /ask the buyer/i);

  const awaiting = formatCheckout({ checkoutId: 'chk-4', status: 'AWAITING_APPROVAL' });
  assert.match(awaiting, /approve the payment/i);
});

test('policy formatting reads a nested policy object', () => {
  const text = formatPolicy('agent-1', {
    policy: { perOrderCap: 100, dailyCap: 500, firstPurchaseCap: 50, currency: 'USD' },
  });
  assert.match(text, /Spend policy saved for agent-1/);
  assert.match(text, /Per order: USD 100\.00/);
  assert.match(text, /Daily: USD 500\.00/);
  assert.match(text, /First purchase: USD 50\.00/);
});

test('clampText keeps every tool reply within the limit', () => {
  const long = 'x'.repeat(MAX_TOOL_TEXT + 100);
  const clamped = clampText(long);
  assert.equal(clamped.length, MAX_TOOL_TEXT);
  assert.ok(clamped.endsWith('…'));
  assert.equal(clampText('short'), 'short');
});
