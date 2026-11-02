/**
 * Anonymous memory of past scam investigations.
 *
 * A stored pattern never holds a customer, a person's name, an email, a phone number, a street
 * address or a raw payee id. It holds only indicators that cannot identify an individual.
 */

import type { Decision } from '../types/contracts-fallback.js';

export const DOMAIN_AGE_BUCKETS = ['<7d', '7-29d', '30-89d', '>=90d', 'unknown'] as const;
export const DISCOUNT_BUCKETS = ['<50', '50-69', '70-79', '>=80', 'unknown'] as const;
export type DomainAgeBucket = (typeof DOMAIN_AGE_BUCKETS)[number];
export type DiscountBucket = (typeof DISCOUNT_BUCKETS)[number];

export interface PastInvestigation {
  /** Stable id: a hash of the registrable domain and the payee hash. */
  id: string;
  registrableDomain: string;
  /** SHA-256 of the payee merchant id. The raw id is never stored. */
  payeeHash?: string;
  decision: Decision;
  /** Risk from 0 to 1. */
  riskScore: number;
  evidenceTypes: string[];
  domainAgeBucket: DomainAgeBucket;
  discountBucket: DiscountBucket;
  /** One anonymous sentence describing the pattern. */
  patternText: string;
  /** ISO time of the latest sighting. */
  timestamp: string;
  seed: boolean;
  seenCount: number;
}

export type PatternMatchType = 'exact_payee' | 'exact_domain' | 'semantic';

export interface PatternQuery {
  patternText: string;
  registrableDomain: string;
  payeeHash?: string;
}

export interface PatternHit {
  id: string;
  matchType: PatternMatchType;
  patternText: string;
  decision: Decision;
  riskScore: number;
  seed: boolean;
  /** Match strength from 0 to 1, already reduced by age decay. */
  score: number;
}

export interface PatternStoreOptions {
  now?: () => number;
  /** Non-seed patterns older than this are dropped. Default 180 days. */
  ttlDays?: number;
  /** A sighting loses half its weight every this many days. Default 60 days. */
  halfLifeDays?: number;
  /** Semantic matches below this similarity are ignored. Default 0.12. */
  minSimilarity?: number;
}

export interface PatternStore {
  /** Sanitizes, de-duplicates and stores a pattern. Throws PatternSanitizationError on personal data. */
  upsert(input: unknown): Promise<PastInvestigation>;
  search(query: PatternQuery): Promise<PatternHit[]>;
  /** Removes expired non-seed patterns and returns how many were removed. */
  purgeExpired(): Promise<number>;
  size(): Promise<number>;
}
