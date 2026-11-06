import type { Decision, Evidence, Explanation, ExplanationBullet } from '../types.js';
import { readNumber, readString } from '../scoring/pointsFor.js';

/**
 * Neutral, non-defamatory template sentences (spec §13.3).
 * Every sentence is derived from the evidence that produced it and never from
 * page text, so it is safe to show as-is.
 */

export const HEADLINES: Record<Decision, string> = {
  ALLOW: 'Seller checks passed',
  WARN: 'Payment held for review',
  PAUSE: 'Payment stopped before it was charged',
};

export const ALLOW_SENTENCE = "The seller's identity, website age and price are consistent.";

export function templatePhraseFor(ev: Evidence): string {
  const data = (ev.data ?? {}) as Record<string, unknown>;

  switch (ev.type) {
    case 'PAYEE_BINDING': {
      const status = readString(data.status);
      if (status === 'MISMATCH') {
        return 'The account receiving the payment is not the one this merchant has registered with Guardian.';
      }
      if (status === 'NO_BINDING') {
        return "The seller's website is not linked to the account receiving the payment.";
      }
      if (status === 'UNKNOWN_MERCHANT') {
        return 'The seller could not be found in the Merchant Trust Registry.';
      }
      if (status === 'MATCH') {
        return 'The account receiving the payment matches the registered merchant.';
      }
      return ev.summary;
    }

    case 'LOOKALIKE_DOMAIN':
      return "The website address closely resembles a known brand's address.";

    case 'DOMAIN_AGE': {
      const ageDays = readNumber(data.ageDays);
      if (ageDays === undefined || ageDays < 0) return ev.summary;
      return ageDays < 90
        ? `The website was registered only ${Math.floor(ageDays)} days ago.`
        : `The website has been registered for ${Math.floor(ageDays)} days.`;
    }

    case 'PRICE_DEVIATION': {
      const discountPct = readNumber(data.discountPct);
      if (discountPct === undefined) return ev.summary;
      return `The price is about ${Math.round(discountPct)}% below what comparable sellers charge.`;
    }

    case 'IMAGE_REUSE':
      return 'Product photos match listings from other sellers.';

    case 'CLAIMED_BRAND_MISMATCH':
      return 'The site presents itself as a known brand, but the payee is not linked to that brand.';

    case 'IDENTITY_MATCH':
      return identitySentence(readNumber(data.overall));

    case 'INJECTION_ATTEMPT':
      return 'The page contains text that tries to give instructions to automated assistants.';

    case 'SCAM_MEMORY_MATCH':
      return 'The pattern is similar to cases Guardian has flagged before.';

    case 'PAYEE_FREE_EMAIL':
      return 'The payment goes to a personal email address that is not linked to a registered business.';

    case 'TLS_INVALID':
      return "The site's security certificate has a problem.";

    case 'CONTACT_LEGAL_MISSING':
      return 'The site lacks clear contact or legal details.';

    case 'TOOL_UNAVAILABLE':
      return 'Some checks could not be completed, so the result may be incomplete.';

    case 'FAVICON_MISMATCH':
      return 'The site icon does not match the brand it claims to be.';

    case 'PAYEE_UNKNOWN':
      return 'No payment account was supplied, so the seller could only be assessed from the website.';

    default:
      return ev.summary;
  }
}

export function identitySentence(overall: number | undefined): string {
  if (overall === undefined) return 'The name on the site could not be compared with the registered business.';
  if (overall >= 0.85) return 'The name on the site matches the registered business.';
  if (overall >= 0.6) return 'The name on the site is close to, but not the same as, the registered business.';
  if (overall >= 0.3) return 'The name on the site is only loosely related to the registered business.';
  return 'The name on the site does not match the business that receives the payment.';
}

export function templateExplanation(evidence: readonly Evidence[] | undefined, decision: Decision): Explanation | null {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;

  // The generic "identity, age and price are consistent" sentence is only accurate when a
  // payee binding actually matched. A scan without a payee must list what was checked instead.
  const hasPayeeMatch = evidence.some(
    (entry) => entry.type === 'PAYEE_BINDING' && readString((entry.data ?? {}).status) === 'MATCH',
  );
  const bullets: ExplanationBullet[] = [];
  for (const entry of evidence) {
    if (bullets.length >= 5) break;
    const text =
      decision === 'ALLOW' && hasPayeeMatch ? ALLOW_SENTENCE : templatePhraseFor(entry);
    if (!text) continue;
    const trimmed = truncateText(text, 160);
    if (bullets.some((bullet) => bullet.text === trimmed)) continue;
    bullets.push({ text: trimmed, evidenceIds: [entry.id] });
  }

  if (bullets.length === 0) return null;
  return { headline: HEADLINES[decision], bullets };
}

export function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
