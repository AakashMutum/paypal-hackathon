import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { GuardianApiClient } from './apiClient.js';
import { registerInvestigateMerchant } from './tools/investigateMerchant.js';
import { registerSafeCheckout } from './tools/safeCheckout.js';
import { registerSetSpendPolicy } from './tools/setSpendPolicy.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './version.js';

export interface GuardianServerOptions {
  api: GuardianApiClient;
}

export function createGuardianServer(options: GuardianServerOptions): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  registerInvestigateMerchant(server, options.api);
  registerSafeCheckout(server, options.api);
  registerSetSpendPolicy(server, options.api);

  return server;
}
