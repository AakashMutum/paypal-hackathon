import { matchInjection } from './patterns.js';

/**
 * The shield. Everything that comes from a web page, a registry free-text field
 * or a memory record passes through here before it can reach a prompt, a trace,
 * a log or an evidence summary.
 *
 * Two deliberate hardenings over the literal spec:
 *  - HTML comments are scanned as hidden text before being removed, because an
 *    injection hidden in a comment would otherwise be silently deleted.
 *  - The full text (up to SCAN_LIMIT) is scanned; only the returned `clean`
 *    string is truncated to maxLen. Truncating before scanning would let an
 *    attacker pad a page and push the injection past the limit.
 */

export type SanitizationLocation = 'visible' | 'hidden' | 'section' | 'registry' | 'memory';

export interface ShieldFinding {
  pattern: string;
  location: SanitizationLocation;
  /** The matched fragment only, never the surrounding page content. */
  snippet: string;
}

export interface SanitizeOptions {
  maxLen?: number;
  location?: SanitizationLocation;
}

export interface SanitizeResult {
  clean: string;
  findings: ShieldFinding[];
}

export const DEFAULT_MAX_LEN: Record<SanitizationLocation, number> = {
  visible: 6000,
  hidden: 2000,
  section: 3000,
  registry: 200,
  memory: 200,
};

/** Hard ceiling for how much text is scanned, to keep the regex pass bounded. */
export const SCAN_LIMIT = 50000;

export const MAX_SNIPPET_LENGTH = 80;

const CONTROL_AND_ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const HTML_COMMENT = /<!--([\s\S]*?)-->/g;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const SPOOF_TAG = /<\/?\s*(untrusted_data|system|inst|instruction)\s*>/gi;

export function sanitizeText(raw: unknown, options: SanitizeOptions = {}): SanitizeResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { clean: '', findings: [] };
  }

  const location = options.location ?? 'visible';
  const maxLen = options.maxLen ?? DEFAULT_MAX_LEN[location];

  try {
    const findings: ShieldFinding[] = [];

    let text = raw.normalize('NFKC').replace(CONTROL_AND_ZERO_WIDTH, '');
    text = decodeEntities(text);
    text = text.slice(0, SCAN_LIMIT);

    // Hidden text first: comments are removed, but their content is checked.
    text = text.replace(HTML_COMMENT, (_full, body: string) => {
      scanSentences(normalizePlainText(neutralizeSpoofTags(body)), 'hidden', findings);
      return ' ';
    });

    // A spoofed delimiter such as <untrusted_data> would otherwise be deleted by
    // the tag stripper before the pattern could ever see it. Bracket it instead.
    text = neutralizeSpoofTags(text);
    text = normalizePlainText(text);

    const kept: string[] = [];
    for (const sentence of splitSentences(text)) {
      const match = matchInjection(sentence);
      if (match) {
        findings.push({ pattern: match.pattern, location, snippet: clampSnippet(match.snippet) });
      } else {
        kept.push(sentence);
      }
    }

    const clean = kept.join(' ').slice(0, Math.max(0, maxLen)).trim();
    return { clean, findings };
  } catch {
    return { clean: '', findings: [] };
  }
}

function scanSentences(text: string, location: SanitizationLocation, findings: ShieldFinding[]): void {
  for (const sentence of splitSentences(text)) {
    const match = matchInjection(sentence);
    if (match) {
      findings.push({ pattern: match.pattern, location, snippet: clampSnippet(match.snippet) });
    }
  }
}

function normalizePlainText(text: string): string {
  return text
    // Tags become line breaks so two paragraphs never merge into one sentence,
    // which would let an injection take the surrounding page copy with it.
    .replace(HTML_TAG, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function neutralizeSpoofTags(text: string): string {
  return text.replace(SPOOF_TAG, (match) => `[${match.replace(/[<>/\s]/g, '')}]`);
}

function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function clampSnippet(value: string): string {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LENGTH);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_full, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_full, dec: string) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
