import type { Decision, Evidence, HardRuleTrigger, Severity } from '../types.js';
import { templatePhraseFor, truncateText } from '../explain/template.js';
import type { ScoredEvidence } from './pointsFor.js';

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export const FALLBACK_SUMMARY: Record<Decision, string> = {
  ALLOW: "The seller's identity, website age and price are consistent.",
  WARN: 'Some checks raised concerns about this seller. Review before paying.',
  PAUSE: 'The payment was stopped because the seller could not be verified.',
};

export function buildFlaggedEvidenceIds(
  evidence: readonly Evidence[] | undefined,
  scored: readonly ScoredEvidence[],
  hardRules: readonly HardRuleTrigger[],
  limit = 6
): string[] {
  const list = Array.isArray(evidence) ? evidence : [];
  const pointsById = new Map<string, number>();
  for (const entry of scored) pointsById.set(entry.evidence.id, entry.points);

  const ruleCited = new Set<string>();
  for (const rule of hardRules) for (const id of rule.evidenceIds) ruleCited.add(id);

  const seen = new Set<string>();
  const candidates: { evidence: Evidence; points: number }[] = [];

  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) continue;
    const points = pointsById.get(entry.id) ?? 0;
    if (points > 0 || ruleCited.has(entry.id)) {
      seen.add(entry.id);
      candidates.push({ evidence: entry, points });
    }
  }

  candidates.sort(
    (a, b) =>
      b.points - a.points ||
      SEVERITY_RANK[a.evidence.severity] - SEVERITY_RANK[b.evidence.severity] ||
      a.evidence.id.localeCompare(b.evidence.id)
  );

  return candidates.slice(0, limit).map((entry) => entry.evidence.id);
}

export function buildSummary(
  decision: Decision,
  evidence: readonly Evidence[] | undefined,
  flaggedEvidenceIds: readonly string[],
  maxLength = 140
): string {
  const list = Array.isArray(evidence) ? evidence : [];
  const byId = new Map(list.map((entry) => [entry.id, entry]));

  const phrases: string[] = [];
  for (const id of flaggedEvidenceIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    const phrase = templatePhraseFor(entry);
    if (!phrase || phrases.includes(phrase)) continue;
    phrases.push(phrase);
    if (phrases.length === 2) break;
  }

  if (phrases.length === 0) return FALLBACK_SUMMARY[decision];
  return truncateText(phrases.join('; '), maxLength);
}
