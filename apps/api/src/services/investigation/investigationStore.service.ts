import {
  type FrontendInvestigation,
} from '../agent/agentRunner.service.js';

let investigations: FrontendInvestigation[] = [];

function generateSeedInvestigations(): FrontendInvestigation[] {
  const seeds: FrontendInvestigation[] = [
    {
      id: 'INV-SEED0',
      domain: 'aether-device-sale.online',
      claimedBrand: 'Aether Store',
      productName: 'AetherPhone 16 Pro',
      price: 199,
      benchmark: 999,
      currency: 'USD',
      payeeName: 'personal-email@mail.ru',
      payeeId: 'PP-MCH-221904',
      payeeTier: 'Inactive Individual Tier',
      domainAgeDays: 9,
      registryRecords: 0,
      riskScore: 96,
      confidence: 99.8,
      status: 'COMPLETE',
      verdict: 'BLOCK',
      captureState: 'HELD',
      reasons: [
        'The merchant receiving your funds does not match the brand shown on the storefront.',
        'Advertised price is 80% below the market benchmark.',
        'PayPal receiver was created 9 days ago and is an unverified individual account.',
      ],
      evidence: [
        {
          id: 'e1',
          node: 'SURFACE',
          title: 'Surface Storefront Claims',
          status: 'FAIL',
          badge: 'INGESTED',
          confidence: 99,
          fields: [
            { label: 'Presented Domain', value: 'aether-device-sale.online' },
            { label: 'Claimed Brand', value: 'Aether Store' },
            { label: 'Theme Signature', value: 'Stolen Luxury Theme', flag: true },
          ],
        },
        {
          id: 'e2',
          node: 'MERCHANT',
          title: 'Merchant Verification',
          status: 'FAIL',
          badge: 'FAILED (0 MATCH)',
          confidence: 97,
          fields: [
            { label: 'Corporate Registry', value: '0 Legal Records', flag: true },
            { label: 'Domain Age', value: '9 Days (WHOIS Obfuscated)', flag: true },
            { label: 'Impersonation Vector', value: '96%', flag: true, meter: 96 },
          ],
        },
        {
          id: 'e3',
          node: 'PRICE',
          title: 'Price Anomaly Model',
          status: 'FAIL',
          badge: '-80% THRESHOLD',
          confidence: 96,
          fields: [
            { label: 'Cart Item', value: 'AetherPhone 16 Pro' },
            { label: 'Advertised Price', value: '$199.00 USD', flag: true },
            { label: 'Market Global Benchmark', value: '$999.00 USD', strike: true },
          ],
        },
        {
          id: 'e4',
          node: 'PAYEE',
          title: 'PayPal Real Recipient',
          status: 'FAIL',
          badge: 'DECODED',
          confidence: 99,
          fields: [
            { label: 'Actual Receiver', value: 'personal-email@mail.ru' },
            { label: 'PayPal Sandbox ID', value: 'PP-MCH-221904' },
            { label: 'Account Status', value: 'Inactive Individual Tier', flag: true },
          ],
        },
      ],
      createdAt: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: 'INV-SEED1',
      domain: 'nordic-living-studio.com',
      claimedBrand: 'Nordic Living',
      productName: 'Oak Side Table',
      price: 240,
      benchmark: 255,
      currency: 'USD',
      payeeName: 'Nordic Retail ApS',
      payeeId: 'PP-MCH-330117',
      payeeTier: 'Registered Merchant',
      domainAgeDays: 2900,
      registryRecords: 2,
      riskScore: 6,
      confidence: 98.9,
      status: 'COMPLETE',
      verdict: 'ALLOW',
      captureState: 'PENDING',
      reasons: ['Storefront claims match the registered PayPal recipient. Safe to capture.'],
      evidence: [
        {
          id: 'e1',
          node: 'SURFACE',
          title: 'Surface Storefront Claims',
          status: 'PASS',
          badge: 'INGESTED',
          confidence: 99,
          fields: [
            { label: 'Presented Domain', value: 'nordic-living-studio.com' },
            { label: 'Claimed Brand', value: 'Nordic Living' },
            { label: 'Theme Signature', value: 'Original Theme', flag: false },
          ],
        },
        {
          id: 'e2',
          node: 'MERCHANT',
          title: 'Merchant Verification',
          status: 'PASS',
          badge: 'MATCHED',
          confidence: 97,
          fields: [
            { label: 'Corporate Registry', value: '2 Legal Records', flag: false },
            { label: 'Domain Age', value: '2900 Days (WHOIS Public)', flag: false },
            { label: 'Impersonation Vector', value: '2%', flag: false, meter: 2 },
          ],
        },
        {
          id: 'e3',
          node: 'PRICE',
          title: 'Price Anomaly Model',
          status: 'PASS',
          badge: 'IN RANGE',
          confidence: 96,
          fields: [
            { label: 'Cart Item', value: 'Oak Side Table' },
            { label: 'Advertised Price', value: '$240.00 USD', flag: false },
            { label: 'Market Global Benchmark', value: '$255.00 USD', strike: false },
          ],
        },
        {
          id: 'e4',
          node: 'PAYEE',
          title: 'PayPal Real Recipient',
          status: 'PASS',
          badge: 'DECODED',
          confidence: 99,
          fields: [
            { label: 'Actual Receiver', value: 'Nordic Retail ApS' },
            { label: 'PayPal Sandbox ID', value: 'PP-MCH-330117' },
            { label: 'Account Status', value: 'Registered Merchant', flag: false },
          ],
        },
      ],
      createdAt: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      id: 'INV-SEED2',
      domain: 'solarbeats-audio.store',
      claimedBrand: 'SolarBeats Audio',
      productName: 'Studio Headphones',
      price: 89,
      benchmark: 349,
      currency: 'USD',
      payeeName: 'Unregistered LLC',
      payeeId: 'PP-MCH-552078',
      payeeTier: 'Unverified Business',
      domainAgeDays: 70,
      registryRecords: 0,
      riskScore: 68,
      confidence: 91.4,
      status: 'COMPLETE',
      verdict: 'WARN',
      captureState: 'HELD',
      reasons: [
        'Some storefront claims could not be verified against the PayPal recipient. Capture is on hold pending review.',
        'Advertised price is 75% below the market benchmark.',
        'No corporate registry record found for the receiving merchant.',
      ],
      evidence: [
        {
          id: 'e1',
          node: 'SURFACE',
          title: 'Surface Storefront Claims',
          status: 'PASS',
          badge: 'INGESTED',
          confidence: 99,
          fields: [
            { label: 'Presented Domain', value: 'solarbeats-audio.store' },
            { label: 'Claimed Brand', value: 'SolarBeats Audio' },
            { label: 'Theme Signature', value: 'Generic Discount Template', flag: true },
          ],
        },
        {
          id: 'e2',
          node: 'MERCHANT',
          title: 'Merchant Verification',
          status: 'WARN',
          badge: 'FAILED (0 MATCH)',
          confidence: 97,
          fields: [
            { label: 'Corporate Registry', value: '0 Legal Records', flag: true },
            { label: 'Domain Age', value: '70 Days (WHOIS Obfuscated)', flag: true },
            { label: 'Impersonation Vector', value: '68%', flag: true, meter: 68 },
          ],
        },
        {
          id: 'e3',
          node: 'PRICE',
          title: 'Price Anomaly Model',
          status: 'WARN',
          badge: '-75% THRESHOLD',
          confidence: 96,
          fields: [
            { label: 'Cart Item', value: 'Studio Headphones' },
            { label: 'Advertised Price', value: '$89.00 USD', flag: true },
            { label: 'Market Global Benchmark', value: '$349.00 USD', strike: true },
          ],
        },
        {
          id: 'e4',
          node: 'PAYEE',
          title: 'PayPal Real Recipient',
          status: 'WARN',
          badge: 'DECODED',
          confidence: 99,
          fields: [
            { label: 'Actual Receiver', value: 'Unregistered LLC' },
            { label: 'PayPal Sandbox ID', value: 'PP-MCH-552078' },
            { label: 'Account Status', value: 'Unverified Business', flag: true },
          ],
        },
      ],
      createdAt: new Date(Date.now() - 21600000).toISOString(),
    },
  ];

  return seeds;
}

investigations = generateSeedInvestigations();

export const investigationStore = {
  add(inv: FrontendInvestigation): void {
    const existingIndex = investigations.findIndex((i) => i.id === inv.id);
    if (existingIndex >= 0) {
      investigations[existingIndex] = inv;
    } else {
      investigations.unshift(inv);
    }
  },

  get(id: string): FrontendInvestigation | undefined {
    return investigations.find((i) => i.id === id || i.orderId === id);
  },

  list(): FrontendInvestigation[] {
    return [...investigations];
  },

  update(id: string, patch: Partial<FrontendInvestigation>): FrontendInvestigation | undefined {
    const inv = this.get(id);
    if (!inv) return undefined;
    Object.assign(inv, patch);
    return inv;
  },

  reset(): void {
    investigations = generateSeedInvestigations();
  },
};
