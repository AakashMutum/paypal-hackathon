import type { ScenarioFixture } from './types.js';

/** Scenario B: a suspicious but not proven seller. Ambiguous, so the investigator runs. */
export const scenarioB: ScenarioFixture = {
  name: 'B',
  request: {
    orderId: 'ORD-B-001',
    merchantUrl: 'https://trailpeak-deals.example',
    transactionAmount: 18,
    currency: 'USD',
    payee: { merchantId: 'MERCH-B', email: 'trailpeak.sales@mailbox.example' },
    items: [{ name: 'Waterproof trail jacket', quantity: 1, unitPrice: 18 }],
  },
  claims: {
    finalUrl: 'https://trailpeak-deals.example',
    domain: 'trailpeak-deals.example',
    siteName: 'TrailPeak Deals',
    contacts: {
      emails: ['trailpeak.sales@mailbox.example'],
      phones: [],
    },
    linkedDomains: [],
    visibleText:
      'TrailPeak Deals. Waterproof trail jacket. Limited time offer. Ships worldwide from our warehouse.',
    hiddenText: '',
    sectionLinks: { about: 'https://trailpeak-deals.example/about' },
    hasContactPage: true,
    hasLegalPage: true,
  },
  signalsEvidence: [
    {
      id: 'EVD-SIG-B-DOMAIN-01',
      type: 'DOMAIN_AGE',
      severity: 'medium',
      confidence: 1,
      summary: 'The domain was registered twelve days ago.',
      source: 'rdap',
      deterministic: true,
      data: { ageDays: 12 },
    },
    {
      id: 'EVD-SIG-B-BINDING-01',
      type: 'PAYEE_BINDING',
      severity: 'medium',
      confidence: 1,
      summary: 'The seller could not be found in the registry.',
      source: 'registry',
      deterministic: true,
      data: { status: 'UNKNOWN_MERCHANT', actualMerchantId: 'MERCH-B' },
    },
    {
      id: 'EVD-SIG-B-PRICE-01',
      type: 'PRICE_DEVIATION',
      severity: 'medium',
      confidence: 0.9,
      summary: 'The price is well below comparable sellers.',
      source: 'channel3',
      deterministic: true,
      data: { discountPct: 85, price: 18, medianPrice: 120, offerCount: 9 },
    },
  ],
  registry: {
    byMerchantId: {},
    byName: {},
    byDomain: {},
  },
  sections: {
    about: {
      found: true,
      url: 'https://trailpeak-deals.example/about',
      text: 'TrailPeak Deals is a small independent outdoor gear shop.',
    },
  },
  expected: {
    decision: 'WARN',
    score: 61,
    path: 'AMBIGUOUS',
    hardRules: [],
    confidence: 0.95,
  },
};
