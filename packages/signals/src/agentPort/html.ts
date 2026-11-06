import { registrableDomain } from '../util.js';
import { recognizeMarketplace } from './marketplace.js';
import type {
  PageAccess,
  PageClaims,
  PageProduct,
  SectionHint,
  SectionResult,
} from './types.js';

// Page text is untrusted data. Everything here only extracts and caps text; nothing in a page
// is ever interpreted as an instruction.

const VISIBLE_CAP = 8000;
const HIDDEN_CAP = 4000;
const JSON_LD_CAP = 512 * 1024;
const MAX_JSON_LD_BLOCKS = 40;
const PRODUCT_NODE_CAP = 10;
const VOID_TAGS = new Set(['br', 'img', 'meta', 'link', 'input', 'hr', 'area', 'base', 'col', 'source', 'wbr']);

const SECTION_WORDS: Record<SectionHint, RegExp> = {
  about: /about/i,
  contact: /contact/i,
  returns: /return|refund/i,
  terms: /terms/i,
  privacy: /privacy/i,
  shipping: /shipping|delivery/i,
};

export const SECTION_PATHS: Record<SectionHint, string[]> = {
  about: ['/about', '/about-us'],
  contact: ['/contact', '/contact-us'],
  returns: ['/returns', '/return-policy', '/refund-policy'],
  terms: ['/terms', '/terms-of-service', '/terms-and-conditions'],
  privacy: ['/privacy', '/privacy-policy'],
  shipping: ['/shipping', '/shipping-policy'],
};

const CHALLENGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /enter the characters you see below/i, reason: 'captcha' },
  { pattern: /type the characters you see in this image/i, reason: 'captcha' },
  { pattern: /click the button below to continue shopping/i, reason: 'bot_check' },
  { pattern: /sorry, we just need to make sure you.re not a robot/i, reason: 'bot_check' },
  { pattern: /to discuss automated access to .{0,60} data/i, reason: 'bot_check' },
  { pattern: /robot check/i, reason: 'bot_check' },
  { pattern: /just a moment\.\.\./i, reason: 'bot_check' },
  { pattern: /attention required!?\s*\|?\s*cloudflare/i, reason: 'bot_check' },
  { pattern: /verify you are human/i, reason: 'bot_check' },
];

const CURRENCY_SYMBOLS: ReadonlyArray<{ pattern: RegExp; code: string }> = [
  { pattern: /A\$/, code: 'AUD' },
  { pattern: /C\$/, code: 'CAD' },
  { pattern: /S\$/, code: 'SGD' },
  { pattern: /R\$/, code: 'BRL' },
  { pattern: /MX\$/, code: 'MXN' },
  { pattern: /₹/, code: 'INR' },
  { pattern: /€/, code: 'EUR' },
  { pattern: /£/, code: 'GBP' },
  { pattern: /¥/, code: 'JPY' },
  { pattern: /\$/, code: 'USD' },
];

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function collapse(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined;
}

function isHiddenTag(tag: string): boolean {
  const style = attr(tag, 'style') ?? '';
  return (
    /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?!\.)/i.test(style) ||
    attr(tag, 'aria-hidden')?.toLowerCase() === 'true' ||
    /\shidden(\s|=|>|\/)/i.test(tag)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function nameOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = nameOf(entry);
      if (name) return name;
    }
    return undefined;
  }
  if (isRecord(value)) return stringValue(value.name);
  return stringValue(value);
}

function availabilityOf(value: unknown): string | undefined {
  const text = nameOf(value);
  if (!text) return undefined;
  return text.replace(/^https?:\/\/schema\.org\//i, '').slice(0, 40);
}

function currencyCode(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const match = text.match(/\b([A-Za-z]{3})\b/);
  return match ? match[1].toUpperCase() : undefined;
}

function currencyFromText(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  for (const { pattern, code } of CURRENCY_SYMBOLS) {
    if (pattern.test(text)) return code;
  }
  return currencyCode(text);
}

/** Parses a price from structured metadata without guessing a missing value. */
export function parsePrice(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const text = value.trim();
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d.,-]/g, '');
  if (!cleaned) return undefined;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot >= 0 && cleaned.split('.').length > 2) {
    const parts = cleaned.split('.');
    normalized = `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function firstOffer(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const offer = firstOffer(entry);
      if (offer) return offer;
    }
    return undefined;
  }
  return isRecord(value) ? value : undefined;
}

function typeNames(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase());
  return [];
}

const PRODUCT_TYPES = new Set(['product', 'productgroup', 'individualproduct', 'productmodel']);

function collectProductNodes(value: unknown, out: Record<string, unknown>[], depth: number, seen: Set<object>): void {
  if (depth > 6 || out.length >= PRODUCT_NODE_CAP) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectProductNodes(entry, out, depth + 1, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);

  const types = typeNames(value['@type']);
  if (types.some((type) => PRODUCT_TYPES.has(type))) out.push(value);

  for (const key of ['@graph', 'hasVariant', 'itemListElement', 'mainEntity', 'item', 'itemOffered', 'offers']) {
    if (key in value) collectProductNodes(value[key], out, depth + 1, seen);
  }
}

function productFromJsonLdNode(node: Record<string, unknown>): PageProduct | undefined {
  const name = stringValue(node.name) ?? stringValue(node.headline);
  const brand = nameOf(node.brand);
  const offer = firstOffer(node.offers);
  const priceValue = offer?.price ?? offer?.lowPrice ?? offer?.highPrice;
  const price = parsePrice(priceValue);
  const currency = currencyCode(offer?.priceCurrency) ?? currencyCode(node.priceCurrency) ?? currencyFromText(priceValue);
  const availability = availabilityOf(offer?.availability ?? node.availability);
  const seller = nameOf(offer?.seller) ?? nameOf(node.seller);

  if (!name && price === undefined && !brand) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(currency ? { currency } : {}),
    ...(brand ? { brand } : {}),
    ...(availability ? { availability } : {}),
    ...(seller ? { seller } : {}),
    source: 'json-ld',
  };
}

function productFromJsonLd(html: string): PageProduct | undefined {
  const nodes: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let blocks = 0;

  for (const match of html.matchAll(scriptPattern)) {
    if (blocks >= MAX_JSON_LD_BLOCKS || nodes.length >= PRODUCT_NODE_CAP) break;
    blocks += 1;
    if (!/type\s*=\s*["']?application\/ld\+json["']?/i.test(match[1] ?? '')) continue;

    const raw = (match[2] ?? '').trim();
    if (!raw || raw.length > JSON_LD_CAP) continue;
    try {
      collectProductNodes(JSON.parse(raw), nodes, 0, seen);
    } catch {
      // Malformed structured data is ignored; the rest of the page is still usable.
    }
  }

  for (const node of nodes) {
    const product = productFromJsonLdNode(node);
    if (product) return product;
  }
  return undefined;
}

function readMetaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, collapse(content));
  }
  return meta;
}

function productFromMeta(meta: Map<string, string>): PageProduct | undefined {
  const ogName = meta.get('og:title') ?? meta.get('twitter:title');
  const ogPrice = meta.get('product:price:amount') ?? meta.get('og:price:amount');
  const ogCurrency = meta.get('product:price:currency') ?? meta.get('og:price:currency');
  const ogAvailability = meta.get('product:availability') ?? meta.get('og:availability');
  const ogBrand = meta.get('product:brand') ?? meta.get('og:brand');

  const microName = meta.get('name');
  const microPrice = meta.get('price');
  const microCurrency = meta.get('pricecurrency');

  const name = ogName ?? microName;
  const priceValue = ogPrice ?? microPrice;
  const price = parsePrice(priceValue);
  const currency = currencyCode(ogCurrency ?? microCurrency) ?? currencyFromText(priceValue);
  const availability = availabilityOf(ogAvailability);
  const brand = ogBrand;

  if (!name && price === undefined && !brand) return undefined;

  const source: PageProduct['source'] = ogName || ogPrice || ogCurrency || ogAvailability || ogBrand
    ? 'opengraph'
    : microName || microPrice || microCurrency
      ? 'microdata'
      : 'metadata';

  return {
    ...(name ? { name } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(currency ? { currency } : {}),
    ...(brand ? { brand } : {}),
    ...(availability ? { availability } : {}),
    ...(sellerFromMeta(meta) ? { seller: sellerFromMeta(meta) } : {}),
    source,
  };
}

function sellerFromMeta(meta: Map<string, string>): string | undefined {
  return meta.get('product:seller') ?? meta.get('og:seller');
}

export interface ExtractedPage {
  title?: string;
  siteName?: string;
  faviconUrl?: string;
  visibleText: string;
  /** Visible text chunks, one per text node, so searches do not span unrelated elements. */
  chunks: string[];
  hiddenText: string;
  emails: string[];
  phones: string[];
  address?: string;
  links: Array<{ href: string; text: string }>;
  product?: PageProduct;
}

export function extractPage(html: string): ExtractedPage {
  const jsonLdProduct = productFromJsonLd(html);
  const comments: string[] = [];
  const withoutComments = html.replace(/<!--([\s\S]*?)-->/g, (_, body: string) => {
    comments.push(collapse(body));
    return ' ';
  });
  const body = withoutComments
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? collapse(titleMatch[1]) : undefined;
  const meta = readMetaTags(body);
  const siteName = meta.get('og:site_name') ?? meta.get('application-name');
  const iconTag = (body.match(/<link\b[^>]*>/gi) ?? []).find((tag) => {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    return rel.split(/\s+/).some((part) => part === 'icon' || part.endsWith('touch-icon'));
  });
  const iconHref = iconTag ? attr(iconTag, 'href') : undefined;
  const faviconUrl = iconHref ? decodeEntities(iconHref).trim() : undefined;

  const visible: string[] = [];
  const hidden: string[] = [...comments.filter(Boolean)];
  const links: Array<{ href: string; text: string }> = [];
  const emails = new Set<string>();
  const stack: Array<{ name: string; hidden: boolean }> = [];
  let openLink: { href: string; text: string } | null = null;
  let addressText: string | undefined;
  let inAddress = false;

  const tokens = body.match(/<\/?[a-zA-Z][^>]*>|[^<]+|</g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('</')) {
      const name = token.slice(2).replace(/[\s>].*$/s, '').toLowerCase();
      const index = stack.map((e) => e.name).lastIndexOf(name);
      if (index >= 0) stack.length = index;
      if (name === 'a' && openLink) {
        links.push(openLink);
        openLink = null;
      }
      if (name === 'address') inAddress = false;
    } else if (token.startsWith('<') && token.length > 1) {
      const name = (token.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1] ?? '').toLowerCase();
      if (!name) continue;
      if (!VOID_TAGS.has(name) && !token.endsWith('/>')) {
        stack.push({ name, hidden: isHiddenTag(token) });
      }
      if (name === 'a') {
        const href = attr(token, 'href');
        if (href) {
          openLink = { href: decodeEntities(href), text: '' };
          const mail = href.match(/^mailto:([^?]+)/i);
          if (mail) emails.add(decodeEntities(mail[1]).toLowerCase());
        }
      }
      if (name === 'address') inAddress = true;
    } else {
      const text = collapse(token);
      if (!text) continue;
      if (stack.some((e) => e.hidden)) hidden.push(text);
      else {
        visible.push(text);
        if (openLink) openLink.text += `${text} `;
        if (inAddress) addressText = `${addressText ?? ''}${addressText ? ' ' : ''}${text}`;
      }
    }
  }

  const visibleText = visible.join(' ').slice(0, VISIBLE_CAP);
  const hiddenText = hidden.join(' ').slice(0, HIDDEN_CAP);
  for (const m of `${visibleText} ${hiddenText}`.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    emails.add(m[0].toLowerCase());
  }
  const phones = [
    ...new Set(
      [...visibleText.matchAll(/\+?\d[\d\s().-]{7,}\d/g)]
        .map((m) => m[0].trim())
        .filter((p) => p.replace(/\D/g, '').length >= 8),
    ),
  ].slice(0, 5);
  const labelled = visibleText.match(/Address:\s*([^|]{8,120})/i);

  // Only structured metadata counts as product data. An arbitrary <h1> is not a product name.
  const product = jsonLdProduct ?? productFromMeta(meta);

  return {
    title,
    siteName,
    ...(faviconUrl ? { faviconUrl } : {}),
    visibleText,
    chunks: visible,
    hiddenText,
    emails: [...emails].slice(0, 10),
    phones,
    address: addressText ?? (labelled ? labelled[1].trim() : undefined),
    links,
    ...(product ? { product } : {}),
  };
}

function legalNameIn(chunks: readonly string[]): string | undefined {
  for (const chunk of chunks) {
    const found = legalNameInText(chunk);
    if (found) return found;
  }
  return undefined;
}

function legalNameInText(text: string): string | undefined {
  const match = text.match(
    /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\s+(?:LLC|Ltd|Limited|Pvt Ltd|Inc|Corp|GmbH|LLP|Co\.))/,
  );
  return match ? match[1] : undefined;
}

/**
 * Classifies what the fetch actually returned. A 200 response is not proof of a readable page:
 * marketplaces commonly answer with a bot-check interstitial that has its own title and text.
 */
export function classifyPageAccess(
  html: string,
  title: string | undefined,
  httpStatus: number,
  visibleText: string,
  hasProduct = false,
): PageAccess {
  if (httpStatus === 401 || httpStatus === 403) {
    return { state: 'blocked', httpStatus, reason: 'access_denied' };
  }
  if (httpStatus === 429) {
    return { state: 'blocked', httpStatus, reason: 'rate_limited' };
  }
  if (httpStatus === 503 || httpStatus === 502 || httpStatus === 504) {
    return { state: 'unreachable', httpStatus, reason: 'service_unavailable' };
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return { state: 'unreachable', httpStatus, reason: 'not_found' };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { state: 'unreachable', httpStatus, reason: `http_${httpStatus}` };
  }

  const challengeText = `${title ?? ''} ${visibleText.slice(0, 3000)}`;
  for (const { pattern, reason } of CHALLENGE_PATTERNS) {
    if (pattern.test(challengeText)) return { state: 'blocked', httpStatus, reason };
  }
  if (html.length < 20_000 && /access denied/i.test(challengeText)) {
    return { state: 'blocked', httpStatus, reason: 'access_denied' };
  }

  if (!hasProduct && !title && visibleText.trim().length < 20) {
    return { state: 'empty', httpStatus, reason: 'empty_content' };
  }
  return { state: 'ok', httpStatus };
}

function isProductPath(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/(?:dp|gp\/product|product|products|p|item|listing)\//i.test(`${path}/`);
  } catch {
    return false;
  }
}

function productFromTitle(title: string, siteNames: readonly string[]): PageProduct | undefined {
  const candidate = title.split(/\s+[|:]\s+/)[0]?.trim() ?? title.trim();
  const name = candidate.slice(0, 160).trim();
  if (name.length < 3) return undefined;
  // A page title that is only the site or platform name is not a product name.
  const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const compactName = compact(name);
  if (siteNames.some((site) => site && compact(site) === compactName)) return undefined;
  return { name, source: 'title' };
}

export function extractPageClaims(html: string, finalUrl: string, httpStatus = 200): PageClaims {
  const page = extractPage(html);
  let host = '';
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const marketplace = host ? recognizeMarketplace(host) : undefined;
  const access = classifyPageAccess(html, page.title, httpStatus, page.visibleText, Boolean(page.product));
  const titleProduct =
    !page.product && page.title && access.state === 'ok' && isProductPath(finalUrl)
      ? productFromTitle(
          page.title,
          [page.siteName, marketplace?.displayName, marketplace?.officialDomain, host].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          ),
        )
      : undefined;
  const product = page.product ?? titleProduct;
  const own = host ? registrableDomain(host) : '';
  const linkedDomains = new Set<string>();
  const sectionLinks: Partial<Record<SectionHint, string>> = {};

  for (const link of page.links) {
    let target: URL;
    try {
      target = new URL(link.href, finalUrl);
    } catch {
      continue;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
    const targetDomain = registrableDomain(target.hostname);
    if (targetDomain !== own) {
      linkedDomains.add(targetDomain);
      continue;
    }
    for (const hint of Object.keys(SECTION_WORDS) as SectionHint[]) {
      if (!sectionLinks[hint] && (SECTION_WORDS[hint].test(target.pathname) || SECTION_WORDS[hint].test(link.text))) {
        sectionLinks[hint] = target.toString();
      }
    }
  }

  const hasContactPage = Boolean(
    sectionLinks.contact || page.emails.length > 0 || page.phones.length > 0 || page.address,
  );
  const hasLegalPage = Boolean(sectionLinks.terms || sectionLinks.privacy);

  // The favicon URL is only recorded here. The comparison with a trusted reference happens in
  // port.ts (favicon.ts). A third-party CDN is common and is not a mismatch.
  let faviconUrl: string | undefined;
  let faviconSameOrigin: boolean | undefined;
  if (page.faviconUrl) {
    try {
      const icon = new URL(page.faviconUrl, finalUrl);
      if (icon.protocol === 'http:' || icon.protocol === 'https:') {
        faviconUrl = icon.toString();
        if (own) faviconSameOrigin = registrableDomain(icon.hostname) === own;
      }
    } catch {
      // A malformed icon URL is simply not recorded.
    }
  }

  // A product-page <title> is a product name, not the merchant's claimed identity. Only fall
  // back to the title on non-product URLs.
  const siteName = page.siteName ?? (!isProductPath(finalUrl) ? page.title?.split(/\s[-|–]\s/)[0] : undefined);
  return {
    finalUrl,
    domain: host,
    siteName,
    legalName: legalNameIn(page.chunks),
    claimedBrand: siteName,
    contacts: { emails: page.emails, phones: page.phones, address: page.address },
    linkedDomains: [...linkedDomains].slice(0, 20),
    visibleText: page.visibleText,
    hiddenText: page.hiddenText,
    sectionLinks,
    ...(faviconUrl ? { faviconUrl } : {}),
    ...(faviconSameOrigin !== undefined ? { faviconSameOrigin } : {}),
    hasContactPage,
    hasLegalPage,
    pageAccess: access,
    ...(access.state === 'ok' && product ? { product } : {}),
    ...(marketplace ? { marketplace } : {}),
  };
}

export function extractSection(html: string, url: string, textCap = 4000, httpStatus = 200): SectionResult {
  const page = extractPage(html);
  const access = classifyPageAccess(html, page.title, httpStatus, page.visibleText, Boolean(page.product));
  if (access.state === 'blocked' || access.state === 'empty') return { found: false };

  const text = page.visibleText.slice(0, textCap);
  const registration = page.visibleText.match(
    /(?:registration|company|reg\.?)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,19})/i,
  );
  return {
    found: true,
    url,
    text,
    legalName: legalNameIn(page.chunks),
    address: page.address,
    registrationNo: registration ? registration[1] : undefined,
  };
}
