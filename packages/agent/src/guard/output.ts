import { sanitizeText } from './shield.js';

/**
 * Output side of the shield: any model-written text that may be shown or stored
 * is cleaned, length-limited, and rejected outright if it contains a URL, an
 * email address or a domain name.
 */

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const DOMAIN_PATTERN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;

export function containsForbiddenReference(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return URL_PATTERN.test(text) || EMAIL_PATTERN.test(text) || DOMAIN_PATTERN.test(text);
}

export function sanitizeModelText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;

  const { clean } = sanitizeText(value, { location: 'visible', maxLen: maxLength });
  const text = clean.trim();
  if (text.length === 0) return undefined;

  if (containsForbiddenReference(text)) return undefined;

  return text;
}
