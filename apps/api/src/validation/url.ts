const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Normalises a user-entered website address without making a network request.
 *
 * A bare domain such as "store-name.example/product/123" is accepted and given the https scheme. The path and
 * query are preserved: a product URL must stay a product URL so structured product metadata can
 * be read. Credentials, non-http(s) schemes, IPs and single-label hosts are rejected. DNS and
 * private-address checks still happen later in assertSafeUrl before any fetch.
 */
export function normalizeMerchantUrl(input: string): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || IPV4_PATTERN.test(host) || host.includes(':')) return undefined;
  if (!HOSTNAME_PATTERN.test(host)) return undefined;

  url.hostname = host;
  url.hash = '';
  return url.toString();
}
