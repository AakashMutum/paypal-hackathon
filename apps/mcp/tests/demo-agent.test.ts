import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from './helpers.js';
import {
  loadMarketContext,
  loadMarketplace,
  loadScenarioFixture,
  type ScenarioFixture,
} from '../demo-agent/marketplace.js';
import {
  createFixtureGuardianClient,
  createMcpGuardianClient,
  createReplayModel,
  createUnguardedPayClient,
  parseModelJson,
  runShopper,
  type DemoModel,
  type GuardianClient,
  type ShopperOptions,
  type ToolCaller,
} from '../demo-agent/shopper.js';
import { parseArgs, replayActions } from '../demo-agent/index.js';

const fixture = loadScenarioFixture();

function marketplace() {
  return {
    listings: fixture.listings,
    marketContext: fixture.marketContext,
    source: 'fixture' as const,
    contextSource: 'fixture' as const,
  };
}

function actions(...list: unknown[]): DemoModel {
  return createReplayModel(list);
}

function baseOptions(overrides: Partial<ShopperOptions> = {}): ShopperOptions {
  return {
    scenario: fixture,
    marketplace: marketplace(),
    model: createReplayModel(fixture.actions),
    guardian: createFixtureGuardianClient(fixture.guardianVerdicts),
    unguardedPay: createUnguardedPayClient(),
    guardianMode: 'on',
    budget: fixture.budget,
    autoHuman: 'yes',
    maxSteps: 10,
    stepTimeoutMs: 1_000,
    totalTimeoutMs: 90_000,
    now: () => 0,
    ...overrides,
  };
}

function spyGuardian(base: GuardianClient): {
  client: GuardianClient;
  investigations: string[];
  starts: string[];
  finalizes: string[];
} {
  const investigations: string[] = [];
  const starts: string[] = [];
  const finalizes: string[] = [];

  return {
    investigations,
    starts,
    finalizes,
    client: {
      async investigate(listing) {
        investigations.push(listing.id);
        return base.investigate(listing);
      },
      async startCheckout(listing) {
        starts.push(listing.id);
        return base.startCheckout(listing);
      },
      async finalizeCheckout(checkoutId, options) {
        finalizes.push(checkoutId);
        return base.finalizeCheckout(checkoutId, options);
      },
    },
  };
}

function codeOf(result: { events: Array<{ code?: string }> }, code: string) {
  return result.events.find((event) => event.code === code);
}

function scenarioWithVerdict(
  listingId: string,
  decision: 'ALLOW' | 'WARN' | 'PAUSE'
): ScenarioFixture {
  return {
    ...fixture,
    guardianVerdicts: {
      ...fixture.guardianVerdicts,
      [listingId]: { decision, score: decision === 'WARN' ? 61 : 8 },
    },
  };
}

test('Scenario D replay captures L-A and never starts L-B or L-C', async () => {
  const spy = spyGuardian(createFixtureGuardianClient(fixture.guardianVerdicts));
  const result = await runShopper(
    baseOptions({ guardian: spy.client, model: createReplayModel(fixture.actions) })
  );

  assert.equal(result.outcome.status, 'CAPTURED');
  assert.equal(result.outcome.listingId, 'L-A');
  assert.equal(result.outcome.captureId, 'CAPTURE-chk-L-A');
  assert.equal(result.outcome.spent, 119);
  assert.equal(result.modelCalls, 6);
  assert.deepEqual(spy.starts, ['L-A']);
  assert.deepEqual(spy.finalizes, ['chk-L-A']);
  assert.ok(codeOf(result, 'guardian_paused'));
  assert.ok(codeOf(result, 'over_budget'));
  assert.ok(!spy.starts.includes('L-B'));
  assert.ok(!spy.starts.includes('L-C'));
});

test('a PAUSE blocks checkout even when the model asks to start it', async () => {
  const spy = spyGuardian(createFixtureGuardianClient(fixture.guardianVerdicts));
  const result = await runShopper(
    baseOptions({
      guardian: spy.client,
      model: actions(
        { action: 'investigate', listingId: 'L-B' },
        { action: 'start_checkout', listingId: 'L-B' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'guardian_paused'));
  assert.deepEqual(spy.starts, []);
  assert.equal(result.outcome.status, 'STOPPED');
});

test('a WARN checkout needs a human yes and does not start on no', async () => {
  const scenario = scenarioWithVerdict('L-A', 'WARN');
  const spy = spyGuardian(createFixtureGuardianClient(scenario.guardianVerdicts));

  const result = await runShopper(
    baseOptions({
      scenario,
      autoHuman: 'no',
      guardian: spy.client,
      model: actions(
        { action: 'investigate', listingId: 'L-A' },
        { action: 'start_checkout', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'human_declined'));
  assert.deepEqual(spy.starts, []);
});

test('a WARN checkout proceeds after a human yes', async () => {
  const scenario = scenarioWithVerdict('L-A', 'WARN');
  const spy = spyGuardian(createFixtureGuardianClient(scenario.guardianVerdicts));

  const result = await runShopper(
    baseOptions({
      scenario,
      autoHuman: 'yes',
      guardian: spy.client,
      model: actions(
        { action: 'investigate', listingId: 'L-A' },
        { action: 'start_checkout', listingId: 'L-A' },
        { action: 'finalize_checkout', listingId: 'L-A' }
      ),
    })
  );

  assert.equal(result.outcome.status, 'CAPTURED');
  assert.deepEqual(spy.starts, ['L-A']);
  assert.deepEqual(spy.finalizes, ['chk-L-A']);
});

test('checkout cannot start before investigation', async () => {
  const spy = spyGuardian(createFixtureGuardianClient(fixture.guardianVerdicts));
  const result = await runShopper(
    baseOptions({
      guardian: spy.client,
      model: actions(
        { action: 'start_checkout', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'investigation_required'));
  assert.deepEqual(spy.starts, []);
});

test('the budget cap rejects an over-budget listing before checkout', async () => {
  const spy = spyGuardian(createFixtureGuardianClient(fixture.guardianVerdicts));
  const result = await runShopper(
    baseOptions({
      guardian: spy.client,
      model: actions(
        { action: 'start_checkout', listingId: 'L-C' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'over_budget'));
  assert.deepEqual(spy.starts, []);
  assert.deepEqual(spy.investigations, []);
});

test('finalizing an ALLOW checkout still requires a human Enter', async () => {
  const spy = spyGuardian(createFixtureGuardianClient(fixture.guardianVerdicts));
  const result = await runShopper(
    baseOptions({
      autoHuman: 'no',
      guardian: spy.client,
      model: actions(
        { action: 'investigate', listingId: 'L-A' },
        { action: 'start_checkout', listingId: 'L-A' },
        { action: 'finalize_checkout', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.deepEqual(spy.starts, ['L-A']);
  assert.deepEqual(spy.finalizes, []);
  assert.ok(codeOf(result, 'human_declined'));
});

test('guardian off uses a clearly labelled simulated unchecked payment', async () => {
  const result = await runShopper(
    baseOptions({
      guardianMode: 'off',
      guardian: undefined,
      model: actions({ action: 'pay_unchecked', listingId: 'L-A' }),
    })
  );

  assert.equal(result.outcome.status, 'SIMULATED');
  assert.equal(result.outcome.spent, 119);
  assert.equal(result.events[0].status, 'SIMULATED');
  assert.match(result.events[0].detail ?? '', /SIMULATED/);
});

test('guardian off rejects guarded checkout actions', async () => {
  const result = await runShopper(
    baseOptions({
      guardianMode: 'off',
      guardian: undefined,
      model: actions(
        { action: 'start_checkout', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'guardian_off'));
});

test('guardian on rejects unchecked payment actions', async () => {
  const result = await runShopper(
    baseOptions({
      model: actions(
        { action: 'pay_unchecked', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'guardian_on'));
});

test('an unknown action is recorded and the loop keeps going', async () => {
  const result = await runShopper(
    baseOptions({
      model: actions(
        { action: 'dance' },
        { action: 'done', summary: 'stop' }
      ),
    })
  );

  assert.ok(codeOf(result, 'invalid_action'));
  assert.equal(result.outcome.status, 'STOPPED');
});

test('the step limit stops a model that never finishes', async () => {
  const model: DemoModel = {
    async next() {
      return { action: 'investigate', listingId: 'L-A' };
    },
  };

  const result = await runShopper(baseOptions({ model, maxSteps: 3 }));

  assert.equal(result.outcome.status, 'STEP_LIMIT');
  assert.equal(result.events.length, 3);
  assert.equal(result.modelCalls, 3);
});

test('a model step that exceeds 8 seconds is reported as a timeout', async () => {
  const model: DemoModel = {
    next() {
      return new Promise(() => undefined);
    },
  };

  const result = await runShopper(
    baseOptions({ model, stepTimeoutMs: 10 })
  );

  assert.equal(result.outcome.status, 'STEP_TIMEOUT');
});

test('the total demo time budget stops the run', async () => {
  let time = 0;
  const now = (): number => {
    time += 50_000;
    return time;
  };

  const result = await runShopper(
    baseOptions({
      model: actions(
        { action: 'investigate', listingId: 'L-A' },
        { action: 'done', summary: 'stop' }
      ),
      totalTimeoutMs: 90_000,
      now,
    })
  );

  assert.equal(result.outcome.status, 'TIME_LIMIT');
  assert.equal(result.events.length, 1);
});

test('running the same replay twice produces the same result', async () => {
  const first = await runShopper(baseOptions());
  const second = await runShopper(baseOptions());

  assert.deepEqual(first, second);
});

test('marketplace falls back to the fixture when the API is unavailable', async () => {
  const result = await loadMarketplace({
    apiUrl: 'http://127.0.0.1:1',
    fixture,
    timeoutMs: 50,
  });

  assert.equal(result.source, 'fixture');
  assert.equal(result.fallbackReason, 'marketplace_unavailable');
  assert.equal(result.listings.length, 3);
});

test('marketplace uses the API when it returns valid listings', async () => {
  const fakeFetch = (async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        success: true,
        data: {
          listings: fixture.listings,
          marketContext: { medianPrice: 111, offerCount: 7, currency: 'USD' },
        },
      }),
  })) as unknown as typeof fetch;

  const result = await loadMarketplace({
    apiUrl: 'https://guardian.example',
    fixture,
    fetchImpl: fakeFetch,
  });

  assert.equal(result.source, 'api');
  assert.equal(result.marketContext.medianPrice, 111);
  assert.equal(result.marketContext.offerCount, 7);
});

test('market context falls back to the recorded median of 120 from 9 offers', async () => {
  const result = await loadMarketContext({
    fixture: fixture.marketContext,
    query: fixture.goal,
  });

  assert.equal(result.source, 'fixture');
  assert.deepEqual(result.context, {
    medianPrice: 120,
    offerCount: 9,
    currency: 'USD',
  });
});

test('the MCP guardian client maps investigate, create and finalize correctly', async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  const caller: ToolCaller = {
    async callTool(params) {
      calls.push(params);
      if (params.name === 'investigate_merchant') {
        return {
          content: [{ type: 'text', text: 'allow' }],
          structuredContent: {
            verdict: { decision: 'ALLOW', score: 8, summary: 'matches' },
          },
        };
      }
      if (params.arguments.phase === 'create') {
        return {
          content: [{ type: 'text', text: 'held' }],
          structuredContent: {
            checkout: {
              checkoutId: 'chk-1',
              status: 'AWAITING_APPROVAL',
              approvalUrl: 'https://approval.example/1',
            },
          },
        };
      }
      return {
        content: [{ type: 'text', text: 'captured' }],
        structuredContent: {
          result: { status: 'CAPTURED', captureId: 'CAP-1' },
        },
      };
    },
  };

  const client = createMcpGuardianClient(caller, { agentId: 'demo-test' });
  const listing = fixture.listings[0];

  assert.equal((await client.investigate(listing)).decision, 'ALLOW');
  assert.equal((await client.startCheckout(listing)).checkoutId, 'chk-1');
  assert.equal(
    (
      await client.finalizeCheckout('chk-1', {
        humanDecision: 'proceed',
        approvedByHuman: true,
      })
    ).status,
    'CAPTURED'
  );

  assert.equal(calls[0].name, 'investigate_merchant');
  assert.equal(calls[0].arguments.agentId, 'demo-test');
  assert.equal(calls[0].arguments.merchantUrl, listing.url);
  assert.equal(calls[1].name, 'safe_checkout');
  assert.equal(calls[1].arguments.phase, 'create');
  assert.equal(calls[2].arguments.phase, 'finalize');

  await assert.rejects(
    () =>
      client.finalizeCheckout('chk-1', {
        humanDecision: 'proceed',
        approvedByHuman: false,
      }),
    /approval/
  );
});

test('replay mode uses a separate unchecked script when the guardian is off', () => {
  const off = replayActions(fixture, 'off');
  const on = replayActions(fixture, 'on');

  assert.equal((off[0] as { action?: string }).action, 'pay_unchecked');
  assert.equal((on[0] as { action?: string }).action, 'investigate');
});

test('the CLI parser validates its options', () => {
  const options = parseArgs([
    '--scenario',
    'd',
    '--guardian',
    'off',
    '--budget',
    '200',
    '--llm',
    'replay',
    '--auto-human',
    'yes',
  ]);

  assert.equal(options.scenario, 'D');
  assert.equal(options.guardian, 'off');
  assert.equal(options.budget, 200);
  assert.equal(options.llm, 'replay');
  assert.equal(options.autoHuman, 'yes');
  assert.throws(() => parseArgs(['--guardian', 'maybe']), /on or off/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['--budget', '-1']), /positive/);
});

function runCli(args: string[], cwd: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'apps/mcp/demo-agent/index.ts', ...args],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the CLI replay exits cleanly and writes a CAPTURED run log', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'guardian-demo-'));
  const outPath = join(directory, 'run.json');

  try {
    const result = await runCli(
      [
        '--scenario',
        'D',
        '--guardian',
        'on',
        '--llm',
        'replay',
        '--auto-human',
        'yes',
        '--out',
        outPath,
      ],
      repoRoot
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Demo result: CAPTURED on L-A/);

    const log = JSON.parse(readFileSync(outPath, 'utf8')) as {
      outcome: { status: string; listingId: string };
      mode: { llm: string; guardian: string };
      events: Array<{ code?: string }>;
    };

    assert.equal(log.outcome.status, 'CAPTURED');
    assert.equal(log.outcome.listingId, 'L-A');
    assert.equal(log.mode.llm, 'replay');
    assert.equal(log.mode.guardian, 'on');
    assert.ok(log.events.some((event) => event.code === 'guardian_paused'));
    assert.ok(log.events.some((event) => event.code === 'over_budget'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('parseModelJson strips prose around a JSON object', () => {
  assert.deepEqual(parseModelJson('here: {"action":"done","summary":"ok"} thanks'), {
    action: 'done',
    summary: 'ok',
  });
  assert.throws(() => parseModelJson('no object here'));
});
