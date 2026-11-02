import { createHash } from 'node:crypto';
import { validateDecision } from '../sanitizer.js';
import {
  DISCOUNT_BUCKETS,
  DOMAIN_AGE_BUCKETS,
  type DiscountBucket,
  type DomainAgeBucket,
  type PastInvestigation,
} from './types.js';

export class PatternSanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternSanitizationError';
  }
}

const PAYEE_SALT = 'checkout-guardian-memory-v1';

export function hashPayee(merchantId: string): string {
  return createHash('sha256').update(`${PAYEE_SALT}|${merchantId.trim()}`).digest('hex');
}

export function patternId(registrableDomain: string, payeeHash?: string): string {
  return createHash('sha1').update(`${registrableDomain}|${payeeHash ?? ''}`).digest('hex');
}

const PII_CHECKS: Array<[string, RegExp]> = [
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['a phone number', /(?<![\w.])\+?\d(?:[\s().-]{0,2}\d){8,}(?![\w])/],
  [
    'a street address',
    /\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){0,3}(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|dr|way|court|ct|place|pl)\b/i,
  ],
  ['a postal box', /\bP\.?\s?O\.?\s*Box\s*\d+/i],
  ['a person name (title)', /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir)\.?\s+[A-Z][a-z]+/],
  [
    'a person name (role)',
    /\b(?:owner|founder|proprietor|director|ceo|manager|named|called|contact|registrant|run by|operated by|registered (?:to|by)|belongs to)\s+(?:is\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/,
  ],
  ['a person name (self-introduction)', /\b(?:[Mm]y name is|I am|I'm)\s+[A-Z][a-z]+/],
  ['a web address', /\bhttps?:\/\//i],
];

/** Returns what kind of personal data the text seems to contain, or null. */
export function findPersonalData(text: string): string | null {
  for (const [label, pattern] of PII_CHECKS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function refuseIfPersonal(field: string, text: string): void {
  const found = findPersonalData(text);
  if (found) throw new PatternSanitizationError(`${field} contains ${found}; personal data is not stored`);
}

export function normalizeRegistrableDomain(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PatternSanitizationError('registrableDomain must be a non-empty string');
  }
  refuseIfPersonal('registrableDomain', raw);
  let host = raw.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) {
    throw new PatternSanitizationError(`registrableDomain is not a valid domain: "${raw}"`);
  }
  return host;
}

function bucket<T extends string>(raw: unknown, allowed: readonly T[], field: string): T {
  const value = raw === undefined ? 'unknown' : raw;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PatternSanitizationError(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export interface SanitizeOptions {
  now: number;
}

/**
 * Builds a PastInvestigation from untrusted input using an allowlist. Unknown fields are
 * dropped. A raw payee merchant id is hashed. Free text that contains an email, phone number,
 * street address or a person's name is refused with PatternSanitizationError.
 */
export function sanitizePastInvestigation(input: unknown, options: SanitizeOptions): PastInvestigation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PatternSanitizationError('Input must be a non-null object');
  }
  const r = input as Record<string, unknown>;

  const registrableDomain = normalizeRegistrableDomain(r.registrableDomain ?? r.domain);

  let payeeHash: string | undefined;
  if (typeof r.payeeHash === 'string' && r.payeeHash) {
    if (!/^[a-f0-9]{64}$/.test(r.payeeHash)) throw new PatternSanitizationError('payeeHash must be a SHA-256 hex string');
    payeeHash = r.payeeHash;
  } else if (r.payeeMerchantId !== undefined && r.payeeMerchantId !== '') {
    if (typeof r.payeeMerchantId !== 'string') throw new PatternSanitizationError('payeeMerchantId must be a string');
    refuseIfPersonal('payeeMerchantId', r.payeeMerchantId);
    payeeHash = hashPayee(r.payeeMerchantId);
  }

  const decision = validateDecision(r.decision);
  const riskScore = typeof r.riskScore === 'number' ? r.riskScore : Number.NaN;
  if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 1) {
    throw new PatternSanitizationError('riskScore must be a number from 0 to 1');
  }

  const rawTypes = r.evidenceTypes ?? [];
  if (!Array.isArray(rawTypes) || rawTypes.length > 20) {
    throw new PatternSanitizationError('evidenceTypes must be an array of at most 20 names');
  }
  const evidenceTypes = [...new Set(rawTypes.map(String))].sort();
  for (const type of evidenceTypes) {
    if (!/^[A-Z][A-Z0-9_]{2,59}$/.test(type)) {
      throw new PatternSanitizationError(`evidence type names must look like DOMAIN_AGE, got "${type.slice(0, 30)}"`);
    }
  }

  const patternText = typeof r.patternText === 'string' ? r.patternText.trim().replace(/\s+/g, ' ') : '';
  if (patternText.length < 10 || patternText.length > 300) {
    throw new PatternSanitizationError('patternText must be 10 to 300 characters');
  }
  refuseIfPersonal('patternText', patternText);

  let timestamp = new Date(options.now).toISOString();
  if (r.timestamp !== undefined) {
    const parsed = new Date(String(r.timestamp));
    if (Number.isNaN(parsed.getTime())) throw new PatternSanitizationError('timestamp is not a valid date');
    timestamp = parsed.toISOString();
  }

  return {
    id: patternId(registrableDomain, payeeHash),
    registrableDomain,
    ...(payeeHash ? { payeeHash } : {}),
    decision,
    riskScore,
    evidenceTypes,
    domainAgeBucket: bucket<DomainAgeBucket>(r.domainAgeBucket, DOMAIN_AGE_BUCKETS, 'domainAgeBucket'),
    discountBucket: bucket<DiscountBucket>(r.discountBucket, DISCOUNT_BUCKETS, 'discountBucket'),
    patternText,
    timestamp,
    seed: r.seed === true,
    seenCount: 1,
  };
}
