import type { Evidence } from '../types.js';

/**
 * Points come from the PRD weights: domain 30, merchant identity 40,
 * pricing 20, technical 10. Each bucket keeps only its worst signal, so
 * evidence cannot be stacked inside a bucket. The four bucket maxima sum to
 * at most 100, which is why the final score is a 0-100 integer.
 */

export type RiskBucket = 'D' | 'M' | 'P' | 'T';

export interface ScoredEvidence {
  evidence: Evidence;
  bucket: RiskBucket;
  points: number;
  deterministic: boolean;
}

/**
 * A signal counts as deterministic only when it is marked deterministic AND it
 * cannot have come from a model. This guards R4/I3 against producers that
 * mislabel LLM output: model-written evidence can never unlock the 74 cap.
 */
export function isDeterministicEvidence(ev: Evidence): boolean {
  if (ev.deterministic !== true) return false;
  if (ev.source === 'llm') return false;
  if (ev.type === 'SCAM_MEMORY_MATCH' && readString(ev.data?.matchType) === 'semantic') return false;
  return true;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function readBoolean(value: unknown): boolean {
  return value === true;
}

export function pointsFor(ev: Evidence): { bucket: RiskBucket; points: number } | null {
  const data = (ev.data ?? {}) as Record<string, unknown>;

  switch (ev.type) {
    case 'DOMAIN_AGE': {
      const ageDays = readNumber(data.ageDays);
      if (ageDays === undefined || ageDays < 0) return null;
      return { bucket: 'D', points: ageDays < 7 ? 30 : ageDays < 30 ? 21 : ageDays < 90 ? 9 : 0 };
    }
    case 'LOOKALIKE_DOMAIN':
      return readBoolean(data.matchesKnownBrand) ? { bucket: 'D', points: 30 } : null;

    case 'SCAM_MEMORY_MATCH': {
      const matchType = readString(data.matchType);
      if (matchType === 'semantic') return { bucket: 'D', points: 21 };
      if (matchType === 'exact_payee' || matchType === 'exact_domain') return { bucket: 'D', points: 30 };
      return null;
    }

    case 'PAYEE_BINDING': {
      const status = readString(data.status);
      const table: Record<string, number> = { MISMATCH: 40, NO_BINDING: 28, UNKNOWN_MERCHANT: 20, MATCH: 0 };
      return { bucket: 'M', points: status ? (table[status] ?? 0) : 0 };
    }

    case 'CLAIMED_BRAND_MISMATCH':
      return { bucket: 'M', points: 40 };

    case 'IMAGE_REUSE':
      return { bucket: 'M', points: 32 };

    case 'PAYEE_FREE_EMAIL':
      return { bucket: 'M', points: 12 };

    case 'IDENTITY_MATCH': {
      const overall = readNumber(data.overall);
      if (overall === undefined || overall < 0 || overall > 1) return null;
      return { bucket: 'M', points: overall < 0.3 ? 30 : overall < 0.6 ? 20 : overall < 0.85 ? 8 : 0 };
    }

    case 'PRICE_DEVIATION': {
      const discountPct = readNumber(data.discountPct);
      if (discountPct === undefined) return null;
      return { bucket: 'P', points: discountPct >= 80 ? 20 : discountPct >= 70 ? 14 : discountPct >= 50 ? 8 : 0 };
    }

    case 'TLS_INVALID':
      return { bucket: 'T', points: 10 };

    case 'INJECTION_ATTEMPT':
      return { bucket: 'T', points: 10 };

    case 'CONTACT_LEGAL_MISSING':
      return { bucket: 'T', points: 5 };

    case 'FAVICON_MISMATCH':
      return { bucket: 'T', points: 5 };

    default:
      return null;
  }
}

export function scoreEvidence(evidence: readonly Evidence[] | undefined): ScoredEvidence[] {
  if (!Array.isArray(evidence)) return [];
  const scored: ScoredEvidence[] = [];
  for (const entry of evidence) {
    if (!entry || typeof entry.type !== 'string') continue;
    const result = pointsFor(entry);
    if (!result) continue;
    scored.push({
      evidence: entry,
      bucket: result.bucket,
      points: result.points,
      deterministic: isDeterministicEvidence(entry),
    });
  }
  return scored;
}

export function bucketMaxima(
  scored: readonly ScoredEvidence[],
  options: { onlyDeterministic?: boolean } = {}
): Record<RiskBucket, number> {
  const totals: Record<RiskBucket, number> = { D: 0, M: 0, P: 0, T: 0 };
  for (const entry of scored) {
    if (options.onlyDeterministic && !entry.deterministic) continue;
    if (entry.points > totals[entry.bucket]) totals[entry.bucket] = entry.points;
  }
  return totals;
}

export function sumBuckets(totals: Record<RiskBucket, number>): number {
  return totals.D + totals.M + totals.P + totals.T;
}
