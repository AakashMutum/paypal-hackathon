import assert from 'node:assert/strict';
import test from 'node:test';
import { BINDING_PATH, PayeeBindingCollector } from '../src/payee/binding.js';
import { jsonResponse, options, request } from './helpers.js';

const collector = new PayeeBindingCollector();

test('binding match gives PAYEE_BINDING_OK', async () => {
  let requested = '';
  const fetchImpl = (async (url: string) => {
    requested = url;
    return jsonResponse({ merchant_id: 'MERCH-HARBORLINE' });
  }) as unknown as typeof fetch;
  const evidence = await collector.collect(request, options(fetchImpl));
  const ok = evidence.find((e) => e.type === 'PAYEE_BINDING_OK');
  assert.ok(ok);
  assert.equal(ok.severity, 'INFO');
  assert.equal(ok.hardFail, false);
  assert.equal(requested, `https://www.harborline-outfitters.example${BINDING_PATH}`);
});

test('binding mismatch is CRITICAL and a hard fail', async () => {
  const fetchImpl = (async () => jsonResponse({ merchant_id: 'MERCH-OTHER' })) as unknown as typeof fetch;
  const evidence = await collector.collect(request, options(fetchImpl));
  const mismatch = evidence.find((e) => e.type === 'PAYEE_BINDING_MISMATCH');
  assert.ok(mismatch);
  assert.equal(mismatch.severity, 'CRITICAL');
  assert.equal(mismatch.hardFail, true);
});

test('missing binding file is MEDIUM and not a hard fail', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
  const evidence = await collector.collect(request, options(fetchImpl));
  const missing = evidence.find((e) => e.type === 'PAYEE_BINDING_MISSING');
  assert.ok(missing);
  assert.equal(missing.severity, 'MEDIUM');
  assert.equal(missing.hardFail, false);
});

test('a network error or invalid body counts as missing', async () => {
  const failing = (async () => {
    throw new Error('boom');
  }) as unknown as typeof fetch;
  const invalid = (async () => new Response('<html>not json</html>')) as unknown as typeof fetch;
  for (const fetchImpl of [failing, invalid]) {
    const evidence = await collector.collect(request, options(fetchImpl));
    assert.ok(evidence.some((e) => e.type === 'PAYEE_BINDING_MISSING'));
  }
});

test('payee email on another domain is only a LOW signal', async () => {
  const fetchImpl = (async () => jsonResponse({ merchant_id: 'MERCH-HARBORLINE' })) as unknown as typeof fetch;
  const evidence = await collector.collect(
    { ...request, payee: { merchantId: 'MERCH-HARBORLINE', email: 'owner@webmail.example' } },
    options(fetchImpl),
  );
  const email = evidence.find((e) => e.type === 'PAYEE_EMAIL_DOMAIN_DIFFERS');
  assert.ok(email);
  assert.equal(email.severity, 'LOW');
  assert.equal(email.hardFail, false);
  assert.equal(evidence.some((e) => e.hardFail), false);
});

test('private merchant hosts are never fetched', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  await assert.rejects(() =>
    collector.collect({ ...request, merchantUrl: 'http://192.168.0.10/' }, options(fetchImpl)),
  );
  assert.equal(called, false);
});
