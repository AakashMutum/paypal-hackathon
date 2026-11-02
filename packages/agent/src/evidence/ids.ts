import type { Evidence } from '../types.js';

/**
 * Evidence IDs created by the agent itself.
 * Format: EVD-AGT-<TYPE>-<nn>, where TYPE is upper snake case and the counter is
 * per type, per investigation.
 */

export interface IdFactory {
  next(type: string): string;
  used(): readonly string[];
  reset(): void;
}

export const DEFAULT_ID_PREFIX = 'EVD-AGT';

export function createIdFactory(prefix: string = DEFAULT_ID_PREFIX): IdFactory {
  const counters = new Map<string, number>();
  const issued: string[] = [];

  return {
    next(type: string): string {
      const key = normalizeEvidenceType(type);
      const nextCount = (counters.get(key) ?? 0) + 1;
      counters.set(key, nextCount);
      const id = `${prefix}-${key}-${String(nextCount).padStart(2, '0')}`;
      issued.push(id);
      return id;
    },
    used(): readonly string[] {
      return issued.slice();
    },
    reset(): void {
      counters.clear();
      issued.length = 0;
    },
  };
}

export function normalizeEvidenceType(type: string): string {
  const normalized = String(type ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized : 'EVIDENCE';
}

/** Returns the IDs that appear more than once, in first-seen order. */
export function duplicateIds(evidence: readonly Pick<Evidence, 'id'>[]): string[] {
  if (!Array.isArray(evidence)) return [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of evidence) {
    if (!entry || typeof entry.id !== 'string') continue;
    if (seen.has(entry.id)) {
      if (!duplicates.includes(entry.id)) duplicates.push(entry.id);
    } else {
      seen.add(entry.id);
    }
  }
  return duplicates;
}
