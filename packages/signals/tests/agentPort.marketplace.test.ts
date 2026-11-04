// @brand-check-allow functional real-merchant hostname tests, not demo content.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAmazonHostname,
  marketplaceBrandDomains,
  recognizeMarketplace,
  safeHostname,
} from '../src/agentPort/marketplace.js';

test('recognises official Amazon India and US hostnames', () => {
  assert.deepEqual(recognizeMarketplace('https://www.amazon.in/dp/B08N5WRWNW'), {
    id: 'amazon',
    displayName: 'Amazon',
    officialDomain: 'amazon.in',
    region: 'IN',
  });
  assert.equal(recognizeMarketplace('amazon.com')?.region, 'US');
  assert.equal(recognizeMarketplace('https://www.amazon.com/dp/B08N5WRWNW?th=1')?.officialDomain, 'amazon.com');
  assert.equal(isAmazonHostname('www.amazon.in'), true);
  assert.equal(isAmazonHostname('m.amazon.com'), true);
});

test('recognises regional storefronts including multi-part suffixes', () => {
  const cases: Array<[string, string, string]> = [
    ['www.amazon.co.uk', 'amazon.co.uk', 'GB'],
    ['www.amazon.com.au', 'amazon.com.au', 'AU'],
    ['www.amazon.co.jp', 'amazon.co.jp', 'JP'],
    ['www.amazon.com.mx', 'amazon.com.mx', 'MX'],
    ['www.amazon.com.br', 'amazon.com.br', 'BR'],
    ['www.amazon.com.sg', 'amazon.com.sg', 'SG'],
    ['www.amazon.ae', 'amazon.ae', 'AE'],
    ['www.amazon.de', 'amazon.de', 'DE'],
  ];
  for (const [input, domain, region] of cases) {
    const identity = recognizeMarketplace(input);
    assert.ok(identity, input);
    assert.equal(identity.officialDomain, domain);
    assert.equal(identity.region, region);
  }
});

test('rejects lookalike and deceptive hostnames', () => {
  const deceptive = [
    'amaz0n-example.com',
    'amaz0n.in',
    'amazon.in.evil.com',
    'amazon.com.evil.example',
    'evilamazon.in',
    'notamazon.com',
    'amazon.co.in',
    'amazon.in-account.com',
    'amazon-support.example',
    'www.amazon.in@evil.com',
    'аmazon.in',
    '127.0.0.1',
    'localhost',
    'not a host',
    '',
  ];
  for (const host of deceptive) {
    assert.equal(recognizeMarketplace(host), undefined, host);
    assert.equal(isAmazonHostname(host), false, host);
  }
});

test('safeHostname accepts host or URL and rejects unsafe forms', () => {
  assert.equal(safeHostname('www.amazon.in'), 'www.amazon.in');
  assert.equal(safeHostname('https://WWW.AMAZON.IN./dp/x'), 'www.amazon.in');
  assert.equal(safeHostname('ftp://amazon.in/'), undefined);
  assert.equal(safeHostname('javascript:alert(1)'), undefined);
  assert.equal(safeHostname('user:pass@amazon.in'), undefined);
  assert.equal(safeHostname('https://user:pass@amazon.in/'), undefined);
});

test('official marketplace domains are exposed for lookalike protection', () => {
  const domains = marketplaceBrandDomains();
  assert.ok(domains.includes('amazon.in'));
  assert.ok(domains.includes('amazon.com'));
  assert.equal(new Set(domains).size, domains.length);
});
