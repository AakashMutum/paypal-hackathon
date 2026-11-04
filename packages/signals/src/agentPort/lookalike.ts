import { registrableDomain } from '../util.js';
import { recognizeMarketplace } from './marketplace.js';

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** Edit distance divided by the longer length, from 0 (same) to 1 (nothing in common). */
export function normalizedDistance(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : editDistance(a, b) / longest;
}

/** The part of a registrable domain before the first dot, for example "shop" in shop.example. */
function labelOf(domain: string): string {
  return domain.split('.')[0] ?? domain;
}

function compact(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function brandSlug(brand: string): string {
  return compact(brand);
}

function brandCandidates(brand: string): string[] {
  const full = brandSlug(brand);
  const parts = brand
    .split(/[.\s]+/)
    .map(compact)
    .filter((part) => part.length >= 3);
  return [...new Set([full, ...parts])].filter((candidate) => candidate.length >= 4);
}

export interface LookalikeMatch {
  matchesKnownBrand: true;
  brandId: string;
  brandName: string;
  knownDomain?: string;
  distance: number;
  normalizedDistance: number;
  reason: 'near_miss' | 'contains_brand';
}

export const NEAR_MISS_THRESHOLD = 0.25;

/**
 * Decides whether a merchant domain imitates a protected brand.
 *
 * Against a known brand domain: a near miss (small normalized edit distance) or a domain that
 * contains the brand's name as a whole word (for example "brand-outlet-shop") counts. A domain
 * equal to a known brand domain never counts. Against only a claimed brand name, just a near
 * miss counts, because a genuine store legitimately contains its own brand name.
 */
export function detectLookalike(
  merchantDomain: string,
  knownBrandDomains: readonly string[],
  claimedBrand?: string,
): LookalikeMatch | null {
  const domain = registrableDomain(merchantDomain);
  const label = labelOf(domain);
  const compactLabel = compact(label);
  const known = knownBrandDomains.map((d) => registrableDomain(d));
  // An official marketplace host is never a lookalike of itself or of the brand it serves.
  if (recognizeMarketplace(merchantDomain) || known.includes(domain)) return null;

  for (const knownDomain of known) {
    const knownLabel = labelOf(knownDomain);
    const compactKnown = compact(knownLabel);
    const brandToken = knownLabel.split('-')[0] ?? knownLabel;
    const dist = normalizedDistance(compactLabel, compactKnown);
    const labelTokens = label.split('-').map(compact).filter(Boolean);
    const tokenDistances = labelTokens.map((token) => normalizedDistance(token, compactKnown));
    const tokenDist = tokenDistances.length > 0 ? Math.min(...tokenDistances) : 1;
    const containsBrand = brandToken.length >= 4 && label.split('-').includes(brandToken.toLowerCase());
    if (dist <= NEAR_MISS_THRESHOLD || tokenDist <= NEAR_MISS_THRESHOLD || containsBrand) {
      const tokenDistance = tokenDistances.length > 0 ? Math.min(...labelTokens.map((token) => editDistance(token, compactKnown))) : 0;
      return {
        matchesKnownBrand: true,
        brandId: `BRAND-${brandToken.toUpperCase()}`,
        brandName: brandToken,
        knownDomain,
        distance: Math.min(editDistance(compactLabel, compactKnown), tokenDistance),
        normalizedDistance: Number(Math.min(dist, tokenDist).toFixed(3)),
        reason: containsBrand ? 'contains_brand' : 'near_miss',
      };
    }
  }

  if (claimedBrand) {
    const candidates = brandCandidates(claimedBrand);
    const labelTokens = label.split('-').map(compact).filter(Boolean);
    // A store that uses its own brand name in the domain is not imitating itself. Comparing
    // tokens also stops a brand name with a TLD suffix from being treated as a misspelling of
    // its own domain label.
    const ownsLabel = candidates.some(
      (candidate) => candidate === compactLabel || labelTokens.includes(candidate),
    );

    if (!ownsLabel) {
      let best: { candidate: string; dist: number; distance: number } | undefined;
      for (const candidate of candidates) {
        for (const part of [compactLabel, ...labelTokens]) {
          const dist = normalizedDistance(part, candidate);
          if (!best || dist < best.dist) best = { candidate, dist, distance: editDistance(part, candidate) };
        }
      }

      if (best && best.dist <= NEAR_MISS_THRESHOLD) {
        return {
          matchesKnownBrand: true,
          brandId: `BRAND-${best.candidate.toUpperCase()}`,
          brandName: claimedBrand,
          distance: best.distance,
          normalizedDistance: Number(best.dist.toFixed(3)),
          reason: 'near_miss',
        };
      }
    }
  }
  return null;
}
