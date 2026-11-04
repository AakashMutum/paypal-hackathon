import type {
  PageAccess,
  PageClaims,
  PageMarketplace,
  PageProduct,
  SectionHint,
} from '../ports.js';
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
  faviconUrl?: string;
  faviconSameOrigin?: boolean;
  faviconHash?: string;
  hasContactPage: boolean;
  hasLegalPage: boolean;
  pageAccess?: PageAccess;
  product?: PageProduct;
  marketplace?: PageMarketplace;
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
    ...(typeof claims.faviconUrl === 'string' && /^https?:\/\//i.test(claims.faviconUrl)
      ? { faviconUrl: claims.faviconUrl.slice(0, 2048) }
      : {}),
    ...(typeof claims.faviconSameOrigin === 'boolean' ? { faviconSameOrigin: claims.faviconSameOrigin } : {}),
    ...(typeof claims.faviconHash === 'string' && claims.faviconHash.length > 0
      ? { faviconHash: claims.faviconHash.slice(0, 128) }
      : {}),
    hasContactPage: claims.hasContactPage === true,
    hasLegalPage: claims.hasLegalPage === true,
    pageAccess: sanitizePageAccess(claims.pageAccess),
    product: sanitizeProduct(claims.product, clean),
    marketplace: sanitizeMarketplace(claims.marketplace, clean),
  };

  return { safe, findings };
}

type CleanFn = (value: unknown, location: SanitizationLocation, maxLen: number) => string;

const ACCESS_STATES = new Set<PageAccess['state']>(['ok', 'blocked', 'empty', 'unreachable', 'unsupported']);
const PRODUCT_SOURCES = new Set<PageProduct['source']>(['json-ld', 'opengraph', 'microdata', 'metadata', 'title']);

function sanitizePageAccess(value: unknown): PageAccess | undefined {
  if (!isRecord(value)) return undefined;
  const state = typeof value.state === 'string' ? (value.state as PageAccess['state']) : undefined;
  if (!state || !ACCESS_STATES.has(state)) return undefined;
  return {
    state,
    ...(typeof value.httpStatus === 'number' && Number.isFinite(value.httpStatus)
      ? { httpStatus: value.httpStatus }
      : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason.slice(0, 120) } : {}),
  };
}

function sanitizeProduct(value: unknown, clean: CleanFn): PageProduct | undefined {
  if (!isRecord(value)) return undefined;
  const name = clean(value.name, 'visible', 160) || undefined;
  const brand = clean(value.brand, 'visible', 80) || undefined;
  const seller = clean(value.seller, 'visible', 160) || undefined;
  const availability = clean(value.availability, 'visible', 40) || undefined;
  const currency =
    typeof value.currency === 'string' && /^[A-Za-z]{3}$/.test(value.currency)
      ? value.currency.toUpperCase()
      : undefined;
  const price =
    typeof value.price === 'number' && Number.isFinite(value.price) && value.price > 0
      ? value.price
      : undefined;
  const source = PRODUCT_SOURCES.has(value.source as PageProduct['source'])
    ? (value.source as PageProduct['source'])
    : 'metadata';

  if (!name && price === undefined && !brand && !seller && !availability) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(currency ? { currency } : {}),
    ...(brand ? { brand } : {}),
    ...(availability ? { availability } : {}),
    ...(seller ? { seller } : {}),
    source,
  };
}

function sanitizeMarketplace(value: unknown, clean: CleanFn): PageMarketplace | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.slice(0, 40) : undefined;
  const displayName = clean(value.displayName, 'visible', 80) || undefined;
  const officialDomain =
    typeof value.officialDomain === 'string' && /^[a-z0-9.-]{3,253}$/i.test(value.officialDomain)
      ? value.officialDomain.toLowerCase()
      : undefined;
  const region =
    typeof value.region === 'string' && /^[A-Za-z]{2}$/.test(value.region)
      ? value.region.toUpperCase()
      : undefined;

  if (!id || !displayName || !officialDomain) return undefined;
  return { id, displayName, officialDomain, ...(region ? { region } : {}) };
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, MAX_LIST_LENGTH)
    .map((entry) => entry.trim().slice(0, 200));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
