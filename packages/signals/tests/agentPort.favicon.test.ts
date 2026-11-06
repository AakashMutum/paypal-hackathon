import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkFavicon,
  findFaviconReference,
  hashFavicon,
  loadDefaultFaviconReferences,
  validateFaviconReferences,
  type FaviconReference,
} from '../src/agentPort/favicon.js';
import { createLocalSignalsPort } from '../src/agentPort/port.js';
import { callOpts } from './agentPort.helpers.js';
import { publicLookup } from './helpers.js';

// Invented bytes that start like a PNG. They are not any brand's icon.
const png = (marker: string): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(marker)]);

const REFERENCE_BYTES = png('reference-icon');
const reference = (overrides: Partial<FaviconReference> = {}): FaviconReference => ({
  brandDomain: 'harborline.example',
  brandNames: ['Harborline Outfitters'],
  hash: hashFavicon(REFERENCE_BYTES),
  source: 'test fixture',
  provenance: { suppliedBy: 'unit test', suppliedOn: '2026-11-04' },
  retrievedOn: '2026-11-04',
  ...overrides,
});

const pageHtml = (brand: string, icon?: string): string =>
  `<html><head><title>${brand}</title><meta property="og:site_name" content="${brand}">${
    icon ? `<link rel="icon" href="${icon}">` : ''
  }</head><body><p>Welcome to ${brand}. Contact us at help@shop.example</p></body></html>`;

interface World {
  page: string;
  icon?: Response | Error;
}

function fakeWeb(world: World, seen: string[]): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    if (url === 'https://shop.example/') {
      return new Response(world.page, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('icon.png') || url.includes('favicon')) {
      if (world.icon instanceof Error) throw world.icon;
      return world.icon ?? new Response('missing', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

async function claimsFor(world: World, refs: FaviconReference[], seen: string[] = []) {
  const port = createLocalSignalsPort({
    mode: 'live',
    fetchImpl: fakeWeb(world, seen),
    lookupImpl: publicLookup,
    faviconReferences: refs,
  });
  return port.getPageClaims('https://shop.example/', callOpts);
}

const iconResponse = (bytes: Uint8Array): Response => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });

test('a different favicon hash against a valid reference is reported as differs', async () => {
  const claims = await claimsFor(
    { page: pageHtml('Harborline Outfitters', '/icon.png'), icon: iconResponse(png('some-other-icon')) },
    [reference()],
  );
  assert.equal(claims.faviconCheck?.state, 'differs');
  assert.equal(claims.faviconCheck?.referenceDomain, 'harborline.example');
  assert.equal(claims.faviconCheck?.observedHash, hashFavicon(png('some-other-icon')));
  assert.equal(claims.faviconHash, claims.faviconCheck?.observedHash);
});

test('the same favicon hash is a match', async () => {
  const claims = await claimsFor(
    { page: pageHtml('Harborline Outfitters', '/icon.png'), icon: iconResponse(REFERENCE_BYTES) },
    [reference()],
  );
  assert.equal(claims.faviconCheck?.state, 'match');
});

test('with no reference for the brand nothing is fetched and the state is no_reference', async () => {
  const seen: string[] = [];
  const claims = await claimsFor(
    { page: pageHtml('Bargain Barn Outlet', '/icon.png'), icon: iconResponse(png('x')) },
    [reference()],
    seen,
  );
  assert.equal(claims.faviconCheck?.state, 'no_reference');
  assert.equal(seen.some((url) => url.includes('icon.png')), false, 'the favicon must not be fetched');
});

test('a page without a declared favicon is no_favicon, not a mismatch', async () => {
  const claims = await claimsFor({ page: pageHtml('Harborline Outfitters') }, [reference()]);
  assert.equal(claims.faviconCheck?.state, 'no_favicon');
});

test('a favicon on a third-party CDN is fetched and compared on its hash only', async () => {
  const same = await claimsFor(
    { page: pageHtml('Harborline Outfitters', 'https://cdn.assets.example/icon.png'), icon: iconResponse(REFERENCE_BYTES) },
    [reference()],
  );
  assert.equal(same.faviconSameOrigin, false);
  assert.equal(same.faviconCheck?.state, 'match');
});

test('a malformed favicon is invalid, not a mismatch', async () => {
  const claims = await claimsFor(
    { page: pageHtml('Harborline Outfitters', '/icon.png'), icon: new Response('<html>not an image at all</html>', { status: 200 }) },
    [reference()],
  );
  assert.equal(claims.faviconCheck?.state, 'invalid');
  assert.equal(claims.faviconCheck?.observedHash, undefined);
});

test('an oversized favicon is too_large and is never hashed', async () => {
  const big = new Uint8Array(200 * 1024);
  big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const claims = await claimsFor({ page: pageHtml('Harborline Outfitters', '/icon.png'), icon: iconResponse(big) }, [reference()]);
  assert.equal(claims.faviconCheck?.state, 'too_large');
  assert.equal(claims.faviconCheck?.observedHash, undefined);
});

test('a favicon fetch failure or a 404 is fetch_failed', async () => {
  const failed = await claimsFor(
    { page: pageHtml('Harborline Outfitters', '/icon.png'), icon: new Error('connection reset') },
    [reference()],
  );
  assert.equal(failed.faviconCheck?.state, 'fetch_failed');
  const missing = await claimsFor({ page: pageHtml('Harborline Outfitters', '/icon.png') }, [reference()]);
  assert.equal(missing.faviconCheck?.state, 'fetch_failed');
});

test('a page on the reference domain is never compared', async () => {
  const seen: string[] = [];
  const result = await checkFavicon({
    pageDomain: 'www.harborline.example',
    claimedBrand: 'Harborline Outfitters',
    faviconUrl: 'https://www.harborline.example/icon.png',
    references: [reference()],
    fetchOptions: { fetchImpl: fakeWeb({ page: '', icon: iconResponse(png('anything')) }, seen), lookup: publicLookup, timeoutMs: 1000 },
  });
  assert.equal(result.state, 'reference_domain');
  assert.equal(seen.length, 0);
});

test('an unsafe favicon address is refused and reported as fetch_failed', async () => {
  const result = await checkFavicon({
    pageDomain: 'shop.example',
    claimedBrand: 'Harborline Outfitters',
    faviconUrl: 'http://127.0.0.1/icon.png',
    references: [reference()],
    fetchOptions: { fetchImpl: fakeWeb({ page: '' }, []), timeoutMs: 1000 },
  });
  assert.equal(result.state, 'fetch_failed');
});

test('a brand is matched by exact name only', () => {
  const refs = [reference()];
  assert.ok(findFaviconReference(refs, 'harborline  outfitters'));
  assert.equal(findFaviconReference(refs, 'Harborlyne Outfitters'), undefined);
  assert.equal(findFaviconReference(refs, undefined), undefined);
});

test('the validator keeps valid entries and drops malformed ones', () => {
  const good = reference();
  const result = validateFaviconReferences({
    version: 1,
    entries: [good, { ...good, hash: 'md5:abc' }, { ...good, provenance: { suppliedBy: '' } }, null],
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 3);
  assert.equal(validateFaviconReferences({ version: 2, entries: [] }).entries.length, 0);
  assert.equal(validateFaviconReferences('nope').errors.length, 1);
});

test('the shipped corpus is valid and has no real brand entries', () => {
  const file = loadDefaultFaviconReferences();
  assert.ok(Array.isArray(file));
});
