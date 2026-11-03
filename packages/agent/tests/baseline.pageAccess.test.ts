// @brand-check-allow functional real-merchant hostname tests, not demo content.
import assert from 'node:assert/strict';
import test from 'node:test';

import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import type { AgentDeps, PageClaims } from '../src/ports.js';
import { AgentResultSchema, type Evidence } from '../src/types.js';

const PRODUCT_URL = 'https://www.amazon.in/dp/B08N5WRWNW';

const marketplace = {
  id: 'amazon',
  displayName: 'Amazon',
  officialDomain: 'amazon.in',
  region: 'IN',
};

function claims(overrides: Partial<PageClaims>): PageClaims {
  return {
    finalUrl: PRODUCT_URL,
    domain: 'www.amazon.in',
    siteName: 'Amazon.in',
    claimedBrand: 'Amazon.in',
    contacts: { emails: [], phones: [] },
    linkedDomains: [],
    visibleText: '',
    hiddenText: '',
    sectionLinks: {},
    hasContactPage: false,
    hasLegalPage: false,
    marketplace,
    ...overrides,
  };
}

const domainAge: Evidence = {
  id: 'EVD-AGE-01',
  type: 'DOMAIN_AGE',
  severity: 'info',
  confidence: 1,
  summary: 'The domain was registered 4000 days ago.',
  source: 'rdap',
  deterministic: true,
  data: { ageDays: 4000 },
};

const priceUnknown: Evidence = {
  id: 'EVD-PRICE-01',
  type: 'PRICE_UNKNOWN',
  severity: 'info',
  confidence: 1,
  summary: 'No price comparison was available.',
  source: 'channel3',
  deterministic: true,
  data: { reason: 'no_price' },
};

function depsFor(page: PageClaims, price: Evidence[] = [priceUnknown]): AgentDeps {
  return {
    signals: {
      async getPageClaims() {
        return page;
      },
      async getDomainReport() {
        return [domainAge];
      },
      async getPriceReport() {
        return price;
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

const overrides = {
  timeoutMs: 8000,
  features: { investigatorLoop: false, identityLlm: false, memory: false },
};

const types = (evidence: Evidence[]): Set<string> => new Set(evidence.map((entry) => entry.type));

test('a blocked marketplace page yields explicit page evidence, not a fraud finding', async () => {
  const result = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-1', merchantUrl: PRODUCT_URL, claimedBrand: 'Amazon' },
    depsFor(
      claims({
        pageAccess: { state: 'blocked', httpStatus: 200, reason: 'bot_check' },
        visibleText: 'Click the button below to continue shopping',
      }),
    ),
    overrides,
  );

  assert.equal(AgentResultSchema.safeParse(result).success, true);
  const found = types(result.evidence);
  assert.ok(found.has('PAGE_BLOCKED'));
  assert.ok(found.has('MERCHANT_RECOGNIZED'));
  assert.equal(found.has('PRODUCT_DATA_UNAVAILABLE'), false);
  assert.equal(found.has('CONTACT_LEGAL_MISSING'), false);
  assert.equal(found.has('FAVICON_OBSERVED'), false);

  const blocked = result.evidence.find((entry) => entry.type === 'PAGE_BLOCKED');
  assert.equal(blocked?.severity, 'low');
  assert.equal(blocked?.deterministic, true);
  assert.match(blocked?.summary ?? '', /bot-check/);

  const recognised = result.evidence.find((entry) => entry.type === 'MERCHANT_RECOGNIZED');
  assert.equal(recognised?.data?.officialDomain, 'amazon.in');
  assert.equal(recognised?.data?.region, 'IN');

  assert.notEqual(result.verdict.decision, 'PAUSE');
  assert.equal(result.verdict.score, 0);
  assert.deepEqual(result.hardRulesTriggered, []);
});

test('structured product metadata is surfaced without changing the score', async () => {
  const result = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-2', merchantUrl: PRODUCT_URL, claimedBrand: 'Amazon' },
    depsFor(
      claims({
        pageAccess: { state: 'ok', httpStatus: 200 },
        product: {
          name: 'Echo Dot (4th Gen)',
          price: 4499,
          currency: 'INR',
          brand: 'Amazon',
          availability: 'InStock',
          source: 'json-ld',
        },
        hasContactPage: true,
        hasLegalPage: true,
        visibleText: 'Echo Dot (4th Gen)',
      }),
    ),
    overrides,
  );

  assert.equal(AgentResultSchema.safeParse(result).success, true);
  const found = types(result.evidence);
  assert.ok(found.has('PRODUCT_METADATA'));
  assert.equal(found.has('PAGE_BLOCKED'), false);
  assert.equal(found.has('PRODUCT_DATA_UNAVAILABLE'), false);

  const product = result.evidence.find((entry) => entry.type === 'PRODUCT_METADATA');
  assert.equal(product?.data?.name, 'Echo Dot (4th Gen)');
  assert.equal(product?.data?.price, 4499);
  assert.equal(product?.data?.currency, 'INR');
  assert.match(product?.summary ?? '', /Echo Dot/);
  assert.match(product?.summary ?? '', /INR 4499/);

  assert.equal(result.verdict.score, 0);
  assert.notEqual(result.verdict.decision, 'PAUSE');
});

test('a readable page without contact or legal disclosure is a low technical signal, not a pause', async () => {
  const result = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-CONTACT', merchantUrl: PRODUCT_URL },
    depsFor(
      claims({
        pageAccess: { state: 'ok', httpStatus: 200 },
        visibleText: 'A shop with a product.',
      }),
    ),
    overrides,
  );

  const missing = result.evidence.find((entry) => entry.type === 'CONTACT_LEGAL_MISSING');
  assert.ok(missing);
  assert.equal(missing?.severity, 'low');
  assert.equal(missing?.deterministic, true);
  assert.equal(result.verdict.score, 5);
  assert.notEqual(result.verdict.decision, 'PAUSE');
});

test('favicon observation is non-scoring and never invents a mismatch', async () => {
  const result = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-FAVICON', merchantUrl: PRODUCT_URL },
    depsFor(
      claims({
        pageAccess: { state: 'ok', httpStatus: 200 },
        hasContactPage: true,
        hasLegalPage: true,
        faviconUrl: 'https://cdn.example.net/icon.png',
        faviconSameOrigin: false,
        visibleText: 'A shop with a product.',
      }),
    ),
    overrides,
  );

  const favicon = result.evidence.find((entry) => entry.type === 'FAVICON_OBSERVED');
  assert.ok(favicon);
  assert.equal(favicon?.severity, 'info');
  assert.equal(favicon?.data?.sameOrigin, false);
  assert.equal(result.evidence.some((entry) => entry.type === 'FAVICON_MISMATCH'), false);
  assert.equal(result.verdict.score, 0);
});

test('an empty page and a replay-mode gap are explained explicitly', async () => {
  const empty = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-3', merchantUrl: PRODUCT_URL },
    depsFor(claims({ pageAccess: { state: 'empty', reason: 'empty_content' } })),
    overrides,
  );
  assert.ok(types(empty.evidence).has('PAGE_EMPTY'));
  assert.match(empty.evidence.find((entry) => entry.type === 'PAGE_EMPTY')?.summary ?? '', /no readable content/);

  const replay = await runInvestigatorAgentDetailed(
    { orderId: 'ORD-AMZ-4', merchantUrl: PRODUCT_URL },
    depsFor(claims({ pageAccess: { state: 'unsupported', reason: 'replay_mode' } }), []),
    overrides,
  );
  const unavailable = replay.evidence.find((entry) => entry.type === 'PAGE_UNAVAILABLE');
  assert.ok(unavailable);
  assert.match(unavailable?.summary ?? '', /replaying recorded signals/);
  assert.ok(types(replay.evidence).has('MERCHANT_RECOGNIZED'));
  assert.notEqual(replay.verdict.decision, 'PAUSE');
});
