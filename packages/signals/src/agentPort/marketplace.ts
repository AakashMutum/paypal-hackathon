// @brand-check-allow Real merchant hostnames are functional recognition data for the
// merchant investigation pipeline. They are never demo content.

import { registrableDomain } from '../util.js';

/**
 * Recognition of large marketplaces from a hostname.
 *
 * Recognition is not trust. It only says which platform the hostname belongs to, so the
 * investigation can label the merchant correctly and use the platform's published metadata.
 * It never lowers a score, never produces an ALLOW and never bypasses access restrictions.
 */

export interface MarketplaceIdentity {
  id: 'amazon';
  /** The platform name, safe to show. */
  displayName: string;
  /** The official registrable domain this hostname belongs to. */
  officialDomain: string;
  /** ISO country/region code for the regional storefront. */
  region: string;
}

interface AmazonStorefront {
  region: string;
  domain: string;
}

// Official regional storefronts. A hostname only counts when its registrable domain is on this
// list, so lookalikes such as amaz0n-example.com or amazon.in.evil.com never match.
const AMAZON_STOREFRONTS: readonly AmazonStorefront[] = [
  { region: 'US', domain: 'amazon.com' },
  { region: 'CA', domain: 'amazon.ca' },
  { region: 'MX', domain: 'amazon.com.mx' },
  { region: 'BR', domain: 'amazon.com.br' },
  { region: 'GB', domain: 'amazon.co.uk' },
  { region: 'DE', domain: 'amazon.de' },
  { region: 'FR', domain: 'amazon.fr' },
  { region: 'IT', domain: 'amazon.it' },
  { region: 'ES', domain: 'amazon.es' },
  { region: 'NL', domain: 'amazon.nl' },
  { region: 'SE', domain: 'amazon.se' },
  { region: 'PL', domain: 'amazon.pl' },
  { region: 'BE', domain: 'amazon.com.be' },
  { region: 'TR', domain: 'amazon.com.tr' },
  { region: 'AE', domain: 'amazon.ae' },
  { region: 'SA', domain: 'amazon.sa' },
  { region: 'EG', domain: 'amazon.eg' },
  { region: 'IN', domain: 'amazon.in' },
  { region: 'JP', domain: 'amazon.co.jp' },
  { region: 'AU', domain: 'amazon.com.au' },
  { region: 'SG', domain: 'amazon.com.sg' },
  { region: 'CN', domain: 'amazon.cn' },
];

const AMAZON_BY_DOMAIN = new Map(AMAZON_STOREFRONTS.map((store) => [store.domain, store]));

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Lowercase, validate and return a hostname from a host or an http(s) URL. No DNS lookup. */
export function safeHostname(input: string): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || IPV4_PATTERN.test(host) || host.includes(':')) return undefined;
  if (!HOSTNAME_PATTERN.test(host)) return undefined;
  return host;
}

function belongsTo(host: string, officialDomain: string): boolean {
  return host === officialDomain || host.endsWith(`.${officialDomain}`);
}

/** True only for an official marketplace hostname (or one of its subdomains). */
export function isAmazonHostname(input: string): boolean {
  return recognizeMarketplace(input)?.id === 'amazon';
}

/** Returns the marketplace identity for an official hostname, otherwise undefined. */
export function recognizeMarketplace(input: string): MarketplaceIdentity | undefined {
  const host = safeHostname(input);
  if (!host) return undefined;

  const registrable = registrableDomain(host);
  const storefront = AMAZON_BY_DOMAIN.get(registrable);
  if (!storefront || !belongsTo(host, registrable)) return undefined;

  return {
    id: 'amazon',
    displayName: 'Amazon',
    officialDomain: registrable,
    region: storefront.region,
  };
}

/** Registrable domains protected by the lookalike check, one per official storefront. */
export function marketplaceBrandDomains(): string[] {
  return AMAZON_STOREFRONTS.map((store) => store.domain);
}
