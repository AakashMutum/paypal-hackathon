/**
 * Small domain helpers. The agent only needs the host and the registrable
 * domain (the "site name" part of a hostname), so this avoids a dependency.
 */

const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.in',
  'net.in',
  'org.in',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.nz',
  'com.br',
  'com.mx',
  'com.sg',
  'com.hk',
  'co.za',
  'com.tr',
  'com.cn',
]);

export function hostOf(url: string): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  try {
    const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return trimmed
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .toLowerCase()
      .replace(/\.$/, '');
  }
}

export function isIpHost(host: string): boolean {
  if (!host) return false;
  if (host.includes(':')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function registrableDomainFromHost(host: string): string {
  if (!host) return '';
  if (isIpHost(host)) return host;

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');

  return lastTwo;
}

export function registrableDomain(url: string): string {
  return registrableDomainFromHost(hostOf(url));
}
