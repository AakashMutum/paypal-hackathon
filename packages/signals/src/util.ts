import type { Evidence } from './types.js';

type EvidenceInput = Omit<Evidence, 'id' | 'confidence' | 'hardFail'> &
  Partial<Pick<Evidence, 'id' | 'confidence' | 'hardFail'>>;

export function makeEvidence(input: EvidenceInput): Evidence {
  const confidence = Math.min(1, Math.max(0, input.confidence ?? 1));
  return {
    ...input,
    id: input.id ?? `${input.source}:${input.type}`.toLowerCase(),
    confidence,
    hardFail: input.hardFail ?? false,
  };
}

export function hostnameOf(merchantUrl: string): string {
  return new URL(merchantUrl).hostname.toLowerCase().replace(/\.$/, '');
}

const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/**
 * Rough registrable domain without a public suffix list: drops a leading "www" and keeps the
 * last two labels, or three when the TLD is a two-letter code under a common second level
 * (for example shop.co.uk). Good enough for evidence; not a security boundary.
 */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL_LABELS.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetchImpl(url, { ...init, signal });
}

/** Reads at most maxBytes of the body as text. Website content is untrusted and may be huge. */
export async function readLimitedText(res: Response, maxBytes = 64 * 1024): Promise<string> {
  if (!res.body) {
    return (await res.text()).slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}
