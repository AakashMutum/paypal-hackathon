import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHttpProvider,
  createJsonClient,
  withRecordReplay,
  type AgentDeps,
  type CallOpts,
  type LlmClient,
  type MemoryDocument,
  type MemoryHit,
  type MemoryPort,
  type MemoryQuery,
  type RegistryLookup,
  type RegistryPort,
  type RegistryRecord,
  type SignalsPort,
} from '@checkout-guardian/agent';
import { createLiveClientsFromEnv, createLocalSignalsPort } from '@checkout-guardian/signals';
import {
  ElasticPatternStore,
  asAgentMemoryPort,
  createPatternStore,
  loadSeeds,
  type PatternStore,
} from '@checkout-guardian/memory';
import { loadStoreCatalog, sameSite } from '../../config/storeCatalog.js';
import { registryLookup } from '../registry/registry.service.js';

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

export type SignalsMode = 'replay' | 'live' | 'auto';
export type LlmMode = 'live' | 'replay' | 'record' | 'none';

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  return v === '' || v.startsWith('your_') || v.includes('.example') || v === 'your_llm_api_key';
}

export function signalsMode(env: NodeJS.ProcessEnv = process.env): SignalsMode {
  const raw = env.SIGNALS_MODE?.trim().toLowerCase();
  // The agent's own SIGNALS_MODE values (fixture, live) map onto replay and live.
  if (raw === 'live') return 'live';
  if (raw === 'auto') return 'auto';
  return 'replay';
}

export function llmMode(env: NodeJS.ProcessEnv = process.env): LlmMode {
  const raw = env.LLM_MODE?.trim().toLowerCase();
  const hasKey = Boolean(env.LLM_API_KEY?.trim()) && !isPlaceholder(env.LLM_API_KEY);
  if (raw === 'none') return 'none';
  if (raw === 'replay') return 'replay';
  if (raw === 'record' || raw === 'live') {
    if (!hasKey) {
      console.warn(`[agent] LLM_MODE=${raw} needs LLM_API_KEY. The language model is off; deterministic fallbacks are used.`);
      return 'none';
    }
    return raw;
  }
  return 'none';
}

export function isCanonicalDomain(domainOrUrl: string): boolean {
  return loadStoreCatalog().some((s) => sameSite(s.domain, domainOrUrl));
}

// ---------------------------------------------------------------------------------------------
// Repository paths
// ---------------------------------------------------------------------------------------------

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'packages', 'agent', 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function llmRecordingsDir(): string {
  const configured = process.env.LLM_FIXTURE_DIR?.trim();
  return configured ? resolve(configured) : join(findRepoRoot(), 'packages', 'agent', 'fixtures', 'llm');
}

// ---------------------------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------------------------

let signalsPort: SignalsPort | undefined;

export function getSignalsPort(): SignalsPort {
  if (signalsPort) return signalsPort;
  const mode = signalsMode();
  const knownBrandDomains = loadStoreCatalog()
    .filter((s) => s.kind === 'genuine')
    .map((s) => s.domain.replace(/^www\./, ''));
  const replay = createLocalSignalsPort({ mode: 'mock' });
  const live = (): SignalsPort => {
    const clients = createLiveClientsFromEnv(process.env);
    return createLocalSignalsPort({ mode: 'live', knownBrandDomains, ...clients });
  };

  if (mode === 'replay') {
    signalsPort = replay;
  } else if (mode === 'live') {
    signalsPort = live();
  } else {
    // auto: recorded signals for the canonical stores, live signals for any other domain.
    const liveSignals = live();
    const pick = (target: string): SignalsPort => (isCanonicalDomain(target) ? replay : liveSignals);
    signalsPort = {
      getPageClaims: (url, o) => pick(url).getPageClaims(url, o),
      getDomainReport: (domain, o) => pick(domain).getDomainReport(domain, o),
      getPriceReport: (input, o) => pick(input.claims.domain).getPriceReport(input, o),
      checkPayeeBinding: (input, o) => pick(input.domain).checkPayeeBinding(input, o),
      fetchPageSection: (input, o) => pick(input.baseUrl).fetchPageSection(input, o),
      compareOffers: (input, o) => replay.compareOffers(input, o),
    };
  }
  return signalsPort;
}

// ---------------------------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------------------------

let llmClient: LlmClient | undefined | null = null;

/** The model client for the current LLM_MODE, or undefined for the deterministic fallbacks. */
export function getLlmClient(): LlmClient | undefined {
  if (llmClient !== null) return llmClient;
  const mode = llmMode();
  if (mode === 'none') {
    llmClient = undefined;
    return llmClient;
  }
  const log = (event: Record<string, unknown>): void => {
    console.info(`[llm] ${String(event.evt ?? 'event')}`);
  };
  const apiKey = process.env.LLM_API_KEY?.trim() ?? '';
  const inner: LlmClient = apiKey
    ? createJsonClient(
        createHttpProvider({
          apiKey,
          baseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
          models: {
            fast: process.env.LLM_MODEL_FAST?.trim() || 'gpt-4o-mini',
            strong: process.env.LLM_MODEL_STRONG?.trim() || 'gpt-4o-mini',
          },
        }),
        { log },
      )
    : { generateJson: async () => ({ ok: false as const, error: 'provider' as const, detail: 'no key', latencyMs: 0 }) };
  llmClient = mode === 'live' ? inner : withRecordReplay(inner, { mode, dir: llmRecordingsDir(), log });
  return llmClient;
}

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

let patternStore: Promise<PatternStore> | undefined;

export function getPatternStore(): Promise<PatternStore> {
  patternStore ??= (async () => {
    const env = { ...process.env };
    if (isPlaceholder(env.ELASTIC_URL) || isPlaceholder(env.ELASTIC_API_KEY)) {
      delete env.ELASTIC_URL;
      delete env.ELASTIC_API_KEY;
    }
    const store = await createPatternStore({ env });
    if (store instanceof ElasticPatternStore) {
      // The in-memory store loads its seeds itself; Elasticsearch gets them once, when empty.
      await store.ensureIndex();
      if ((await store.size()) === 0) await loadSeeds(store);
    }
    return store;
  })();
  return patternStore;
}

export async function memoryMode(): Promise<'elastic' | 'memory'> {
  return (await getPatternStore()) instanceof ElasticPatternStore ? 'elastic' : 'memory';
}

export interface MemoryRecorder {
  port: MemoryPort;
  /** Hits returned by the agent's own memory search during this run. */
  hits: MemoryHit[];
  searched: boolean;
}

/**
 * A memory port for one investigation. It records the hits the agent saw, so they can be shown
 * as similar cases without searching twice. Canonical demo stores are read but not written:
 * a stored WARN or PAUSE would make the same store look "flagged before" and change its score
 * on the next run.
 */
export async function createMemoryRecorder(): Promise<MemoryRecorder> {
  const inner = asAgentMemoryPort(await getPatternStore());
  const recorder: MemoryRecorder = {
    hits: [],
    searched: false,
    port: {
      async search(query: MemoryQuery, options: CallOpts): Promise<MemoryHit[]> {
        const hits = await inner.search(query, options);
        recorder.hits = hits;
        recorder.searched = true;
        return hits;
      },
      async write(document: MemoryDocument, options: CallOpts): Promise<void> {
        if (isCanonicalDomain(document.registrableDomain)) {
          console.info('[memory] a canonical demo store is not written to memory');
          return;
        }
        await inner.write(document, options);
      },
    },
  };
  return recorder;
}

export async function searchMemory(query: MemoryQuery, options: CallOpts): Promise<MemoryHit[]> {
  return asAgentMemoryPort(await getPatternStore()).search(query, options);
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

export const registryPort: RegistryPort = {
  async lookup(input: RegistryLookup, _options: CallOpts): Promise<RegistryRecord[]> {
    const rows = await registryLookup(input.by, input.query);
    return rows.map((m) => ({
      merchantId: m.merchantId,
      legalName: m.legalName,
      brandNames: m.brandNames,
      domain: m.domain,
      status: m.status,
      linkedBrandIds: [],
    }));
  },
};

export interface AgentWiring {
  deps: AgentDeps;
  recorder: MemoryRecorder;
}

export async function createAgentWiring(): Promise<AgentWiring> {
  const recorder = await createMemoryRecorder();
  const llm = getLlmClient();
  return {
    recorder,
    deps: {
      signals: getSignalsPort(),
      registry: registryPort,
      memory: recorder.port,
      ...(llm ? { llm } : {}),
      now: () => Date.now(),
      log: () => undefined,
    },
  };
}

/** For tests: forget cached ports after changing environment variables. */
export function resetAgentPorts(): void {
  signalsPort = undefined;
  llmClient = null;
  patternStore = undefined;
}
