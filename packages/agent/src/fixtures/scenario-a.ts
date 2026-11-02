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

/** Scenario A: a genuine seller. Everything lines up, so this must be a fast ALLOW. */
export const scenarioA: ScenarioFixture = {
  name: 'A',
  request: {
    orderId: 'ORD-A-001',
    merchantUrl: 'https://veloura-outdoor.example',
    transactionAmount: 119,
    currency: 'USD',
    claimedBrand: 'Veloura',
    payee: { merchantId: 'MERCH-A', email: 'payments@veloura-outdoor.example' },
    items: [{ name: 'Waterproof trail jacket', quantity: 1, unitPrice: 119 }],
  },
  claims: {
    finalUrl: 'https://veloura-outdoor.example',
    domain: 'veloura-outdoor.example',
    siteName: 'Veloura Outdoor',
    legalName: 'Veloura Outdoor Pvt Ltd',
    claimedBrand: 'Veloura',
    claimedLocation: { city: 'Bengaluru', country: 'IN' },
    contacts: {
      emails: ['payments@veloura-outdoor.example'],
      phones: ['+91 80 0000 0000'],
      address: 'Bengaluru, IN',
    },
    linkedDomains: [],
    visibleText:
      'Veloura Outdoor. Waterproof trail jacket with a breathable membrane and sealed seams. Free returns within 30 days.',
    hiddenText: '',
    sectionLinks: {},
    hasContactPage: true,
    hasLegalPage: true,
  },
  signalsEvidence: [
    {
      id: 'EVD-SIG-A-DOMAIN-01',
      type: 'DOMAIN_AGE',
      severity: 'info',
      confidence: 1,
      summary: 'The domain was registered four years ago.',
      source: 'rdap',
      deterministic: true,
      data: { ageDays: 1460, registrar: 'Example Registrar' },
    },
    {
      id: 'EVD-SIG-A-BINDING-01',
      type: 'PAYEE_BINDING',
      severity: 'info',
      confidence: 1,
      summary: 'The receiving account matches the registered merchant.',
      source: 'registry',
      deterministic: true,
      data: { status: 'MATCH', expectedMerchantId: 'MERCH-A', actualMerchantId: 'MERCH-A', linkedBrandIds: [] },
    },
    {
      id: 'EVD-SIG-A-PRICE-01',
      type: 'PRICE_DEVIATION',
      severity: 'info',
      confidence: 1,
      summary: 'The price is in line with comparable sellers.',
      source: 'channel3',
      deterministic: true,
      data: { discountPct: 1, price: 119, medianPrice: 120, offerCount: 9 },
    },
  ],
  registry: {
    byMerchantId: { 'MERCH-A': [veloura] },
    byName: { veloura: [veloura], 'veloura outdoor': [veloura] },
    byDomain: { 'veloura-outdoor.example': [veloura] },
  },
  expected: {
    decision: 'ALLOW',
    score: 0,
    path: 'FAST_ALLOW',
    hardRules: [],
    confidence: 0.99,
  },
};
