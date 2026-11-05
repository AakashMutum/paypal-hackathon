// Plain-language labels. Everything the screens say about a decision, an evidence type or a
// retrieval method goes through here so the words stay consistent.
import type { Verdict } from '../types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'cyan' | 'neutral';

/** One decision vocabulary: ALLOW, WARN, PAUSE, each with a plain subtitle. */
export const VERDICT_WORDS: Record<Verdict, { word: Verdict; subtitle: string; tone: Tone; meaning: string }> = {
  ALLOW: { word: 'ALLOW', subtitle: 'Cleared', tone: 'ok', meaning: 'No problems were found. The payment can be captured.' },
  WARN: { word: 'WARN', subtitle: 'Needs review', tone: 'warn', meaning: 'Something could not be confirmed. A person must acknowledge it before the payment is captured.' },
  PAUSE: { word: 'PAUSE', subtitle: 'Held', tone: 'bad', meaning: 'The evidence does not support the storefront. The payment is never captured.' },
};

/** The decision as one string, for example "WARN · Needs review". */
export const verdictText = (v: Verdict): string => `${VERDICT_WORDS[v].word} · ${VERDICT_WORDS[v].subtitle}`;

/**
 * The score is a separate number. A WARN with a score of 0 means nothing suspicious was found but
 * something could not be checked, so it is never shown as "0% anomaly".
 */
export function scoreText(verdict: Verdict | undefined, riskScore: number): string {
  if (!verdict) return '…';
  if (verdict === 'WARN' && riskScore <= 0) return 'Could not verify';
  return `Score ${Math.round(riskScore)}`;
}

// Backend evidence types, keyed the way the API names them. The API sends a title-cased version of
// the type ("Tls Invalid"); evidenceLabel turns that back into the key and looks it up here.
const EVIDENCE_LABEL: Record<string, string> = {
  DOMAIN_AGE: 'Domain age',
  TLS_INVALID: 'Security certificate problem',
  TLS_VALID: 'Security certificate',
  LOOKALIKE_DOMAIN: 'Address looks like a known brand',
  INJECTION_ATTEMPT: 'Page tried to instruct the checker',
  PAGE_SECTION_CLAIMS: 'Claims on the page',
  CONTACT_LEGAL_MISSING: 'No contact or legal details',
  CONTACT_LEGAL_UNVERIFIED: 'Contact or legal links not confirmed',
  FAVICON_MISMATCH: 'Site icon differs from the brand',
  FAVICON_OBSERVED: 'Site icon',
  PROMOTIONAL_LANGUAGE: 'Pressure wording on the page',
  IMAGE_REUSE: 'Reused images',
  TOOL_UNAVAILABLE: 'A check could not run',
  AGENT_ERROR: 'Checker error',
  INVESTIGATION_NOTE: 'Note',
  REGISTRY_RECORD: 'Registered business found',
  REGISTRY_EMPTY: 'No registered business found',
  SITE_NAME: 'Name on the site',
  IDENTITY_MATCH: 'Site name vs registered name',
  IDENTITY_UNVERIFIABLE: 'Name could not be compared',
  CLAIMED_BRAND_MISMATCH: 'Brand does not match the payee',
  SCAM_MEMORY_MATCH: 'Similar past case',
  PRICE_DEVIATION: 'Price vs comparable sellers',
  PRICE_UNKNOWN: 'No price comparison',
  OFFER_COMPARISON: 'Comparable offers',
  PAYEE_BINDING: 'Receiving account vs the site',
  PAYEE_UNKNOWN: 'No receiving account supplied',
  PAYEE_FREE_EMAIL: 'Personal email receives the payment',
  MERCHANT_RECOGNIZED: 'Recognised platform',
  PAGE_BLOCKED: 'Page blocked the checker',
  PAGE_UNAVAILABLE: 'Page not reachable',
  PAGE_EMPTY: 'Page had no readable content',
  PRODUCT_METADATA: 'Product details on the page',
  PRODUCT_DATA_UNAVAILABLE: 'No product details on the page',
};

export const evidenceKey = (raw: string): string => raw.trim().toUpperCase().replace(/[\s-]+/g, '_');

/** A human label for an evidence type or for the title-cased label the API sends. */
export function evidenceLabel(raw: string): string {
  return EVIDENCE_LABEL[evidenceKey(raw)] ?? raw;
}

/** What a similar-case search really used, in words that do not over-claim. */
export function retrievalLabel(retrieval?: string): string {
  if (!retrieval) return 'Similarity match';
  const r = retrieval.toLowerCase();
  if (r.startsWith('exact')) return 'Exact match on payee or domain';
  if (r.includes('local-hash')) return 'Text similarity (local hashing, not a language-model embedding)';
  if (r.includes('gemini')) return 'Gemini embedding similarity';
  if (r.includes('elastic')) return 'Elasticsearch similarity';
  if (r.startsWith('lexical')) return 'Word overlap';
  if (r.startsWith('embedding')) return 'Embedding similarity';
  return retrieval;
}

/** Past cases are shown only when they are reasonably close. */
export const MIN_CASE_SIMILARITY = 0.5;
export const closeCases = <T extends { score: number }>(cases: readonly T[] | undefined): T[] =>
  (cases ?? []).filter((c) => c.score >= MIN_CASE_SIMILARITY);

/** Where scam memory lives, without promising durability a free host cannot give. */
export function memoryLabel(mode: string, persistent?: boolean): string {
  if (mode === 'elastic') return 'Elasticsearch';
  if (mode === 'file') return persistent === false ? 'file (not persistent)' : 'file (may reset on redeploy)';
  return 'in the server process (resets on restart)';
}

/** The embedding setting, labelled as configuration. Retrieval is labelled per case. */
export function embeddingSettingLabel(embeddings?: string): string | null {
  if (!embeddings) return null;
  if (embeddings.startsWith('local-hash')) return 'local text hashing';
  if (embeddings.startsWith('gemini')) return `${embeddings} (configured)`;
  if (embeddings === 'lexical-overlap') return 'word overlap';
  if (embeddings === 'elastic-inference') return 'Elasticsearch inference';
  return embeddings;
}

const MAX_BRAND = 60;

/**
 * The claimed brand, or something readable when it is too long or reads like a page description.
 * Falls back to the host name without "www.".
 */
export function displayBrand(claimedBrand: string, domain: string): string {
  const brand = claimedBrand.trim();
  const words = brand.split(/\s+/).filter(Boolean).length;
  const sentenceLike = /[.!?]\s|[|]|\s[-–—]\s/.test(brand) || words > 8;
  if (brand && brand.length <= MAX_BRAND && !sentenceLike) return brand;
  const host = domain.trim().toLowerCase().replace(/^www\./, '');
  return host || brand.slice(0, MAX_BRAND);
}

/** Date and time, for example "4 Nov 2026, 15:42". Locale-independent so it reads the same everywhere. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Plain titles for the four evidence groups. */
export const NODE_TITLE: Record<string, string> = {
  SURFACE: 'Storefront claims',
  MERCHANT: 'Merchant check',
  PRICE: 'Price check',
  PAYEE: 'Who gets paid',
};
