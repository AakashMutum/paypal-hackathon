import { assertSafeUrl } from '../safety/url.js';
import { readLimitedBytes, readLimitedText } from '../util.js';

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
  return safeRequest(
    url,
    options,
    'text/html, text/plain;q=0.9, */*;q=0.1',
    (res, maxBytes) => readLimitedText(res, maxBytes),
    '',
  );
}

export interface SafeGetBytesResult {
  finalUrl: string;
  status: number;
  ok: boolean;
  bytes: Uint8Array;
  /** True when the body was longer than maxBytes. The bytes are then cut and must not be trusted. */
  truncated: boolean;
}

/**
 * Same safety rules as safeGet (every hop through assertSafeUrl, no CAPTCHA bypass, bounded
 * retries) for a small binary body such as a favicon. Reads at most maxBytes and reports whether
 * the body was longer.
 */
export async function safeGetBytes(url: string, options: SafeGetOptions): Promise<SafeGetBytesResult> {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const result = await safeRequest(
    url,
    { ...options, maxBytes },
    'image/*, */*;q=0.1',
    (res, limit) => readLimitedBytes(res, limit + 1),
    new Uint8Array(0),
  );
  const truncated = result.text.byteLength > maxBytes;
  return {
    finalUrl: result.finalUrl,
    status: result.status,
    ok: result.ok,
    bytes: truncated ? result.text.subarray(0, maxBytes) : result.text,
    truncated,
  };
}

async function safeRequest<T>(
  url: string,
  options: SafeGetOptions,
  accept: string,
  read: (res: Response, maxBytes: number) => Promise<T>,
  empty: T,
): Promise<{ finalUrl: string; status: number; ok: boolean; text: T }> {
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
            accept,
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

      const text = res.ok ? await read(res, options.maxBytes ?? 256 * 1024) : empty;
      if (!res.ok) await res.body?.cancel().catch(() => undefined);
      return { finalUrl: current, status: res.status, ok: res.ok, text };
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
