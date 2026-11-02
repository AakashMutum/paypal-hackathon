import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { MemoryDocument, MemoryPort } from '../src/ports.js';
import { AgentResultSchema } from '../src/types.js';
import { InMemoryMemory, createElasticMemory, ensureScamMemoryIndex } from '../src/adapters/memoryElastic.js';
import { loadSeeds, seedDocuments } from '../src/memory/seeds.js';
import { memoryIdFor } from '../src/memory/store.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { scenarioA } from '../src/fixtures/scenario-a.js';
import { scenarioB } from '../src/fixtures/scenario-b.js';
import { depsFor } from './helpers.js';

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

const document = (overrides: Partial<MemoryDocument> = {}): MemoryDocument => ({
  patternText: 'A lookalike store sells below market price.',
  domain: 'trailpeak-deals.example',
  registrableDomain: 'trailpeak-deals.example',
  decision: 'PAUSE',
  riskScore: 0.9,
  evidenceTypes: [],
  domainAgeBucket: '7-29d',
  discountBucket: '>=80',
  ...overrides,
});

// ------------------------------------------------------------- in-memory adapter

test('the in-memory adapter matches an exact payee', async () => {
  const memory = new InMemoryMemory();
  memory.load([document({ id: 'doc-1', payeeMerchantId: 'MERCH-B' })]);

  const hits = await memory.search(
    { patternText: 'something else entirely', registrableDomain: 'other.example', payeeMerchantId: 'MERCH-B' },
    { timeoutMs: 1000 }
  );

  assert.equal(hits[0].matchType, 'exact_payee');
  assert.equal(hits[0].id, 'doc-1');
});

test('the in-memory adapter matches an exact domain', async () => {
  const memory = new InMemoryMemory();
  memory.load([document({ id: 'doc-2', registrableDomain: 'trailpeak-deals.example' })]);

  const hits = await memory.search(
    { patternText: 'unrelated words', registrableDomain: 'trailpeak-deals.example' },
    { timeoutMs: 1000 }
  );

  assert.equal(hits[0].matchType, 'exact_domain');
});

test('the in-memory adapter scores semantic similarity by word overlap', async () => {
  const memory = new InMemoryMemory();
  memory.load([
    document({ id: 'a', patternText: 'a store imitates a known brand', registrableDomain: 'a.invalid' }),
    document({ id: 'b', patternText: 'unrelated text about tents', registrableDomain: 'b.invalid' }),
  ]);

  const hits = await memory.search(
    { patternText: 'a store imitates a known brand', registrableDomain: 'query.example' },
    { timeoutMs: 1000 }
  );

  assert.equal(hits[0].id, 'a');
  assert.equal(hits[0].matchType, 'semantic');
  assert.ok((hits[0].score ?? 0) > 0.9);
});

test('writing twice upserts the same document and counts sightings', async () => {
  const memory = new InMemoryMemory();
  await memory.write(document({ payeeMerchantId: 'MERCH-B' }), { timeoutMs: 1000 });
  await memory.write(document({ payeeMerchantId: 'MERCH-B', riskScore: 0.7 }), { timeoutMs: 1000 });

  assert.equal(memory.size, 1);
  const stored = memory.get(memoryIdFor('trailpeak-deals.example', 'MERCH-B'));
  assert.ok(stored);
  assert.equal(stored.seenCount, 2);
  assert.equal(stored.riskScore, 0.7);
});

test('the seed pack loads eight disclosed cards', async () => {
  const memory = new InMemoryMemory();
  const written = await loadSeeds(memory, { timeoutMs: 1000 });
  assert.equal(written, 8);
  assert.equal(memory.size, 8);
  assert.equal(seedDocuments().every((card) => card.seed === true), true);
});

// ------------------------------------------------------------- elastic adapter

test('the elastic adapter asks for exact and semantic matches', async () => {
  const bodies: { url?: string; body: Record<string, unknown> }[] = [];

  const server = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    bodies.push({ url: req.url, body });
    res.setHeader('content-type', 'application/json');

    if ((body.query as Record<string, unknown>)?.semantic) {
      res.end(
        JSON.stringify({
          hits: {
            hits: [
              {
                _id: 'semantic-1',
                _score: 0.91,
                _source: { patternText: 'similar pattern', decision: 'WARN', riskScore: 0.6 },
              },
            ],
          },
        })
      );
      return;
    }

    res.end(
      JSON.stringify({
        hits: {
          hits: [
            {
              _id: 'exact-1',
              _score: 1,
              _source: {
                payeeMerchantId: 'MERCH-B',
                patternText: 'exact pattern',
                decision: 'PAUSE',
                riskScore: 0.9,
              },
            },
          ],
        },
      })
    );
  });

  try {
    const memory = createElasticMemory({ url: server.url, apiKey: 'k', index: 'guardian' });
    const hits = await memory.search(
      { patternText: 'similar pattern', registrableDomain: 'trailpeak-deals.example', payeeMerchantId: 'MERCH-B' },
      { timeoutMs: 1000 }
    );

    assert.equal(hits.length, 2);
    assert.equal(hits[0].matchType, 'exact_payee');
    assert.equal(hits[1].matchType, 'semantic');
    assert.equal(bodies.filter((entry) => entry.url === '/guardian/_search').length, 2);
  } finally {
    await server.close();
  }
});

test('the elastic adapter falls back to a keyword search when semantic fails', async () => {
  let keywordSearches = 0;

  const server = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as { query?: Record<string, unknown> };
    res.setHeader('content-type', 'application/json');

    if (body.query?.semantic) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { reason: 'semantic_text is not available' } }));
      return;
    }
    if (body.query?.match) {
      keywordSearches += 1;
      res.end(
        JSON.stringify({
          hits: { hits: [{ _id: 'kw-1', _score: 0.7, _source: { patternText: 'keyword hit', decision: 'WARN' } }] },
        })
      );
      return;
    }
    res.end(JSON.stringify({ hits: { hits: [] } }));
  });

  try {
    const memory = createElasticMemory({ url: server.url, apiKey: 'k', index: 'guardian' });
    const hits = await memory.search(
      { patternText: 'a pattern', registrableDomain: 'a.example' },
      { timeoutMs: 1000 }
    );

    assert.equal(keywordSearches, 1);
    assert.ok(hits.some((hit) => hit.id === 'kw-1'));
  } finally {
    await server.close();
  }
});

test('the elastic adapter writes with doc and upsert', async () => {
  let captured: { url?: string; body?: Record<string, unknown> } = {};

  const server = await startServer(async (req, res) => {
    captured = { url: req.url, body: JSON.parse(await readBody(req)) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result: 'updated' }));
  });

  try {
    const memory = createElasticMemory({ url: server.url, apiKey: 'k', index: 'guardian' });
    await memory.write(document({ payeeMerchantId: 'MERCH-B' }), { timeoutMs: 1000 });

    const id = memoryIdFor('trailpeak-deals.example', 'MERCH-B');
    assert.equal(captured.url, `/guardian/_update/${id}`);
    assert.ok(captured.body?.doc);
    assert.ok(captured.body?.upsert);
  } finally {
    await server.close();
  }
});

test('index creation tolerates an existing index and reports other errors', async () => {
  const existing = await startServer((_req, res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { type: 'resource_already_exists_exception' } }));
  });

  try {
    await assert.doesNotReject(() =>
      ensureScamMemoryIndex({ url: existing.url, apiKey: 'k', index: 'guardian' })
    );
  } finally {
    await existing.close();
  }

  const broken = await startServer((_req, res) => {
    res.statusCode = 500;
    res.end('boom');
  });

  try {
    await assert.rejects(() => ensureScamMemoryIndex({ url: broken.url, apiKey: 'k', index: 'guardian' }));
  } finally {
    await broken.close();
  }
});

// ------------------------------------------------------------- orchestrator

test('a WARN case searches memory and writes a document', async () => {
  const memory = new InMemoryMemory();
  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, undefined, memory)
  );

  assert.equal(memory.searchCalls.length, 1);
  assert.equal(memory.writeCalls.length, 1);
  assert.equal(memory.writeCalls[0].decision, 'WARN');
  assert.equal(memory.writeCalls[0].registrableDomain, 'trailpeak-deals.example');
  assert.ok(result.patternSentence);
  assert.ok(result.patternSentence.length > 0);
});

test('a fast ALLOW never touches memory', async () => {
  const memory = new InMemoryMemory();
  await runInvestigatorAgentDetailed(scenarioA.request, depsFor(scenarioA, {}, undefined, memory));

  assert.equal(memory.searchCalls.length, 0);
  assert.equal(memory.writeCalls.length, 0);
});

test('an exact memory hit adds deterministic evidence and raises the score', async () => {
  const memory = new InMemoryMemory();
  memory.load([
    document({
      id: 'known-bad',
      payeeMerchantId: 'MERCH-B',
      registrableDomain: 'elsewhere.example',
      patternText: 'A store imitates a brand and pays an unrelated business.',
    }),
  ]);

  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, undefined, memory)
  );

  const memoryEvidence = result.evidence.filter((entry) => entry.type === 'SCAM_MEMORY_MATCH');
  assert.ok(memoryEvidence.some((entry) => entry.deterministic === true));
  assert.equal(result.verdict.score, 70);
  assert.equal(result.verdict.decision, 'WARN');
});

test('memory can be switched off by feature flag', async () => {
  const memory = new InMemoryMemory();
  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, undefined, memory),
    { features: { memory: false } }
  );

  assert.equal(memory.searchCalls.length, 0);
  assert.equal(memory.writeCalls.length, 0);
  assert.equal(result.patternSentence, undefined);
});

test('a failing memory search does not change the verdict', async () => {
  const memory: MemoryPort = {
    search: async () => {
      throw new Error('elastic down');
    },
    write: async () => undefined,
  };

  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, undefined, memory)
  );

  assert.equal(result.verdict.score, 61);
  assert.equal(result.verdict.decision, 'WARN');
  assert.equal(result.degraded, false);
});

test('a failing memory write does not change the verdict', async () => {
  const memory: MemoryPort = {
    search: async () => [],
    write: async () => {
      throw new Error('write failed');
    },
  };

  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, undefined, memory)
  );

  assert.equal(result.verdict.score, 61);
  assert.equal(AgentResultSchema.safeParse(result).success, true);
});
