import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeUrl, isPrivateAddress, UnsafeUrlError } from '../src/safety/url.js';
import { publicLookup } from './helpers.js';

test('isPrivateAddress flags private, loopback and link-local ranges', () => {
  for (const ip of [
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:a00:1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress allows public addresses', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

// Built at runtime so no credentialed URL literal appears in the source.
function withCredentials(): string {
  const u = new URL('https://shop.example/');
  u.username = 'tester';
  u.password = 'placeholder';
  return u.toString();
}

test('assertSafeUrl rejects unsafe URLs', async () => {
  const bad = [
    'ftp://shop.example/',
    'file:///etc/passwd',
    withCredentials(),
    'http://localhost/',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://2130706433/',
    'not a url',
  ];
  for (const url of bad) {
    await assert.rejects(() => assertSafeUrl(url, { lookup: publicLookup }), UnsafeUrlError, url);
  }
});

test('assertSafeUrl rejects a public-looking name that resolves to a private address', async () => {
  await assert.rejects(
    () => assertSafeUrl('https://shop.example/', { lookup: async () => ['93.184.216.34', '10.0.0.5'] }),
    UnsafeUrlError,
  );
});

test('assertSafeUrl accepts a public host', async () => {
  const safe = await assertSafeUrl('https://shop.example/path', { lookup: publicLookup });
  assert.equal(safe.hostname, 'shop.example');
  assert.deepEqual(safe.addresses, ['93.184.216.34']);
});
