import { z } from 'zod';

import type { Decision, Evidence, Explanation, HardRuleTrigger } from '../types.js';
import type { LlmClient } from '../llm/client.js';
import { EXPLANATION_SYSTEM } from '../llm/prompts.js';
import { truncate } from '../tools/call.js';

/**
 * The explanation writer. It receives only code-built facts and sanitised
 * evidence summaries — never page text — and returns a short, cited explanation.
 * Its output is always passed through the checker before anyone sees it.
 */

export const ExplanationResponseSchema = z
  .object({
    headline: z.string().min(1).max(90),
    bullets: z
      .array(
        z
          .object({
            text: z.string().min(1).max(160),
            evidenceIds: z.array(z.string().min(1)).min(1).max(6),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

export type ExplanationResponse = z.infer<typeof ExplanationResponseSchema>;

export const EXPLANATION_TIMEOUT_MS = 2500;
export const EXPLANATION_MAX_TOKENS = 500;
export const MAX_WRITER_EVIDENCE = 8;

const KEY_FACTS = ['ageDays', 'discountPct', 'overall', 'status', 'offerCount', 'matchType'];

export interface ExplanationWriterInput {
  decision: Decision;
  score: number;
  confidence: number;
  evidence: Evidence[];
  hardRules: HardRuleTrigger[];
  identityGaps?: string[];
}

export interface ExplanationWriterOptions {
  llm?: LlmClient;
  useLlm?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExplanationWriterResult {
  explanation?: Explanation;
  attempted: boolean;
  ok: boolean;
}

export async function writeExplanation(
  input: ExplanationWriterInput,
  options: ExplanationWriterOptions = {}
): Promise<ExplanationWriterResult> {
  if (options.useLlm === false || !options.llm) {
    return { attempted: false, ok: false };
  }

  const response = await options.llm.generateJson({
    tier: 'fast',
    system: EXPLANATION_SYSTEM,
    user: buildWriterUser(input),
    schema: ExplanationResponseSchema,
    schemaName: 'Explanation',
    maxOutputTokens: EXPLANATION_MAX_TOKENS,
    timeoutMs: options.timeoutMs ?? EXPLANATION_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) return { attempted: true, ok: false };

  return { attempted: true, ok: true, explanation: response.data };
}

export function buildWriterUser(input: ExplanationWriterInput): string {
  const evidenceLines = input.evidence
    .slice(0, MAX_WRITER_EVIDENCE)
    .map((entry) => `- ${entry.id} | ${entry.type} | ${truncate(entry.summary, 160)}${describeFacts(entry)}`)
    .join('\n');

  const hardRules =
    input.hardRules.length > 0
      ? input.hardRules.map((rule) => `${rule.rule} (${rule.evidenceIds.join(', ')})`).join('; ')
      : 'none';

  const lines = [
    `Decision: ${input.decision} (score ${input.score}, confidence ${input.confidence.toFixed(2)})`,
    '',
    'Evidence you may cite (trusted):',
    evidenceLines || '- none',
    '',
    `Hard rules: ${hardRules}`,
  ];

  if (input.identityGaps && input.identityGaps.length > 0) {
    lines.push('', 'Identity gaps:', ...input.identityGaps.map((gap) => `- ${gap}`));
  }

  lines.push(
    '',
    'Write a headline and between 1 and 5 bullets. Every bullet must cite ids from the list above.'
  );

  return lines.join('\n');
}

function describeFacts(entry: Evidence): string {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const facts: string[] = [];

  for (const key of KEY_FACTS) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) facts.push(`${key}=${value}`);
    else if (typeof value === 'string' && value.length <= 40) facts.push(`${key}=${value}`);
  }

  return facts.length > 0 ? ` | ${facts.join(', ')}` : '';
}
