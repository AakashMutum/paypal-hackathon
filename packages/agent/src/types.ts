import { z } from 'zod';

/**
 * Local mirror of the shared API contracts.
 *
 * `packages/contracts` is owned by the api area and is never edited from this package.
 * The vocabulary here intentionally matches it: ALLOW / WARN / PAUSE and the
 * ActionTaken values. `adapters/contractsAdapter.ts` maps these shapes onto the
 * contract response objects.
 */

export const DecisionSchema = z.enum(['ALLOW', 'WARN', 'PAUSE']);
export type Decision = z.infer<typeof DecisionSchema>;

export const RecommendedActionSchema = z.enum(['PROCEED', 'WARN_DISPLAYED', 'CAPTURE_PAUSED']);
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

export const SeveritySchema = z.enum(['info', 'low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const EvidenceSourceSchema = z.enum([
  'rdap',
  'tls',
  'kernel',
  'channel3',
  'registry',
  'paypal',
  'elastic',
  'llm',
  'rule',
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(60),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(240),
  source: EvidenceSourceSchema,
  deterministic: z.boolean(),
  hardFail: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const OrderItemSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
  unitPrice: z.number().positive(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const PayeeSchema = z.object({
  merchantId: z.string().min(1).max(100),
  email: z.string().email().max(254).optional(),
});
export type Payee = z.infer<typeof PayeeSchema>;

export const InvestigationRequestSchema = z.object({
  orderId: z.string().min(1).max(128),
  merchantUrl: z.string().url().max(2048),
  claimedBrand: z.string().min(1).max(80).optional(),
  transactionAmount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  payee: PayeeSchema.optional(),
  agentId: z.string().min(1).max(60).optional(),
  items: z.array(OrderItemSchema).max(20).optional(),
  cachedEvidence: z.array(EvidenceSchema).max(50).optional(),
});
export type InvestigationRequest = z.infer<typeof InvestigationRequestSchema>;

export const TraceStepSchema = z.object({
  step: z.number().int().min(0),
  tool: z.string().min(1).max(60),
  why: z.string().min(1).max(140),
  input: z.string().max(200),
  result: z.string().max(200),
  evidenceIds: z.array(z.string()).max(20),
  ok: z.boolean(),
  ms: z.number().min(0),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const ExplanationBulletSchema = z.object({
  text: z.string().min(1).max(160),
  evidenceIds: z.array(z.string().min(1)).min(1).max(6),
});
export type ExplanationBullet = z.infer<typeof ExplanationBulletSchema>;

export const ExplanationSchema = z.object({
  headline: z.string().min(1).max(90),
  bullets: z.array(ExplanationBulletSchema).min(1).max(5),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export const IdentityRelationSchema = z.enum([
  'same_entity',
  'likely_same',
  'related_entity',
  'unknown',
  'different',
]);
export type IdentityRelation = z.infer<typeof IdentityRelationSchema>;

export const IdentityPairSchema = z.object({
  id: z.enum(['P1', 'P2']),
  a: z.string().max(200),
  b: z.string().max(200),
  relation: IdentityRelationSchema,
  similarity: z.number().min(0).max(1),
});
export type IdentityPair = z.infer<typeof IdentityPairSchema>;

export const IdentityMatchResultSchema = z.object({
  pairs: z.array(IdentityPairSchema).max(4),
  overall: z.number().min(0).max(1),
  locationConsistent: z.boolean().optional(),
  gaps: z.array(z.string().max(160)).max(5).optional(),
});
export type IdentityMatchResult = z.infer<typeof IdentityMatchResultSchema>;

export const VerdictSchema = z.object({
  orderId: z.string().min(1).max(128),
  decision: DecisionSchema,
  score: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(140),
  flaggedEvidenceIds: z.array(z.string()).max(12),
  recommendedAction: RecommendedActionSchema,
  explanation: ExplanationSchema.optional(),
  trace: z.array(TraceStepSchema).optional(),
  identityMatch: IdentityMatchResultSchema.optional(),
  degraded: z.boolean().optional(),
  fallbackReason: z.string().max(120).optional(),
  evidence: z.array(EvidenceSchema).optional(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const RiskBucketsSchema = z.object({
  domain: z.number().min(0).max(100),
  merchant: z.number().min(0).max(100),
  pricing: z.number().min(0).max(100),
  technical: z.number().min(0).max(100),
});
export type RiskBuckets = z.infer<typeof RiskBucketsSchema>;

export const HardRuleIdSchema = z.enum(['HF1', 'HF2', 'HF3', 'R4', 'R5']);
export type HardRuleId = z.infer<typeof HardRuleIdSchema>;

export const HardRuleTriggerSchema = z.object({
  rule: HardRuleIdSchema,
  evidenceIds: z.array(z.string()).max(20),
  description: z.string().min(1).max(160),
});
export type HardRuleTrigger = z.infer<typeof HardRuleTriggerSchema>;

export const AgentPathSchema = z.enum(['FAST_ALLOW', 'FAST_PAUSE', 'AMBIGUOUS']);
export type AgentPath = z.infer<typeof AgentPathSchema>;

export const AgentStatsSchema = z.object({
  ms: z.number().min(0),
  llmCalls: z.number().int().min(0),
  followUps: z.number().int().min(0),
  failedBaseline: z.number().int().min(0),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const AgentResultSchema = z.object({
  verdict: VerdictSchema,
  evidence: z.array(EvidenceSchema),
  trace: z.array(TraceStepSchema),
  explanation: ExplanationSchema,
  identityMatch: IdentityMatchResultSchema.optional(),
  patternSentence: z.string().max(300).optional(),
  buckets: RiskBucketsSchema,
  hardRulesTriggered: z.array(HardRuleTriggerSchema),
  path: AgentPathSchema,
  stats: AgentStatsSchema,
  degraded: z.boolean(),
  fallbackReason: z.string().max(120).optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
