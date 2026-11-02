import { z } from 'zod';

import type { Evidence } from '../types.js';
import type { LlmClient } from '../llm/client.js';
import { PATTERN_SYSTEM } from '../llm/prompts.js';
import { containsForbiddenReference } from '../guard/output.js';
import { sanitizeText } from '../guard/shield.js';
import { pointsFor } from '../scoring/pointsFor.js';
import { truncateText } from '../explain/template.js';

/**
 * The memory pattern sentence.
 *
 * The model turns code-built facts into one neutral sentence describing the
 * scheme (not the shop). The sentence is validated before it may be stored: no
 * injection phrasing, no URLs, no merchant name, no long digit strings. If
 * anything fails, a template sentence built from the same facts is used.
 */

export type DomainAgeBucket = '<7d' | '7-29d' | '30-89d' | '>=90d' | 'unknown';
export type DiscountBucket = '<50' | '50-69' | '70-79' | '>=80' | 'unknown';

export interface PatternFacts {
  evidence: { type: string; summary: string }[];
  domainAgeBucket: DomainAgeBucket;
  discountBucket: DiscountBucket;
  flags: {
    lookalike: boolean;
    payeeMismatch: boolean;
    noBinding: boolean;
    unknownSeller: boolean;
    brandMismatch: boolean;
    freeEmail: boolean;
    injection: boolean;
  };
}

export const PatternResponseSchema = z.object({ pattern: z.string().min(10).max(300) }).strict();

export const PATTERN_TIMEOUT_MS = 2000;
export const PATTERN_MAX_TOKENS = 120;
export const PATTERN_MAX_WORDS = 45;

export function buildPatternFacts(evidence: readonly Evidence[] | undefined): PatternFacts {
  const list = Array.isArray(evidence) ? evidence : [];
  const ageEvidence = list.find((entry) => entry.type === 'DOMAIN_AGE');
  const priceEvidence = list.find((entry) => entry.type === 'PRICE_DEVIATION');
  const binding = list.find((entry) => entry.type === 'PAYEE_BINDING');
  const status = typeof binding?.data?.status === 'string' ? binding.data.status : undefined;

  return {
    evidence: list
      .filter((entry) => (pointsFor(entry)?.points ?? 0) > 0)
      .map((entry) => ({ type: entry.type, summary: truncateText(entry.summary, 160) })),
    domainAgeBucket: bucketAge(ageEvidence?.data?.ageDays),
    discountBucket: bucketDiscount(priceEvidence?.data?.discountPct),
    flags: {
      lookalike: list.some((entry) => entry.type === 'LOOKALIKE_DOMAIN' && entry.data?.matchesKnownBrand === true),
      payeeMismatch: status === 'MISMATCH',
      noBinding: status === 'NO_BINDING',
      unknownSeller: status === 'UNKNOWN_MERCHANT',
      brandMismatch: list.some((entry) => entry.type === 'CLAIMED_BRAND_MISMATCH'),
      freeEmail: list.some((entry) => entry.type === 'PAYEE_FREE_EMAIL'),
      injection: list.some((entry) => entry.type === 'INJECTION_ATTEMPT'),
    },
  };
}

export function bucketAge(value: unknown): DomainAgeBucket {
  const age = Number(value);
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  if (age < 7) return '<7d';
  if (age < 30) return '7-29d';
  if (age < 90) return '30-89d';
  return '>=90d';
}

export function bucketDiscount(value: unknown): DiscountBucket {
  const discount = Number(value);
  if (!Number.isFinite(discount)) return 'unknown';
  if (discount < 50) return '<50';
  if (discount < 70) return '50-69';
  if (discount < 80) return '70-79';
  return '>=80';
}

export function templatePatternSentence(facts: PatternFacts): string {
  const recent = facts.domainAgeBucket === '<7d' || facts.domainAgeBucket === '7-29d';
  const clauses: string[] = [];

  if (facts.flags.lookalike) clauses.push('imitates a known brand');
  if (facts.discountBucket === '>=80') clauses.push('sells far below market price');
  else if (facts.discountBucket === '70-79') clauses.push('sells well below market price');
  if (facts.flags.payeeMismatch || facts.flags.brandMismatch) {
    clauses.push('routes payment to a business unrelated to the brand');
  } else if (facts.flags.unknownSeller) {
    clauses.push('is not present in the merchant registry');
  } else if (facts.flags.noBinding) {
    clauses.push('receives payment in an account not linked to the site');
  }
  if (facts.flags.freeEmail) clauses.push('asks for payment to a personal email address');
  if (facts.flags.injection) clauses.push('hides text aimed at automated shopping assistants');

  const subject = recent ? 'A recently created store' : 'A store';
  if (clauses.length === 0) {
    return `${subject} shows several weak signals and needs manual review.`;
  }

  const body =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;

  return truncateText(`${subject} ${body}.`, 300);
}

export function validatePatternSentence(
  candidate: unknown,
  forbiddenTerms: readonly string[] = []
): string | undefined {
  if (typeof candidate !== 'string') return undefined;

  // Length is checked before sanitising, otherwise a too-long sentence would be
  // silently truncated into a half sentence and accepted.
  const raw = candidate.trim();
  if (raw.length < 10 || raw.length > 300) return undefined;
  if (raw.split(/\s+/).filter(Boolean).length > PATTERN_MAX_WORDS) return undefined;

  const { clean, findings } = sanitizeText(raw, { location: 'memory', maxLen: 300 });
  if (findings.length > 0) return undefined;

  const text = clean.trim();
  if (text.length < 10) return undefined;
  if (containsForbiddenReference(text)) return undefined;
  if (/\d{4,}/.test(text)) return undefined;

  const lower = text.toLowerCase();
  for (const term of forbiddenTerms) {
    const normalized = String(term ?? '').trim().toLowerCase();
    if (normalized.length >= 3 && lower.includes(normalized)) return undefined;
  }

  return text;
}

export interface PatternOptions {
  llm?: LlmClient;
  useLlm?: boolean;
  timeoutMs?: number;
  forbiddenTerms?: readonly string[];
  signal?: AbortSignal;
}

export interface PatternResult {
  sentence: string;
  usedLlm: boolean;
  degraded: boolean;
}

export async function writePatternSentence(
  facts: PatternFacts,
  options: PatternOptions = {}
): Promise<PatternResult> {
  const template = templatePatternSentence(facts);

  if (options.useLlm === false || !options.llm) {
    return { sentence: template, usedLlm: false, degraded: false };
  }

  const response = await options.llm.generateJson({
    tier: 'fast',
    system: PATTERN_SYSTEM,
    user: buildPatternUser(facts),
    schema: PatternResponseSchema,
    schemaName: 'PatternSentence',
    maxOutputTokens: PATTERN_MAX_TOKENS,
    timeoutMs: options.timeoutMs ?? PATTERN_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    return { sentence: template, usedLlm: true, degraded: true };
  }

  const validated = validatePatternSentence(response.data.pattern, options.forbiddenTerms ?? []);
  if (!validated) {
    return { sentence: template, usedLlm: true, degraded: true };
  }

  return { sentence: validated, usedLlm: true, degraded: false };
}

export function buildPatternUser(facts: PatternFacts): string {
  const flags = Object.entries(facts.flags)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

  const evidenceLines = facts.evidence
    .slice(0, 10)
    .map((entry) => `- ${entry.type}: ${entry.summary}`)
    .join('\n');

  return [
    'Describe the scheme in one neutral sentence. Do not name the business.',
    `Signals: ${flags}`,
    `Domain age bucket: ${facts.domainAgeBucket}`,
    `Discount bucket: ${facts.discountBucket}`,
    '',
    'Evidence (trusted):',
    evidenceLines || '- none',
  ].join('\n');
}
