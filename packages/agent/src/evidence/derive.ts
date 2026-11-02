import type { Evidence } from '../types.js';
import type { ShieldFinding } from '../guard/shield.js';
import type { IdFactory } from './ids.js';

/**
 * Evidence the agent derives itself, plus the injection evidence builder.
 *
 * Injection evidence never contains the removed page text: only a count, the
 * locations and the pattern names. That keeps hostile content out of prompts,
 * traces, logs and memory records.
 */

export const FREE_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
];

export interface RegistryRecordLike {
  merchantId: string;
  legalName?: string;
  brandNames?: string[];
  linkedBrandIds?: string[];
}

export interface DeriveInput {
  payee?: { merchantId?: string; email?: string };
  claimedBrand?: string;
  payeeRecords?: readonly RegistryRecordLike[];
  brandOwnerRecords?: readonly RegistryRecordLike[];
}

export function emailDomain(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  if (/\s/.test(normalized)) return undefined;

  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return undefined;

  const domain = normalized
    .slice(at + 1)
    .replace(/\.+$/, '')
    .trim();

  if (!domain.includes('.') || /\s/.test(domain)) return undefined;
  return domain;
}

export function isFreeEmailDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const normalized = domain.toLowerCase();
  return FREE_EMAIL_DOMAINS.some((free) => normalized === free || normalized.endsWith(`.${free}`));
}

export function buildInjectionEvidence(
  findings: readonly ShieldFinding[] | undefined,
  ids: IdFactory
): Evidence | null {
  if (!Array.isArray(findings) || findings.length === 0) return null;

  return {
    id: ids.next('INJECTION_ATTEMPT'),
    type: 'INJECTION_ATTEMPT',
    severity: 'high',
    confidence: 0.9,
    summary: 'The page contains hidden or visible text that tries to instruct an AI system.',
    source: 'rule',
    deterministic: true,
    data: {
      count: findings.length,
      locations: unique(findings.map((finding) => finding.location)),
      patterns: unique(findings.map((finding) => finding.pattern)),
    },
  };
}

export function deriveEvidence(input: DeriveInput | undefined, ids: IdFactory): Evidence[] {
  if (!input || typeof input !== 'object') return [];
  const evidence: Evidence[] = [];

  const payee = input.payee;
  const payeeRecords = Array.isArray(input.payeeRecords) ? input.payeeRecords : [];

  const domain = emailDomain(payee?.email);
  if (domain && isFreeEmailDomain(domain) && payeeRecords.length === 0) {
    evidence.push({
      id: ids.next('PAYEE_FREE_EMAIL'),
      type: 'PAYEE_FREE_EMAIL',
      severity: 'medium',
      confidence: 0.8,
      summary: 'The payment goes to a personal email address that is not linked to a registered business.',
      source: 'rule',
      deterministic: true,
      data: { emailDomain: domain },
    });
  }

  const claimedBrand = normalizeName(input.claimedBrand);
  const payeeMerchantId = typeof payee?.merchantId === 'string' ? payee.merchantId.trim() : '';

  if (claimedBrand && payeeMerchantId) {
    const owners = Array.isArray(input.brandOwnerRecords) ? input.brandOwnerRecords : [];
    const owner = owners.find(
      (record) =>
        record &&
        typeof record.merchantId === 'string' &&
        record.merchantId !== payeeMerchantId &&
        ownsBrand(record, claimedBrand)
    );

    if (owner && !payeeIsLinkedTo(payeeRecords, owner)) {
      evidence.push({
        id: ids.next('CLAIMED_BRAND_MISMATCH'),
        type: 'CLAIMED_BRAND_MISMATCH',
        severity: 'high',
        confidence: 0.85,
        summary: 'The site claims a brand that the receiving account is not registered to sell.',
        source: 'registry',
        deterministic: true,
        data: {
          claimedBrand: String(input.claimedBrand).trim(),
          registryOwnerMerchantId: owner.merchantId,
          payeeMerchantId,
        },
      });
    }
  }

  return evidence;
}

function ownsBrand(record: RegistryRecordLike, brand: string): boolean {
  if (!Array.isArray(record.brandNames)) return false;
  return record.brandNames.some((name) => normalizeName(name) === brand);
}

function payeeIsLinkedTo(payeeRecords: readonly RegistryRecordLike[], owner: RegistryRecordLike): boolean {
  const ownerKeys = new Set<string>([normalizeName(owner.merchantId)]);
  for (const name of owner.brandNames ?? []) ownerKeys.add(normalizeName(name));

  return payeeRecords.some((record) => {
    if (!record || !Array.isArray(record.linkedBrandIds)) return false;
    return record.linkedBrandIds.some((id) => ownerKeys.has(normalizeName(id)));
  });
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
