import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCertificate, type CertificateInfo } from '../src/certificate/tls.js';

const base: CertificateInfo = {
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  issuer: 'Example CA',
  daysToExpiry: 200,
  authorized: true,
};

test('evaluateCertificate grades certificate status', () => {
  assert.equal(evaluateCertificate(base, 'shop.example').severity, 'INFO');
  assert.equal(evaluateCertificate({ ...base, daysToExpiry: 5 }, 'shop.example').severity, 'LOW');
  assert.equal(evaluateCertificate({ ...base, authorized: false }, 'shop.example').severity, 'MEDIUM');
  assert.equal(evaluateCertificate({ ...base, daysToExpiry: -3 }, 'shop.example').severity, 'HIGH');
  for (const info of [base, { ...base, daysToExpiry: -3 }]) {
    const evidence = evaluateCertificate(info, 'shop.example');
    assert.equal(evidence.type, 'CERT_STATUS');
    assert.equal(evidence.hardFail, false);
  }
});
