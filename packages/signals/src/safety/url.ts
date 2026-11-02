import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export type LookupFn = (hostname: string) => Promise<string[]>;

export interface SafeUrl {
  url: URL;
  hostname: string;
  /** Addresses the hostname resolved to. All of them passed the private-range check. */
  addresses: string[];
}

const defaultLookup: LookupFn = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((a) => a.address);

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    text = text.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/** True for private, loopback, link-local, unspecified and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) {
    const g = expandIPv6(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return isPrivateIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

/**
 * Throws UnsafeUrlError unless the URL is a plain http(s) URL that points at a public host.
 * Hostnames are resolved and every resolved address is checked, so a public-looking name that
 * points at a private address is rejected. Callers should connect to a returned address or
 * accept that a later lookup can differ.
 */
export async function assertSafeUrl(
  input: string,
  options: { lookup?: LookupFn } = {},
): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL must not contain credentials');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname) throw new UnsafeUrlError('URL has no hostname');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('localhost is not allowed');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError(`Private address is not allowed: ${hostname}`);
    return { url, hostname, addresses: [hostname] };
  }

  let addresses: string[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(hostname);
  } catch {
    throw new UnsafeUrlError(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`Host did not resolve: ${hostname}`);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError(`Host ${hostname} resolves to a private address`);
    }
  }
  return { url, hostname, addresses };
}
