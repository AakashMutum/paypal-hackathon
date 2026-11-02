import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startClient, startRawServer } from './helpers.js';

const EXPECTED_TOOLS = ['investigate_merchant', 'safe_checkout', 'set_spend_policy'];

test('the spawned server exposes exactly the three guardian tools', async () => {
  const spawned = await startClient({ GUARDIAN_API_URL: 'http://127.0.0.1:1' });

  try {
    const listed = await spawned.client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    for (const tool of listed.tools) {
      assert.ok(tool.description && tool.description.length > 20);
      assert.ok(tool.inputSchema);
    }
  } finally {
    await spawned.close();
  }
});

test('every stdout line is a JSON-RPC message', async () => {
  const raw = await startRawServer({ GUARDIAN_API_URL: 'http://127.0.0.1:1' });

  try {
    assert.ok(raw.lines.length >= 2);

    const messages = raw.lines.map((line) => {
      const parsed: unknown = JSON.parse(line);
      assert.ok(typeof parsed === 'object' && parsed !== null);
      assert.equal((parsed as { jsonrpc?: unknown }).jsonrpc, '2.0');
      return parsed as { id?: unknown; result?: { tools?: Array<{ name: string }> } };
    });

    const listResponse = messages.find((message) => message.id === 2);
    assert.ok(listResponse?.result?.tools);
    assert.deepEqual(
      listResponse.result.tools.map((tool) => tool.name).sort(),
      [...EXPECTED_TOOLS].sort()
    );
  } finally {
    await raw.close();
  }
});

test('no source file writes to stdout', () => {
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;

      const source = readFileSync(path, 'utf8');
      if (source.includes('console.log(') || source.includes('process.stdout.write')) {
        offenders.push(path);
      }
    }
  };

  walk(sourceRoot);
  assert.deepEqual(offenders, []);
});
