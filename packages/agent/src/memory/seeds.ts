import type { MemoryDocument, MemoryPort, CallOpts } from '../ports.js';

/**
 * Seed cards. They are fictional, committed, and disclosed in the README so the
 * demo has something to match against before any live case is recorded.
 */

export const SEED_PATTERNS: readonly string[] = [
  'A newly registered lookalike of a known brand claims to be an official outlet and sells far below market price.',
  'The checkout pays a business that is unrelated to the brand the store advertises.',
  'A site registered days ago copies a known retailer name and asks for payment to a personal email address.',
  'Product photos match a well-known catalogue, but the seller is not among the known sellers of that product.',
  'A shop with no company details, a brand-new domain and a discount above eighty percent asks for payment through an online wallet.',
  'Hidden text on the page tries to tell automated shopping assistants to approve the purchase.',
  'The site claims to be based in one country while the receiving business is registered in another and cannot be linked to the brand.',
  'A clone of a retailer site keeps the same layout but uses a different address and a different payee every week.',
];

export function seedDocuments(): MemoryDocument[] {
  return SEED_PATTERNS.map((patternText, index) => ({
    id: `seed-${index + 1}`,
    patternText,
    domain: '',
    registrableDomain: `seed-${index + 1}.invalid`,
    decision: 'PAUSE' as const,
    riskScore: 0.9,
    evidenceTypes: [],
    domainAgeBucket: 'unknown',
    discountBucket: 'unknown',
    seed: true,
  }));
}

export async function loadSeeds(memory: MemoryPort, options: CallOpts): Promise<number> {
  let written = 0;
  for (const document of seedDocuments()) {
    await memory.write(document, options);
    written += 1;
  }
  return written;
}
