import { z } from 'zod';

import type {
  Evidence,
  IdentityMatchResult,
  IdentityPair,
  IdentityRelation,
} from '../types.js';
import type { IdFactory } from '../evidence/ids.js';
import type { LlmClient } from '../llm/client.js';
import { IDENTITY_SYSTEM, wrapUntrusted } from '../llm/prompts.js';
import { identitySentence } from '../explain/template.js';
import { sanitizeModelText } from '../guard/output.js';
import { sanitizeText } from '../guard/shield.js';
import { coreName, normalizeLegal } from './normalize.js';
import { effectiveSimilarity, round3 } from './similarity.js';

/**
 * Identity matching compares "who the site says it is" with "who the payee
 * actually is". The model may only make the answer stricter than the string
 * math: a relation is capped by the measured similarity, and the result can only
 * add suspicion, never remove it (invariant I9).
 */

export const IDENTITY_RELATIONS = [
  'same_entity',
  'likely_same',
  'related_entity',
  'unknown',
  'different',
] as const;

export const IdentityResponseSchema = z
  .object({
    pairs: z
      .array(
        z
          .object({
            id: z.enum(['P1', 'P2']),
            relation: z.enum(IDENTITY_RELATIONS),
            reason: z.string().max(160).optional(),
          })
          .strict()
      )
      .min(1)
      .max(2),
    locationConsistent: z.boolean().optional(),
    gaps: z.array(z.string().max(160)).max(5).optional(),
  })
  .strict();

export type IdentityResponse = z.infer<typeof IdentityResponseSchema>;

export const IDENTITY_TIMEOUT_MS = 2500;
export const IDENTITY_MAX_TOKENS = 500;

const RELATION_SCORE: Record<IdentityRelation, number> = {
  same_entity: 0.95,
  likely_same: 0.8,
  related_entity: 0.55,
  unknown: 0.4,
  different: 0.1,
};

const RELATION_RANK: Record<IdentityRelation, number> = {
  different: 0,
  unknown: 1,
  related_entity: 2,
  likely_same: 3,
  same_entity: 4,
};

export interface IdentityPayeeRecord {
  merchantId: string;
  legalName: string;
  brandNames?: string[];
  city?: string;
  country?: string;
}

export interface IdentityInput {
  siteName?: string;
  legalName?: string;
  claimedBrand?: string;
  claimedLocation?: { city?: string; country?: string };
  payeeRecord?: IdentityPayeeRecord | null;
}

export interface IdentityMatchOptions {
  llm?: LlmClient;
  /** Defaults to true. With false the deterministic fallback is used. */
  useLlm?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface IdentityMatchOutput {
  result: IdentityMatchResult | null;
  evidence: Evidence[];
  usedLlm: boolean;
  degraded: boolean;
}

interface Pair {
  id: 'P1' | 'P2';
  aRaw: string;
  bRaw: string;
  similarity: number;
  shortcut: boolean;
}

export async function matchIdentity(
  input: IdentityInput | undefined,
  ids: IdFactory,
  options: IdentityMatchOptions = {}
): Promise<IdentityMatchOutput> {
  try {
    return await run(input, ids, options);
  } catch {
    return {
      result: null,
      evidence: [unverifiable(ids, 'internal_error')],
      usedLlm: false,
      degraded: true,
    };
  }
}

async function run(
  input: IdentityInput | undefined,
  ids: IdFactory,
  options: IdentityMatchOptions
): Promise<IdentityMatchOutput> {
  const payee = input?.payeeRecord;
  const siteName = cleanName(input?.siteName);
  const legalName = cleanName(input?.legalName);
  const claimedBrand = cleanName(input?.claimedBrand);
  const siteSide = legalName ?? siteName;

  if (!payee || !payee.merchantId || !payee.legalName) {
    return { result: null, evidence: [unverifiable(ids, 'no_registry_record')], usedLlm: false, degraded: false };
  }

  if (!siteSide && !claimedBrand) {
    return { result: null, evidence: [unverifiable(ids, 'no_claimed_name')], usedLlm: false, degraded: false };
  }

  const pairs = buildPairs(siteSide, claimedBrand, payee);
  if (pairs.length === 0) {
    return { result: null, evidence: [unverifiable(ids, 'names_not_comparable')], usedLlm: false, degraded: false };
  }

  const relations = new Map<'P1' | 'P2', IdentityRelation>();
  for (const pair of pairs) if (pair.shortcut) relations.set(pair.id, 'same_entity');

  const unresolved = pairs.filter((pair) => !relations.has(pair.id));
  let usedLlm = false;
  let degraded = false;
  let modelLocation: boolean | undefined;
  let gaps: string[] = [];

  if (unresolved.length > 0) {
    const canUseLlm = options.useLlm !== false && Boolean(options.llm);

    if (canUseLlm && options.llm) {
      usedLlm = true;
      const reply = await askModel(options.llm, unresolved, input, payee, options);

      if (reply.ok) {
        for (const pair of unresolved) {
          relations.set(pair.id, capRelation(reply.relations.get(pair.id) ?? 'unknown', pair.similarity));
        }
        modelLocation = reply.locationConsistent;
        gaps = reply.gaps;
      } else {
        degraded = true;
        for (const pair of unresolved) relations.set(pair.id, fallbackRelation(pair.similarity));
      }
    } else {
      for (const pair of unresolved) relations.set(pair.id, fallbackRelation(pair.similarity));
    }
  }

  const codeLocation = checkLocation(input?.claimedLocation, payee);
  const locationConsistent =
    codeLocation === false ? false : codeLocation === true ? true : modelLocation;

  if (locationConsistent === false) {
    if (!gaps.some((gap) => /location/i.test(gap))) {
      gaps = ['The site claims a location that differs from the registered business.', ...gaps].slice(0, 5);
    }
    for (const pair of pairs) {
      const current = relations.get(pair.id) ?? 'unknown';
      if (RELATION_RANK[current] > RELATION_RANK.related_entity) {
        relations.set(pair.id, 'related_entity');
      }
    }
  }

  const resolvedPairs: IdentityPair[] = pairs.map((pair) => ({
    id: pair.id,
    a: pair.aRaw,
    b: pair.bRaw,
    relation: relations.get(pair.id) ?? 'unknown',
    similarity: pair.similarity,
  }));

  const overall = round3(Math.min(...resolvedPairs.map((pair) => RELATION_SCORE[pair.relation])));
  const result: IdentityMatchResult = {
    pairs: resolvedPairs,
    overall,
    ...(locationConsistent !== undefined ? { locationConsistent } : {}),
    ...(gaps.length > 0 ? { gaps: gaps.slice(0, 5) } : {}),
  };

  const allShortcuts = pairs.every((pair) => pair.shortcut);
  const source: Evidence['source'] = allShortcuts ? 'rule' : usedLlm && !degraded ? 'llm' : 'rule';

  return {
    result,
    evidence: [
      {
        id: ids.next('IDENTITY_MATCH'),
        type: 'IDENTITY_MATCH',
        severity: overall < 0.3 ? 'high' : overall < 0.6 ? 'medium' : overall < 0.85 ? 'low' : 'info',
        confidence: 0.7,
        summary: identitySentence(overall),
        source,
        deterministic: allShortcuts,
        data: {
          pairs: resolvedPairs.map((pair) => ({
            id: pair.id,
            a: pair.a,
            b: pair.b,
            relation: pair.relation,
            similarity: pair.similarity,
          })),
          overall,
          ...(locationConsistent !== undefined ? { locationConsistent } : {}),
          ...(gaps.length > 0 ? { gaps: gaps.slice(0, 5) } : {}),
        },
      },
    ],
    usedLlm,
    degraded,
  };
}

function buildPairs(siteSide: string | undefined, claimedBrand: string | undefined, payee: IdentityPayeeRecord): Pair[] {
  const pairs: Pair[] = [];

  if (siteSide) {
    const a = normalizeLegal(siteSide);
    const b = normalizeLegal(payee.legalName);
    if (a && b) {
      pairs.push({
        id: 'P1',
        aRaw: siteSide,
        bRaw: payee.legalName,
        similarity: round3(effectiveSimilarity(a, b)),
        shortcut: a === b,
      });
    }
  }

  if (claimedBrand) {
    const brandCore = coreName(claimedBrand);
    if (brandCore) {
      const candidates = [...(payee.brandNames ?? []), payee.legalName].filter(
        (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
      );

      let best: { raw: string; normalized: string; score: number } | undefined;
      for (const candidate of candidates) {
        const normalized = coreName(candidate);
        if (!normalized) continue;
        const score = effectiveSimilarity(brandCore, normalized);
        if (!best || score > best.score) best = { raw: candidate, normalized, score };
      }

      if (best) {
        pairs.push({
          id: 'P2',
          aRaw: claimedBrand,
          bRaw: best.raw,
          similarity: round3(best.score),
          shortcut: brandCore === best.normalized,
        });
      }
    }
  }

  return pairs;
}

async function askModel(
  llm: LlmClient,
  unresolved: Pair[],
  input: IdentityInput | undefined,
  payee: IdentityPayeeRecord,
  options: IdentityMatchOptions
): Promise<
  | { ok: true; relations: Map<'P1' | 'P2', IdentityRelation>; locationConsistent?: boolean; gaps: string[] }
  | { ok: false }
> {
  const user = [
    'Compare each name pair and return the requested JSON.',
    wrapUntrusted(
      'name_pairs',
      unresolved.map((pair) => ({ id: pair.id, siteSide: pair.aRaw, payeeSide: pair.bRaw }))
    ),
    wrapUntrusted('locations', {
      site: input?.claimedLocation ?? null,
      payee: { city: payee.city ?? null, country: payee.country ?? null },
    }),
    `Pair ids to classify: ${unresolved.map((pair) => pair.id).join(', ')}`,
  ].join('\n');

  const response = await llm.generateJson({
    tier: 'fast',
    system: IDENTITY_SYSTEM,
    user,
    schema: IdentityResponseSchema,
    schemaName: 'IdentityMatch',
    maxOutputTokens: IDENTITY_MAX_TOKENS,
    timeoutMs: options.timeoutMs ?? IDENTITY_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) return { ok: false };

  const relations = new Map<'P1' | 'P2', IdentityRelation>();
  for (const entry of response.data.pairs) {
    if (!relations.has(entry.id)) relations.set(entry.id, entry.relation);
  }

  const gaps = (response.data.gaps ?? [])
    .map((gap) => sanitizeModelText(gap, 160))
    .filter((gap): gap is string => Boolean(gap))
    .slice(0, 5);

  return {
    ok: true,
    relations,
    ...(response.data.locationConsistent !== undefined
      ? { locationConsistent: response.data.locationConsistent }
      : {}),
    gaps,
  };
}

export function capRelation(relation: IdentityRelation, measured: number): IdentityRelation {
  const ceiling: IdentityRelation =
    measured < 0.4 ? 'related_entity' : measured <= 0.7 ? 'likely_same' : 'same_entity';

  return RELATION_RANK[relation] <= RELATION_RANK[ceiling] ? relation : ceiling;
}

export function fallbackRelation(measured: number): IdentityRelation {
  if (measured >= 0.92) return 'likely_same';
  if (measured >= 0.7) return 'related_entity';
  return 'different';
}

function checkLocation(
  site: { city?: string; country?: string } | undefined,
  payee: IdentityPayeeRecord
): boolean | undefined {
  const siteCity = normalizePlace(site?.city);
  const payeeCity = normalizePlace(payee.city);
  const siteCountry = normalizePlace(site?.country);
  const payeeCountry = normalizePlace(payee.country);

  let compared = false;
  if (siteCity && payeeCity) {
    compared = true;
    if (siteCity !== payeeCity) return false;
  }
  if (siteCountry && payeeCountry) {
    compared = true;
    if (siteCountry !== payeeCountry) return false;
  }

  return compared ? true : undefined;
}

function normalizePlace(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function cleanName(value: unknown): string | undefined {
  const { clean } = sanitizeText(value, { location: 'visible', maxLen: 160 });
  return clean.length > 0 ? clean : undefined;
}

function unverifiable(ids: IdFactory, reason: string): Evidence {
  return {
    id: ids.next('IDENTITY_UNVERIFIABLE'),
    type: 'IDENTITY_UNVERIFIABLE',
    severity: 'info',
    confidence: 1,
    summary: 'The name on the site could not be compared with the registered business.',
    source: 'rule',
    deterministic: true,
    data: { reason },
  };
}
