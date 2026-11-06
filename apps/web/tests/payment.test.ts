import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTone, friendlyPaymentError, fundsStatement, paymentButtonMode, type PaymentButtonInput } from '../src/lib/payment.js';

const base: PaymentButtonInput = { useMock: false, apiPaypal: 'sandbox', healthPending: false, healthFailed: false, clientId: 'client-id-for-test' };

test('sandbox API with a client id gets the real PayPal SDK button', () => {
  assert.equal(paymentButtonMode(base), 'sdk');
});

test('sandbox API without a client id gets a disabled state, never the simulated button', () => {
  assert.equal(paymentButtonMode({ ...base, clientId: undefined }), 'unconfigured');
  assert.equal(paymentButtonMode({ ...base, clientId: '   ' }), 'unconfigured');
});

test('a simulated API, or the built-in simulated backend, gets the simulated button', () => {
  assert.equal(paymentButtonMode({ ...base, apiPaypal: 'simulated' }), 'simulated');
  assert.equal(paymentButtonMode({ ...base, apiPaypal: 'simulated', clientId: undefined }), 'simulated');
  assert.equal(paymentButtonMode({ ...base, useMock: true, apiPaypal: undefined, healthPending: true }), 'simulated');
});

test('while the modes are unknown no payment button is offered', () => {
  assert.equal(paymentButtonMode({ ...base, apiPaypal: undefined, healthPending: true }), 'loading');
  assert.equal(paymentButtonMode({ ...base, apiPaypal: undefined, healthFailed: true }), 'unknown');
});

test('a PayPal 422 is explained in plain words and the raw text is kept for Details', () => {
  const raw = '422 {"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"ORDER_NOT_APPROVED"}]}';
  const e = friendlyPaymentError(raw);
  assert.match(e.title, /not approved/i);
  assert.equal(e.details, raw);
  assert.doesNotMatch(e.message, /UNPROCESSABLE_ENTITY/);
});

test('other errors map to a title, and unknown ones fall back safely', () => {
  assert.match(friendlyPaymentError('INSTRUMENT_DECLINED').title, /declined/i);
  assert.match(friendlyPaymentError('invalid_client').title, /credentials/i);
  assert.match(friendlyPaymentError('Failed to fetch').title, /Could not reach/i);
  assert.equal(friendlyPaymentError('something odd').title, 'The payment step did not complete');
  assert.equal(friendlyPaymentError(undefined).details, '');
});

test('every capture state says whether funds were captured', () => {
  assert.equal(fundsStatement('CAPTURED').captured, true);
  for (const state of ['PENDING', 'AUTHORIZED', 'HELD', 'VOIDED', 'FAILED'] as const) {
    const s = fundsStatement(state);
    assert.equal(s.captured, false, state);
    assert.match(s.text, /No funds/);
  }
});

test('Failed is shown in the danger tone and Captured is not mixed up with a merchant verdict', () => {
  assert.equal(captureTone('FAILED'), 'bad');
  assert.equal(captureTone('CAPTURED'), 'ok');
  assert.equal(captureTone('HELD'), 'warn');
});
