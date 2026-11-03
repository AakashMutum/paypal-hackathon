import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signalsMode,
  llmMode,
  getLlmClient,
  getSignalsPort,
  getPatternStore,
  memoryMode,
  resetAgentPorts,
  setCustomLlmFetch,
  setCustomSignalsClients,
  setCustomMemoryFetch,
} from '../src/services/agent/agentPorts.js';
import { ElasticPatternStore, InMemoryPatternStore } from '@checkout-guardian/memory';

const originalEnv = { ...process.env };

describe('Live Integration Suite (LLM, Signals, Elastic)', () => {
  beforeEach(() => {
    resetAgentPorts();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetAgentPorts();
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------------------------
  // PHASE 1: Real LLM Integration
  // -------------------------------------------------------------------------------------------
  describe('LLM Mode & Live Provider', () => {
    test('llmMode recognizes mock as replay and live when key is present', () => {
      assert.equal(llmMode({ LLM_MODE: 'mock' }), 'replay');
      assert.equal(llmMode({ LLM_MODE: 'replay' }), 'replay');
      assert.equal(llmMode({ LLM_MODE: 'none' }), 'none');
      assert.equal(llmMode({ LLM_MODE: 'live', LLM_API_KEY: 'test-key' }), 'live');
      assert.equal(llmMode({ LLM_MODE: 'live', LLM_API_KEY: '' }), 'none');
    });

    test('successful live LLM response with controlled HTTP double', async () => {
      process.env.LLM_MODE = 'live';
      process.env.LLM_API_KEY = 'mock-llm-key';

      let receivedAuth = '';
      setCustomLlmFetch(async (_input, init) => {
        receivedAuth = ((init?.headers as Record<string, string>)?.authorization) || '';
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    headline: 'Payment verified safely',
                    bullets: ['Verified seller identity EVD-TEST-01'],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const client = getLlmClient();
      assert.ok(client);

      const { z } = await import('zod');
      const schema = z.object({ headline: z.string(), bullets: z.array(z.string()) });

      const res = await client.generateJson({
        tier: 'fast',
        system: 'System prompt',
        user: 'User prompt',
        schema,
        schemaName: 'explanation',
        maxOutputTokens: 200,
        timeoutMs: 3000,
      });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.headline, 'Payment verified safely');
        assert.equal(receivedAuth, 'Bearer mock-llm-key');
      }
    });

    test('invalid JSON from LLM provider fails gracefully without throwing', async () => {
      process.env.LLM_MODE = 'live';
      process.env.LLM_API_KEY = 'mock-llm-key';

      setCustomLlmFetch(async () => {
        return new Response('Not valid json at all', { status: 200 });
      });

      const client = getLlmClient();
      assert.ok(client);

      const { z } = await import('zod');
      const res = await client.generateJson({
        tier: 'fast',
        system: 'System prompt',
        user: 'User prompt',
        schema: z.object({ val: z.number() }),
        schemaName: 'test',
        maxOutputTokens: 100,
        timeoutMs: 2000,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.ok(['invalid_json', 'schema', 'provider'].includes(res.error));
      }
    });

    test('timeout from LLM provider is handled cleanly', async () => {
      process.env.LLM_MODE = 'live';
      process.env.LLM_API_KEY = 'mock-llm-key';

      setCustomLlmFetch(async (_input, init) => {
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => reject(new Error('AbortError')));
          }
        });
      });

      const client = getLlmClient();
      assert.ok(client);

      const { z } = await import('zod');
      const res = await client.generateJson({
        tier: 'fast',
        system: 'System prompt',
        user: 'User prompt',
        schema: z.object({ val: z.number() }),
        schemaName: 'test',
        maxOutputTokens: 100,
        timeoutMs: 50,
      });

      assert.equal(res.ok, false);
    });

    test('provider HTTP error returns provider failure without leaking key', async () => {
      process.env.LLM_MODE = 'live';
      process.env.LLM_API_KEY = 'secret-live-key';

      setCustomLlmFetch(async () => {
        return new Response('Rate limit exceeded', { status: 429 });
      });

      const client = getLlmClient();
      assert.ok(client);

      const { z } = await import('zod');
      const res = await client.generateJson({
        tier: 'fast',
        system: 'System',
        user: 'User',
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'test',
        maxOutputTokens: 50,
        timeoutMs: 2000,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error, 'provider');
        assert.ok(!res.detail?.includes('secret-live-key'));
      }
    });

    test('deterministic security rules override any unsafe LLM recommendation', async () => {
      process.env.LLM_MODE = 'live';
      process.env.LLM_API_KEY = 'mock-llm-key';

      // Script LLM trying to claim everything is 100% genuine and safe
      setCustomLlmFetch(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    headline: 'Legitimate merchant verified',
                    bullets: ['Nothing suspicious found'],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      });

      // Investigate the known impersonator store (Harborlyne) through executeMerchantInvestigation
      const { executeMerchantInvestigation } = await import('../src/services/agent/agentRunner.service.js');
      const inv = await executeMerchantInvestigation({ url: 'https://www.harborlyne-outfitters-sale.example' });

      // Security invariant: payee mismatch MUST be PAUSE / BLOCK, regardless of LLM
      assert.equal(inv.verdict, 'PAUSE');
      assert.ok(inv.riskScore >= 75);
      assert.equal(inv.payeeMismatch, true);
    });
  });

  // -------------------------------------------------------------------------------------------
  // PHASE 2: Live Kernel and Channel3 Signals
  // -------------------------------------------------------------------------------------------
  describe('Live Signals (Kernel & Channel3)', () => {
    test('signalsMode handles live, auto, replay and mock', () => {
      assert.equal(signalsMode({ SIGNALS_MODE: 'live' }), 'live');
      assert.equal(signalsMode({ SIGNALS_MODE: 'auto' }), 'auto');
      assert.equal(signalsMode({ SIGNALS_MODE: 'replay' }), 'replay');
      assert.equal(signalsMode({ SIGNALS_MODE: 'mock' }), 'replay');
      assert.equal(signalsMode({}), 'replay');
    });

    test('live Channel3 client queries search endpoint and parses offers', async () => {
      process.env.SIGNALS_MODE = 'live';
      process.env.CHANNEL3_API_KEY = 'test-channel3-key';

      let receivedApiKey = '';
      setCustomSignalsClients({
        fetchImpl: async (input, init) => {
          const url = String(input);
          receivedApiKey = ((init?.headers as Record<string, string>)?.['x-api-key']) || '';
          if (url.includes('search')) {
            return new Response(
              JSON.stringify({
                products: [
                  {
                    offers: [
                      { price: 40, currency: 'USD', domain: 'competitor1.example' },
                      { price: 45, currency: 'USD', domain: 'competitor2.example' },
                    ],
                  },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response('Not found', { status: 404 });
        },
      });

      const port = getSignalsPort();
      const report = await port.getPriceReport(
        {
          claims: { finalUrl: 'https://shop.example', domain: 'shop.example', siteName: 'Canvas Bag', contacts: { emails: [], phones: [] }, linkedDomains: [], visibleText: '', hiddenText: '', sectionLinks: {}, hasContactPage: false, hasLegalPage: false },
          amount: 50,
          currency: 'USD',
          items: [{ name: 'Canvas Bag', unitPrice: 50, quantity: 1 }],
        },
        { timeoutMs: 3000 }
      );

      assert.equal(receivedApiKey, 'test-channel3-key');
      assert.ok(report.length > 0);
      assert.equal(report[0].type, 'PRICE_DEVIATION');
    });

    test('failed Channel3 call returns TOOL_UNAVAILABLE without fabricating evidence', async () => {
      process.env.SIGNALS_MODE = 'live';
      process.env.CHANNEL3_API_KEY = 'test-channel3-key';

      setCustomSignalsClients({
        fetchImpl: async () => {
          throw new Error('Connection refused upstream');
        },
      });

      const port = getSignalsPort();
      const report = await port.getPriceReport(
        {
          claims: { finalUrl: 'https://shop.example', domain: 'shop.example', siteName: 'Canvas Bag', contacts: { emails: [], phones: [] }, linkedDomains: [], visibleText: '', hiddenText: '', sectionLinks: {}, hasContactPage: false, hasLegalPage: false },
          amount: 50,
          currency: 'USD',
          items: [{ name: 'Canvas Bag', unitPrice: 50, quantity: 1 }],
        },
        { timeoutMs: 3000 }
      );

      assert.ok(report.length > 0);
      assert.equal(report[0].type, 'TOOL_UNAVAILABLE');
      assert.equal(report[0].deterministic, false);
    });
  });

  // -------------------------------------------------------------------------------------------
  // PHASE 3: Elastic Memory
  // -------------------------------------------------------------------------------------------
  describe('Elastic Memory Provider', () => {
    test('memoryMode defaults to memory when credentials are absent', async () => {
      delete process.env.ELASTIC_URL;
      delete process.env.ELASTIC_API_KEY;

      const mode = await memoryMode();
      assert.equal(mode, 'memory');

      const store = await getPatternStore();
      assert.ok(store instanceof InMemoryPatternStore);
    });

    test('connected Elastic memory initialized when URL and API key are set', async () => {
      process.env.ELASTIC_URL = 'https://elastic.test.example:9200';
      process.env.ELASTIC_API_KEY = 'test-elastic-key';
      process.env.ELASTIC_INDEX = 'test-scam-index';

      setCustomMemoryFetch(async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        // HEAD/GET index existence
        if (url.includes('test-scam-index') && method === 'HEAD') {
          return new Response(null, { status: 200 });
        }
        // Count query
        if (url.includes('_count')) {
          return new Response(JSON.stringify({ count: 5 }), { status: 200 });
        }
        // Search query
        if (url.includes('_search')) {
          return new Response(
            JSON.stringify({
              hits: {
                hits: [
                  {
                    _id: 'doc-1',
                    _source: {
                      registrableDomain: 'scam.example',
                      payeeHash: 'hash123',
                      decision: 'PAUSE',
                      patternText: 'Lookalike luxury apparel scam',
                    },
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
      });

      const mode = await memoryMode();
      assert.equal(mode, 'elastic');

      const store = await getPatternStore();
      assert.ok(store instanceof ElasticPatternStore);
    });

    test('unavailable Elastic gracefully falls back to in-memory store without failing', async () => {
      process.env.ELASTIC_URL = 'https://unreachable-elastic.example:9200';
      process.env.ELASTIC_API_KEY = 'test-elastic-key';

      setCustomMemoryFetch(async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:9200');
      });

      // getPatternStore catches error and falls back to in-memory store
      const store = await getPatternStore();
      assert.ok(store instanceof InMemoryPatternStore);
      assert.ok((await store.size()) > 0); // Seed patterns loaded
    });
  });
});
