import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface RecordedRequest {
  method: string;
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

export interface MockBackend {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export interface VerdictFixture {
  orderId: string;
  decision: 'ALLOW' | 'WARN' | 'PAUSE';
  score: number;
  riskScore: number;
  confidence: number;
  summary: string;
  recommendedAction: 'PROCEED' | 'WARN_DISPLAYED' | 'CAPTURE_PAUSED';
  explanation: {
    headline: string;
    bullets: Array<{ text: string; evidenceIds: string[] }>;
  };
  trace: Array<{
    step: number;
    tool: string;
    why: string;
    input: string;
    result: string;
    evidenceIds: string[];
    ok: boolean;
    ms: number;
  }>;
  evidence: Array<{
    id: string;
    type: string;
    severity: 'info' | 'low' | 'medium' | 'high';
    confidence: number;
    summary: string;
    source: string;
    deterministic: boolean;
  }>;
  degraded: boolean;
}

const ALLOW_VERDICT: VerdictFixture = {
  orderId: 'mock-order',
  decision: 'ALLOW',
  score: 5,
  riskScore: 0.05,
  confidence: 0.99,
  summary: 'No risk signals were found in the standard checks.',
  recommendedAction: 'PROCEED',
  explanation: {
    headline: 'The merchant looks genuine.',
    bullets: [
      { text: 'The domain is four years old.', evidenceIds: ['EVD-SIG-AGE-01'] },
    ],
  },
  trace: [
    {
      step: 0,
      tool: 'domain_report',
      why: 'Standard check',
      input: 'shop.example',
      result: 'Registered four years ago',
      evidenceIds: ['EVD-SIG-AGE-01'],
      ok: true,
      ms: 4,
    },
  ],
  evidence: [
    {
      id: 'EVD-SIG-AGE-01',
      type: 'DOMAIN_AGE',
      severity: 'info',
      confidence: 1,
      summary: 'Registered four years ago',
      source: 'rdap',
      deterministic: true,
    },
  ],
  degraded: false,
};

const WARN_VERDICT: VerdictFixture = {
  orderId: 'mock-order',
  decision: 'WARN',
  score: 61,
  riskScore: 0.61,
  confidence: 0.95,
  summary: 'Several signals need a closer look.',
  recommendedAction: 'WARN_DISPLAYED',
  explanation: {
    headline: 'Some details do not add up.',
    bullets: [
      { text: 'The domain is 12 days old.', evidenceIds: ['EVD-SIG-DAYS-01'] },
      { text: 'The payee is not in the registry.', evidenceIds: ['EVD-SIG-PAYEE-02'] },
      { text: 'The price is 85 percent below market.', evidenceIds: ['EVD-SIG-PRICE-03'] },
      { text: 'The seller uses a free email address.', evidenceIds: ['EVD-SIG-MAIL-04'] },
      { text: 'This fifth reason must be trimmed.', evidenceIds: ['EVD-SIG-EXTRA-05'] },
    ],
  },
  trace: Array.from({ length: 8 }, (_, index) => ({
    step: index,
    tool: `tool_${index}`,
    why: 'Standard check',
    input: 'input',
    result: `result ${index}`,
    evidenceIds: [`EVD-SIG-STEP-${index}`],
    ok: true,
    ms: index,
  })),
  evidence: [
    {
      id: 'EVD-SIG-DAYS-01',
      type: 'DOMAIN_AGE',
      severity: 'medium',
      confidence: 1,
      summary: 'The domain is 12 days old.',
      source: 'rdap',
      deterministic: true,
    },
  ],
  degraded: false,
};

const PAUSE_VERDICT: VerdictFixture = {
  orderId: 'mock-order',
  decision: 'PAUSE',
  score: 94,
  riskScore: 0.94,
  confidence: 0.99,
  summary: 'The merchant impersonates a known brand.',
  recommendedAction: 'CAPTURE_PAUSED',
  explanation: {
    headline: 'This checkout was paused.',
    bullets: [
      { text: 'The payee does not match the merchant.', evidenceIds: ['EVD-SIG-BIND-01'] },
      { text: 'The domain copies a known brand.', evidenceIds: ['EVD-SIG-LOOK-02'] },
      { text: 'The page tried to instruct the agent.', evidenceIds: ['EVD-SIG-INJ-03'] },
    ],
  },
  trace: [
    {
      step: 0,
      tool: 'domain_report',
      why: 'Standard check',
      input: 'shop.example',
      result: 'Registered four days ago',
      evidenceIds: ['EVD-SIG-LOOK-02'],
      ok: true,
      ms: 3,
    },
  ],
  evidence: [],
  degraded: false,
};

function success(data: unknown): unknown {
  return { success: true, data, meta: { requestId: 'mock' } };
}

function failure(code: string, message: string): unknown {
  return { success: false, error: { code, message } };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hostOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function verdictForHost(host: string): VerdictFixture {
  if (host === 'pause.example') return PAUSE_VERDICT;
  if (host === 'warn.example') return WARN_VERDICT;
  return ALLOW_VERDICT;
}

function checkoutIdForHost(host: string): string {
  if (host === 'pause.example') return 'chk-paused';
  if (host === 'warn.example') return 'chk-human';
  if (host === 'policy.example') return 'chk-policy';
  if (host === 'badbody.example') return '';
  return 'chk-captured';
}

export async function startMockBackend(): Promise<MockBackend> {
  const requests: RecordedRequest[] = [];

  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    requests.push({
      method: request.method ?? 'GET',
      path,
      authorization: request.headers.authorization,
      body,
    });

    if (request.method === 'POST' && path === '/api/v1/investigations') {
      const host = hostOf(body.merchantUrl);
      if (host === 'error.example') {
        send(response, 504, failure('UPSTREAM_TIMEOUT', 'upstream timed out'));
        return;
      }
      if (host === 'slow.example') {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      send(response, 200, success(verdictForHost(host)));
      return;
    }

    if (request.method === 'POST' && path === '/api/v1/checkout/orders') {
      const host = hostOf(body.merchantUrl);
      const checkoutId = checkoutIdForHost(host);
      if (checkoutId.length === 0) {
        send(response, 200, success({ status: 'AWAITING_APPROVAL' }));
        return;
      }
      send(
        response,
        200,
        success({
          checkoutId,
          approvalUrl: `https://approval.example/${checkoutId}`,
          status: 'AWAITING_APPROVAL',
        })
      );
      return;
    }

    const finalizeMatch = /^\/api\/v1\/checkout\/orders\/([^/]+)\/finalize$/.exec(path);
    if (request.method === 'POST' && finalizeMatch) {
      const checkoutId = decodeURIComponent(finalizeMatch[1]);

      if (checkoutId === 'chk-policy') {
        send(response, 409, failure('POLICY_VIOLATION', 'daily cap exceeded'));
        return;
      }

      if (checkoutId === 'chk-paused') {
        send(
          response,
          200,
          success({ checkoutId, status: 'PAUSED', verdict: PAUSE_VERDICT })
        );
        return;
      }

      if (checkoutId === 'chk-human' && body.humanDecision !== 'proceed') {
        send(
          response,
          200,
          success({ checkoutId, status: 'NEEDS_HUMAN_DECISION', verdict: WARN_VERDICT })
        );
        return;
      }

      send(
        response,
        200,
        success({ checkoutId, status: 'CAPTURED', verdict: ALLOW_VERDICT })
      );
      return;
    }

    const policyMatch = /^\/api\/v1\/policies\/([^/]+)$/.exec(path);
    if (request.method === 'PUT' && policyMatch) {
      const agentId = decodeURIComponent(policyMatch[1]);
      send(
        response,
        200,
        success({
          agentId,
          perOrderCap: body.perOrderCap,
          dailyCap: body.dailyCap,
          firstPurchaseCap: body.firstPurchaseCap,
          currency: body.currency,
        })
      );
      return;
    }

    send(response, 404, failure('NOT_FOUND', 'route not found'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('mock backend did not bind to a port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...overrides };
}

export interface SpawnedClient {
  client: Client;
  stderr(): string;
  close(): Promise<void>;
}

export async function startClient(
  overrides: Record<string, string> = {}
): Promise<SpawnedClient> {
  let stderrText = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'apps/mcp/src/index.ts'],
    cwd: repoRoot,
    env: cleanEnv(overrides),
    stderr: 'pipe',
  });

  const stderr = transport.stderr as Readable | null;
  if (stderr) {
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => {
      stderrText += chunk;
    });
  }

  const client = new Client({ name: 'guardian-test', version: '1.0.0' });
  try {
    await client.connect(transport);
  } catch (error) {
    const detail = stderrText.length > 0 ? `\n${stderrText}` : '';
    throw new Error(
      `MCP server failed to start: ${error instanceof Error ? error.message : String(error)}${detail}`
    );
  }

  return {
    client,
    stderr: () => stderrText,
    close: () => client.close(),
  };
}

export interface RawServer {
  lines: string[];
  child: ChildProcessWithoutNullStreams;
  close(): Promise<void>;
}

export async function startRawServer(
  overrides: Record<string, string> = {}
): Promise<RawServer> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/mcp/src/index.ts'],
    {
      cwd: repoRoot,
      env: cleanEnv(overrides),
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    if (line.trim().length > 0) lines.push(line);
  });

  const waitFor = (predicate: () => boolean, timeoutMs = 5_000): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('timed out waiting for MCP stdout'));
        }
      }, 10);
    });

  const send = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'raw-test', version: '1.0.0' },
    },
  });
  await waitFor(() => lines.length >= 1);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await waitFor(() => lines.some((line) => parsedId(line) === 2));

  return {
    lines,
    child,
    close: () =>
      new Promise<void>((resolve) => {
        reader.close();
        child.once('close', () => resolve());
        child.kill();
      }),
  };
}

function parsedId(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
      return (parsed as { id?: unknown }).id;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}
