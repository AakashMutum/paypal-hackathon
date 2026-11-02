import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { GuardianApiClient } from './apiClient.js';
import { loadMcpConfig, type McpConfig } from './config.js';
import { createGuardianServer } from './server.js';
import { MCP_SERVER_NAME } from './version.js';

const MAX_HTTP_BODY_BYTES = 100 * 1024;

export * from './version.js';
export { createGuardianServer } from './server.js';
export { loadMcpConfig } from './config.js';
export type { McpConfig } from './config.js';
export { GuardianApiClient, GuardianApiError, plainMessageFor } from './apiClient.js';
export type {
  CreateCheckoutPayload,
  FinalizeCheckoutPayload,
  GuardianApiClientOptions,
  InvestigateMerchantPayload,
  SpendPolicyPayload,
} from './apiClient.js';
export { isSafePublicUrl } from './security/publicUrl.js';
export {
  clampText,
  MAX_REASONS,
  MAX_TOOL_TEXT,
  MAX_TRACE_LINES,
  formatCheckout,
  formatPolicy,
  formatVerdict,
} from './format.js';

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function unauthorized(response: import('node:http').ServerResponse): void {
  response.writeHead(401, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'unauthorized' }));
}

async function readBody(
  request: import('node:http').IncomingMessage
): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_HTTP_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function startHttpTransport(
  api: GuardianApiClient,
  config: McpConfig
): Promise<void> {
  if (!config.bearerToken) {
    throw new Error('MCP_BEARER_TOKEN is required when MCP_TRANSPORT=http');
  }

  const httpServer = createServer(async (request, response) => {
    try {
      if (request.url !== '/mcp' && !request.url?.startsWith('/mcp?')) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      if (request.method === 'OPTIONS') {
        response.writeHead(405);
        response.end();
        return;
      }

      if (request.headers.authorization !== `Bearer ${config.bearerToken}`) {
        unauthorized(response);
        return;
      }

      let parsedBody: unknown;
      if (request.method === 'POST') {
        const declaredLength = Number(request.headers['content-length'] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
          response.writeHead(413, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'payload_too_large' }));
          request.resume();
          return;
        }

        const raw = await readBody(request);
        if (raw === undefined) {
          response.writeHead(413, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'payload_too_large' }));
          return;
        }

        try {
          parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined;
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_json' }));
          return;
        }
      }

      // A stateless transport cannot be reused across requests, so every
      // request gets its own server and transport pair.
      const server = createGuardianServer({ api });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      response.once('close', () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
      }
      response.end(JSON.stringify({ error: 'internal_error' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, () => resolve());
  });

  console.error(`[${MCP_SERVER_NAME}] HTTP transport listening on port ${config.port}`);
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = loadMcpConfig(env);
  const api = new GuardianApiClient({
    baseUrl: config.guardianApiUrl,
    apiKey: config.guardianApiKey,
    requestTimeoutMs: config.requestTimeoutMs,
    finalizeTimeoutMs: config.finalizeTimeoutMs,
  });
  if (config.transport === 'http') {
    await startHttpTransport(api, config);
    return;
  }

  const server = createGuardianServer({ api });
  await server.connect(new StdioServerTransport());
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${MCP_SERVER_NAME}] failed to start: ${message}`);
    process.exitCode = 1;
  });
}
