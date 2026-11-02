const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
]);

function withoutBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function withoutTrailingDot(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

function parseIpv4(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;

  return false;
}

function ipv4FromMappedIpv6(host: string): string | null {
  if (!host.startsWith('::ffff:')) return null;
  const rest = host.slice('::ffff:'.length);

  if (parseIpv4(rest)) return rest;

  const hexParts = rest.split(':');
  if (hexParts.length !== 2) return null;

  const high = Number.parseInt(hexParts[0], 16);
  const low = Number.parseInt(hexParts[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isPrivateIpv6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(host)) return true;
  if (host.startsWith('2001:db8')) return true;

  const mapped = ipv4FromMappedIpv6(host);
  if (mapped) {
    const parts = parseIpv4(mapped);
    return parts ? isPrivateIpv4(parts) : true;
  }

  return false;
}

/**
 * `true` only for an absolute http(s) URL whose host is publicly routable.
 *
 * Blocks credentials, localhost, `.local`, `.internal`, single-label hosts and
 * private, loopback, link-local, multicast or documentation address ranges.
 */
export function isSafePublicUrl(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;

  const host = withoutTrailingDot(withoutBrackets(url.hostname.toLowerCase()));
  if (host.length === 0) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) return !isPrivateIpv4(ipv4);

  if (host.includes(':')) return !isPrivateIpv6(host);

  return host.includes('.');
}
