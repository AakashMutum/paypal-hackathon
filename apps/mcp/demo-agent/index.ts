import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  loadMarketContext,
  loadMarketplace,
  loadScenarioFixture,
  type ScenarioFixture,
} from './marketplace.js';
import {
  createFixtureGuardianClient,
  createHttpModel,
  createMcpGuardianClient,
  createRecordingModel,
  createReplayModel,
  createUnguardedPayClient,
  runShopper,
  type GuardianClient,
  type HumanPrompt,
  type ShopperResult,
  type ToolCaller,
  type ToolResultLike,
} from './shopper.js';
import { runScriptedShopper, summarizeScripted } from './scripted.js';

const DEMO_AGENT_NAME = 'checkout-guardian-demo-shopper';
const DEFAULT_API_URL = 'http://localhost:3000';
// The canonical demo stores sell a weekender bag and a jacket, so live and scripted runs shop for a bag.
const CANONICAL_GOAL = 'Buy one canvas weekender bag for under $100.';
const CANONICAL_BUDGET = 100;
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface CliOptions {
  scenario: string;
  goal?: string;
  budget?: number;
  guardian: 'on' | 'off';
  autoHuman: 'ask' | 'yes' | 'no';
  /** auto picks live when LLM_API_KEY is set and none (a scripted shopper) otherwise. */
  llm: 'auto' | 'live' | 'record' | 'replay' | 'none';
  maxSteps?: number;
  out?: string;
  help: boolean;
}

export interface CliResult {
  result: ShopperResult;
  logPath: string;
}

export const USAGE = [
  'Usage: npm run demo:agent -- [options]',
  '',
  'Options:',
  '  --scenario <D>            Recorded demo scenario (default: D)',
  '  --goal <text>             Override the shopping goal',
  '  --budget <number>         Override the budget (default: 150)',
  '  --guardian <on|off>       Use Checkout Guardian (default: on)',
  '  --auto-human <ask|yes|no> Human decision mode (default: ask)',
  '  --llm <auto|live|record|replay|none> Model mode (default: auto: live with LLM_API_KEY, else a scripted shopper)',
  '  --max-steps <number>      Maximum agent steps (default: 10)',
  '  --out <path>              Run log path (default: demo-runs/<timestamp>.json)',
  '  --help                    Show this help',
].join('\n');

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function replayActions(
  scenario: ScenarioFixture,
  guardian: 'on' | 'off'
): unknown[] {
  if (guardian === 'on') return scenario.actions;

  return (
    scenario.guardianOffActions ?? [
      {
        action: 'pay_unchecked',
        listingId: scenario.listings[0]?.id ?? 'L-A',
        why: 'guardian is off',
      },
    ]
  );
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scenario: 'D',
    guardian: 'on',
    autoHuman: 'ask',
    llm: 'auto',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inline] = raw.split('=', 2);
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      index += 1;
      return readValue(argv, index - 1, flag);
    };

    switch (flag) {
      case '--scenario':
        options.scenario = takeValue().toUpperCase();
        break;
      case '--goal':
        options.goal = takeValue();
        break;
      case '--budget': {
        const value = Number(takeValue());
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error('--budget must be a positive number');
        }
        options.budget = value;
        break;
      }
      case '--guardian': {
        const value = takeValue();
        if (value !== 'on' && value !== 'off') {
          throw new Error('--guardian must be on or off');
        }
        options.guardian = value;
        break;
      }
      case '--auto-human': {
        const value = takeValue();
        if (value !== 'ask' && value !== 'yes' && value !== 'no') {
          throw new Error('--auto-human must be ask, yes or no');
        }
        options.autoHuman = value;
        break;
      }
      case '--llm': {
        const value = takeValue();
        if (value !== 'auto' && value !== 'live' && value !== 'record' && value !== 'replay' && value !== 'none') {
          throw new Error('--llm must be auto, live, record, replay or none');
        }
        options.llm = value;
        break;
      }
      case '--max-steps': {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 1 || value > 50) {
          throw new Error('--max-steps must be an integer between 1 and 50');
        }
        options.maxSteps = value;
        break;
      }
      case '--out':
        options.out = takeValue();
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

async function connectMcp(env: Record<string, string | undefined>): Promise<{
  caller: ToolCaller;
  close(): Promise<void>;
}> {
  const command = env.GUARDIAN_MCP_COMMAND;
  const transport = new StdioClientTransport({
    command: command ?? process.execPath,
    args: command ? [] : ['--import', 'tsx', join(repoRoot, 'apps/mcp/src/index.ts')],
    cwd: repoRoot,
    env: cleanEnv(env),
    stderr: 'inherit',
  });

  const client = new Client({ name: DEMO_AGENT_NAME, version: '1.0.0' });
  await client.connect(transport);

  return {
    caller: {
      callTool: (params) =>
        client.callTool(params) as unknown as Promise<ToolResultLike>,
    },
    close: () => client.close(),
  };
}

function createHumanPrompt(): { prompt: HumanPrompt; close(): void } {
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  return {
    prompt: async (question) => {
      const label =
        question.kind === 'warn'
          ? `Guardian returned WARN for ${question.title ?? question.listingId ?? 'this listing'} (${question.amount ?? '?'} ${question.currency ?? ''}). Type yes to proceed: `
          : question.kind === 'proceed'
            ? `Press Enter to authorize payment of ${question.amount ?? '?'} ${question.currency ?? ''} for ${question.listingId ?? 'this listing'}, or type no: `
            : `${question.question ?? 'Confirm?'} Type yes to confirm: `;

      const answer = (await readline.question(label)).trim().toLowerCase();
      if (question.kind === 'proceed') {
        return answer === '' || answer === 'yes' || answer === 'y';
      }
      return answer === 'yes' || answer === 'y';
    },
    close: () => readline.close(),
  };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): Promise<CliResult> {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(USAGE);
    return {
      result: {
        scenario: options.scenario,
        goal: '',
        budget: 0,
        currency: 'USD',
        guardian: options.guardian,
        marketplaceSource: 'fixture',
        contextSource: 'fixture',
        events: [],
        outcome: { status: 'STOPPED', spent: 0, reason: 'help' },
        modelCalls: 0,
      },
      logPath: '',
    };
  }

  if (options.llm === 'auto') options.llm = env.LLM_API_KEY?.trim() ? 'live' : 'none';

  const fixture = loadScenarioFixture();
  if (options.scenario !== fixture.scenario) {
    throw new Error(
      `Unknown scenario "${options.scenario}". Only scenario ${fixture.scenario} is recorded.`
    );
  }

  const offline = options.llm === 'replay';
  const scenario: ScenarioFixture = {
    ...fixture,
    goal: options.goal ?? (offline ? fixture.goal : CANONICAL_GOAL),
  };

  if (options.llm === 'none') return runScripted(options, env, fixture, scenario);

  const marketplace = await loadMarketplace({
    fixture,
    apiUrl: offline ? undefined : (env.GUARDIAN_API_URL ?? DEFAULT_API_URL),
    timeoutMs: 2_000,
  });

  const marketContext =
    options.llm === 'replay'
      ? { context: fixture.marketContext, source: 'fixture' as const }
      : await loadMarketContext({
          fixture: marketplace.marketContext,
          query: scenario.goal,
          apiKey: env.CHANNEL3_API_KEY,
          baseUrl: env.CHANNEL3_BASE_URL,
          timeoutMs: 4_000,
        });

  marketplace.marketContext = marketContext.context;
  marketplace.contextSource = marketContext.source;

  const recordedActions: unknown[] = [];
  let model;

  if (options.llm === 'replay') {
    model = createReplayModel(replayActions(fixture, options.guardian));
  } else {
    const baseUrl = env.LLM_BASE_URL;
    const modelName = env.LLM_MODEL_STRONG ?? env.LLM_MODEL_FAST;
    if (!baseUrl || !modelName) {
      throw new Error('LLM_BASE_URL and LLM_MODEL_STRONG are required for live or record mode');
    }

    const liveModel = createHttpModel({
      baseUrl,
      apiKey: env.LLM_API_KEY,
      model: modelName,
      timeoutMs: 8_000,
    });
    model =
      options.llm === 'record'
        ? createRecordingModel(liveModel, recordedActions)
        : liveModel;
  }

  let guardian: GuardianClient | undefined;
  let mcpClose: (() => Promise<void>) | undefined;

  if (options.guardian === 'on') {
    if (options.llm === 'replay') {
      guardian = createFixtureGuardianClient(fixture.guardianVerdicts);
    } else {
      const mcp = await connectMcp(env);
      guardian = createMcpGuardianClient(mcp.caller);
      mcpClose = mcp.close;
    }
  }

  const human =
    options.autoHuman === 'ask' ? createHumanPrompt() : undefined;

  try {
    const result = await runShopper({
      scenario,
      marketplace,
      model,
      guardian,
      unguardedPay: createUnguardedPayClient({
        apiUrl: options.llm === 'replay' ? undefined : env.GUARDIAN_API_URL,
      }),
      guardianMode: options.guardian,
      budget: options.budget ?? (offline ? fixture.budget : CANONICAL_BUDGET),
      autoHuman: options.autoHuman,
      humanPrompt: human?.prompt,
      maxSteps: options.maxSteps,
    });

    const logPath = options.out
      ? resolve(options.out)
      : resolve(repoRoot, 'demo-runs', `${timestampSlug()}.json`);

    const log = {
      ...result,
      mode: { llm: options.llm, guardian: options.guardian },
      createdAt: new Date().toISOString(),
      brandNotice: 'All merchant and brand names in this demo are fictional.',
      ...(recordedActions.length > 0 ? { recordedActions } : {}),
    };

    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`, 'utf8');

    for (const event of result.events) {
      const outcome = event.accepted ? 'accepted' : 'rejected';
      const code = event.code ? ` (${event.code})` : '';
      console.log(
        `[${event.step}] ${event.action}${event.listingId ? ` ${event.listingId}` : ''} -> ${outcome}${code}`
      );
    }

    const spent = result.outcome.spent.toFixed(2).replace(/\.00$/, '');
    console.log(
      `Demo result: ${result.outcome.status}${result.outcome.listingId ? ` on ${result.outcome.listingId}` : ''} (spent ${spent} ${result.currency})`
    );
    console.log(`Log: ${logPath}`);

    return { result, logPath };
  } finally {
    human?.close();
    await mcpClose?.();
  }
}

async function runScripted(
  options: CliOptions,
  env: Record<string, string | undefined>,
  fixture: ScenarioFixture,
  scenario: ScenarioFixture
): Promise<CliResult> {
  const apiUrl = env.GUARDIAN_API_URL ?? DEFAULT_API_URL;
  const marketplace = await loadMarketplace({ fixture, apiUrl, timeoutMs: 3_000 });
  if (marketplace.source !== 'api') {
    throw new Error(`The Guardian API at ${apiUrl} is not reachable. Start it with "npm start" (after "npm run build"), or set GUARDIAN_API_URL.`);
  }

  const budget = options.budget ?? CANONICAL_BUDGET;
  const mcp = await connectMcp({ ...env, GUARDIAN_API_URL: apiUrl });
  const human = options.autoHuman === 'ask' ? createHumanPrompt() : undefined;

  try {
    console.log('Checkout Guardian demo: scripted shopper (no language model)');
    console.log(`Goal: ${scenario.goal} Budget: ${budget} ${scenario.currency}`);
    console.log(`API: ${apiUrl}. Stores are fictional.`);

    const policy = { perOrderCap: budget, dailyCap: budget * 3, firstPurchaseCap: budget, currency: scenario.currency };
    const policyResult = await mcp.caller.callTool({ name: 'set_spend_policy', arguments: { agentId: 'demo-shopper', ...policy } });
    console.log(policyResult.isError ? 'Spend policy could not be saved.' : `Spend policy saved: up to ${budget} per order, ${budget * 3} per day.`);

    const results = await runScriptedShopper({
      listings: marketplace.listings,
      guardian: createMcpGuardianClient(mcp.caller),
      budget,
      autoHuman: options.autoHuman,
      humanPrompt: human?.prompt,
    });

    console.log('');
    console.log('Summary');
    for (const line of summarizeScripted(results)) console.log(`  ${line}`);

    const logPath = options.out ? resolve(options.out) : resolve(repoRoot, 'demo-runs', `${timestampSlug()}.json`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(
      logPath,
      `${JSON.stringify({ mode: { llm: 'none', guardian: 'on' }, apiUrl, goal: scenario.goal, budget, results, createdAt: new Date().toISOString(), brandNotice: 'All merchant and brand names in this demo are fictional.' }, null, 2)}
`,
      'utf8'
    );
    console.log(`Log: ${logPath}`);

    const spent = results.filter((r) => r.action === 'PAID' || r.action === 'HUMAN_PROCEEDED').length;
    return {
      result: {
        scenario: options.scenario,
        goal: scenario.goal,
        budget,
        currency: scenario.currency,
        guardian: 'on',
        marketplaceSource: 'api',
        contextSource: 'fixture',
        events: [],
        outcome: { status: spent > 0 ? 'CAPTURED' : 'STOPPED', spent: 0, reason: 'scripted' },
        modelCalls: 0,
      },
      logPath,
    };
  } finally {
    human?.close();
    await mcp.close();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${DEMO_AGENT_NAME}] ${message}`);
    process.exitCode = 1;
  });
}
