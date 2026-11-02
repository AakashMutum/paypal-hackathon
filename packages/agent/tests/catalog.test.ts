import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CompareOffersInputSchema,
  FOLLOW_UP_TOOLS,
  FetchPageSectionInputSchema,
  GetDomainReportInputSchema,
  LookupRegistryInputSchema,
  describeFollowUpTools,
  findFollowUpTool,
} from '../src/tools/catalog.js';

test('the catalog exposes exactly the four allowed tools', () => {
  assert.deepEqual(
    FOLLOW_UP_TOOLS.map((tool) => tool.name),
    ['lookup_registry', 'fetch_page_section', 'compare_offers', 'get_domain_report']
  );
  assert.ok(FOLLOW_UP_TOOLS.every((tool) => tool.readOnly === true));
});

test('registry lookups accept the three lookup modes', () => {
  for (const by of ['name', 'domain', 'merchantId']) {
    assert.equal(LookupRegistryInputSchema.safeParse({ by, query: 'Veloura' }).success, true);
  }
  assert.equal(LookupRegistryInputSchema.safeParse({ by: 'email', query: 'x' }).success, false);
  assert.equal(LookupRegistryInputSchema.safeParse({ by: 'name', query: 'a' }).success, false);
  assert.equal(LookupRegistryInputSchema.safeParse({ by: 'name', query: 'x'.repeat(121) }).success, false);
});

test('registry lookups reject extra fields', () => {
  assert.equal(
    LookupRegistryInputSchema.safeParse({ by: 'name', query: 'Veloura', url: 'https://evil.example' }).success,
    false
  );
});

test('section reads only accept the six known hints', () => {
  for (const hint of ['about', 'contact', 'returns', 'terms', 'privacy', 'shipping']) {
    assert.equal(FetchPageSectionInputSchema.safeParse({ hint }).success, true);
  }
  assert.equal(FetchPageSectionInputSchema.safeParse({ hint: 'pricing' }).success, false);
  assert.equal(
    FetchPageSectionInputSchema.safeParse({ hint: 'about', url: 'https://evil.example' }).success,
    false
  );
});

test('offer comparison enforces its input limits', () => {
  assert.equal(
    CompareOffersInputSchema.safeParse({ productQuery: 'trail jacket', maxPrice: 130 }).success,
    true
  );
  assert.equal(CompareOffersInputSchema.safeParse({ productQuery: 'ab' }).success, false);
  assert.equal(CompareOffersInputSchema.safeParse({ productQuery: 'jacket', maxPrice: -1 }).success, false);
});

test('domain reports accept a domain and reject a full URL', () => {
  assert.equal(GetDomainReportInputSchema.safeParse({ domain: 'linked.example' }).success, true);
  assert.equal(GetDomainReportInputSchema.safeParse({ domain: 'https://linked.example' }).success, true);
  assert.equal(GetDomainReportInputSchema.safeParse({ domain: 'x' }).success, false);
});

test('compare_offers is capped at two uses per investigation', () => {
  assert.equal(findFollowUpTool('compare_offers')?.maxUsesPerInvestigation, 2);
  assert.equal(findFollowUpTool('lookup_registry')?.maxUsesPerInvestigation, 5);
  assert.equal(findFollowUpTool('unknown'), undefined);
});

test('the prompt description lists every tool with its input shape', () => {
  const text = describeFollowUpTools();
  for (const tool of FOLLOW_UP_TOOLS) {
    assert.ok(text.includes(tool.name));
    assert.ok(text.includes('input:'));
  }
  assert.equal(text.includes('pay'), false);
});
