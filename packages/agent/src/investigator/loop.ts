import type { Clock } from '../clock.js';
import type { AgentDeps } from '../ports.js';
import type { Evidence, TraceStep } from '../types.js';
import type { IdFactory } from '../evidence/ids.js';
import type { LlmClient } from '../llm/client.js';
import { emailDomain } from '../evidence/derive.js';
import { sanitizeModelText } from '../guard/output.js';
import { INVESTIGATOR_SYSTEM, wrapUntrusted } from '../llm/prompts.js';
import { truncate } from '../tools/call.js';
import {
  callKey,
  checkGuards,
  executeFollowUp,
  type FollowUpState,
  type FollowUpUsage,
} from '../tools/followups.js';
import { MAX_CALLS_PER_TURN, MAX_TURNS, TurnSchema, type ToolCall } from './protocol.js';

/**
 * The investigator loop.
 *
 * Hard limits, all enforced here rather than in the prompt:
 *  - at most `maxFollowUps` executed tool calls per investigation,
 *  - at most 3 executed calls per turn,
 *  - at most 4 turns,
 *  - no new turn once less than 4.5 s remains,
 *  - one retry per failing tool, then TOOL_UNAVAILABLE,
 *  - duplicates and guarded calls never consume budget.
 */

export const INVESTIGATOR_TIMEOUT_MS = 3000;
export const INVESTIGATOR_MAX_TOKENS = 400;
export const MIN_TURN_WINDOW_MS = 4500;
export const MAX_STATE_EVIDENCE = 12;

export interface InvestigationState extends FollowUpState {
  trace: TraceStep[];
  followUps: number;
  llmCalls: number;
}

export interface InvestigatorOptions {
  llm?: LlmClient;
  maxFollowUps: number;
  useLoop: boolean;
  signal?: AbortSignal;
}

export interface InvestigatorOutcome {
  followUps: number;
  llmCalls: number;
  degraded: boolean;
  usedFixedPlan: boolean;
}

export async function runInvestigator(
  state: InvestigationState,
  deps: AgentDeps,
  ids: IdFactory,
  clock: Clock,
  options: InvestigatorOptions
): Promise<InvestigatorOutcome> {
  const usage: FollowUpUsage = { compareOffersUsed: 0 };
  const seen = new Set<string>();
  let degraded = false;
  let usedFixedPlan = false;
  let turns = 0;

  const canLoop = options.useLoop && Boolean(options.llm);

  if (canLoop && options.llm) {
    while (
      turns < MAX_TURNS &&
      remainingCalls(state, options) > 0 &&
      clock.remainingMs() > MIN_TURN_WINDOW_MS
    ) {
      const llmBudget = Math.min(INVESTIGATOR_TIMEOUT_MS, clock.step(INVESTIGATOR_TIMEOUT_MS));
      if (llmBudget <= 0) break;

      const response = await options.llm.generateJson({
        tier: 'strong',
        system: INVESTIGATOR_SYSTEM,
        user: buildStateMessage(state, clock, options, turns),
        schema: TurnSchema,
        schemaName: 'InvestigatorTurn',
        maxOutputTokens: INVESTIGATOR_MAX_TOKENS,
        timeoutMs: llmBudget,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      state.llmCalls += 1;
      turns += 1;

      if (!response.ok) {
        degraded = true;
        pushTrace(state, {
          tool: 'investigator',
          why: 'Model call failed',
          input: '',
          result: `failed: ${response.error}`,
          evidenceIds: [],
          ok: false,
          ms: 0,
        });
        break;
      }

      if (response.data.action === 'finish') {
        pushTrace(state, {
          tool: 'finish',
          why: safeWhy(response.data.why),
          input: '',
          result: 'investigation finished',
          evidenceIds: [],
          ok: true,
          ms: 0,
        });
        return { followUps: state.followUps, llmCalls: state.llmCalls, degraded, usedFixedPlan };
      }

      const accepted: ToolCall[] = [];
      for (const call of response.data.calls.slice(0, MAX_CALLS_PER_TURN)) {
        if (accepted.length >= remainingCalls(state, options)) break;

        const key = callKey(call);
        if (seen.has(key)) {
          pushRejected(state, call, 'duplicate');
          continue;
        }

        const guard = checkGuards(call, state, usage);
        if (guard) {
          pushRejected(state, call, guard);
          continue;
        }

        seen.add(key);
        accepted.push(call);
      }

      if (accepted.length === 0) continue;

      const toolBudget = clock.step(3000);
      if (toolBudget <= 0) {
        pushTrace(state, {
          tool: 'deadline',
          why: 'Out of time',
          input: '',
          result: 'skipped remaining calls',
          evidenceIds: [],
          ok: false,
          ms: 0,
        });
        break;
      }

      const results = await Promise.all(
        accepted.map(async (call) => ({
          call,
          outcome: await executeFollowUp(call, state, deps, ids, Math.max(1, toolBudget)),
        }))
      );

      for (const { call, outcome } of results) {
        state.followUps += 1;
        if (call.tool === 'compare_offers') usage.compareOffersUsed += 1;

        if (outcome.ok) {
          state.evidence.push(...outcome.evidence);
          pushTrace(state, {
            tool: call.tool,
            why: safeWhy(call.why),
            input: describeInput(call),
            result: outcome.result,
            evidenceIds: outcome.evidence.map((entry) => entry.id),
            ok: true,
            ms: outcome.ms,
          });
        } else {
          const unavailable = toolUnavailable(ids, call.tool, outcome.error ?? 'unknown error');
          state.evidence.push(unavailable);
          pushTrace(state, {
            tool: call.tool,
            why: safeWhy(call.why),
            input: describeInput(call),
            result: `failed: ${truncate(outcome.error ?? 'unknown error', 120)}`,
            evidenceIds: [unavailable.id],
            ok: false,
            ms: outcome.ms,
          });
        }
      }
    }
  }

  if (!canLoop || degraded) {
    usedFixedPlan = true;
    const fixedDegraded = await runFixedPlan(state, deps, ids, clock, options, usage, seen);
    degraded = degraded || fixedDegraded;
  }

  return { followUps: state.followUps, llmCalls: state.llmCalls, degraded, usedFixedPlan };
}

function remainingCalls(state: InvestigationState, options: InvestigatorOptions): number {
  return Math.max(0, options.maxFollowUps - state.followUps);
}

async function runFixedPlan(
  state: InvestigationState,
  deps: AgentDeps,
  ids: IdFactory,
  clock: Clock,
  options: InvestigatorOptions,
  usage: FollowUpUsage,
  seen: Set<string>
): Promise<boolean> {
  const planned = planFixedCalls(state);

  for (const call of planned) {
    if (remainingCalls(state, options) <= 0) break;
    if (clock.remainingMs() <= 1500) break;

    const key = callKey(call);
    if (seen.has(key)) continue;
    if (checkGuards(call, state, usage)) continue;
    seen.add(key);

    const budget = Math.min(INVESTIGATOR_TIMEOUT_MS, clock.step(INVESTIGATOR_TIMEOUT_MS));
    if (budget <= 0) break;

    const outcome = await executeFollowUp(call, state, deps, ids, Math.max(1, budget));
    state.followUps += 1;
    if (call.tool === 'compare_offers') usage.compareOffersUsed += 1;

    if (outcome.ok) {
      state.evidence.push(...outcome.evidence);
      pushTrace(state, {
        tool: call.tool,
        why: 'Standard check',
        input: describeInput(call),
        result: outcome.result,
        evidenceIds: outcome.evidence.map((entry) => entry.id),
        ok: true,
        ms: outcome.ms,
      });
    } else {
      const unavailable = toolUnavailable(ids, call.tool, outcome.error ?? 'unknown error');
      state.evidence.push(unavailable);
      pushTrace(state, {
        tool: call.tool,
        why: 'Standard check',
        input: describeInput(call),
        result: `failed: ${truncate(outcome.error ?? 'unknown error', 120)}`,
        evidenceIds: [unavailable.id],
        ok: false,
        ms: outcome.ms,
      });
    }
  }

  return false;
}

export function planFixedCalls(state: InvestigationState): ToolCall[] {
  const planned: ToolCall[] = [];

  if (state.payeeRecords.length === 0) {
    const query = state.safeClaims?.siteName ?? state.request.claimedBrand;
    if (query) {
      planned.push({
        tool: 'lookup_registry',
        input: { by: 'name', query: truncate(query, 120) },
        why: 'Standard check',
      });
    }
  }

  if (!state.safeClaims?.legalName && state.safeClaims?.sectionLinks.about) {
    planned.push({ tool: 'fetch_page_section', input: { hint: 'about' }, why: 'Standard check' });
  }

  const priceUnknown = state.evidence.some((entry) => entry.type === 'PRICE_UNKNOWN');
  const product = state.request.items?.[0]?.name;
  if (priceUnknown && product) {
    planned.push({
      tool: 'compare_offers',
      input: { productQuery: truncate(product, 120) },
      why: 'Standard check',
    });
  }

  return planned;
}

export function buildStateMessage(
  state: InvestigationState,
  clock: Clock,
  options: InvestigatorOptions,
  turnsUsed = 0
): string {
  const request = state.request;

  const summary = {
    merchantDomain: state.safeClaims?.domain ?? '',
    claimedBrand: request.claimedBrand ?? state.safeClaims?.claimedBrand ?? null,
    amount: request.transactionAmount ?? null,
    currency: request.currency ?? null,
    payeeMerchantId: request.payee?.merchantId ?? null,
    payeeEmailDomain: emailDomain(request.payee?.email) ?? null,
    agentId: request.agentId ?? null,
  };

  const evidenceLines = state.evidence
    .slice(-MAX_STATE_EVIDENCE)
    .map((entry) => `- ${entry.id} | ${entry.type} | ${entry.severity} | ${truncate(entry.summary, 120)}`)
    .join('\n');

  const claimsBlock = state.safeClaims
    ? wrapUntrusted('page_claims', {
        siteName: state.safeClaims.siteName ?? null,
        legalName: state.safeClaims.legalName ?? null,
        claimedLocation: state.safeClaims.claimedLocation ?? null,
        linkedDomains: state.safeClaims.linkedDomains.slice(0, 10),
        sectionsAvailable: Object.keys(state.safeClaims.sectionLinks),
        visibleTextExcerpt: truncate(state.safeClaims.visibleText, 600),
      })
    : wrapUntrusted('page_claims', { unavailable: true });

  const registryBlock = wrapUntrusted(
    'registry_records',
    state.payeeRecords.slice(0, 5).map((record) => ({
      merchantId: record.merchantId,
      legalName: record.legalName,
      domain: record.domain,
      status: record.status,
    }))
  );

  const budget = [
    `callsLeft=${remainingCalls(state, options)}`,
    `secondsLeft=${(Math.max(0, clock.remainingMs()) / 1000).toFixed(1)}`,
    `turnsLeft=${Math.max(0, MAX_TURNS - turnsUsed)}`,
  ].join(', ');

  return [
    'Case summary (trusted):',
    JSON.stringify(summary),
    '',
    'Evidence so far (trusted):',
    evidenceLines || '- none',
    '',
    claimsBlock,
    '',
    registryBlock,
    '',
    `Budget: ${budget}`,
  ].join('\n');
}

function pushTrace(state: InvestigationState, step: Omit<TraceStep, 'step'>): void {
  state.trace.push({ step: state.trace.length + 1, ...step });
}

function pushRejected(state: InvestigationState, call: ToolCall, reason: string): void {
  pushTrace(state, {
    tool: call.tool,
    why: safeWhy(call.why),
    input: describeInput(call),
    result: `rejected: ${reason}`,
    evidenceIds: [],
    ok: false,
    ms: 0,
  });
}

function safeWhy(value: string): string {
  return sanitizeModelText(value, 140) ?? 'Model-selected check';
}

function describeInput(call: ToolCall): string {
  return truncate(JSON.stringify(call.input), 120);
}

function toolUnavailable(ids: IdFactory, tool: string, reason: string): Evidence {
  return {
    id: ids.next('TOOL_UNAVAILABLE'),
    type: 'TOOL_UNAVAILABLE',
    severity: 'info',
    confidence: 1,
    summary: 'A follow-up check could not be completed.',
    source: 'rule',
    deterministic: true,
    data: { tool, reason: truncate(reason, 160) },
  };
}
