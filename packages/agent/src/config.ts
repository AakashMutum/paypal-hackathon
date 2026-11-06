import { z } from 'zod';

/**
 * Environment driven configuration.
 *
 * Parsing is deliberately tolerant: every value has a default and nothing is
 * required at import time. Variables marked "live only" are validated by the
 * adapter that needs them (see `requireEnv`). That keeps unit tests and the
 * fixture/replay modes runnable with an empty environment.
 */

export interface LlmConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  modelFast: string;
  modelStrong: string;
  mode: 'live' | 'record' | 'replay';
  fixtureDir: string;
}

export interface SignalsConfig {
  mode: 'live' | 'fixture';
  baseUrl?: string;
  fixtureDir: string;
}

export interface ElasticConfig {
  url?: string;
  apiKey?: string;
  index: string;
  inferenceId?: string;
}

export interface GuardianConfig {
  apiUrl?: string;
  apiKey?: string;
}

export interface FeatureConfig {
  investigatorLoop: boolean;
  identityLlm: boolean;
  /** Model-assisted promotional and pressure language evidence. */
  promoLanguage: boolean;
  memory: boolean;
}

export interface InvestigatorAgentConfig {
  /** Spec name, mapped onto maxFollowUps. */
  maxToolCalls: number;
  maxFollowUps: number;
  timeoutMs: number;
  /**
   * Total time all model calls of one investigation may use (AGENT_MODEL_BUDGET_MS). After it,
   * remaining model steps are skipped and deterministic output is used. 0 means no limit.
   */
  modelBudgetMs: number;
  confidenceThreshold: number;
  memoryMatchMin: number;
  baselineCountsTowardCap: boolean;
  features: FeatureConfig;
  llm: LlmConfig;
  signals: SignalsConfig;
  elastic: ElasticConfig;
  guardian: GuardianConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const ConfigSchema = z.object({
  maxToolCalls: z.number().int().min(0).max(20),
  maxFollowUps: z.number().int().min(0).max(20),
  timeoutMs: z.number().int().min(1).max(120000),
  modelBudgetMs: z.number().int().min(0).max(120000),
  confidenceThreshold: z.number().min(0).max(1),
  memoryMatchMin: z.number().min(0).max(1),
  baselineCountsTowardCap: z.boolean(),
  features: z.object({
    investigatorLoop: z.boolean(),
    identityLlm: z.boolean(),
    promoLanguage: z.boolean(),
    memory: z.boolean(),
  }),
  llm: z.object({
    provider: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    modelFast: z.string().min(1),
    modelStrong: z.string().min(1),
    mode: z.enum(['live', 'record', 'replay']),
    fixtureDir: z.string().min(1),
  }),
  signals: z.object({
    mode: z.enum(['live', 'fixture']),
    baseUrl: z.string().url().optional(),
    fixtureDir: z.string().min(1),
  }),
  elastic: z.object({
    url: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    index: z.string().min(1),
    inferenceId: z.string().min(1).optional(),
  }),
  guardian: z.object({
    apiUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
  }),
});

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'on' || normalized === 'true' || normalized === '1';
}

function readString(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw.trim();
}

function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = readString(name)?.toLowerCase();
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function loadConfig(overrides: DeepPartial<InvestigatorAgentConfig> = {}): InvestigatorAgentConfig {
  const maxFollowUps = readNumber('AGENT_MAX_FOLLOWUPS', 5);

  const candidate: InvestigatorAgentConfig = {
    maxToolCalls: maxFollowUps,
    maxFollowUps,
    timeoutMs: readNumber('AGENT_TIMEOUT_MS', 25000),
    confidenceThreshold: readNumber('AGENT_CONF_THRESHOLD', 0.7),
    memoryMatchMin: readNumber('MEMORY_MATCH_MIN', 0.75),
    baselineCountsTowardCap: readFlag('BASELINE_COUNTS_TOWARD_CAP', false),
    features: {
      investigatorLoop: readFlag('FEATURE_INVESTIGATOR_LOOP', true),
      identityLlm: readFlag('FEATURE_IDENTITY_LLM', true),
      promoLanguage: readFlag('FEATURE_PROMO_LANGUAGE', true),
      memory: readFlag('FEATURE_SCAM_MEMORY', true),
    },
    llm: {
      provider: readString('LLM_PROVIDER') ?? 'openai-compatible',
      apiKey: readString('LLM_API_KEY'),
      baseUrl: readString('LLM_BASE_URL') ?? 'https://api.openai.com/v1',
      modelFast: readString('LLM_MODEL_FAST') ?? 'gpt-4o-mini',
      modelStrong: readString('LLM_MODEL_STRONG') ?? 'gpt-4o-mini',
      mode: readEnum('LLM_MODE', ['live', 'record', 'replay'] as const, 'live'),
      fixtureDir: readString('LLM_FIXTURE_DIR') ?? 'fixtures/llm',
    },
    signals: {
      mode: readEnum('SIGNALS_MODE', ['live', 'fixture'] as const, 'fixture'),
      baseUrl: readString('SIGNALS_BASE_URL'),
      fixtureDir: readString('SIGNALS_FIXTURE_DIR') ?? 'fixtures',
    },
    elastic: {
      url: readString('ELASTIC_URL'),
      apiKey: readString('ELASTIC_API_KEY'),
      index: readString('ELASTIC_INDEX') ?? 'guardian-scam-memory',
      inferenceId: readString('ELASTIC_INFERENCE_ID'),
    },
    guardian: {
      apiUrl: readString('GUARDIAN_API_URL'),
      apiKey: readString('GUARDIAN_API_KEY'),
    },
  };

  const merged = mergeConfig(candidate, overrides);
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid agent configuration: ${issues}`);
  }
  return parsed.data;
}

function mergeConfig(base: InvestigatorAgentConfig, overrides: DeepPartial<InvestigatorAgentConfig>): InvestigatorAgentConfig {
  return {
    ...base,
    ...defined(overrides),
    features: { ...base.features, ...defined(overrides.features ?? {}) },
    llm: { ...base.llm, ...defined(overrides.llm ?? {}) },
    signals: { ...base.signals, ...defined(overrides.signals ?? {}) },
    elastic: { ...base.elastic, ...defined(overrides.elastic ?? {}) },
    guardian: { ...base.guardian, ...defined(overrides.guardian ?? {}) },
  };
}

function defined<T extends object>(value: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as Partial<T>;
}

/** Throws a named error when a live adapter is configured without its secret. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}
