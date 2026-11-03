import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RDAP_BOOTSTRAP_URL,
  RdapCollector,
  domainAgeDays,
  findRegistrationDate,
  rdapUrlFor,
} from '../src/domain/rdap.js';
import { jsonResponse, options, request } from './helpers.js';

test('domainAgeDays counts whole days', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(domainAgeDays('2026-10-03T12:00:00Z', now), 30);
  assert.equal(domainAgeDays('2026-10-04T00:00:00Z', now), 29);
  assert.equal(domainAgeDays('not a date', now), null);
});

test('findRegistrationDate reads the registration event', () => {
  const rdap = {
    events: [
      { eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' },
      { eventAction: 'registration', eventDate: '2019-05-05T00:00:00Z' },
    ],
  };
  assert.equal(findRegistrationDate(rdap), '2019-05-05T00:00:00Z');
  assert.equal(findRegistrationDate({}), null);
});

function rdapFor(daysAgo: number): typeof fetch {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return (async () =>
    jsonResponse({ events: [{ eventAction: 'registration', eventDate: date }] })) as unknown as typeof fetch;
}

test('domain age severity: under 30 days MEDIUM, under 90 LOW, else INFO', async () => {
  const collector = new RdapCollector();
  const cases: Array<[number, string]> = [
    [5, 'MEDIUM'],
    [60, 'LOW'],
    [400, 'INFO'],
  ];
  for (const [days, severity] of cases) {
    const [evidence] = await collector.collect(request, options(rdapFor(days)));
    assert.equal(evidence.type, 'DOMAIN_AGE');
    assert.equal(evidence.severity, severity, `${days} days`);
    assert.equal(evidence.hardFail, false);
  }
});

test('uses the IANA bootstrap to choose the authoritative registry endpoint', async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === RDAP_BOOTSTRAP_URL) {
      return jsonResponse({ services: [[['shop'], ['https://rdap.example.test/api/']]] });
    }
    return jsonResponse({ events: [] });
  }) as unknown as typeof fetch;

  const url = await rdapUrlFor('example.shop', { fetchImpl, timeoutMs: 1000, now: () => Date.now() });
  assert.equal(url, 'https://rdap.example.test/api/domain/example.shop');
  assert.ok(requests.includes(RDAP_BOOTSTRAP_URL));
});

test('requests rdap.org for the registrable domain', async () => {
  let requested = '';
  const fetchImpl = (async (url: string) => {
    requested = url;
    return jsonResponse({ events: [] });
  }) as unknown as typeof fetch;
  const [evidence] = await new RdapCollector().collect(request, options(fetchImpl));
  assert.equal(requested, 'https://rdap.org/domain/harborline-outfitters.example');
  assert.equal(evidence.type, 'DOMAIN_AGE_UNKNOWN');
});
