import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createHttpProvider } from '../src/llm/httpProvider.js';

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

const okBody = JSON.stringify({
  choices: [{ message: { content: '{"answer":1}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
});

test('the provider sends an OpenAI-compatible request', async () => {
  const captured: {
    url?: string;
    auth?: string;
    body?: Record<string, unknown>;
  }[] = [];

  const server = await startServer(async (req, res) => {
    captured.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(await readBody(req)) });
    res.setHeader('content-type', 'application/json');
    res.end(okBody);
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'test-key',
      baseUrl: `${server.url}/`,
      models: { fast: 'fast-model', strong: 'strong-model' },
    });

    const response = await provider.complete({
      tier: 'strong',
      system: 'system text',
      user: 'user text',
      maxOutputTokens: 400,
      timeoutMs: 1000,
    });

    assert.equal(response.text, '{"answer":1}');
    assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 2 });

    assert.equal(captured[0].url, '/chat/completions');
    assert.equal(captured[0].auth, 'Bearer test-key');
    assert.equal(captured[0].body?.model, 'strong-model');
    assert.equal(captured[0].body?.temperature, 0);
    assert.equal(captured[0].body?.max_tokens, 400);
    assert.deepEqual(captured[0].body?.messages, [
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' },
    ]);
    assert.deepEqual(captured[0].body?.response_format, { type: 'json_object' });
  } finally {
    await server.close();
  }
});

test('the fast tier uses the fast model', async () => {
  let model = '';
  const server = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as { model: string };
    model = body.model;
    res.setHeader('content-type', 'application/json');
    res.end(okBody);
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'k',
      baseUrl: server.url,
      models: { fast: 'fast-model', strong: 'strong-model' },
    });
    await provider.complete({
      tier: 'fast',
      system: 's',
      user: 'u',
      maxOutputTokens: 10,
      timeoutMs: 1000,
    });
    assert.equal(model, 'fast-model');
  } finally {
    await server.close();
  }
});

test('a provider that rejects json mode is retried once without it', async () => {
  const bodies: Record<string, unknown>[] = [];

  const server = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'response_format is unsupported' } }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(okBody);
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'k',
      baseUrl: server.url,
      models: { fast: 'm', strong: 'm' },
    });
    const response = await provider.complete({
      tier: 'fast',
      system: 's',
      user: 'u',
      maxOutputTokens: 10,
      timeoutMs: 1000,
    });

    assert.equal(response.text, '{"answer":1}');
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].response_format);
    assert.equal(bodies[1].response_format, undefined);
  } finally {
    await server.close();
  }
});

test('an unrelated 400 is not retried', async () => {
  let calls = 0;
  const server = await startServer((_req, res) => {
    calls += 1;
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: 'unknown model' } }));
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'k',
      baseUrl: server.url,
      models: { fast: 'm', strong: 'm' },
    });
    await assert.rejects(
      () =>
        provider.complete({ tier: 'fast', system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 1000 }),
      /LLM provider error 400/
    );
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test('a 500 becomes a provider error', async () => {
  const server = await startServer((_req, res) => {
    res.statusCode = 500;
    res.end('internal failure');
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'k',
      baseUrl: server.url,
      models: { fast: 'm', strong: 'm' },
    });
    await assert.rejects(
      () =>
        provider.complete({ tier: 'fast', system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 1000 }),
      /LLM provider error 500/
    );
  } finally {
    await server.close();
  }
});

test('a response without text content is rejected', async () => {
  const server = await startServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [] }));
  });

  try {
    const provider = createHttpProvider({
      apiKey: 'k',
      baseUrl: server.url,
      models: { fast: 'm', strong: 'm' },
    });
    await assert.rejects(
      () =>
        provider.complete({ tier: 'fast', system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 1000 }),
      /did not contain text content/
    );
  } finally {
    await server.close();
  }
});
