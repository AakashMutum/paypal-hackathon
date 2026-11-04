import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHttpProvider,
  createJsonClient,
  withRecordReplay,
  type AgentDeps,
  type CallOpts,
  type Evidence,
  type LlmClient,
  type MemoryDocument,
  type MemoryHit,
  type MemoryPort,
  type MemoryQuery,
  type PageClaims,
  type RegistryLookup,
  type RegistryPort,
  type RegistryRecord,
  type SignalsPort,
} from '@checkout-guardian/agent';
import {
  createLiveClientsFromEnv,
  createLocalSignalsPort,
  marketplaceBrandDomains,
  recognizeMarketplace,
  type KernelClientDeps,
  type LocalSignalsPortOptions,
} from '@checkout-guardian/signals';
import {
  ElasticPatternStore,
  FilePatternStore,
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

export function signalsMode(env: NodeJS.ProcessEnv = process.env): SignalsMode {
  const raw = env.SIGNALS_MODE?.trim().toLowerCase();
  // The agent's own SIGNALS_MODE values (fixture, live) map onto replay and live.
  if (raw === 'live') return 'live';
  if (raw === 'replay' || raw === 'mock' || raw === 'fixture') return 'replay';
  // Default: recorded signals for the canonical demo stores, live signals for any other domain.
  // Replay-only was the default before, which silently produced empty evidence for real stores.
  return 'auto';
}

type LlmKeySource = 'LLM_API_KEY' | 'GEMINI_API_KEY' | 'none';

function llmApiKey(env: NodeJS.ProcessEnv): { key: string; source: LlmKeySource } {
  for (const name of ['LLM_API_KEY', 'GEMINI_API_KEY'] as const) {
    const value = env[name]?.trim();
    if (value) return { key: value, source: name };
  }
  return { key: '', source: 'none' };
}

export function llmMode(env: NodeJS.ProcessEnv = process.env): LlmMode {
  const raw = env.LLM_MODE?.trim().toLowerCase();
  const hasKey = llmApiKey(env).key.length > 0;
  if (raw === 'none') return 'none';
  if (raw === 'mock' || raw === 'replay') return 'replay';
  if (raw === 'record' || raw === 'live') {
    if (!hasKey) {
      console.error(`[agent] LLM_MODE=${raw} needs LLM_API_KEY or GEMINI_API_KEY. The language model is off; deterministic fallbacks are used.`);
      return 'none';
    }
    return raw;
  }
  return hasKey ? 'live' : 'none';
}

export interface LlmInfo {
  mode: LlmMode;
  provider: string;
  baseUrl: string;
  keySource: LlmKeySource;
  models: { fast: string[]; strong: string[] };
  error?: string;
}

function isGeminiProvider(env: NodeJS.ProcessEnv): boolean {
  const provider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const base = (env.LLM_BASE_URL ?? '').toLowerCase();
  return provider.includes('gemini') || provider.includes('google') || base.includes('generativelanguage.googleapis.com');
}

function llmModelsForTier(env: NodeJS.ProcessEnv, tier: 'fast' | 'strong'): string[] {
  const configured =
    (tier === 'fast' ? env.LLM_MODEL_FAST : env.LLM_MODEL_STRONG)?.trim() ||
    env.LLM_MODEL_FAST?.trim() ||
    env.LLM_MODEL_STRONG?.trim() ||
    (isGeminiProvider(env) ? 'gemini-3.5-flash' : 'gpt-4o-mini');

  if (!isGeminiProvider(env)) return [configured];

  // The configured model first, then known-good Gemini models. A 404/503 on
  // one model falls through to the next instead of silently disabling the LLM.
  return [...new Set([configured, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'])];
}

export function llmInfo(env: NodeJS.ProcessEnv = process.env): LlmInfo {
  const mode = llmMode(env);
  const apiKey = llmApiKey(env);
  const provider = (env.LLM_PROVIDER?.trim() || (isGeminiProvider(env) ? 'gemini' : 'openai-compatible')).toLowerCase();
  const baseUrl = env.LLM_BASE_URL?.trim() || (isGeminiProvider(env) ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : 'https://api.openai.com/v1');
  const info: LlmInfo = {
    mode,
    provider,
    baseUrl,
    keySource: apiKey.source,
    models: { fast: llmModelsForTier(env, 'fast'), strong: llmModelsForTier(env, 'strong') },
  };
  if (mode === 'none' && (env.LLM_MODE?.trim().toLowerCase() === 'live' || env.LLM_MODE?.trim().toLowerCase() === 'record') && !apiKey.key) {
    info.error = 'LLM_MODE=live requires LLM_API_KEY or GEMINI_API_KEY';
  }
  return info;
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
let customSignalsFetch: typeof fetch | null = null;
let customKernelDeps: KernelClientDeps | null = null;
let customSignalsLookup: NonNullable<LocalSignalsPortOptions['lookupImpl']> | null = null;
let customSignalsTlsProbe: NonNullable<LocalSignalsPortOptions['tlsProbe']> | null = null;

export function setCustomSignalsClients(options: {
  fetchImpl?: typeof fetch | null;
  kernelDeps?: KernelClientDeps | null;
  lookupImpl?: LocalSignalsPortOptions['lookupImpl'] | null;
  tlsProbe?: LocalSignalsPortOptions['tlsProbe'] | null;
}): void {
  if (options.fetchImpl !== undefined) customSignalsFetch = options.fetchImpl;
  if (options.kernelDeps !== undefined) customKernelDeps = options.kernelDeps;
  if (options.lookupImpl !== undefined) customSignalsLookup = options.lookupImpl;
  if (options.tlsProbe !== undefined) customSignalsTlsProbe = options.tlsProbe;
  signalsPort = undefined;
}

/**
 * A replay-mode port for a domain with no recording. It says that signals were not collected
 * instead of returning empty arrays that look like a successful scan with no evidence.
 */
function replayUnavailablePort(): SignalsPort {
  const emptyClaims = (url: string): PageClaims => {
    let domain = '';
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      domain = '';
    }
    const marketplace = domain ? recognizeMarketplace(domain) : undefined;
    return {
      finalUrl: url,
      domain,
      contacts: { emails: [], phones: [] },
      linkedDomains: [],
      visibleText: '',
      hiddenText: '',
      sectionLinks: {},
      hasContactPage: false,
      hasLegalPage: false,
      pageAccess: { state: 'unsupported', reason: 'replay_mode' },
      ...(marketplace ? { marketplace } : {}),
    };
  };

  const priceUnknown: Evidence = {
    id: 'EVD-SIG-PRICE_UNKNOWN-REPLAY',
    type: 'PRICE_UNKNOWN',
    severity: 'info',
    confidence: 0.8,
    summary: 'Price signals are unavailable because the API is replaying recorded signals.',
    source: 'channel3',
    deterministic: true,
    data: { reason: 'replay_mode' },
  };

  return {
    async getPageClaims(url) {
      return emptyClaims(url);
    },
    async getDomainReport() {
      return [];
    },
    async getPriceReport() {
      return [priceUnknown];
    },
    async checkPayeeBinding() {
      return [];
    },
    async fetchPageSection() {
      return { found: false };
    },
    async compareOffers() {
      return { offerCount: 0, sampleDomains: [] };
    },
  };
}

function selectSignalsPort(replay: SignalsPort, liveSignals: SignalsPort): SignalsPort {
  const pick = (target: string): SignalsPort => (isCanonicalDomain(target) ? replay : liveSignals);
  return {
    getPageClaims: (url, o) => pick(url).getPageClaims(url, o),
    getDomainReport: (domain, o) => pick(domain).getDomainReport(domain, o),
    getPriceReport: (input, o) => pick(input.claims.domain).getPriceReport(input, o),
    checkPayeeBinding: (input, o) => pick(input.domain).checkPayeeBinding(input, o),
    fetchPageSection: (input, o) => pick(input.baseUrl).fetchPageSection(input, o),
    compareOffers: (input, o) => replay.compareOffers(input, o),
  };
}

export function getSignalsPort(): SignalsPort {
  if (signalsPort) return signalsPort;
  const mode = signalsMode();
  const knownBrandDomains = [
    ...loadStoreCatalog()
      .filter((s) => s.kind === 'genuine')
      .map((s) => s.domain.replace(/^www\./, '')),
    // Official marketplace domains are protected by the lookalike check. Recognition never
    // clears a store; it only stops the official domain being flagged as an imitation of itself.
    ...marketplaceBrandDomains(),
  ];
  const replay = createLocalSignalsPort({ mode: 'mock' });
  const live = (): SignalsPort => {
    const clients = createLiveClientsFromEnv(process.env, {
      fetchImpl: customSignalsFetch ?? undefined,
      kernelDeps: customKernelDeps ?? undefined,
    });
    return createLocalSignalsPort({
      mode: 'live',
      knownBrandDomains,
      validateSectionPages: process.env.VALIDATE_SECTION_PAGES !== 'false',
      ...clients,
      // Page and RDAP fetches use this client too, not only the Kernel and Channel3 adapters.
      ...(customSignalsFetch ? { fetchImpl: customSignalsFetch } : {}),
      ...(customSignalsLookup ? { lookupImpl: customSignalsLookup } : {}),
      ...(customSignalsTlsProbe ? { tlsProbe: customSignalsTlsProbe } : {}),
    });
  };

  if (mode === 'replay') {
    const unavailable = replayUnavailablePort();
    const pick = (target: string): SignalsPort => (isCanonicalDomain(target) ? replay : unavailable);
    signalsPort = {
      getPageClaims: (url, o) => pick(url).getPageClaims(url, o),
      getDomainReport: (domain, o) => pick(domain).getDomainReport(domain, o),
      getPriceReport: (input, o) => pick(input.claims.domain).getPriceReport(input, o),
      checkPayeeBinding: (input, o) => pick(input.domain).checkPayeeBinding(input, o),
      fetchPageSection: (input, o) => pick(input.baseUrl).fetchPageSection(input, o),
      compareOffers: (input, o) => replay.compareOffers(input, o),
    };
  } else if (mode === 'live') {
    signalsPort = live();
  } else {
    // auto: recorded signals for the canonical stores, live signals for any other domain.
    signalsPort = selectSignalsPort(replay, live());
  }
  return signalsPort;
}

// ---------------------------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------------------------

let llmClient: LlmClient | undefined | null = null;
let customLlmFetch: typeof fetch | null = null;

export function setCustomLlmFetch(fn: typeof fetch | null): void {
  customLlmFetch = fn;
  llmClient = null;
}

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
  const { key: apiKey, source } = llmApiKey(process.env);
  if (!apiKey) {
    console.error('[agent] no LLM key is configured (LLM_API_KEY or GEMINI_API_KEY); using deterministic fallbacks');
    llmClient = undefined;
    return llmClient;
  }
  const info = llmInfo();
  console.info(`[agent] LLM provider=${info.provider} mode=${mode} key=${source} models=${JSON.stringify(info.models)}`);
  const inner: LlmClient = createJsonClient(
    createHttpProvider({
      apiKey,
      baseUrl: info.baseUrl,
      models: info.models,
      fetchImpl: customLlmFetch ?? undefined,
    }),
    { log },
  );
  llmClient = mode === 'live' ? inner : withRecordReplay(inner, { mode, dir: llmRecordingsDir(), log });
  return llmClient;
}

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

let patternStore: Promise<PatternStore> | undefined;
let customMemoryFetch: typeof fetch | null = null;

export function setCustomMemoryFetch(fn: typeof fetch | null): void {
  customMemoryFetch = fn;
  patternStore = undefined;
}

export function getPatternStore(): Promise<PatternStore> {
  patternStore ??= (async () => {
    try {
      const requested = process.env.MEMORY_MODE?.trim().toLowerCase();
      const inTest = Boolean(process.env.NODE_TEST_CONTEXT);
      // Tests default to an isolated in-memory store. A test that needs the file store sets
      // MEMORY_MODE=file and MEMORY_FILE to a temporary path.
      const useFile = requested === 'file' || (!inTest && requested !== 'memory' && requested !== 'elastic');
      const filePath = process.env.MEMORY_FILE?.trim() || join(process.cwd(), '.cache', 'trustora-memory.json');
      const store = await createPatternStore({
        env: process.env,
        fetchImpl: customMemoryFetch ?? undefined,
        ...(useFile ? { filePath } : {}),
        seed: true,
        log: (event) => console.info(`[memory] ${JSON.stringify(event)}`),
      });
      if (store instanceof ElasticPatternStore) {
        // The in-memory and file stores load their seeds themselves; Elastic gets them once, when empty.
        try {
          await store.ensureIndex();
          if ((await store.size()) === 0) await loadSeeds(store);
        } catch (err) {
          console.warn('[agentPorts] Elastic connection/indexing failed, falling back to in-memory store:', err);
          return await createPatternStore({ env: {}, seed: true });
        }
      }
      return store;
    } catch (err) {
      console.warn('[agentPorts] Failed to initialize pattern store from env, using in-memory fallback:', err);
      return await createPatternStore({ env: {}, seed: true });
    }
  })();
  return patternStore;
}

export interface MemoryInfo {
  mode: 'elastic' | 'file' | 'memory';
  persistent: boolean;
  embeddings: string;
  size: number;
  location?: string;
}

export async function memoryInfo(): Promise<MemoryInfo> {
  const store = await getPatternStore();
  let size = 0;
  try {
    size = await store.size();
  } catch {
    size = 0;
  }
  if (store instanceof FilePatternStore) {
    const info = store.embeddingInfo?.();
    const embeddings = info ? `${info.provider}${info.model ? `:${info.model}` : ''}` : 'none';
    return { mode: 'file', persistent: true, embeddings, size, location: store.filePath };
  }
  if (store instanceof ElasticPatternStore) {
    return { mode: 'elastic', persistent: true, embeddings: 'elastic-inference', size };
  }
  return { mode: 'memory', persistent: false, embeddings: 'lexical-overlap', size };
}

export async function memoryMode(): Promise<'elastic' | 'file' | 'memory'> {
  return (await memoryInfo()).mode;
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
  async lookup(input: RegistryLookup, options: CallOpts): Promise<RegistryRecord[]> {
    const rows = await registryLookup(input.by, input.query, {
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(customSignalsFetch ? { fetchImpl: customSignalsFetch } : {}),
    });
    return rows.map((m) => ({
      merchantId: m.merchantId,
      legalName: m.legalName,
      brandNames: m.brandNames,
      domain: m.domain,
      status: m.status,
      linkedBrandIds: [],
      ...(m.source ? { source: m.source } : {}),
      ...(m.fetchedAt ? { fetchedAt: m.fetchedAt } : {}),
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
  customLlmFetch = null;
  customSignalsFetch = null;
  customKernelDeps = null;
  customSignalsLookup = null;
  customSignalsTlsProbe = null;
  customMemoryFetch = null;
}
