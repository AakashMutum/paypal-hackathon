import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registrableDomain } from '../util.js';
import { safeGetBytes, type SafeGetOptions } from './http.js';
import type { FaviconCheck } from './types.js';

/**
 * Favicon reference integrity. A page is compared with a configured, trusted reference favicon
 * for the brand it claims to be. With no reference, nothing is fetched and nothing is compared:
 * "no reference" is an explicit state, never a mismatch.
 */

export const FAVICON_MAX_BYTES = 64 * 1024;

export interface FaviconReference {
  /** Registrable domain that owns the brand, for example "harborline.example". */
  brandDomain: string;
  /** Names the brand goes by. A claimed brand must equal one of them (ignoring case and spacing). */
  brandNames: string[];
  /** "sha256:" plus 64 lowercase hex characters, taken over the raw favicon bytes. */
  hash: string;
  /** Where the reference favicon came from, for example the brand's own site. */
  source: string;
  /** Who supplied it and when. */
  provenance: { suppliedBy: string; suppliedOn: string };
  /** ISO date (YYYY-MM-DD) the favicon was retrieved. */
  retrievedOn: string;
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface FaviconValidation {
  entries: FaviconReference[];
  errors: string[];
}

/** Keeps only well-formed entries. An invalid entry is reported and dropped, never half-used. */
export function validateFaviconReferences(raw: unknown): FaviconValidation {
  const errors: string[] = [];
  const entries: FaviconReference[] = [];
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) {
    return { entries, errors: ['file must be an object with version 1'] };
  }
  const list = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return { entries, errors: ['entries must be an array'] };

  list.forEach((item, index) => {
    const problems: string[] = [];
    const e = (item ?? {}) as Record<string, unknown>;
    const text = (value: unknown, max = 200): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (typeof e.brandDomain !== 'string' || !DOMAIN_PATTERN.test(e.brandDomain.toLowerCase())) {
      problems.push('brandDomain');
    }
    if (
      !Array.isArray(e.brandNames) ||
      e.brandNames.length === 0 ||
      !e.brandNames.every((name) => text(name, 120))
    ) {
      problems.push('brandNames');
    }
    if (typeof e.hash !== 'string' || !HASH_PATTERN.test(e.hash)) problems.push('hash');
    if (!text(e.source)) problems.push('source');
    const provenance = (e.provenance ?? {}) as Record<string, unknown>;
    if (!text(provenance.suppliedBy)) problems.push('provenance.suppliedBy');
    if (typeof provenance.suppliedOn !== 'string' || !DATE_PATTERN.test(provenance.suppliedOn)) {
      problems.push('provenance.suppliedOn');
    }
    if (typeof e.retrievedOn !== 'string' || !DATE_PATTERN.test(e.retrievedOn)) problems.push('retrievedOn');

    if (problems.length > 0) {
      errors.push(`entry ${index}: invalid ${problems.join(', ')}`);
      return;
    }
    entries.push({
      brandDomain: (e.brandDomain as string).toLowerCase(),
      brandNames: e.brandNames as string[],
      hash: e.hash as string,
      source: e.source as string,
      provenance: {
        suppliedBy: provenance.suppliedBy as string,
        suppliedOn: provenance.suppliedOn as string,
      },
      retrievedOn: e.retrievedOn as string,
    });
  });
  return { entries, errors };
}

/** Reads the versioned data file shipped with the package. A missing or broken file means no references. */
export function loadDefaultFaviconReferences(): FaviconReference[] {
  try {
    const file = new URL('../../data/favicon-references.json', import.meta.url);
    return validateFaviconReferences(JSON.parse(readFileSync(file, 'utf8'))).entries;
  } catch {
    return [];
  }
}

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The reference for the claimed brand. Exact name match only: a near match must not create a mismatch. */
export function findFaviconReference(
  references: readonly FaviconReference[],
  claimedBrand: string | undefined,
): FaviconReference | undefined {
  const wanted = claimedBrand ? normalizeName(claimedBrand) : '';
  if (!wanted) return undefined;
  return references.find((ref) => ref.brandNames.some((name) => normalizeName(name) === wanted));
}

export function hashFavicon(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** True when the bytes look like an image a browser would show as an icon. */
export function looksLikeIcon(bytes: Uint8Array): boolean {
  const starts = (...sig: number[]): boolean => sig.every((byte, i) => bytes[i] === byte);
  if (bytes.byteLength < 8) return false;
  if (starts(0x89, 0x50, 0x4e, 0x47)) return true; // PNG
  if (starts(0x00, 0x00, 0x01, 0x00)) return true; // ICO
  if (starts(0x47, 0x49, 0x46, 0x38)) return true; // GIF
  if (starts(0xff, 0xd8, 0xff)) return true; // JPEG
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return true; // WEBP
  const head = Buffer.from(bytes.subarray(0, 512)).toString('utf8').toLowerCase();
  return head.includes('<svg');
}

export interface FaviconCheckInput {
  pageDomain: string;
  claimedBrand: string | undefined;
  faviconUrl: string | undefined;
  references: readonly FaviconReference[];
  fetchOptions: SafeGetOptions;
}

/**
 * Decides the favicon state for one page. The favicon is fetched only when a valid reference
 * exists for the claimed brand and the page is not on the reference's own domain.
 */
export async function checkFavicon(input: FaviconCheckInput): Promise<FaviconCheck> {
  const reference = findFaviconReference(input.references, input.claimedBrand);
  if (!reference) return { state: 'no_reference' };

  const base = {
    referenceDomain: reference.brandDomain,
    referenceHash: reference.hash,
    referenceSource: reference.source,
    referenceRetrievedOn: reference.retrievedOn,
  };
  if (registrableDomain(input.pageDomain) === registrableDomain(reference.brandDomain)) {
    return { state: 'reference_domain', ...base };
  }
  if (!input.faviconUrl) return { state: 'no_favicon', ...base };

  try {
    const result = await safeGetBytes(input.faviconUrl, { ...input.fetchOptions, maxBytes: FAVICON_MAX_BYTES });
    if (!result.ok) return { state: 'fetch_failed', ...base };
    if (result.truncated) return { state: 'too_large', ...base };
    if (!looksLikeIcon(result.bytes)) return { state: 'invalid', ...base };
    const observedHash = hashFavicon(result.bytes);
    return { state: observedHash === reference.hash ? 'match' : 'differs', observedHash, ...base };
  } catch {
    return { state: 'fetch_failed', ...base };
  }
}
