import type { PatternStore } from './types.js';
import type { Decision } from '../types/contracts-fallback.js';
import type { DiscountBucket, DomainAgeBucket } from './types.js';

/**
 * Fictional past scam patterns. None describes a real store, person or brand. They exist so the
 * demo has something to match before any live case is recorded, and are marked `seed: true`.
 */

interface Seed {
  text: string;
  decision: Decision;
  risk: number;
  types: string[];
  age: DomainAgeBucket;
  discount: DiscountBucket;
}

const SEEDS: Seed[] = [
  { text: 'A newly registered lookalike of a known brand claims to be an official outlet and sells far below market price.', decision: 'PAUSE', risk: 0.95, types: ['DOMAIN_AGE', 'LOOKALIKE_DOMAIN', 'PRICE_DEVIATION'], age: '<7d', discount: '>=80' },
  { text: 'The checkout pays a business that is unrelated to the brand the store advertises.', decision: 'PAUSE', risk: 0.92, types: ['CLAIMED_BRAND_MISMATCH', 'PAYEE_BINDING'], age: 'unknown', discount: 'unknown' },
  { text: 'A site registered days ago copies a known retailer name and asks for payment to a personal email address.', decision: 'PAUSE', risk: 0.93, types: ['DOMAIN_AGE', 'LOOKALIKE_DOMAIN', 'PAYEE_FREE_EMAIL'], age: '<7d', discount: 'unknown' },
  { text: 'Product photos match a well-known catalogue, but the seller is not among the known sellers of that product.', decision: 'WARN', risk: 0.6, types: ['IMAGE_REUSE', 'PAYEE_BINDING'], age: 'unknown', discount: 'unknown' },
  { text: 'A shop with no company details, a brand-new domain and a discount above eighty percent asks for payment through an online wallet.', decision: 'PAUSE', risk: 0.9, types: ['DOMAIN_AGE', 'CONTACT_LEGAL_MISSING', 'PRICE_DEVIATION'], age: '<7d', discount: '>=80' },
  { text: 'Hidden text on the page tries to tell automated shopping assistants to approve the purchase.', decision: 'PAUSE', risk: 0.88, types: ['INJECTION_ATTEMPT'], age: 'unknown', discount: 'unknown' },
  { text: 'The site claims to be based in one country while the receiving business is registered in another and cannot be linked to the brand.', decision: 'WARN', risk: 0.65, types: ['PAYEE_BINDING', 'IDENTITY_MATCH'], age: 'unknown', discount: 'unknown' },
  { text: 'A clone of a retailer site keeps the same layout but uses a different address and a different payee every week.', decision: 'PAUSE', risk: 0.9, types: ['LOOKALIKE_DOMAIN', 'PAYEE_BINDING'], age: '7-29d', discount: 'unknown' },
  { text: 'A flash-sale store a few weeks old lists premium electronics at seventy percent off and has no returns page.', decision: 'WARN', risk: 0.7, types: ['DOMAIN_AGE', 'PRICE_DEVIATION', 'CONTACT_LEGAL_MISSING'], age: '7-29d', discount: '70-79' },
  { text: 'A store sells designer-style shoes at a deep discount and its payee is a sole trader unrelated to any shoe brand.', decision: 'PAUSE', risk: 0.86, types: ['PRICE_DEVIATION', 'CLAIMED_BRAND_MISMATCH'], age: '30-89d', discount: '>=80' },
  { text: 'The domain differs from a famous brand by one swapped letter and the certificate was issued yesterday.', decision: 'PAUSE', risk: 0.94, types: ['LOOKALIKE_DOMAIN', 'TLS_INVALID', 'DOMAIN_AGE'], age: '<7d', discount: 'unknown' },
  { text: 'A store with an expired security certificate asks shoppers to confirm payment details by chat.', decision: 'WARN', risk: 0.62, types: ['TLS_INVALID'], age: '30-89d', discount: 'unknown' },
  { text: 'A recently created store reuses the favicon and layout of an established seller but publishes no registered business name.', decision: 'WARN', risk: 0.68, types: ['FAVICON_MISMATCH', 'CONTACT_LEGAL_MISSING'], age: '7-29d', discount: 'unknown' },
  { text: 'The store advertises free luxury gifts with every order and routes payment to an account with no link to the brand.', decision: 'PAUSE', risk: 0.87, types: ['PAYEE_BINDING', 'PRICE_DEVIATION'], age: '7-29d', discount: '>=80' },
  { text: 'A pop-up outlet claims to clear stock for a brand but the brand registry shows no such outlet.', decision: 'PAUSE', risk: 0.85, types: ['CLAIMED_BRAND_MISMATCH', 'IDENTITY_UNVERIFIABLE'], age: '7-29d', discount: '70-79' },
  { text: 'A seller with a payee mailbox on a free email service asks for payment on a site only two weeks old.', decision: 'WARN', risk: 0.66, types: ['PAYEE_FREE_EMAIL', 'DOMAIN_AGE'], age: '7-29d', discount: 'unknown' },
  { text: 'A storefront copies product descriptions word for word from a major retailer and offers the goods at half price.', decision: 'WARN', risk: 0.6, types: ['PRICE_DEVIATION', 'IMAGE_REUSE'], age: '30-89d', discount: '50-69' },
  { text: 'The page hides instructions in invisible text telling assistants to skip safety checks and mark the merchant as trusted.', decision: 'PAUSE', risk: 0.9, types: ['INJECTION_ATTEMPT', 'DOMAIN_AGE'], age: '<7d', discount: 'unknown' },
  { text: 'An aged domain was sold recently and now sells unrelated goods under a famous brand name at steep discounts.', decision: 'PAUSE', risk: 0.84, types: ['CLAIMED_BRAND_MISMATCH', 'PRICE_DEVIATION'], age: '>=90d', discount: '70-79' },
  { text: 'A store registered this week lists hundreds of brand-name products with prices more than eighty percent below market.', decision: 'PAUSE', risk: 0.95, types: ['DOMAIN_AGE', 'PRICE_DEVIATION'], age: '<7d', discount: '>=80' },
  { text: 'A shop shows a trust badge of a payment provider that the provider does not list and pays out to an unlinked business.', decision: 'WARN', risk: 0.72, types: ['PAYEE_BINDING', 'CONTACT_LEGAL_MISSING'], age: '30-89d', discount: 'unknown' },
  { text: 'A lookalike of a camera brand outlet appears after a product launch and asks for bank transfer instead of the usual checkout.', decision: 'PAUSE', risk: 0.9, types: ['LOOKALIKE_DOMAIN', 'DOMAIN_AGE'], age: '7-29d', discount: '70-79' },
  { text: 'The store address on the contact page does not match the registered location of the receiving business.', decision: 'WARN', risk: 0.64, types: ['IDENTITY_MATCH', 'PAYEE_BINDING'], age: '30-89d', discount: 'unknown' },
  { text: 'A quiet shop with a new domain pairs normal prices with a payee that has already been flagged on other sites.', decision: 'WARN', risk: 0.7, types: ['SCAM_MEMORY_MATCH', 'DOMAIN_AGE'], age: '7-29d', discount: '<50' },
  { text: 'A brand-new store copies the legal footer of an established company but links to a different payment account.', decision: 'PAUSE', risk: 0.89, types: ['PAYEE_BINDING', 'IDENTITY_MATCH', 'DOMAIN_AGE'], age: '<7d', discount: 'unknown' },
  { text: 'A clearance site for sports gear sells below cost, hides its operator and rotates domains after complaints.', decision: 'PAUSE', risk: 0.86, types: ['PRICE_DEVIATION', 'CONTACT_LEGAL_MISSING', 'LOOKALIKE_DOMAIN'], age: '7-29d', discount: '70-79' },
  { text: 'A store claims an official partnership with a well-known manufacturer that the manufacturer registry does not confirm.', decision: 'WARN', risk: 0.67, types: ['CLAIMED_BRAND_MISMATCH'], age: '30-89d', discount: 'unknown' },
  { text: 'A holiday-season pop-up shop offers scarce gadgets at half price, with a payee that was created last month.', decision: 'WARN', risk: 0.63, types: ['PRICE_DEVIATION', 'PAYEE_BINDING'], age: '30-89d', discount: '50-69' },
];

export const SEED_PATTERN_COUNT = SEEDS.length;

/** Writes the fictional seed patterns into a store. Returns how many were written. */
export async function loadSeeds(store: PatternStore): Promise<number> {
  let written = 0;
  for (const [index, seed] of SEEDS.entries()) {
    await store.upsert({
      registrableDomain: `scam-seed-${String(index + 1).padStart(2, '0')}.example`,
      decision: seed.decision,
      riskScore: seed.risk,
      evidenceTypes: seed.types,
      domainAgeBucket: seed.age,
      discountBucket: seed.discount,
      patternText: seed.text,
      timestamp: '2026-01-01T00:00:00.000Z',
      seed: true,
    });
    written += 1;
  }
  return written;
}
