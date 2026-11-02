import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRecord, HISTORICAL_RECORD_ALLOWED_KEYS } from '../src/index.js';

test('sanitizeRecord strips all PII fields (customer name, card, CVV, shipping address)', () => {
  const contaminatedInput = {
    // Legitimate fields
    investigationId: 'inv-12345',
    domain: 'luxury-store.example.com',
    claimedBrand: 'Chronos Elite',
    payeeMerchantId: 'M-998877',
    payeeEmail: 'billing@luxury-store.example.com',
    riskScore: 82.5,
    decision: 'PAUSE',
    flaggedEvidenceTypes: ['MERCHANT_MISMATCH', 'DISCOUNT_ANOMALY'],
    timestamp: '2026-11-02T10:00:00.000Z',

    // Contaminating PII fields that MUST be stripped
    customerName: 'John Doe',
    customer_name: 'Johnathan Doe',
    buyerName: 'Jane Doe',
    name: 'Secret User',
    cardNumber: '4111222233334444',
    card_number: '5500000000000004',
    pan: '4111222233334444',
    cc: '4111-2222-3333-4444',
    cvv: '123',
    cvc: '999',
    securityCode: '456',
    shippingAddress: '123 Fake Street, Springfield, IL',
    shipping_address: 'Apartment 4B, 100 Main St',
    billingAddress: '99 Wall St, New York, NY',
    ssn: '000-12-3456',
    phoneNumber: '+1-555-0199',
    unknownMeta: { internalTracker: true },
  };

  const sanitized = sanitizeRecord(contaminatedInput) as unknown as Record<string, unknown>;

  // Assert PII fields do not survive
  assert.equal(sanitized.customerName, undefined);
  assert.equal(sanitized.customer_name, undefined);
  assert.equal(sanitized.buyerName, undefined);
  assert.equal(sanitized.name, undefined);
  assert.equal(sanitized.cardNumber, undefined);
  assert.equal(sanitized.card_number, undefined);
  assert.equal(sanitized.pan, undefined);
  assert.equal(sanitized.cc, undefined);
  assert.equal(sanitized.cvv, undefined);
  assert.equal(sanitized.cvc, undefined);
  assert.equal(sanitized.securityCode, undefined);
  assert.equal(sanitized.shippingAddress, undefined);
  assert.equal(sanitized.shipping_address, undefined);
  assert.equal(sanitized.billingAddress, undefined);
  assert.equal(sanitized.ssn, undefined);
  assert.equal(sanitized.phoneNumber, undefined);
  assert.equal(sanitized.unknownMeta, undefined);

  // Assert exactly the 9 allowlisted keys are present
  const keys = Object.keys(sanitized).sort();
  const expectedKeys = [...HISTORICAL_RECORD_ALLOWED_KEYS].sort();
  assert.deepEqual(keys, expectedKeys);
});

test('sanitizeRecord normalizes domain and email to lowercase', () => {
  const input = {
    investigationId: 'inv-abc',
    domain: 'HTTPS://WWW.CHECKOUT-DEALS.COM/shop?id=1',
    claimedBrand: 'AuraTech',
    payeeMerchantId: 'MERCHANT-XYZ',
    payeeEmail: 'SUPPORT@Checkout-Deals.COM',
    riskScore: 25.0,
    decision: 'ALLOW',
    flaggedEvidenceTypes: [],
    timestamp: '2026-11-02T11:00:00Z',
  };

  const sanitized = sanitizeRecord(input);

  assert.equal(sanitized.domain, 'www.checkout-deals.com');
  assert.equal(sanitized.payeeEmail, 'support@checkout-deals.com');
  assert.equal(sanitized.riskScore, 25.0);
  assert.equal(sanitized.decision, 'ALLOW');
});

test('sanitizeRecord validates and formats timestamps into ISO 8601 strings', () => {
  const dateObj = new Date('2026-11-01T15:30:00.000Z');
  const inputWithDateObj = {
    investigationId: 'inv-date-test',
    domain: 'example.com',
    claimedBrand: 'Veloce Athletics',
    payeeMerchantId: 'M1',
    payeeEmail: 'pay@example.com',
    riskScore: 10.5,
    decision: 'ALLOW',
    timestamp: dateObj,
  };

  const sanitized = sanitizeRecord(inputWithDateObj);
  assert.equal(sanitized.timestamp, '2026-11-01T15:30:00.000Z');
});

test('sanitizeRecord rejects invalid decisions', () => {
  const invalidInput = {
    investigationId: 'inv-invalid',
    domain: 'example.com',
    claimedBrand: 'Brand',
    payeeMerchantId: 'M1',
    payeeEmail: 'pay@example.com',
    riskScore: 50,
    decision: 'APPROVE_AUTOMATICALLY', // not ALLOW, WARN, or PAUSE
    timestamp: '2026-11-02T12:00:00Z',
  };

  assert.throws(() => sanitizeRecord(invalidInput), /Invalid decision: "APPROVE_AUTOMATICALLY"/);
});

test('sanitizeRecord rejects invalid risk score and non-object inputs', () => {
  assert.throws(() => sanitizeRecord(null), /non-null object/);
  assert.throws(() => sanitizeRecord('invalid string'), /non-null object/);
  assert.throws(() => sanitizeRecord([]), /non-null object/);

  const invalidScoreInput = {
    investigationId: 'inv-score',
    domain: 'example.com',
    claimedBrand: 'Brand',
    payeeMerchantId: 'M1',
    payeeEmail: 'pay@example.com',
    riskScore: 'not-a-number',
    decision: 'ALLOW',
    timestamp: '2026-11-02T12:00:00Z',
  };

  assert.throws(() => sanitizeRecord(invalidScoreInput), /finite float number/);
});

test('sanitized record is frozen against modifications', () => {
  const input = {
    investigationId: 'inv-freeze',
    domain: 'example.com',
    claimedBrand: 'Brand',
    payeeMerchantId: 'M1',
    payeeEmail: 'pay@example.com',
    riskScore: 40.0,
    decision: 'WARN',
    flaggedEvidenceTypes: ['PRICING_ANOMALY'],
    timestamp: '2026-11-02T12:00:00Z',
  };

  const sanitized = sanitizeRecord(input);
  assert.ok(Object.isFrozen(sanitized));

  assert.throws(() => {
    // @ts-expect-error test mutation at runtime
    sanitized.customerName = 'Malicious Injection';
  }, TypeError);
});
