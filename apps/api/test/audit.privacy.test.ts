import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditEncryptionStatus,
  hashPayeeEmail,
  isSealedAuditPayload,
  maskEmail,
  openAuditPayload,
  redactAuditDetail,
  redactInvestigationForStorage,
  sealAuditPayload,
} from '../src/services/persistence/auditPrivacy.js';
import { MemoryBackend } from '../src/services/persistence/recordStore.js';
import type { FrontendInvestigation } from '../src/services/investigation/investigation.types.js';

const BUYER_EMAIL = 'buyer.person@mail.example';
const PAYEE_EMAIL = 'payments@merchant.example';

function investigation(overrides: Partial<FrontendInvestigation> = {}): FrontendInvestigation {
  return {
    id: 'INV-PRIVACY-1',
    orderId: 'ORD-PRIVACY-1',
    domain: 'merchant.example',
    claimedBrand: 'Example Merchant',
    productName: 'Example product',
    price: 49.5,
    benchmark: 50,
    currency: 'USD',
    payeeName: 'Example Merchant LLC',
    payeeId: 'MERCHANT-1',
    payeeTier: 'verified',
    domainAgeDays: 400,
    registryRecords: 1,
    riskScore: 0,
    confidence: 80,
    status: 'COMPLETE',
    verdict: 'ALLOW',
    captureState: 'PENDING',
    reasons: ['The domain was registered 400 days ago.'],
    evidence: [
      {
        id: 'EVD-AGE-1',
        node: 'SURFACE',
        title: 'Surface Storefront Claims',
        status: 'PASS',
        badge: 'CHECKED',
        confidence: 90,
        fields: [{ label: 'Domain age', value: '400 days' }],
        sources: ['rdap'],
      },
    ],
    buyerEmail: BUYER_EMAIL,
    expectedPayeeEmailHash: hashPayeeEmail(PAYEE_EMAIL),
    createdAt: '2026-11-03T12:00:00.000Z',
    ...overrides,
  };
}

function withKey<T>(key: string, fn: () => T): T {
  const previous = process.env.AUDIT_ENCRYPTION_KEY;
  process.env.AUDIT_ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AUDIT_ENCRYPTION_KEY;
    else process.env.AUDIT_ENCRYPTION_KEY = previous;
  }
}

test('buyer email is masked and never appears in the stored investigation JSON', async () => {
  const backend = new MemoryBackend();
  const inv = investigation();
  const data = redactInvestigationForStorage(inv) as unknown as Record<string, unknown>;

  await backend.upsert({
    id: inv.id,
    kind: 'order',
    captureState: inv.captureState,
    amount: inv.price ?? undefined,
    currency: inv.currency,
    simulated: true,
    data,
    createdAt: inv.createdAt,
  });

  const stored = await backend.get('order', inv.id);
  assert.ok(stored);
  const serialized = JSON.stringify(stored.data);
  assert.doesNotMatch(serialized, /buyer\.person@mail\.example/);
  assert.equal((stored.data as { buyerEmail?: string }).buyerEmail, 'b***@mail.example');
  assert.equal((stored.data as { payeeName?: string }).payeeName, 'Example Merchant LLC');
  assert.equal((stored.data as { verdict?: string }).verdict, 'ALLOW');
  assert.equal((stored.data as { expectedPayeeEmailHash?: string }).expectedPayeeEmailHash, hashPayeeEmail(PAYEE_EMAIL));
});

test('sensitive payment-event fields are redacted before they reach a backend', async () => {
  const backend = new MemoryBackend();
  await backend.addEvent({
    investigationId: 'INV-PRIVACY-1',
    toState: 'AUTHORIZED',
    detail: {
      reason: 'Buyer buyer.person@mail.example approved.',
      buyerEmail: BUYER_EMAIL,
      phone: '+1 555 0100',
      cardNumber: '4111111111111111',
      authorizationId: 'AUTH-123',
    },
    simulated: true,
  });

  const [event] = await backend.events('INV-PRIVACY-1');
  assert.ok(event);
  const serialized = JSON.stringify(event.detail);
  assert.doesNotMatch(serialized, /buyer\.person@mail\.example/);
  assert.doesNotMatch(serialized, /4111111111111111/);
  assert.doesNotMatch(serialized, /555 0100/);
  assert.match(serialized, /b\*\*\*@mail\.example/);
  assert.equal(event.detail?.authorizationId, 'AUTH-123');
});

test('AES-256-GCM seals audit JSON when a key is configured', () => {
  const key = 'a'.repeat(64);
  withKey(key, () => {
    assert.equal(auditEncryptionStatus(), 'enabled');
    const payload = { buyerEmail: BUYER_EMAIL, verdict: 'ALLOW', amount: 49.5 };
    const sealed = sealAuditPayload(payload);
    assert.equal(isSealedAuditPayload(sealed), true);
    const serialized = JSON.stringify(sealed);
    assert.doesNotMatch(serialized, /buyer\.person@mail\.example/);
    assert.doesNotMatch(serialized, /ALLOW/);
    assert.deepEqual(openAuditPayload(sealed), payload);
  });
});

test('encrypted rows require the key and plaintext rows remain readable', () => {
  const key = 'b'.repeat(64);
  const sealed = withKey(key, () => sealAuditPayload({ verdict: 'WARN' }));

  const previous = process.env.AUDIT_ENCRYPTION_KEY;
  delete process.env.AUDIT_ENCRYPTION_KEY;
  try {
    assert.equal(auditEncryptionStatus(), 'disabled');
    assert.throws(() => openAuditPayload(sealed), /AUDIT_ENCRYPTION_KEY/);
    assert.deepEqual(openAuditPayload({ verdict: 'ALLOW' }), { verdict: 'ALLOW' });
  } finally {
    if (previous === undefined) delete process.env.AUDIT_ENCRYPTION_KEY;
    else process.env.AUDIT_ENCRYPTION_KEY = previous;
  }
});

test('invalid or missing keys do not enable encryption or leak data', () => {
  const previous = process.env.AUDIT_ENCRYPTION_KEY;
  process.env.AUDIT_ENCRYPTION_KEY = 'too-short';
  try {
    assert.equal(auditEncryptionStatus(), 'invalid');
    assert.deepEqual(sealAuditPayload({ verdict: 'ALLOW' }), { verdict: 'ALLOW' });
  } finally {
    if (previous === undefined) delete process.env.AUDIT_ENCRYPTION_KEY;
    else process.env.AUDIT_ENCRYPTION_KEY = previous;
  }
});

test('payee email fingerprints are stable, non-reversible and do not contain the address', () => {
  const first = hashPayeeEmail('Payments@Merchant.Example');
  const second = hashPayeeEmail('payments@merchant.example');
  assert.equal(first, second);
  assert.doesNotMatch(first, /payments|merchant\.example/i);
  assert.match(first, /^(sha256|hmac-sha256):[0-9a-f]{64}$/);
  assert.equal(maskEmail(BUYER_EMAIL), 'b***@mail.example');
  assert.deepEqual(redactAuditDetail({ buyerEmail: BUYER_EMAIL, note: 'paid' }), {
    buyerEmail: 'b***@mail.example',
    note: 'paid',
  });
});
