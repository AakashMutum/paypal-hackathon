import { assertSafeUrl } from '../safety/url.js';
import { readLimitedText } from '../util.js';

export interface SafeGetOptions {
  fetchImpl: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  /** Retries for transient failures only (network errors, 408/425/429/5xx). Default 1. */
  maxRetries?: number;
  /** Delay between transient retries. Default 150 ms. */
  retryDelayMs?: number;
}

export interface SafeGetResult {
  finalUrl: string;
  status: number;
  ok: boolean;
  text: string;
  contentType?: string;
}

/** Identifies the verifier honestly. It does not impersonate a browser or evade a challenge. */
export const MERCHANT_FETCH_USER_AGENT = 'TrustOra-MerchantVerifier/0.1';

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Plain GET of an untrusted page. Every URL, including each redirect target, goes through
 * assertSafeUrl. The body is capped. Transient failures get a bounded number of retries; a
 * CAPTCHA, a WAF block or any other 4xx is returned as-is and never retried or bypassed.
 */
export async function safeGet(url: string, options: SafeGetOptions): Promise<SafeGetResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 1));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150);
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeUrl(current, { lookup: options.lookup });

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0 && retryDelayMs > 0) await delay(retryDelayMs, signal);

      let res: Response;
      try {
        res = await options.fetchImpl(current, {
          redirect: 'manual',
          signal,
          headers: {
            accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': MERCHANT_FETCH_USER_AGENT,
          },
        });
      } catch (error) {
        if (attempt < maxRetries && !signal.aborted) continue;
        throw error;
      }

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        await res.body?.cancel().catch(() => undefined);
        break;
      }

      if (!res.ok && TRANSIENT_STATUSES.has(res.status) && attempt < maxRetries) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }

      const text = res.ok ? await readLimitedText(res, options.maxBytes ?? 256 * 1024) : '';
      if (!res.ok) await res.body?.cancel().catch(() => undefined);
      const contentType = res.headers.get('content-type') ?? undefined;
      return { finalUrl: current, status: res.status, ok: res.ok, text, ...(contentType ? { contentType } : {}) };
    }
  }
  throw new Error('Too many redirects');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
