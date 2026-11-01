import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyMerchantIdentity,
  type ExpectedMerchant,
} from '../src/services/verification/merchantVerification.service.js';
import type { PayPalOrderResponse } from '../src/services/paypal/paypalOrders.service.js';

test('verifyMerchantIdentity confirms MATCH when merchant ID matches', () => {
  const order: PayPalOrderResponse = {
    id: 'ORDER-101',
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '100.00' },
        payee: {
          merchant_id: 'MERCHANT_VERIFIED_123',
          email_address: 'finance@legitstore.com',
        },
      },
    ],
  };

  const expectedMerchant: ExpectedMerchant = {
    domain: 'legitstore.com',
    claimed_name: 'Legit Store Inc',
    merchant_id: 'MERCHANT_VERIFIED_123',
    payee_email: 'finance@legitstore.com',
    verification_status: 'VERIFIED_GENUINE',
  };

  const result = verifyMerchantIdentity(order, expectedMerchant);
  assert.equal(result.isMatch, true);
  assert.equal(result.matchStatus, 'MATCH');
  assert.equal(result.merchantConsistencyScore, 0.00);
  assert.equal(result.summary.isMatch, true);
});

test('verifyMerchantIdentity confirms MATCH when payee email matches case-insensitively', () => {
  const order: PayPalOrderResponse = {
    id: 'ORDER-102',
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '25.00' },
        payee: {
          email_address: 'PAYEE@StoreFront.com',
        },
      },
    ],
  };

  const expectedMerchant: ExpectedMerchant = {
    domain: 'storefront.com',
    claimed_name: 'StoreFront Co',
    payee_email: 'payee@storefront.com',
    verification_status: 'VERIFIED_GENUINE',
  };

  const result = verifyMerchantIdentity(order, expectedMerchant);
  assert.equal(result.isMatch, true);
  assert.equal(result.matchStatus, 'MATCH');
  assert.equal(result.merchantConsistencyScore, 0.00);
});

test('verifyMerchantIdentity detects MISMATCH when payee email differs from merchant record', () => {
  const order: PayPalOrderResponse = {
    id: 'ORDER-103',
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '350.00' },
        payee: {
          email_address: 'rogue_personal_account@gmail.com',
          merchant_id: 'UNKNOWN_ROGUE_ID',
        },
      },
    ],
  };

  const expectedMerchant: ExpectedMerchant = {
    domain: 'official-brand.com',
    claimed_name: 'Official Brand Store',
    payee_email: 'payments@official-brand.com',
    merchant_id: 'OFFICIAL_BRAND_PAYPAL_ID',
    verification_status: 'VERIFIED_GENUINE',
  };

  const result = verifyMerchantIdentity(order, expectedMerchant);
  assert.equal(result.isMatch, false);
  assert.equal(result.matchStatus, 'MISMATCH');
  assert.equal(result.merchantConsistencyScore, 100.00);
  assert.ok(result.evidence.reasons.length > 0);
  assert.ok(result.evidence.reasons.some((r) => r.includes('rogue_personal_account@gmail.com')));
});

test('verifyMerchantIdentity detects MISSING_PAYEE when PayPal order omits payee details', () => {
  const order: PayPalOrderResponse = {
    id: 'ORDER-104',
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '50.00' },
      },
    ],
  };

  const expectedMerchant: ExpectedMerchant = {
    domain: 'unknown-store.com',
    claimed_name: 'Unknown Store',
    payee_email: 'sales@unknown-store.com',
  };

  const result = verifyMerchantIdentity(order, expectedMerchant);
  assert.equal(result.isMatch, false);
  assert.equal(result.matchStatus, 'MISSING_PAYEE');
  assert.equal(result.merchantConsistencyScore, 85.00);
});

test('verifyMerchantIdentity flags CONFIRMED_FRAUD merchant immediately', () => {
  const order: PayPalOrderResponse = {
    id: 'ORDER-105',
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '10.00' },
        payee: {
          email_address: 'fraud@badsite.com',
        },
      },
    ],
  };

  const expectedMerchant: ExpectedMerchant = {
    domain: 'badsite.com',
    claimed_name: 'Bad Site',
    payee_email: 'fraud@badsite.com',
    verification_status: 'CONFIRMED_FRAUD',
  };

  const result = verifyMerchantIdentity(order, expectedMerchant);
  assert.equal(result.isMatch, false);
  assert.equal(result.matchStatus, 'MISMATCH');
  assert.equal(result.merchantConsistencyScore, 100.00);
});

