import type { PageClaims, SectionHint } from '../ports.js';
import { sanitizeText, type SanitizationLocation, type ShieldFinding } from './shield.js';

/**
 * Every field of a page claim that could contain text from the web is passed
 * through the shield before the rest of the agent sees it. The sanitised copy is
 * the only version that may be placed in a prompt.
 */

export interface SafeClaims {
  finalUrl: string;
  domain: string;
  siteName?: string;
  legalName?: string;
  claimedBrand?: string;
  claimedLocation?: { city?: string; country?: string };
  contacts: { emails: string[]; phones: string[]; address?: string };
  linkedDomains: string[];
  visibleText: string;
  hiddenText: string;
  sectionLinks: Partial<Record<SectionHint, string>>;
  hasContactPage: boolean;
  hasLegalPage: boolean;
}

export interface SanitizedClaims {
  safe?: SafeClaims;
  findings: ShieldFinding[];
}

const MAX_NAME_LENGTH = 160;
const MAX_LIST_LENGTH = 20;

export function sanitizeClaims(claims: PageClaims | undefined | null): SanitizedClaims {
  if (!claims || typeof claims !== 'object') return { findings: [] };

  const findings: ShieldFinding[] = [];
  const clean = (value: unknown, location: SanitizationLocation, maxLen: number): string => {
    const result = sanitizeText(value, { location, maxLen });
    findings.push(...result.findings);
    return result.clean;
  };

  const safe: SafeClaims = {
    finalUrl: typeof claims.finalUrl === 'string' ? claims.finalUrl.slice(0, 2048) : '',
    domain: typeof claims.domain === 'string' ? claims.domain.slice(0, 255) : '',
    siteName: clean(claims.siteName, 'visible', MAX_NAME_LENGTH) || undefined,
    legalName: clean(claims.legalName, 'visible', MAX_NAME_LENGTH) || undefined,
    claimedBrand: clean(claims.claimedBrand, 'visible', 80) || undefined,
    claimedLocation:
      claims.claimedLocation && typeof claims.claimedLocation === 'object'
        ? {
            city: typeof claims.claimedLocation.city === 'string' ? claims.claimedLocation.city.slice(0, 80) : undefined,
            country:
              typeof claims.claimedLocation.country === 'string'
                ? claims.claimedLocation.country.slice(0, 80)
                : undefined,
          }
        : undefined,
    contacts: {
      emails: cleanList(claims.contacts?.emails),
      phones: cleanList(claims.contacts?.phones),
      address: typeof claims.contacts?.address === 'string' ? claims.contacts.address.slice(0, 240) : undefined,
    },
    linkedDomains: cleanList(claims.linkedDomains).map((domain) => domain.toLowerCase()),
    visibleText: clean(claims.visibleText, 'visible', 6000),
    hiddenText: clean(claims.hiddenText, 'hidden', 2000),
    sectionLinks: isRecord(claims.sectionLinks) ? (claims.sectionLinks as Partial<Record<SectionHint, string>>) : {},
    hasContactPage: claims.hasContactPage === true,
    hasLegalPage: claims.hasLegalPage === true,
  };

  return { safe, findings };
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, MAX_LIST_LENGTH)
    .map((entry) => entry.trim().slice(0, 200));
}

function isRecord(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object';
}
