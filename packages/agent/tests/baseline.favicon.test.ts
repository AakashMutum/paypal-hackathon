import assert from 'node:assert/strict';
import test from 'node:test';

import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import type { AgentDeps, FaviconCheck, PageClaims } from '../src/ports.js';

const URL_UNDER_TEST = 'https://shop.example/';
const REF = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;

function claims(faviconCheck?: unknown, overrides: Partial<PageClaims> = {}): PageClaims {
  return {
    finalUrl: URL_UNDER_TEST,
    domain: 'shop.example',
    siteName: 'Harborline Outfitters',
    claimedBrand: 'Harborline Outfitters',
    contacts: { emails: ['help@shop.example'], phones: [] },
    linkedDomains: [],
    visibleText: 'A shop with a product.',
    hiddenText: '',
    sectionLinks: {},
    faviconUrl: 'https://shop.example/icon.png',
    faviconSameOrigin: true,
    hasContactPage: true,
    hasLegalPage: true,
    pageAccess: { state: 'ok', httpStatus: 200 },
    ...(faviconCheck ? { faviconCheck: faviconCheck as FaviconCheck } : {}),
    ...overrides,
  };
}

function depsFor(page: PageClaims): AgentDeps {
  return {
    signals: {
      async getPageClaims() {
        return page;
      },
      async getDomainReport() {
        return [];
      },
      async getPriceReport() {
        return [];
      },
      async checkPayeeBinding() {
        return [];
      },
      async fetchPageSection() {
        return { found: false };
      },
      async compareOffers() {
        return { offerCount: 0, sampleDomains: [] };
      },
    },
    registry: {
      async lookup() {
        return [];
      },
    },
    now: () => Date.now(),
    log: () => undefined,
  };
}

async function run(page: PageClaims) {
  return runInvestigatorAgentDetailed(
    { orderId: 'ORD-FAV', merchantUrl: URL_UNDER_TEST },
    depsFor(page),
    {
      timeoutMs: 8000,
      features: { investigatorLoop: false, identityLlm: false, memory: false },
    },
  );
}

const valid = (state: FaviconCheck['state'], extra: Partial<FaviconCheck> = {}): FaviconCheck => ({
  state,
  referenceDomain: 'harborline.example',
  referenceHash: REF,
  ...extra,
});

test('a differing hash against a valid reference on another domain is a medium FAVICON_MISMATCH', async () => {
  const result = await run(claims(valid('differs', { observedHash: OTHER })));
  const mismatch = result.evidence.find((e) => e.type === 'FAVICON_MISMATCH');
  assert.ok(mismatch);
  assert.equal(mismatch.severity, 'medium');
  assert.equal(mismatch.deterministic, true);
  assert.equal(mismatch.data?.referenceDomain, 'harborline.example');
  assert.equal(result.evidence.some((e) => e.type === 'FAVICON_OBSERVED'), false);
});

test('a favicon mismatch alone cannot reach PAUSE and sets no hard rule', async () => {
  const result = await run(claims(valid('differs', { observedHash: OTHER })));
  assert.notEqual(result.verdict.decision, 'PAUSE');
  assert.ok(result.verdict.score < 40, `score ${result.verdict.score}`);
  assert.deepEqual(result.hardRulesTriggered, []);
});

test('every other state stays FAVICON_OBSERVED and is never a mismatch', async () => {
  const states: Array<[FaviconCheck, string]> = [
    [{ state: 'no_reference' }, 'no_reference'],
    [valid('reference_domain'), 'reference_domain'],
    [valid('no_favicon'), 'no_favicon'],
    [valid('fetch_failed'), 'fetch_failed'],
    [valid('too_large'), 'too_large'],
    [valid('invalid'), 'invalid'],
    [valid('match', { observedHash: REF }), 'match'],
  ];
  for (const [check, integrity] of states) {
    const result = await run(claims(check));
    assert.equal(result.evidence.some((e) => e.type === 'FAVICON_MISMATCH'), false, integrity);
    const observed = result.evidence.find((e) => e.type === 'FAVICON_OBSERVED');
    assert.ok(observed, integrity);
    assert.equal(observed.severity, 'info');
    assert.equal(observed.data?.integrity, integrity);
  }
});

test('without any check the old behaviour holds: observed, not compared', async () => {
  const result = await run(claims(undefined));
  const observed = result.evidence.find((e) => e.type === 'FAVICON_OBSERVED');
  assert.equal(observed?.data?.integrity, 'not_compared');
  assert.equal(result.evidence.some((e) => e.type === 'FAVICON_MISMATCH'), false);
});

test('a claimed mismatch is refused when the page is on the reference domain', async () => {
  const result = await run(
    claims(valid('differs', { observedHash: OTHER }), { domain: 'www.harborline.example', finalUrl: 'https://www.harborline.example/' }),
  );
  assert.equal(result.evidence.some((e) => e.type === 'FAVICON_MISMATCH'), false);
});

test('a claimed mismatch is refused when the hashes are equal or malformed', async () => {
  for (const check of [
    valid('differs', { observedHash: REF }),
    valid('differs', { observedHash: 'not-a-hash' }),
    valid('differs'),
    { state: 'differs', observedHash: OTHER, referenceHash: REF },
    { state: 'made-up-state', observedHash: OTHER, referenceHash: REF, referenceDomain: 'harborline.example' },
  ]) {
    const result = await run(claims(check));
    assert.equal(result.evidence.some((e) => e.type === 'FAVICON_MISMATCH'), false, JSON.stringify(check));
  }
});

test('a registrar name never changes the score or the decision', async () => {
  const outcomes = new Set<string>();
  for (const registrar of [undefined, 'Example Registrar', 'Bulk Budget Domains', 'Unknown Registrar LLC']) {
    const page = claims(undefined);
    const base = depsFor(page);
    const deps: AgentDeps = {
      ...base,
      signals: {
        ...base.signals,
        async getDomainReport() {
          return [
            {
              id: 'EVD-AGE-01',
              type: 'DOMAIN_AGE',
              severity: 'low',
              confidence: 1,
              summary: 'The domain was registered 60 days ago.',
              source: 'rdap',
              deterministic: true,
              data: { ageDays: 60, ...(registrar ? { registrar } : {}) },
            },
          ];
        },
      },
    };
    const result = await runInvestigatorAgentDetailed({ orderId: 'ORD-REG', merchantUrl: URL_UNDER_TEST }, deps, {
      timeoutMs: 8000,
      features: { investigatorLoop: false, identityLlm: false, memory: false },
    });
    outcomes.add(`${result.verdict.score}/${result.verdict.decision}`);
  }
  assert.equal(outcomes.size, 1, [...outcomes].join(', '));
});
