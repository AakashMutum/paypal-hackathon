import test from 'node:test';
import assert from 'node:assert/strict';

import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../src/index.js';

test('mcp package exposes its server identity', () => {
  assert.equal(MCP_SERVER_NAME, 'checkout-guardian');
  assert.match(MCP_SERVER_VERSION, /^\d+\.\d+\.\d+$/);
});
