import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAuditEncryption, checkModes, daysUntil, describeTls } from './smoke-checks.mjs';

const modes = { paypal: 'simulated', store: 'memory', signals: 'auto', llm: 'none', memory: 'file' };

test('checkModes accepts the five reported modes and names what is missing', () => {
  assert.deepEqual(checkModes(modes), []);
  assert.match(checkModes(undefined)[0], /did not report modes/);
  assert.match(checkModes({ ...modes, llm: undefined })[0], /llm/);
  assert.match(checkModes({ paypal: 'sandbox' })[0], /store, signals, llm, memory/);
});

test('REQUIRE_AUDIT_ENCRYPTION fails with a clear message unless auditEncryption is enabled', () => {
  assert.equal(checkAuditEncryption({ ...modes, auditEncryption: 'enabled' }, true).problem, undefined);
  for (const status of ['disabled', 'invalid', undefined]) {
    const result = checkAuditEncryption({ ...modes, auditEncryption: status }, true);
    assert.match(result.problem, /REQUIRE_AUDIT_ENCRYPTION=true/);
    assert.match(result.problem, /AUDIT_ENCRYPTION_KEY/);
  }
  assert.match(checkAuditEncryption(modes, true).problem, /not reported/);
});

test('without the requirement, any auditEncryption value passes', () => {
  assert.equal(checkAuditEncryption({ ...modes, auditEncryption: 'disabled' }, false).problem, undefined);
});

test('daysUntil counts whole days and tolerates bad input', () => {
  const now = Date.parse('2026-11-04T00:00:00Z');
  assert.equal(daysUntil('2026-12-04T00:00:00Z', now), 30);
  assert.equal(daysUntil('2026-11-03T00:00:00Z', now), -1);
  assert.equal(daysUntil('nonsense', now), null);
});

test('describeTls reports the protocol and expiry without asserting a version', () => {
  const line = describeTls({ protocol: 'TLSv1.2', validTo: '2099-01-01T00:00:00Z', authorized: true });
  assert.match(line, /negotiated TLSv1\.2/);
  assert.match(line, /expires 2099-01-01/);
  assert.match(line, /trusted/);
  assert.match(describeTls({ protocol: 'TLSv1.3', validTo: '2099-01-01T00:00:00Z', authorized: false, authorizationError: 'self-signed certificate' }), /NOT trusted: self-signed/);
  assert.match(describeTls(undefined), /not checked/);
  assert.match(describeTls({ error: 'ECONNREFUSED' }), /could not be read/);
});
