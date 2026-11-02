import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { GuardianApiError, plainMessageFor } from './apiClient.js';

export const MAX_TOOL_TEXT = 1_200;
export const MAX_REASONS = 4;
export const MAX_TRACE_LINES = 6;

interface ExplanationBulletShape {
  text: string;
  evidenceIds: string[];
}

interface TraceStepShape {
  tool?: string;
  why?: string;
  result?: string;
  evidenceIds?: string[];
  ok?: boolean;
}

export interface VerdictShape {
  decision?: string;
  score?: number;
  confidence?: number;
  summary?: string;
  recommendedAction?: string;
  explanation?: { headline?: string; bullets?: ExplanationBulletShape[] };
  trace?: TraceStepShape[];
  evidence?: Array<{ id?: string; summary?: string }>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function clampText(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - 1)}…`;
}

export function normalizeVerdict(data: unknown): VerdictShape {
  if (!isRecord(data)) return {};

  if (isRecord(data.verdict)) return data.verdict as VerdictShape;
  if (isRecord(data.investigation)) return data.investigation as VerdictShape;
  if (isRecord(data.result) && isRecord(data.result.verdict)) {
    return data.result.verdict as VerdictShape;
  }

  return data as VerdictShape;
}

export function nextStepFor(action: string | undefined, decision: string | undefined): string {
  if (action === 'PROCEED' || decision === 'ALLOW') {
    return 'Next step: proceed with the purchase.';
  }
  if (action === 'WARN_DISPLAYED' || decision === 'WARN') {
    return 'Next step: show this warning and ask the buyer before paying.';
  }
  if (action === 'CAPTURE_PAUSED' || decision === 'PAUSE') {
    return 'Next step: stop. A human must review this checkout; do not pay.';
  }
  return 'Next step: review the guardian result before paying.';
}

function reasonLines(verdict: VerdictShape): string[] {
  const bullets = verdict.explanation?.bullets;
  const lines: string[] = [];

  if (Array.isArray(bullets)) {
    for (const bullet of bullets) {
      if (!isRecord(bullet) || typeof bullet.text !== 'string') continue;
      const ids = Array.isArray(bullet.evidenceIds)
        ? bullet.evidenceIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
        : [];
      const citation = ids.length > 0 ? ` (${ids.join(', ')})` : '';
      lines.push(`- ${bullet.text}${citation}`);
      if (lines.length >= MAX_REASONS) break;
    }
  }

  if (lines.length === 0 && verdict.summary) {
    lines.push(`- ${verdict.summary}`);
  }

  return lines;
}

function traceLines(verdict: VerdictShape): string[] {
  if (!Array.isArray(verdict.trace)) return [];

  const lines: string[] = [];
  for (const step of verdict.trace) {
    if (!isRecord(step)) continue;
    const tool = asString(step.tool);
    if (!tool) continue;
    const result = asString(step.result) ?? asString(step.why) ?? 'checked';
    lines.push(`- ${tool}: ${result.slice(0, 90)}`);
    if (lines.length >= MAX_TRACE_LINES) break;
  }
  return lines;
}

export function formatVerdict(
  data: unknown,
  options: { includeNextStep?: boolean } = {}
): string {
  const verdict = normalizeVerdict(data);
  const decision = asString(verdict.decision) ?? 'UNKNOWN';
  const score = asNumber(verdict.score);
  const confidence = asNumber(verdict.confidence);

  const scorePart = score === undefined ? '' : ` — ${Math.round(score)}/100`;
  const confidencePart =
    confidence === undefined ? '' : ` (confidence ${confidence.toFixed(2)})`;

  const lines: string[] = [`Decision: ${decision}${scorePart}${confidencePart}`];

  const headline = asString(verdict.explanation?.headline);
  if (headline) lines.push(headline);
  else if (verdict.summary) lines.push(verdict.summary);

  const reasons = reasonLines(verdict);
  if (reasons.length > 0) {
    lines.push('Reasons:');
    lines.push(...reasons);
  }

  const checked = traceLines(verdict);
  if (checked.length > 0) {
    lines.push('What I checked:');
    lines.push(...checked);
  }

  if (options.includeNextStep !== false) {
    lines.push(nextStepFor(asString(verdict.recommendedAction), asString(verdict.decision)));
  }
  return clampText(lines.join('\n'));
}

export function formatCheckout(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const status = asString(record.status) ?? 'UNKNOWN';
  const checkoutId = asString(record.checkoutId);

  const lines: string[] = [`Checkout: ${status}`];
  if (checkoutId) lines.push(`Checkout ID: ${checkoutId}`);

  const verdict = normalizeVerdict(data);
  if (verdict.decision) {
    lines.push(formatVerdict(verdict, { includeNextStep: false }));
  }

  if (status === 'CAPTURED') {
    lines.push('Next step: purchase completed.');
  } else if (status === 'PAUSED') {
    lines.push('Next step: stop. A human must review this checkout; do not pay.');
  } else if (status === 'NEEDS_HUMAN_DECISION') {
    lines.push('Next step: ask the buyer to approve the warning or decline.');
  } else if (status === 'AWAITING_APPROVAL') {
    lines.push('Next step: approve the payment in the provider window.');
  } else {
    lines.push('Next step: review the checkout status before paying.');
  }

  return clampText(lines.join('\n'));
}

export function formatPolicy(agentId: string, data: unknown): string {
  const record =
    isRecord(data) && isRecord(data.policy) ? data.policy : isRecord(data) ? data : {};
  const currency = asString(record.currency) ?? '';
  const perOrder = asNumber(record.perOrderCap);
  const daily = asNumber(record.dailyCap);
  const firstPurchase = asNumber(record.firstPurchaseCap);

  const lines = [`Spend policy saved for ${agentId}.`];
  if (perOrder !== undefined) lines.push(`Per order: ${currency} ${perOrder.toFixed(2)}`);
  if (daily !== undefined) lines.push(`Daily: ${currency} ${daily.toFixed(2)}`);
  if (firstPurchase !== undefined) {
    lines.push(`First purchase: ${currency} ${firstPurchase.toFixed(2)}`);
  }
  lines.push('Next step: create the guarded checkout when the buyer is ready.');

  return clampText(lines.join('\n'));
}

export function toolResult(
  text: string,
  structuredContent: Record<string, unknown>
): CallToolResult {
  return {
    content: [{ type: 'text', text: clampText(text) }],
    structuredContent,
  };
}

export function errorResult(error: unknown): CallToolResult {
  const isGuardianError = error instanceof GuardianApiError;
  const code = isGuardianError ? error.code : 'UNEXPECTED_ERROR';
  const message = isGuardianError
    ? error.message
    : 'Could not complete the request. Nothing was charged.';

  return {
    content: [{ type: 'text', text: clampText(`Error: ${message}`) }],
    structuredContent: { error: { code, message: plainMessageFor(code) } },
    isError: true,
  };
}
