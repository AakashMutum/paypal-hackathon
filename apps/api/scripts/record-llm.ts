/**
 * Records language-model answers for the three canonical demo stores so LLM_MODE=replay can
 * reproduce them without a key. Needs LLM_API_KEY. Run from the repository root:
 *
 *   LLM_API_KEY=... npm run record:llm
 *
 * Recordings are written to packages/agent/fixtures/llm (or LLM_FIXTURE_DIR). Each file holds
 * only the prompt hash and the model's JSON answer. Check them before committing: they must
 * contain no key and no personal data.
 */
process.env.LLM_MODE = 'record';

if (!process.env.LLM_API_KEY?.trim()) {
  console.error('LLM_API_KEY is not set. Nothing was recorded.');
  process.exit(1);
}

const { loadStoreCatalog } = await import('../src/config/storeCatalog.js');
const { executeMerchantInvestigation } = await import('../src/services/agent/agentRunner.service.js');
const { llmRecordingsDir } = await import('../src/services/agent/agentPorts.js');

for (const store of loadStoreCatalog()) {
  // The two shapes the API uses: a scan (no order) and an order with a payee and an amount.
  await executeMerchantInvestigation({ url: store.domain });
  await executeMerchantInvestigation({
    orderId: `REC-${store.storeId}`,
    url: store.domain,
    amount: store.price,
    claimedBrand: store.brand,
    productName: store.product,
    payeeEmail: store.payeeEmail,
    payeeMerchantId: store.payeeMerchantId,
  });
  console.log(`recorded ${store.storeId}`);
}
console.log(`Recordings are in ${llmRecordingsDir()}`);
