
import { z } from 'zod';

import type { Decision, Evidence, Explanation, HardRuleTrigger } from '../types.js';
import { RetrievedCaseSchema } from '../types.js';
import type { LlmClient } from '../llm/client.js';
import { EXPLANATION_SYSTEM, wrapUntrusted } from '../llm/prompts.js';
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
    retrievedCases: z.array(RetrievedCaseSchema).max(3).optional(),
  })
  .strict();

export type ExplanationResponse = z.infer<typeof ExplanationResponseSchema>;

export const EXPLANATION_TIMEOUT_MS = 20000;
export const EXPLANATION_MAX_TOKENS = 500;
export const MAX_WRITER_EVIDENCE = 8;

const KEY_FACTS = ['ageDays', 'discountPct', 'overall', 'status', 'offerCount', 'matchType'];

export interface RetrievedCaseInput {
  caseId: string;
  patternText: string;
  decision: Decision;
  score: number;
  retrieval?: string;
}

export interface ExplanationWriterInput {
  decision: Decision;
  score: number;
  confidence: number;
  evidence: Evidence[];
  hardRules: HardRuleTrigger[];
  identityGaps?: string[];
  /** Historical cases retrieved from memory. Context only; they never change the decision. */
  retrievedCases?: RetrievedCaseInput[];
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
    .map(
      (entry) =>
        `- ${entry.id} | ${entry.type} | ${truncate(entry.summary, 160)}${describeFacts(entry)}${describeMemoryMatches(entry)}`
    )
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

  const retrieved = input.retrievedCases ?? [];
  lines.push(
    '',
    'Historical cases retrieved from memory (context only; never evidence for this case and never a reason to change the decision):',
    ...(retrieved.length > 0
      ? retrieved
          .slice(0, 3)
          .map(
            (entry) =>
              `- ${entry.caseId} | ${entry.decision} | score ${entry.score.toFixed(2)} | ${entry.retrieval ?? 'semantic'} | ${truncate(entry.patternText, 160)}`,
          )
      : ['- none']),
    '',
    'Write a headline and between 1 and 5 bullets. Every bullet must cite ids from the evidence list above.',
    'If a retrieved case helps explain the decision, add "retrievedCases":[{"caseId":"<one of the ids above>","relevance":"<=160 chars"}]. Use only the ids above. Do not let a past case change the decision.',
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

function describeMemoryMatches(entry: Evidence): string {
  if (entry.type !== 'SCAM_MEMORY_MATCH') return '';

  const data = (entry.data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(data.matches)) return '';

  const matches = data.matches
    .slice(0, 3)
    .flatMap((match) => {
      if (!match || typeof match !== 'object') return [];

      const item = match as Record<string, unknown>;

      if (typeof item.patternText !== 'string' || typeof item.decision !== 'string') {
        return [];
      }

      return [
        {
          previousPattern: truncate(item.patternText, 160),
          previousDecision: item.decision,
        },
      ];
    });

  if (matches.length === 0) return '';

  return `\nPrevious-case context (historical examples, not proof):\n${wrapUntrusted('previous_case_matches', matches)}`;
}
