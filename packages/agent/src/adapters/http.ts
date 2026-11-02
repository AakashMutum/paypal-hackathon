import type { CallOpts } from '../ports.js';

/** Minimal JSON POST helper used by the live adapters. */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: CallOpts,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  if (options.signal?.aborted) throw new Error('request aborted');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
  timer.unref?.();

  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
