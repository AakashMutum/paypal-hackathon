import { createHash } from 'node:crypto';

import type { Evidence } from '../types.js';
import type { MemoryHit, MemoryPort, MemoryQuery, MemoryDocument } from '../ports.js';
import type { IdFactory } from '../evidence/ids.js';
import { callWithRetry } from '../tools/call.js';
import { containsForbiddenReference } from '../guard/output.js';
import { sanitizeText } from '../guard/shield.js';
import { pointsFor } from '../scoring/pointsFor.js';
import { bucketAge, bucketDiscount } from './pattern.js';

/**
 * Memory search and write rules.
 *
 * Exact repeats (same payee or same domain) are deterministic evidence worth 30
 * points. Semantic matches are fuzzy, so they are non-deterministic and capped
 * by rule R4 — they can never cause a PAUSE alone.
 */

export const MEMORY_SEARCH_TIMEOUT_MS = 4000;
export const MEMORY_WRITE_TIMEOUT_MS = 3000;
export const MEMORY_MATCHES_LIMIT = 3;

export function memoryIdFor(registrableDomain: string, payeeMerchantId?: string): string {
  return createHash('sha1').update(`${registrableDomain}|${payeeMerchantId ?? ''}`).digest('hex');
}

export async function searchMemory(
  query: MemoryQuery,
  memory: MemoryPort | undefined,
  options: { timeoutMs?: number; now?: () => number; log?: (event: Record<string, unknown>) => void } = {}
): Promise<MemoryHit[]> {
  if (!memory) return [];

  const outcome = await callWithRetry((callOptions) => memory.search(query, callOptions), {
    timeoutMs: options.timeoutMs ?? MEMORY_SEARCH_TIMEOUT_MS,
    attempts: 1,
    now: options.now,
  });

  if (!outcome.ok) {
    options.log?.({ evt: 'memory_search_failed', detail: outcome.error });
    return [];
  }

  return Array.isArray(outcome.value) ? outcome.value.slice(0, 10) : [];
}

export function buildMemoryEvidence(
  hits: readonly MemoryHit[] | undefined,
  ids: IdFactory,
  minScore: number
): Evidence[] {
  const list = Array.isArray(hits) ? hits : [];
  const evidence: Evidence[] = [];

  const exact = list.filter(
    (hit) => hit.matchType === 'exact_payee' || hit.matchType === 'exact_domain'
  );
  const exactIds = new Set(exact.map((hit) => hit.id));

  if (exact.length > 0) {
    const matchType = exact.some((hit) => hit.matchType === 'exact_payee')
      ? 'exact_payee'
      : 'exact_domain';

    evidence.push({
      id: ids.next('SCAM_MEMORY_MATCH'),
      type: 'SCAM_MEMORY_MATCH',
      severity: 'high',
      confidence: 0.9,
      summary: 'The seller or domain matches a case Guardian flagged before.',
      source: 'elastic',
      deterministic: true,
      data: { matchType, matches: buildMatches(exact) },
    });
  }

  const semantic = list.filter(
    (hit) =>
      hit.matchType === 'semantic' &&
      !exactIds.has(hit.id) &&
      hit.decision !== 'ALLOW' &&
      (hit.score ?? 0) >= minScore
  );

  if (semantic.length > 0) {
    evidence.push({
      id: ids.next('SCAM_MEMORY_MATCH'),
      type: 'SCAM_MEMORY_MATCH',
      severity: 'medium',
      confidence: 0.7,
      summary: 'The pattern is similar to cases Guardian has flagged before.',
      source: 'elastic',
      deterministic: false,
      data: { matchType: 'semantic', matches: buildMatches(semantic) },
    });
  }

  return evidence;
}

export function buildMemoryDocument(input: {
  registrableDomain: string;
  domain: string;
  payeeMerchantId?: string;
  decision: MemoryDocument['decision'];
  riskScore: number;
  patternText: string;
  evidence: readonly Evidence[];
}): MemoryDocument {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const ageEvidence = evidence.find((entry) => entry.type === 'DOMAIN_AGE');
  const priceEvidence = evidence.find((entry) => entry.type === 'PRICE_DEVIATION');

  return {
    id: memoryIdFor(input.registrableDomain, input.payeeMerchantId),
    patternText: input.patternText,
    domain: input.domain,
    registrableDomain: input.registrableDomain,
    ...(input.payeeMerchantId ? { payeeMerchantId: input.payeeMerchantId } : {}),
    decision: input.decision,
    riskScore: input.riskScore,
    evidenceTypes: [
      ...new Set(
        evidence.filter((entry) => (pointsFor(entry)?.points ?? 0) > 0).map((entry) => entry.type)
      ),
    ],
    domainAgeBucket: bucketAge(ageEvidence?.data?.ageDays),
    discountBucket: bucketDiscount(priceEvidence?.data?.discountPct),
  };
}

export async function writeMemorySafely(
  document: MemoryDocument,
  memory: MemoryPort | undefined,
  options: { timeoutMs?: number; now?: () => number; log?: (event: Record<string, unknown>) => void } = {}
): Promise<boolean> {
  if (!memory) return false;

  const outcome = await callWithRetry((callOptions) => memory.write(document, callOptions), {
    timeoutMs: options.timeoutMs ?? MEMORY_WRITE_TIMEOUT_MS,
    attempts: 1,
    now: options.now,
  });

  if (!outcome.ok) {
    options.log?.({ evt: 'memory_write_failed', detail: outcome.error });
    return false;
  }

  return true;
}

function buildMatches(hits: readonly MemoryHit[]): {
  patternText: string;
  decision: string;
  score: number;
  seed: boolean;
}[] {
  const matches: { patternText: string; decision: string; score: number; seed: boolean }[] = [];

  for (const hit of hits) {
    if (matches.length >= MEMORY_MATCHES_LIMIT) break;

    const text = safePatternText(hit.patternText);
    if (!text) continue;

    matches.push({
      patternText: text,
      decision: hit.decision,
      score: typeof hit.score === 'number' ? Math.round(hit.score * 1000) / 1000 : 0,
      seed: hit.seed === true,
    });
  }

  return matches;
}

function safePatternText(value: unknown): string | undefined {
  const { clean, findings } = sanitizeText(value, { location: 'memory', maxLen: 200 });
  if (findings.length > 0) return undefined;

  const text = clean.trim();
  if (text.length === 0) return undefined;
  if (containsForbiddenReference(text)) return undefined;

  return text;
}
