import type { ScenarioFixture } from './types.js';
import type { RegistryRecord } from '../ports.js';

const veloura: RegistryRecord = {
  merchantId: 'MERCH-A',
  legalName: 'Veloura Outdoor Pvt Ltd',
  brandNames: ['Veloura', 'Veloura Outdoor'],
  domain: 'veloura-outdoor.example',
  city: 'Bengaluru',
  country: 'IN',
  status: 'verified',
  linkedBrandIds: [],
};

const d2: RegistryRecord = {
  merchantId: 'MERCH-D2',
  legalName: 'Veloura Outdoor Store Pvt Ltd',
  brandNames: ['Veloura Outdoor Store'],
  domain: 'veloura-outdoor-store.example',
  city: 'Delhi',
  country: 'IN',
  status: 'verified',
  linkedBrandIds: [],
};

/**
 * Scenario D2: the name matches, the payee matches its own domain, but it is not
 * the brand owner. HF2 still catches it.
 */
export const scenarioD2: ScenarioFixture = {
  name: 'D2',
  request: {
    orderId: 'ORD-D2-001',
    merchantUrl: 'https://veloura-outdoor-store.example',
    transactionAmount: 95,
    currency: 'USD',
    claimedBrand: 'Veloura',
    payee: { merchantId: 'MERCH-D2', email: 'pay@veloura-outdoor-store.example' },
    items: [{ name: 'Waterproof trail jacket', quantity: 1, unitPrice: 95 }],
  },
  claims: {
    finalUrl: 'https://veloura-outdoor-store.example',
    domain: 'veloura-outdoor-store.example',
    siteName: 'Veloura Outdoor Store',
    legalName: 'Veloura Outdoor Store Pvt Ltd',
    claimedBrand: 'Veloura',
    claimedLocation: { city: 'Delhi', country: 'IN' },
    contacts: { emails: ['pay@veloura-outdoor-store.example'], phones: [] },
    linkedDomains: [],
    visibleText: 'Veloura Outdoor Store. Waterproof trail jacket. Ships in two days.',
    hiddenText: '',
    sectionLinks: {},
    hasContactPage: true,
    hasLegalPage: true,
  },
  signalsEvidence: [
    {
      id: 'EVD-SIG-D2-DOMAIN-01',
      type: 'DOMAIN_AGE',
      severity: 'high',
      confidence: 1,
      summary: 'The domain was registered three days ago.',
      source: 'rdap',
      deterministic: true,
      data: { ageDays: 3 },
    },
    {
      id: 'EVD-SIG-D2-LOOKALIKE-01',
      type: 'LOOKALIKE_DOMAIN',
      severity: 'high',
      confidence: 1,
      summary: 'The address closely resembles the Veloura brand address.',
      source: 'kernel',
      deterministic: true,
      data: { matchesKnownBrand: true, brandId: 'BRAND-VELOURA', brandName: 'Veloura', distance: 3 },
    },
    {
      id: 'EVD-SIG-D2-BINDING-01',
      type: 'PAYEE_BINDING',
      severity: 'info',
      confidence: 1,
      summary: 'The receiving account matches the registered merchant record.',
      source: 'registry',
      deterministic: true,
      data: {
        status: 'MATCH',
        expectedMerchantId: 'MERCH-D2',
        actualMerchantId: 'MERCH-D2',
        linkedBrandIds: [],
      },
    },
    {
      id: 'EVD-SIG-D2-PRICE-01',
      type: 'PRICE_DEVIATION',
      severity: 'low',
      confidence: 1,
      summary: 'The price is somewhat below comparable sellers.',
      source: 'channel3',
      deterministic: true,
      data: { discountPct: 45, price: 95, medianPrice: 172, offerCount: 9 },
    },
  ],
  registry: {
    byMerchantId: { 'MERCH-D2': [d2] },
    byName: { veloura: [veloura] },
    byDomain: { 'veloura-outdoor-store.example': [d2] },
  },
  expected: {
    decision: 'PAUSE',
    score: 75,
    path: 'FAST_PAUSE',
    hardRules: ['HF2'],
    confidence: 0.95,
  },
};
