import { registrableDomain } from '../util.js';
import type { PageClaims, SectionHint, SectionResult } from './types.js';

// Page text is untrusted data. Everything here only extracts and caps text; nothing in a page
// is ever interpreted as an instruction.

const VISIBLE_CAP = 8000;
const HIDDEN_CAP = 4000;
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

export interface ExtractedPage {
  title?: string;
  siteName?: string;
  visibleText: string;
  /** Visible text chunks, one per text node, so searches do not span unrelated elements. */
  chunks: string[];
  hiddenText: string;
  emails: string[];
  phones: string[];
  address?: string;
  links: Array<{ href: string; text: string }>;
}

export function extractPage(html: string): ExtractedPage {
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
  let siteName: string | undefined;
  for (const meta of body.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(meta, 'property') ?? attr(meta, 'name') ?? '').toLowerCase();
    if (key === 'og:site_name' || key === 'application-name') {
      siteName = siteName ?? collapse(attr(meta, 'content') ?? '');
    }
  }

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

  return {
    title,
    siteName,
    visibleText,
    chunks: visible,
    hiddenText,
    emails: [...emails].slice(0, 10),
    phones,
    address: addressText ?? (labelled ? labelled[1].trim() : undefined),
    links,
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

export function extractPageClaims(html: string, finalUrl: string): PageClaims {
  const page = extractPage(html);
  const host = new URL(finalUrl).hostname.toLowerCase();
  const own = registrableDomain(host);
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

  const siteName = page.siteName ?? page.title?.split(/\s[-|–]\s/)[0];
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
    hasContactPage: Boolean(sectionLinks.contact),
    hasLegalPage: Boolean(sectionLinks.terms || sectionLinks.privacy),
  };
}

export function extractSection(html: string, url: string, textCap = 4000): SectionResult {
  const page = extractPage(html);
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
