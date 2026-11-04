import type {
  AgentPath,
  AgentResult,
  Decision,
  Evidence,
  Explanation,
  IdentityMatchResult,
  InvestigationRequest,
  Verdict,
} from './types.js';
import { IDENTITY_TIMEOUT_MS, matchIdentity, type IdentityInput } from './identity/matcher.js';
import { AgentResultSchema, InvestigationRequestSchema } from './types.js';
import { loadConfig, type DeepPartial, type InvestigatorAgentConfig } from './config.js';
import { makeClock } from './clock.js';
import { createIdFactory, type IdFactory } from './evidence/ids.js';
import { deriveEvidence } from './evidence/derive.js';
import { runBaseline, type BaselineResult } from './tools/baseline.js';
import { markHardFail, scoreAndDecide, type ScoreResult } from './scoring/decide.js';
import { HEADLINES, templateExplanation } from './explain/template.js';
import {
  EXPLANATION_TIMEOUT_MS,
  MAX_WRITER_EVIDENCE,
  writeExplanation,
} from './explain/writer.js';
import { checkExplanation } from './explain/checker.js';
import {
  PATTERN_TIMEOUT_MS,
  buildPatternFacts,
  templatePatternSentence,
  writePatternSentence,
} from './memory/pattern.js';
import {
  MEMORY_SEARCH_TIMEOUT_MS,
  buildMemoryDocument,
  buildMemoryEvidence,
  searchMemory,
  writeMemorySafely,
} from './memory/store.js';
import { registrableDomain } from './util/domain.js';
import { FALLBACK_SUMMARY } from './scoring/summary.js';
import {
  runInvestigator,
  type InvestigationState,
  type InvestigatorOutcome,
} from './investigator/loop.js';
import type { AgentDeps } from './ports.js';

/**
 * The investigation pipeline.
 *
 * Phase 6 completes the ambiguous branch: when the deterministic sweep cannot
 * decide, the investigator chooses follow-up checks within a hard budget, then
 * evidence is re-derived and the score is recomputed. Identity matching, the
 * explanation writer and scam memory arrive in later phases.
 */

export function choosePath(score: ScoreResult, baseline: BaselineResult): AgentPath {
  const blocking = score.hardRulesTriggered.some(
    (rule) => rule.rule === 'HF1' || rule.rule === 'HF2'
  );
  if (blocking) return 'FAST_PAUSE';
  if (score.decision !== 'ALLOW') return 'AMBIGUOUS';
  return isFastAllow(score, baseline) ? 'FAST_ALLOW' : 'AMBIGUOUS';
}

export function isFastAllow(score: ScoreResult, baseline: BaselineResult): boolean {
  if (score.decision !== 'ALLOW') return false;

  const evidence = baseline.evidence;
  const has = (predicate: (entry: Evidence) => boolean): boolean => evidence.some(predicate);

  const bindingMatch = has(
    (entry) => entry.type === 'PAYEE_BINDING' && entry.data?.status === 'MATCH'
  );
  const oldDomain = has((entry) => {
    if (entry.type !== 'DOMAIN_AGE') return false;
    const ageDays = Number(entry.data?.ageDays);
    return Number.isFinite(ageDays) && ageDays >= 90;
  });
  const lookalike = has(
    (entry) => entry.type === 'LOOKALIKE_DOMAIN' && entry.data?.matchesKnownBrand === true
  );
  const injection = has((entry) => entry.type === 'INJECTION_ATTEMPT');
  const toolUnavailable = has((entry) => entry.type === 'TOOL_UNAVAILABLE');
  const brandMismatch = has((entry) => entry.type === 'CLAIMED_BRAND_MISMATCH');
  const freeEmail = has((entry) => entry.type === 'PAYEE_FREE_EMAIL');

  const price = evidence.find((entry) => entry.type === 'PRICE_DEVIATION');
  const discount = price ? Number(price.data?.discountPct) : undefined;
  const deepDiscount = discount !== undefined && Number.isFinite(discount) && discount >= 50;

  return (
    bindingMatch &&
    oldDomain &&
    !lookalike &&
    !injection &&
    !toolUnavailable &&
    !brandMismatch &&
    !freeEmail &&
    !deepDiscount
  );
}

export async function runInvestigatorAgentDetailed(
  request: InvestigationRequest,
  deps: AgentDeps,
  overrides: DeepPartial<InvestigatorAgentConfig> = {}
): Promise<AgentResult> {
  const config = loadConfig(overrides);
  const now = safeNow(deps.now);
  const clock = makeClock(config.timeoutMs, now);
  const started = now();
  const modelDeadline = config.modelBudgetMs > 0 ? started + config.modelBudgetMs : Infinity;
  const modelBudget = (limit: number): number => {
    const clockBudget = clock.step(limit);
    if (modelDeadline === Infinity) return clockBudget;
    return Math.max(0, Math.min(clockBudget, modelDeadline - deps.now()));
  };
  const ids = createIdFactory();

  try {
    const parsed = InvestigationRequestSchema.safeParse(request);
    if (!parsed.success) {
      return degradedResult(request, deps, started, 'invalid_request');
    }

    const baseline = await runBaseline(parsed.data, deps, ids);
    const state: InvestigationState = {
      request: parsed.data,
      safeClaims: baseline.safeClaims,
      payeeRecords: [...baseline.payeeRecords],
      brandOwnerRecords: [...baseline.brandOwnerRecords],
      evidence: [...baseline.evidence],
      trace: [...baseline.trace],
      followUps: 0,
      llmCalls: 0,
    };

    const scoreOptions = {
      confidenceThreshold: config.confidenceThreshold,
      baselineFailures: baseline.failedBaseline,
      baselineSucceeded: baseline.succeededBaseline,
    };

    let score = scoreAndDecide(state.evidence, scoreOptions);
    const path = choosePath(score, baseline);

    let investigator: InvestigatorOutcome | undefined;
    if (path === 'AMBIGUOUS') {
      investigator = await runInvestigator(state, deps, ids, clock, {
        llm: deps.llm,
        maxFollowUps: config.maxFollowUps,
        useLoop: config.features.investigatorLoop,
        signal: clock.signal,
      });
      mergeDerivedEvidence(state, parsed.data, ids);
      score = scoreAndDecide(state.evidence, scoreOptions);
    }

    let patternSentence: string | undefined;
    let identityMatch: IdentityMatchResult | undefined;
    const memoryEnabled = config.features.memory && Boolean(deps.memory);

    // Identity matching and the pattern sentence are independent, so they run
    // together; the memory search then uses the finished sentence.
    const patternTask = (async () => {
      if (!memoryEnabled || path === 'FAST_ALLOW') return undefined;

      const facts = buildPatternFacts(state.evidence);
      const forbiddenTerms = [
        state.safeClaims?.domain,
        state.safeClaims?.siteName,
        state.safeClaims?.legalName,
        parsed.data.claimedBrand,
      ].filter((term): term is string => typeof term === 'string' && term.trim().length > 0);

      const patternBudget = modelBudget(PATTERN_TIMEOUT_MS);
      const pattern =
        patternBudget > 0
          ? await writePatternSentence(facts, {
              llm: deps.llm,
              timeoutMs: patternBudget,
              forbiddenTerms,
              signal: clock.signal,
            })
          : { sentence: templatePatternSentence(facts), usedLlm: false, degraded: false };

      const hits = await searchMemory(
        {
          patternText: pattern.sentence,
          registrableDomain: registrableDomain(parsed.data.merchantUrl),
          ...(parsed.data.payee?.merchantId ? { payeeMerchantId: parsed.data.payee.merchantId } : {}),
        },
        deps.memory,
        { timeoutMs: MEMORY_SEARCH_TIMEOUT_MS, log: deps.log, now: deps.now }
      );

      return {
        sentence: pattern.sentence,
        usedLlm: pattern.usedLlm,
        evidence: buildMemoryEvidence(hits, ids, config.memoryMatchMin),
        hits,
      };
    })();

    const identityTask =
      path === 'AMBIGUOUS'
        ? matchIdentity(buildIdentityInput(state, parsed.data), ids, {
            llm: deps.llm,
            useLlm: config.features.identityLlm,
            timeoutMs: modelBudget(IDENTITY_TIMEOUT_MS),
            signal: clock.signal,
          })
        : Promise.resolve(undefined);

    const [patternResult, identityResult] = await Promise.all([patternTask, identityTask]);

    if (patternResult) {
      patternSentence = patternResult.sentence;
      if (patternResult.usedLlm) state.llmCalls += 1;
      if (patternResult.evidence.length > 0) state.evidence.push(...patternResult.evidence);
    }

    if (identityResult) {
      if (identityResult.usedLlm) state.llmCalls += 1;
      if (identityResult.evidence.length > 0) state.evidence.push(...identityResult.evidence);
      if (identityResult.result) identityMatch = identityResult.result;
    }

    if (identityResult || patternResult) {
      score = scoreAndDecide(state.evidence, scoreOptions);
    }

    const evidence = markHardFail(state.evidence, score.hardRulesTriggered);
    if (evidence.length === 0) evidence.push(investigationNote(ids));

    const ordered = orderForExplanation(evidence, score.flaggedEvidenceIds);
    let explanation: Explanation;
    let explanationFallback = false;

    const writerBudget = modelBudget(EXPLANATION_TIMEOUT_MS);
    if (path === 'FAST_ALLOW' || writerBudget <= 0) {
      explanation =
        templateExplanation(ordered, score.decision) ??
        minimalExplanation(score.decision, evidence[0]);
    } else {
      const writer = await writeExplanation(
        {
          decision: score.decision,
          score: score.score,
          confidence: score.confidence,
          evidence: ordered.slice(0, MAX_WRITER_EVIDENCE),
          hardRules: score.hardRulesTriggered,
          ...(patternResult && patternResult.hits.length > 0
            ? {
                retrievedCases: patternResult.hits.slice(0, 3).map((hit) => ({
                  caseId: hit.id,
                  patternText: hit.patternText,
                  decision: hit.decision,
                  score: hit.score ?? 0,
                  ...(hit.retrieval ? { retrieval: hit.retrieval } : {}),
                })),
              }
            : {}),
        },
        { llm: deps.llm, timeoutMs: writerBudget, signal: clock.signal }
      );

      const checked = checkExplanation({
        candidate: writer.explanation,
        evidence,
        decision: score.decision,
        hardRules: score.hardRulesTriggered,
        allowedCaseIds: patternResult?.hits.map((hit) => hit.id) ?? [],
      });

      if (writer.attempted) state.llmCalls += 1;
      explanation = checked.explanation ?? minimalExplanation(score.decision, evidence[0]);
      explanationFallback = writer.attempted && (!writer.ok || checked.usedTemplate);
    }

    let degraded =
      baseline.failedBaseline > 0 ||
      Boolean(investigator?.degraded) ||
      Boolean(identityResult?.degraded);
    let fallbackReason =
      baseline.failedBaseline > 0
        ? 'tool_unavailable'
        : investigator?.degraded
          ? 'investigator_failed'
          : identityResult?.degraded
            ? 'identity_llm_failed'
            : undefined;

    if (explanationFallback) {
      degraded = true;
      fallbackReason = fallbackReason ?? 'explanation_fallback';
    }

    if (clock.isExpired()) {
      degraded = true;
      fallbackReason = fallbackReason ?? 'deadline';
    }

    const result: AgentResult = {
      verdict: buildVerdict(
        parsed.data,
        score,
        evidence,
        explanation,
        state.trace,
        degraded,
        fallbackReason,
        identityMatch
      ),
      evidence,
      trace: state.trace,
      explanation,
      buckets: score.buckets,
      hardRulesTriggered: score.hardRulesTriggered,
      path,
      stats: {
        ms: Math.max(0, deps.now() - started),
        llmCalls: state.llmCalls,
        followUps: state.followUps,
        failedBaseline: baseline.failedBaseline,
      },
      degraded,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(patternSentence ? { patternSentence } : {}),
      ...(identityMatch ? { identityMatch } : {}),
    };

    const validated = AgentResultSchema.safeParse(result);
    if (!validated.success) {
      deps.log({ evt: 'verdict_invalid', issues: validated.error.issues.length });
      return degradedResult(parsed.data, deps, started, 'verdict_invalid');
    }

    if (memoryEnabled && path !== 'FAST_ALLOW' && patternSentence && result.verdict.decision !== 'ALLOW') {
      const document = buildMemoryDocument({
        registrableDomain: registrableDomain(parsed.data.merchantUrl),
        domain: state.safeClaims?.domain ?? '',
        ...(parsed.data.payee?.merchantId ? { payeeMerchantId: parsed.data.payee.merchantId } : {}),
        decision: result.verdict.decision,
        riskScore: result.verdict.riskScore,
        patternText: patternSentence,
        evidence: state.evidence,
      });
      await writeMemorySafely(document, deps.memory, { log: deps.log, now: deps.now });
    }

    deps.log({
      evt: 'agent_done',
      orderId: parsed.data.orderId,
      path,
      decision: result.verdict.decision,
      score: result.verdict.score,
      confidence: result.verdict.confidence,
      ms: result.stats.ms,
      llmCalls: state.llmCalls,
      followUps: state.followUps,
      failedBaseline: baseline.failedBaseline,
      degraded,
    });

    return validated.data as AgentResult;
  } catch (error) {
    deps.log({
      evt: 'agent_error',
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
    });
    return degradedResult(request, deps, started, 'internal_error');
  } finally {
    clock.dispose();
  }
}

function mergeDerivedEvidence(
  state: InvestigationState,
  request: InvestigationRequest,
  ids: IdFactory
): void {
  const derived = deriveEvidence(
    {
      payee: request.payee,
      claimedBrand: request.claimedBrand ?? state.safeClaims?.claimedBrand,
      payeeRecords: state.payeeRecords,
      brandOwnerRecords: state.brandOwnerRecords,
    },
    ids
  );

  const existingTypes = new Set(state.evidence.map((entry) => entry.type));
  for (const entry of derived) {
    if (!existingTypes.has(entry.type)) state.evidence.push(entry);
  }
}

function buildVerdict(
  request: InvestigationRequest,
  score: ScoreResult,
  evidence: Evidence[],
  explanation: Explanation,
  trace: InvestigationState['trace'],
  degraded: boolean,
  fallbackReason: string | undefined,
  identityMatch: IdentityMatchResult | undefined
): Verdict {
  const verdict: Verdict = {
    orderId: request.orderId,
    decision: score.decision,
    score: score.score,
    riskScore: score.riskScore,
    confidence: score.confidence,
    summary: score.summary,
    flaggedEvidenceIds: score.flaggedEvidenceIds,
    recommendedAction: score.recommendedAction,
    explanation,
    trace,
    evidence,
    ...(degraded ? { degraded: true } : {}),
    ...(identityMatch ? { identityMatch } : {}),
  };
  if (fallbackReason) verdict.fallbackReason = fallbackReason;
  return verdict;
}

function safeNow(now: () => number): () => number {
  return () => {
    try {
      const value = now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };
}

function buildIdentityInput(
  state: InvestigationState,
  request: InvestigationRequest
): IdentityInput {
  const record =
    state.payeeRecords.find((entry) => entry.merchantId === request.payee?.merchantId) ??
    state.payeeRecords[0];

  return {
    siteName: state.safeClaims?.siteName,
    legalName: state.safeClaims?.legalName,
    claimedBrand: request.claimedBrand ?? state.safeClaims?.claimedBrand,
    claimedLocation: state.safeClaims?.claimedLocation,
    payeeRecord: record
      ? {
          merchantId: record.merchantId,
          legalName: record.legalName,
          brandNames: record.brandNames,
          city: record.city,
          country: record.country,
        }
      : null,
  };
}

/**
 * Plain wrapper used by the backend: returns only the verdict, never throws.
 */
export async function runInvestigatorAgent(
  request: InvestigationRequest,
  deps: AgentDeps,
  overrides: DeepPartial<InvestigatorAgentConfig> = {}
): Promise<Verdict> {
  return (await runInvestigatorAgentDetailed(request, deps, overrides)).verdict;
}

function orderForExplanation(evidence: Evidence[], flaggedEvidenceIds: string[]): Evidence[] {
  const rank = new Map<string, number>();
  flaggedEvidenceIds.forEach((id, index) => rank.set(id, index));

  return [...evidence].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

function minimalExplanation(decision: Decision, first: Evidence): Explanation {
  return {
    headline: HEADLINES[decision],
    bullets: [{ text: FALLBACK_SUMMARY[decision], evidenceIds: [first.id] }],
  };
}

function investigationNote(ids: IdFactory): Evidence {
  return {
    id: ids.next('INVESTIGATION_NOTE'),
    type: 'INVESTIGATION_NOTE',
    severity: 'info',
    confidence: 1,
    summary: 'No additional checks were available for this investigation.',
    source: 'rule',
    deterministic: true,
  };
}

function degradedResult(
  request: InvestigationRequest | undefined,
  deps: AgentDeps,
  started: number,
  reason: 'invalid_request' | 'internal_error' | 'verdict_invalid'
): AgentResult {
  const ids = createIdFactory();
  const orderId =
    request && typeof request.orderId === 'string' && request.orderId.length > 0
      ? request.orderId.slice(0, 128)
      : 'UNKNOWN';

  const note: Evidence = {
    id: ids.next('AGENT_ERROR'),
    type: 'AGENT_ERROR',
    severity: 'info',
    confidence: 1,
    summary: 'The investigation could not be completed as requested.',
    source: 'rule',
    deterministic: true,
    data: { reason },
  };

  const decision: Decision = 'WARN';
  const explanation: Explanation = {
    headline: HEADLINES.WARN,
    bullets: [
      {
        text: 'The investigation could not be completed, so the payment is held for review.',
        evidenceIds: [note.id],
      },
    ],
  };

  const verdict: Verdict = {
    orderId,
    decision,
    score: 0,
    riskScore: 0,
    confidence: 0.3,
    summary: FALLBACK_SUMMARY.WARN,
    flaggedEvidenceIds: [],
    recommendedAction: 'WARN_DISPLAYED',
    explanation,
    trace: [],
    evidence: [note],
    degraded: true,
    fallbackReason: reason,
  };

  return {
    verdict,
    evidence: [note],
    trace: [],
    explanation,
    buckets: { domain: 0, merchant: 0, pricing: 0, technical: 0 },
    hardRulesTriggered: [],
    path: 'AMBIGUOUS',
    stats: {
      ms: Math.max(0, Date.now() - started),
      llmCalls: 0,
      followUps: 0,
      failedBaseline: 0,
    },
    degraded: true,
    fallbackReason: reason,
  };
}
