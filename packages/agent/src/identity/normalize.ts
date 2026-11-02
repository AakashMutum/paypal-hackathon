/**
 * Name normalisation for identity matching.
 *
 * `normalizeLegal` strips company suffixes so "Veloura Outdoor Pvt Ltd" and
 * "Veloura Outdoor Private Limited" become the same string. `coreName` also
 * strips generic trading words so brand comparisons ignore "Official Outlet".
 */

const LEGAL_SUFFIXES = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'sa',
  'sas',
  'srl',
  'bv',
  'plc',
  'llp',
  'lp',
  'oy',
  'ab',
  'as',
  'pte',
  'sdn',
  'bhd',
  'and',
]);

const GENERIC_WORDS = new Set([
  'official',
  'store',
  'shop',
  'outlet',
  'outlets',
  'retailer',
  'online',
  'deals',
  'sale',
  'mart',
  'india',
  'international',
  'global',
  'group',
]);

export function normalizeLegal(input: unknown): string {
  if (typeof input !== 'string') return '';
  const text = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ');

  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && !LEGAL_SUFFIXES.has(token))
    .join(' ');
}

export function coreName(input: unknown): string {
  return normalizeLegal(input)
    .split(' ')
    .filter((token) => token.length > 0 && !GENERIC_WORDS.has(token))
    .join(' ');
}
