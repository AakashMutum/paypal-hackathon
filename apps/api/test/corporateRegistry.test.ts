import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DATA_GOV_IN_PROVIDER,
  DATA_GOV_IN_SOURCE,
  corporateRegistryConfig,
  lookupCorporateRegistry,
} from '../src/services/registry/corporateRegistry.js';

const endpoint = 'https://api.data.gov.in/resource/test-resource';
const env = {
  CORPORATE_REGISTRY_URL: endpoint,
  CORPORATE_REGISTRY_API_KEY: 'unit-test-placeholder',
  CORPORATE_REGISTRY_TIMEOUT_MS: '1000',
};
interface Company {
  cin: string;
  company_name: string;
  company_status: string;
  date_of_registration: string;
  registered_address: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/data-gov-roc-company-master.mock.json', import.meta.url), 'utf8'),
) as { records: Company[] };
const company = fixture.records[0]!;
assert.ok(company);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lookup = (
  by: 'cin' | 'name',
  query: string,
  fetchImpl: typeof fetch,
  timeoutMs = 1000,
) => lookupCorporateRegistry({ by, query }, { env, fetchImpl, timeoutMs });

test('maps CIN results with source and lookup timestamps', async () => {
  let url: URL | undefined;
  const result = await lookup('cin', company.cin, (async (input: string | URL | Request) => {
    url = new URL(String(input));
    return jsonResponse({ records: [company] });
  }) as typeof fetch);

  assert.equal(result.status, 'MATCH');
  assert.equal(result.provider, DATA_GOV_IN_PROVIDER);
  assert.deepEqual(result.records[0], {
    merchantId: company.cin, cin: company.cin, legalName: company.company_name,
    brandNames: [company.company_name], status: 'verified', companyStatus: 'Active',
    registrationDate: company.date_of_registration, registeredAddress: company.registered_address,
    source: DATA_GOV_IN_SOURCE, fetchedAt: result.records[0].fetchedAt,
  });
  assert.match(result.records[0].fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.lookedUpAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(url?.searchParams.get('filters[cin]'), company.cin);
  assert.equal(url?.searchParams.get('format'), 'json');
  assert.equal(url?.searchParams.has('api-key'), true);
});

test('matches company name and returns UNKNOWN when there is no exact match', async () => {
  let nameFilter: string | null = null;
  const match = await lookup('name', company.company_name, (async (input: string | URL | Request) => {
    nameFilter = new URL(String(input)).searchParams.get('filters[company_name]');
    return jsonResponse({ records: [company] });
  }) as typeof fetch);
  assert.equal(nameFilter, company.company_name);
  assert.equal(match.status, 'MATCH');

  const none = await lookup('name', 'No Such Company', (async () =>
    jsonResponse({ records: [company] })) as typeof fetch);
  assert.equal(none.status, 'UNKNOWN');
  assert.deepEqual(none.records, []);
});

test('returns UNKNOWN for malformed response and invalid JSON', async () => {
  const malformed = await lookup('cin', company.cin, (async () =>
    jsonResponse({ records: [{ company_name: 'Missing CIN' }] })) as typeof fetch);
  assert.equal(malformed.status, 'UNKNOWN');
  assert.deepEqual(malformed.records, []);
  assert.match(malformed.error ?? '', /company name and CIN/);

  const invalid = await lookup('cin', company.cin, (async () =>
    new Response('not json')) as typeof fetch);
  assert.equal(invalid.status, 'UNKNOWN');
  assert.match(invalid.error ?? '', /invalid JSON/);
});

test('returns UNKNOWN for HTTP errors and timeouts without leaking request details', async () => {
  const unavailable = await lookup('cin', company.cin, (async () =>
    new Response('unavailable', { status: 503 })) as typeof fetch);
  assert.equal(unavailable.status, 'UNKNOWN');
  assert.deepEqual(unavailable.records, []);
  assert.equal(unavailable.error, 'data.gov.in returned HTTP 503');

  const timeout = await lookup('cin', company.cin, (async (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')), { once: true });
    })) as typeof fetch, 10);
  assert.equal(timeout.status, 'UNKNOWN');
  assert.deepEqual(timeout.records, []);
  assert.match(timeout.error ?? '', /timed out or was cancelled/);
  assert.equal(timeout.error?.includes(env.CORPORATE_REGISTRY_API_KEY), false);
});

test('requires a data.gov.in HTTPS URL and server-side API key', () => {
  assert.equal(corporateRegistryConfig({ CORPORATE_REGISTRY_URL: endpoint }), null);
  assert.equal(corporateRegistryConfig({
    CORPORATE_REGISTRY_URL: 'https://other.example/resource',
    CORPORATE_REGISTRY_API_KEY: 'placeholder',
  }), null);
  assert.equal(corporateRegistryConfig(env)?.timeoutMs, 1000);
});
