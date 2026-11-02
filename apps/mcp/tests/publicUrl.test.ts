import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafePublicUrl } from '../src/security/publicUrl.js';

const SAFE_URLS = [
  'https://shop.example',
  'http://shop.example/path?q=1',
  'https://sub.shop.example',
  'https://8.8.8.8',
  'https://1.1.1.1:8443',
  'https://[2606:4700:4700::1111]',
  'https://example.co.uk',
  'https://xn--bcher-kva.example',
  'https://example.com.',
  'https://example.travel',
];

const UNSAFE_URLS = [
  'ftp://shop.example',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/plain,hello',
  'http://localhost',
  'http://foo.localhost',
  'http://foo.local',
  'http://foo.internal',
  'http://127.0.0.1',
  'http://127.1',
  'http://0.0.0.0',
  'http://10.0.0.1',
  'http://172.16.5.4',
  'http://192.168.1.1',
  'http://169.254.169.254',
  'http://100.64.0.1',
  'http://198.18.0.1',
  'http://224.0.0.1',
  'http://255.255.255.255',
  'http://[::1]',
  'http://[fc00::1]',
  'http://[fe80::1]',
  'http://[::ffff:127.0.0.1]',
  'http://user:pass@example.com',
  'http://example',
  '',
];

test('accepts public http(s) URLs', () => {
  for (const url of SAFE_URLS) {
    assert.equal(isSafePublicUrl(url), true, `expected safe: ${url}`);
  }
});

test('rejects local, private, credential-bearing and non-http URLs', () => {
  for (const url of UNSAFE_URLS) {
    assert.equal(isSafePublicUrl(url), false, `expected unsafe: ${url}`);
  }
});

test('never throws on malformed or non-string input', () => {
  for (const value of [null, undefined, 42, {}, [], 'http://', '::::']) {
    assert.doesNotThrow(() => isSafePublicUrl(value as unknown as string));
    assert.equal(isSafePublicUrl(value as unknown as string), false);
  }
});

test('normalises decimal, octal and hex loopback spellings', () => {
  assert.equal(isSafePublicUrl('http://2130706433'), false);
  assert.equal(isSafePublicUrl('http://0x7f000001'), false);
  assert.equal(isSafePublicUrl('http://0177.0.0.1'), false);
});
