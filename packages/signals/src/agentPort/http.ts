import { assertSafeUrl } from '../safety/url.js';
import { readLimitedText } from '../util.js';

export interface SafeGetOptions {
  fetchImpl: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeGetResult {
  finalUrl: string;
  status: number;
  ok: boolean;
  text: string;
}

/**
 * Plain GET of an untrusted page. Every URL, including each redirect target, goes through
 * assertSafeUrl. The body is capped. Throws UnsafeUrlError for unsafe URLs; callers decide how
 * to report that.
 */
export async function safeGet(url: string, options: SafeGetOptions): Promise<SafeGetResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeUrl(current, { lookup: options.lookup });
    const res = await options.fetchImpl(current, {
      redirect: 'manual',
      signal,
      headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    const text = res.ok ? await readLimitedText(res, options.maxBytes ?? 256 * 1024) : '';
    if (!res.ok) await res.body?.cancel().catch(() => undefined);
    return { finalUrl: current, status: res.status, ok: res.ok, text };
  }
  throw new Error('Too many redirects');
}
