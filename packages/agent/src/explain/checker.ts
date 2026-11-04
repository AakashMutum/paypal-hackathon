import type {
  Decision,
  Evidence,
  Explanation,
  ExplanationBullet,
  HardRuleTrigger,
  RetrievedCase,
} from '../types.js';
import { containsForbiddenReference } from '../guard/output.js';
import { sanitizeText } from '../guard/shield.js';
import { FALLBACK_SUMMARY } from '../scoring/summary.js';
import { HEADLINES, templateExplanation, templatePhraseFor, truncateText } from './template.js';

/**
 * The explanation checker. Nothing the writer produces reaches a buyer until it
 * passes these rules:
 *   1. every cited evidence ID exists,
 *   2. no URL, email or defamatory word,
 *   3. every number appears in the cited evidence,
 *   4. no injection phrasing,
 *   5. hard-rule evidence is always mentioned,
 *   6. otherwise the neutral template is used.
 */

export const BANNED_WORDS =
  /\b(scam(mer)?s?|fraud(ster)?s?|criminals?|illegal|steal(ing)?|thief|thieves|fake)\b/i;

export const MAX_BULLETS = 5;

export interface CheckExplanationInput {
  candidate?: Explanation;
  evidence: Evidence[];
  decision: Decision;
  hardRules: HardRuleTrigger[];
  maxBullets?: number;
  /** Case ids the writer was allowed to cite from memory. */
  allowedCaseIds?: string[];
}

export interface CheckExplanationResult {
  explanation: Explanation | null;
  dropped: number;
  usedTemplate: boolean;
}

export function checkExplanation(input: CheckExplanationInput): CheckExplanationResult {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  const maxBullets = input.maxBullets ?? MAX_BULLETS;

  const kept: ExplanationBullet[] = [];
  let dropped = 0;
  let keptFromCandidate = 0;

  for (const bullet of input.candidate?.bullets ?? []) {
    if (kept.length >= maxBullets) break;

    const rawIds = Array.isArray(bullet?.evidenceIds) ? bullet.evidenceIds : [];
    const ids = [...new Set(rawIds.filter((id) => byId.has(id)))];
    const text = typeof bullet?.text === 'string' ? bullet.text.trim() : '';

    if (text.length === 0 || ids.length === 0) {
      dropped += 1;
      continue;
    }

    if (!isAcceptableText(text)) {
      dropped += 1;
      continue;
    }

    if (!numbersSupported(text, ids, byId)) {
      dropped += 1;
      continue;
    }

    kept.push({ text: truncateText(text, 160), evidenceIds: ids.slice(0, 6) });
    keptFromCandidate += 1;
  }

  // A hard rule that no bullet mentions always gets its own sentence.
  for (const rule of input.hardRules) {
    const cited = rule.evidenceIds.some((id) => kept.some((bullet) => bullet.evidenceIds.includes(id)));
    if (cited) continue;

    const target = rule.evidenceIds.map((id) => byId.get(id)).find((entry): entry is Evidence => Boolean(entry));
    if (!target) continue;

    if (kept.length >= maxBullets) kept.pop();
    kept.push({ text: truncateText(templatePhraseFor(target), 160), evidenceIds: [target.id] });
  }

  if (kept.length === 0) {
    return {
      explanation: fallbackExplanation(evidence, input.decision),
      dropped,
      usedTemplate: true,
    };
  }

  // If none of the model's own bullets survived, the text is template output,
  // even when a hard-rule sentence was appended afterwards.
  const usedTemplate = keptFromCandidate === 0;
  const retrievedCases = safeRetrievedCases(input.candidate?.retrievedCases, input.allowedCaseIds);

  return {
    explanation: {
      headline: usedTemplate
        ? HEADLINES[input.decision]
        : safeHeadline(input.candidate?.headline, input.decision),
      bullets: kept.slice(0, maxBullets),
      ...(retrievedCases.length > 0 ? { retrievedCases } : {}),
    },
    dropped,
    usedTemplate,
  };
}

function safeRetrievedCases(
  candidate: RetrievedCase[] | undefined,
  allowedCaseIds: string[] | undefined,
): RetrievedCase[] {
  const allowed = new Set(allowedCaseIds ?? []);
  const seen = new Set<string>();
  const kept: RetrievedCase[] = [];
  for (const entry of candidate ?? []) {
    if (kept.length >= 3) break;
    if (!entry || !allowed.has(entry.caseId) || seen.has(entry.caseId)) continue;
    const relevance = typeof entry.relevance === 'string' ? entry.relevance.trim() : '';
    if (!relevance || !isAcceptableText(relevance)) continue;
    kept.push({ caseId: entry.caseId, relevance: truncateText(relevance, 160) });
    seen.add(entry.caseId);
  }
  return kept;
}

function isAcceptableText(text: string): boolean {
  if (BANNED_WORDS.test(text)) return false;
  if (containsForbiddenReference(text)) return false;
  return sanitizeText(text, { location: 'visible', maxLen: 200 }).findings.length === 0;
}

function numbersSupported(text: string, ids: string[], byId: Map<string, Evidence>): boolean {
  const mentioned = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (mentioned.length === 0) return true;

  const allowed = new Set<string>();
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry) collectNumbers(entry, allowed);
  }

  return mentioned.every((raw) => allowed.has(canonical(Number(raw))));
}

function collectNumbers(entry: Evidence, into: Set<string>): void {
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      into.add(canonical(value));
      return;
    }
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\d+(?:\.\d+)?/g)) into.add(canonical(Number(match[0])));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item);
    }
  };

  visit(entry.data);
  visit(entry.summary);
}

function canonical(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function safeHeadline(headline: string | undefined, decision: Decision): string {
  const fallback = HEADLINES[decision];
  if (typeof headline !== 'string') return fallback;

  const text = headline.trim();
  if (text.length === 0) return fallback;
  if (BANNED_WORDS.test(text)) return fallback;
  if (containsForbiddenReference(text)) return fallback;
  if (sanitizeText(text, { location: 'visible', maxLen: 200 }).findings.length > 0) return fallback;

  return truncateText(text, 90);
}

function fallbackExplanation(evidence: Evidence[], decision: Decision): Explanation | null {
  const template = templateExplanation(evidence, decision);
  if (template) return template;

  const first = evidence[0];
  if (!first) return null;

  return {
    headline: HEADLINES[decision],
    bullets: [{ text: FALLBACK_SUMMARY[decision], evidenceIds: [first.id] }],
  };
}
