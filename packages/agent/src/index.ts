export * from './types.js';
export { loadConfig, requireEnv } from './config.js';
export type { InvestigatorAgentConfig, DeepPartial } from './config.js';
export { makeClock, RESERVED_MS } from './clock.js';
export type { Clock } from './clock.js';
export { toOrderDecision, toRiskScores, toRiskWeights, RISK_WEIGHTS } from './adapters/contractsAdapter.js';
export type {
  OrderDecisionPayload,
  ContractRiskScores,
  ContractRiskWeights,
} from './adapters/contractsAdapter.js';
export {
  pointsFor,
  scoreEvidence,
  bucketMaxima,
  sumBuckets,
  isDeterministicEvidence,
} from './scoring/pointsFor.js';
export type { RiskBucket, ScoredEvidence } from './scoring/pointsFor.js';
export { evaluateHardRules, floorForRule, hasBlockingHardRule } from './scoring/rules.js';
export { computeConfidence } from './scoring/confidence.js';
export {
  scoreAndDecide,
  decisionForScore,
  actionForDecision,
  markHardFail,
  DECISION_THRESHOLDS,
} from './scoring/decide.js';
export type { ScoreOptions, ScoreResult } from './scoring/decide.js';
export { buildFlaggedEvidenceIds, buildSummary, FALLBACK_SUMMARY } from './scoring/summary.js';
export {
  templatePhraseFor,
  templateExplanation,
  identitySentence,
  truncateText,
  HEADLINES,
  ALLOW_SENTENCE,
} from './explain/template.js';
export {
  writeExplanation,
  buildWriterUser,
  ExplanationResponseSchema,
  EXPLANATION_TIMEOUT_MS,
  EXPLANATION_MAX_TOKENS,
  MAX_WRITER_EVIDENCE,
} from './explain/writer.js';
export type {
  ExplanationWriterInput,
  ExplanationWriterOptions,
  ExplanationWriterResult,
  ExplanationResponse,
} from './explain/writer.js';
export { checkExplanation, BANNED_WORDS, MAX_BULLETS } from './explain/checker.js';
export type { CheckExplanationInput, CheckExplanationResult } from './explain/checker.js';
export { containsForbiddenReference } from './guard/output.js';
export {
  sanitizeText,
  DEFAULT_MAX_LEN,
  MAX_SNIPPET_LENGTH,
  SCAN_LIMIT,
} from './guard/shield.js';
export type {
  SanitizationLocation,
  SanitizeOptions,
  SanitizeResult,
  ShieldFinding,
} from './guard/shield.js';
export {
  INJECTION_PATTERNS,
  matchInjection,
  AI_SUBJECT_REGEX,
  DIRECTIVE_REGEX,
  AI_ADDRESS_MAX_GAP,
} from './guard/patterns.js';
export type { InjectionPattern, InjectionMatch } from './guard/patterns.js';
export {
  createIdFactory,
  duplicateIds,
  normalizeEvidenceType,
  DEFAULT_ID_PREFIX,
} from './evidence/ids.js';
export type { IdFactory } from './evidence/ids.js';
export {
  deriveEvidence,
  buildInjectionEvidence,
  emailDomain,
  isFreeEmailDomain,
  FREE_EMAIL_DOMAINS,
} from './evidence/derive.js';
export type { DeriveInput, RegistryRecordLike } from './evidence/derive.js';
export {
  hostOf,
  isIpHost,
  registrableDomain,
  registrableDomainFromHost,
} from './util/domain.js';
export { sanitizeClaims } from './guard/claims.js';
export type { SafeClaims, SanitizedClaims } from './guard/claims.js';
export { sanitizeModelText } from './guard/output.js';
export { normalizeLegal, coreName } from './identity/normalize.js';
export {
  jaro,
  jaroWinkler,
  tokenOverlap,
  similarity,
  effectiveSimilarity,
  round3,
} from './identity/similarity.js';
export {
  matchIdentity,
  capRelation,
  fallbackRelation,
  IdentityResponseSchema,
  IDENTITY_RELATIONS,
  IDENTITY_TIMEOUT_MS,
  IDENTITY_MAX_TOKENS,
} from './identity/matcher.js';
export type {
  IdentityInput,
  IdentityPayeeRecord,
  IdentityMatchOptions,
  IdentityMatchOutput,
  IdentityResponse,
} from './identity/matcher.js';
export type {
  AgentDeps,
  AgentLogger,
  CallOpts,
  OfferSummary,
  PageClaims,
  RegistryLookup,
  RegistryPort,
  RegistryRecord,
  SectionHint,
  SectionResult,
  SignalsPort,
} from './ports.js';
export {
  FOLLOW_UP_TOOLS,
  SECTION_HINTS,
  LOOKUP_BY,
  LookupRegistryInputSchema,
  FetchPageSectionInputSchema,
  CompareOffersInputSchema,
  GetDomainReportInputSchema,
  findFollowUpTool,
  describeFollowUpTools,
} from './tools/catalog.js';
export type { FollowUpTool, FollowUpToolName } from './tools/catalog.js';
export { runBaseline, BASELINE_TIMEOUT_MS, MAX_ATTEMPTS } from './tools/baseline.js';
export type { BaselineResult } from './tools/baseline.js';
export {
  createFixtureSignals,
  createHttpSignals,
} from './adapters/signalsAdapter.js';
export {
  createFixtureRegistry,
  createHttpRegistry,
} from './adapters/registryAdapter.js';
export { createGate, clone } from './adapters/fixtureGate.js';
export type { FixtureBehaviour, FixtureGate } from './adapters/fixtureGate.js';
export { SCENARIOS, loadScenario } from './fixtures/index.js';
export type { ScenarioFixture } from './fixtures/index.js';
export {
  runInvestigatorAgentDetailed,
  runInvestigatorAgent,
  choosePath,
  isFastAllow,
} from './orchestrator.js';
export {
  buildPatternFacts,
  templatePatternSentence,
  validatePatternSentence,
  writePatternSentence,
  buildPatternUser,
  bucketAge,
  bucketDiscount,
  PatternResponseSchema,
  PATTERN_TIMEOUT_MS,
  PATTERN_MAX_TOKENS,
  PATTERN_MAX_WORDS,
} from './memory/pattern.js';
export type {
  PatternFacts,
  PatternOptions,
  PatternResult,
  DomainAgeBucket,
  DiscountBucket,
} from './memory/pattern.js';
export {
  searchMemory,
  buildMemoryEvidence,
  buildMemoryDocument,
  writeMemorySafely,
  memoryIdFor,
  MEMORY_SEARCH_TIMEOUT_MS,
  MEMORY_WRITE_TIMEOUT_MS,
  MEMORY_MATCHES_LIMIT,
} from './memory/store.js';
export { SEED_PATTERNS, seedDocuments, loadSeeds } from './memory/seeds.js';
export { scamMemoryMapping } from './memory/indexMappings.js';
export {
  InMemoryMemory,
  createElasticMemory,
  ensureScamMemoryIndex,
} from './adapters/memoryElastic.js';
export type { ElasticMemoryConfig } from './adapters/memoryElastic.js';
export type {
  MemoryPort,
  MemoryHit,
  MemoryDocument,
  MemoryQuery,
  MemoryMatchType,
} from './ports.js';
export {
  TurnSchema,
  ToolCallSchema,
  SHORT_REASON,
  MAX_CALLS_PER_TURN,
  MAX_TURNS,
} from './investigator/protocol.js';
export type { Turn, ToolCall } from './investigator/protocol.js';
export {
  runInvestigator,
  planFixedCalls,
  buildStateMessage,
  INVESTIGATOR_TIMEOUT_MS,
  INVESTIGATOR_MAX_TOKENS,
  MIN_TURN_WINDOW_MS,
} from './investigator/loop.js';
export type {
  InvestigationState,
  InvestigatorOptions,
  InvestigatorOutcome,
} from './investigator/loop.js';
export { executeFollowUp, checkGuards, callKey, allowedDomains } from './tools/followups.js';
export type { FollowUpState, FollowUpOutcome, FollowUpUsage } from './tools/followups.js';
export { callWithRetry, truncate } from './tools/call.js';
export type { CallOutcome, CallOptions } from './tools/call.js';
export type {
  LlmClient,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmTier,
  LlmMode,
  LlmErrorCode,
  LlmUsage,
  RawLlmRequest,
  RawLlmResponse,
} from './llm/client.js';
export {
  createJsonClient,
  extractJsonObject,
  parseJsonWithSchema,
  buildRepairMessage,
  summarizeIssues,
  REPAIR_INSTRUCTION,
} from './llm/json.js';
export { FakeLlm, ScriptedProvider } from './llm/fakeLlm.js';
export type { FakeTurn, RawTurn } from './llm/fakeLlm.js';
export { createHttpProvider } from './llm/httpProvider.js';
export type { HttpProviderConfig } from './llm/httpProvider.js';
export { withRecordReplay, llmCacheKey } from './llm/recordReplay.js';
export type { RecordReplayOptions } from './llm/recordReplay.js';
export {
  PROMPTS,
  INVESTIGATOR_SYSTEM,
  IDENTITY_SYSTEM,
  PATTERN_SYSTEM,
  EXPLANATION_SYSTEM,
  SHOPPER_SYSTEM,
  JSON_ONLY_RULE,
  UNTRUSTED_RULE,
  NO_DECISION_RULE,
  MAX_UNTRUSTED_CHARS,
  wrapUntrusted,
} from './llm/prompts.js';
