import type { Evidence, InvestigationRequest } from '../types.js';
import type { AgentDeps, RegistryRecord } from '../ports.js';
import type { IdFactory } from '../evidence/ids.js';
import type { SafeClaims } from '../guard/claims.js';
import type { ToolCall } from '../investigator/protocol.js';
import { sanitizeText } from '../guard/shield.js';
import { registrableDomain } from '../util/domain.js';
import { callWithRetry, truncate } from './call.js';

/**
 * The only four checks the model may ask for, plus their guards. Every guard is
 * enforced here rather than in the prompt: a model that ignores instructions
 * simply gets its call rejected.
 */

export interface FollowUpState {
  request: InvestigationRequest;
  safeClaims?: SafeClaims;
  payeeRecords: RegistryRecord[];
  brandOwnerRecords: RegistryRecord[];
  evidence: Evidence[];
}

export interface FollowUpUsage {
  compareOffersUsed: number;
}

export interface FollowUpOutcome {
  ok: boolean;
  evidence: Evidence[];
  result: string;
  error?: string;
  ms: number;
}

export function callKey(call: ToolCall): string {
  const input = Object.entries(call.input as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value).toLowerCase()}`)
    .join('&');
  return `${call.tool}|${input}`;
}

export function allowedDomains(state: FollowUpState): Set<string> {
  const allowed = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || value.trim() === '') return;
    const domain = registrableDomain(value);
    if (domain) allowed.add(domain);
  };

  add(state.safeClaims?.domain);
  for (const domain of state.safeClaims?.linkedDomains ?? []) add(domain);
  for (const record of state.payeeRecords) add(record.domain);

  return allowed;
}

export function checkGuards(call: ToolCall, state: FollowUpState, usage: FollowUpUsage): string | null {
  switch (call.tool) {
    case 'lookup_registry':
      return null;

    case 'fetch_page_section': {
      if (!state.safeClaims) return 'no_page_claims';
      if (!state.safeClaims.sectionLinks[call.input.hint]) return 'section_not_linked';
      return null;
    }

    case 'compare_offers':
      return usage.compareOffersUsed >= 2 ? 'usage_limit' : null;

    case 'get_domain_report': {
      const domain = registrableDomain(call.input.domain);
      if (!domain) return 'invalid_domain';
      return allowedDomains(state).has(domain) ? null : 'domain_not_on_page';
    }

    default:
      return 'unknown_tool';
  }
}

export async function executeFollowUp(
  call: ToolCall,
  state: FollowUpState,
  deps: AgentDeps,
  ids: IdFactory,
  timeoutMs: number
): Promise<FollowUpOutcome> {
  switch (call.tool) {
    case 'lookup_registry':
      return lookupRegistry(call.input, state, deps, ids, timeoutMs);
    case 'fetch_page_section':
      return fetchSection(call.input.hint, state, deps, ids, timeoutMs);
    case 'compare_offers':
      return compareOffers(call.input, state, deps, ids, timeoutMs);
    case 'get_domain_report': {
      const domain = registrableDomain(call.input.domain);
      const outcome = await callWithRetry(
        (options) => deps.signals.getDomainReport(domain, options),
        { timeoutMs, now: deps.now }
      );
      if (!outcome.ok) {
        return { ok: false, evidence: [], result: 'failed', error: outcome.error, ms: outcome.ms };
      }
      const evidence = outcome.value ?? [];
      return {
        ok: true,
        evidence,
        result: `Domain report: ${evidence.length} signal(s)`,
        ms: outcome.ms,
      };
    }
    default:
      return { ok: false, evidence: [], result: 'unsupported tool', error: 'unknown_tool', ms: 0 };
  }
}

async function lookupRegistry(
  input: Extract<ToolCall, { tool: 'lookup_registry' }>['input'],
  state: FollowUpState,
  deps: AgentDeps,
  ids: IdFactory,
  timeoutMs: number
): Promise<FollowUpOutcome> {
  const query = sanitizeText(input.query, { location: 'visible', maxLen: 120 }).clean.trim();
  if (query.length < 2) {
    return { ok: false, evidence: [], result: 'rejected', error: 'invalid_query', ms: 0 };
  }

  const outcome = await callWithRetry((options) => deps.registry.lookup({ by: input.by, query }, options), {
    timeoutMs,
    now: deps.now,
  });

  if (!outcome.ok) {
    return { ok: false, evidence: [], result: 'failed', error: outcome.error, ms: outcome.ms };
  }

  const records = (outcome.value ?? []).slice(0, 5);
  mergeRecords(state, input.by, records);

  if (records.length === 0) {
    return { ok: true, evidence: [], result: 'Registry: no records', ms: outcome.ms };
  }

  const evidence: Evidence = {
    id: ids.next('REGISTRY_RECORD'),
    type: 'REGISTRY_RECORD',
    severity: 'info',
    confidence: 1,
    summary: `The registry returned ${records.length} record(s).`,
    source: 'registry',
    deterministic: true,
    data: {
      query,
      by: input.by,
      records: records.map((record) => ({
        merchantId: record.merchantId,
        legalName: sanitizeText(record.legalName, { location: 'registry', maxLen: 200 }).clean,
        domain: record.domain,
      })),
    },
  };

  return {
    ok: true,
    evidence: [evidence],
    result: `Registry: ${records.length} record(s)`,
    ms: outcome.ms,
  };
}

async function fetchSection(
  hint: Extract<ToolCall, { tool: 'fetch_page_section' }>['input']['hint'],
  state: FollowUpState,
  deps: AgentDeps,
  ids: IdFactory,
  timeoutMs: number
): Promise<FollowUpOutcome> {
  const baseUrl = state.safeClaims?.sectionLinks[hint] ?? '';
  const outcome = await callWithRetry(
    (options) => deps.signals.fetchPageSection({ baseUrl, hint }, options),
    { timeoutMs, now: deps.now }
  );

  if (!outcome.ok) {
    return { ok: false, evidence: [], result: 'failed', error: outcome.error, ms: outcome.ms };
  }

  const section = outcome.value;
  if (!section || !section.found) {
    return { ok: true, evidence: [], result: `Section ${hint}: not found`, ms: outcome.ms };
  }

  const legalName = section.legalName
    ? sanitizeText(section.legalName, { location: 'registry', maxLen: 200 }).clean
    : undefined;
  const address = section.address
    ? sanitizeText(section.address, { location: 'registry', maxLen: 200 }).clean
    : undefined;
  const text = section.text
    ? sanitizeText(section.text, { location: 'section', maxLen: 3000 }).clean
    : undefined;

  if (!state.safeClaims?.legalName && legalName) {
    state.safeClaims = { ...state.safeClaims, legalName } as SafeClaims;
  }

  const evidence: Evidence = {
    id: ids.next('PAGE_SECTION_CLAIMS'),
    type: 'PAGE_SECTION_CLAIMS',
    severity: 'info',
    confidence: 1,
    summary: `The ${hint} page was read.`,
    source: 'rule',
    deterministic: true,
    data: {
      hint,
      ...(legalName ? { legalName } : {}),
      ...(address ? { address } : {}),
      ...(section.registrationNo ? { registrationNo: sanitizeText(section.registrationNo, { location: 'registry', maxLen: 80 }).clean } : {}),
      ...(text ? { textLength: text.length } : {}),
    },
  };

  return {
    ok: true,
    evidence: [evidence],
    result: `Section ${hint}: found`,
    ms: outcome.ms,
  };
}

async function compareOffers(
  input: Extract<ToolCall, { tool: 'compare_offers' }>['input'],
  state: FollowUpState,
  deps: AgentDeps,
  ids: IdFactory,
  timeoutMs: number
): Promise<FollowUpOutcome> {
  const outcome = await callWithRetry(
    (options) =>
      deps.signals.compareOffers(
        { productQuery: input.productQuery, maxPrice: input.maxPrice },
        options
      ),
    { timeoutMs, now: deps.now }
  );

  if (!outcome.ok) {
    return { ok: false, evidence: [], result: 'failed', error: outcome.error, ms: outcome.ms };
  }

  const summary = outcome.value;
  if (!summary || summary.offerCount === 0) {
    return { ok: true, evidence: [], result: 'Offers: none found', ms: outcome.ms };
  }

  const evidence: Evidence[] = [
    {
      id: ids.next('OFFER_COMPARISON'),
      type: 'OFFER_COMPARISON',
      severity: 'info',
      confidence: 1,
      summary: `Comparable offers were found for ${truncate(input.productQuery, 60)}.`,
      source: 'channel3',
      deterministic: true,
      data: {
        offerCount: summary.offerCount,
        medianPrice: summary.medianPrice,
        currency: summary.currency,
      },
    },
  ];

  const amount = state.request.transactionAmount;
  if (typeof amount === 'number' && amount > 0 && typeof summary.medianPrice === 'number' && summary.medianPrice > 0) {
    const discountPct = Math.round((1 - amount / summary.medianPrice) * 100);
    evidence.push({
      id: ids.next('PRICE_DEVIATION'),
      type: 'PRICE_DEVIATION',
      severity: discountPct >= 80 ? 'high' : discountPct >= 50 ? 'medium' : 'low',
      confidence: 1,
      summary: 'The price was compared with comparable sellers.',
      source: 'channel3',
      deterministic: true,
      data: { discountPct, price: amount, medianPrice: summary.medianPrice, offerCount: summary.offerCount },
    });
  }

  return {
    ok: true,
    evidence,
    result: `Offers: ${summary.offerCount}, median ${summary.medianPrice ?? 'unknown'}`,
    ms: outcome.ms,
  };
}

function mergeRecords(state: FollowUpState, by: 'name' | 'domain' | 'merchantId', records: RegistryRecord[]): void {
  if (records.length === 0) return;

  if (by === 'name') {
    const seen = new Set(state.brandOwnerRecords.map((record) => record.merchantId));
    for (const record of records) if (!seen.has(record.merchantId)) state.brandOwnerRecords.push(record);
    return;
  }

  if (by === 'merchantId') {
    const seen = new Set(state.payeeRecords.map((record) => record.merchantId));
    for (const record of records) if (!seen.has(record.merchantId)) state.payeeRecords.push(record);
  }
}
