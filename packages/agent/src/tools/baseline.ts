import type { Evidence, InvestigationRequest, TraceStep } from '../types.js';
import type { AgentDeps, CallOpts, PageClaims, RegistryRecord } from '../ports.js';
import { buildInjectionEvidence, deriveEvidence } from '../evidence/derive.js';
import type { IdFactory } from '../evidence/ids.js';
import { sanitizeClaims, type SafeClaims } from '../guard/claims.js';
import { registrableDomain } from '../util/domain.js';

/**
 * The baseline sweep runs without any AI: page claims, domain report, payee
 * binding and the payee registry lookup in parallel, then price and brand owner
 * once the page is known. Every call gets one retry, and a final failure becomes
 * TOOL_UNAVAILABLE evidence instead of an exception.
 */

export const BASELINE_TIMEOUT_MS = 3000;
export const MAX_ATTEMPTS = 2;

export interface BaselineResult {
  evidence: Evidence[];
  trace: TraceStep[];
  claims?: PageClaims;
  safeClaims?: SafeClaims;
  payeeRecords: RegistryRecord[];
  brandOwnerRecords: RegistryRecord[];
  failedBaseline: number;
  succeededBaseline: number;
}

interface CallOutcome<T> {
  ok: boolean;
  value?: T;
  error?: string;
  ms: number;
  tool: string;
}

export async function runBaseline(
  request: InvestigationRequest,
  deps: AgentDeps,
  ids: IdFactory,
  options: { timeoutMs?: number } = {}
): Promise<BaselineResult> {
  const timeoutMs = options.timeoutMs ?? BASELINE_TIMEOUT_MS;
  const domain = registrableDomain(request.merchantUrl);
  const hasPayee = Boolean(request.payee?.merchantId);
  const payee = request.payee;
  const brandQuery = request.claimedBrand;

  const claimsCall = callTool<PageClaims>(
    'get_page_claims',
    (opts) => deps.signals.getPageClaims(request.merchantUrl, opts),
    deps,
    timeoutMs
  );
  const domainCall = callTool<Evidence[]>(
    'get_domain_report',
    (opts) => deps.signals.getDomainReport(domain, opts),
    deps,
    timeoutMs
  );
  const bindingCall =
    hasPayee && payee
      ? callTool<Evidence[]>(
          'check_payee_binding',
          (opts) =>
            deps.signals.checkPayeeBinding(
              { domain, payee, claimedBrand: request.claimedBrand },
              opts
            ),
          deps,
          timeoutMs
        )
      : Promise.resolve(null);
  const payeeLookupCall =
    hasPayee && payee
      ? callTool<RegistryRecord[]>(
          'lookup_payee',
          (opts) => deps.registry.lookup({ by: 'merchantId', query: payee.merchantId }, opts),
          deps,
          timeoutMs
        )
      : Promise.resolve(null);

  const [claimsCallResult, domainCallResult, bindingCallResult, payeeLookupResult] = await Promise.all([
    claimsCall,
    domainCall,
    bindingCall,
    payeeLookupCall,
  ]);

  let priceCall: CallOutcome<Evidence[]> | null = null;
  let brandCall: CallOutcome<RegistryRecord[]> | null = null;
  let priceSkipped = false;

  if (claimsCallResult.ok && claimsCallResult.value) {
    const claims = claimsCallResult.value;
    const effectiveBrand = brandQuery ?? claims.claimedBrand;

    const pricePromise = callTool<Evidence[]>(
      'get_price_report',
      (opts) =>
        deps.signals.getPriceReport(
          {
            claims,
            items: request.items,
            amount: request.transactionAmount,
            currency: request.currency,
          },
          opts
        ),
      deps,
      timeoutMs
    );

    const brandPromise = effectiveBrand
      ? callTool<RegistryRecord[]>(
          'lookup_brand_owner',
          (opts) => deps.registry.lookup({ by: 'name', query: effectiveBrand }, opts),
          deps,
          timeoutMs
        )
      : Promise.resolve(null);

    [priceCall, brandCall] = await Promise.all([pricePromise, brandPromise]);
  } else {
    priceSkipped = true;
  }

  const evidence: Evidence[] = [];
  const trace: TraceStep[] = [];
  let failed = 0;
  let succeeded = 0;

  const addOutcome = <T>(
    outcome: CallOutcome<T> | null,
    take: (value: T) => Evidence[]
  ): Evidence[] => {
    if (!outcome) return [];
    if (outcome.ok && outcome.value !== undefined) {
      succeeded += 1;
      const produced = take(outcome.value);
      evidence.push(...produced);
      return produced;
    }
    failed += 1;
    const unavailable = toolUnavailable(outcome.tool, outcome.error ?? 'unknown error', ids);
    evidence.push(unavailable);
    return [unavailable];
  };

  addOutcome(claimsCallResult, () => []);
  const domainEvidence = addOutcome(domainCallResult, (list) => list);
  const bindingEvidence = addOutcome(bindingCallResult, (list) => list);
  const payeeRecords = payeeLookupResult?.ok ? (payeeLookupResult.value ?? []) : [];
  addOutcome(payeeLookupResult, () => []);
  const registryEvidence = registryLookupEvidence(payeeLookupResult, payeeRecords, payee?.merchantId, ids);
  evidence.push(...registryEvidence);
  const priceEvidence = addOutcome(priceCall, (list) => list);
  const brandOwnerRecords = brandCall?.ok ? (brandCall.value ?? []) : [];
  addOutcome(brandCall, () => []);

  const { safe, findings } = sanitizeClaims(claimsCallResult.ok ? claimsCallResult.value : undefined);
  const pageEvidence = buildPageEvidence(safe, ids);
  evidence.push(...pageEvidence);
  const injectionEvidence = buildInjectionEvidence(findings, ids);
  if (injectionEvidence) evidence.push(injectionEvidence);

  const derived = deriveEvidence(
    {
      payee,
      claimedBrand: brandQuery ?? safe?.claimedBrand,
      payeeRecords,
      brandOwnerRecords,
    },
    ids
  );
  evidence.push(...derived);

  if (!hasPayee) {
    evidence.push(payeeUnknown(ids));
  }

  let stepNumber = 0;
  const pushStep = (
    tool: string,
    input: string,
    outcome: CallOutcome<unknown>,
    produced: Evidence[]
  ): void => {
    stepNumber += 1;
    trace.push({
      step: stepNumber,
      tool,
      why: 'Standard check',
      input: truncate(input, 200),
      result: outcome.ok
        ? produced.length > 0
          ? `returned ${produced.length} evidence item(s)`
          : 'completed'
        : `failed: ${truncate(outcome.error ?? 'unknown error', 160)}`,
      evidenceIds: produced.map((entry) => entry.id).slice(0, 10),
      ok: outcome.ok,
      ms: outcome.ms,
    });
  };

  pushStep('get_page_claims', request.merchantUrl, claimsCallResult, [
    ...pageEvidence,
    ...(injectionEvidence ? [injectionEvidence] : []),
  ]);
  pushStep('get_domain_report', domain, domainCallResult, domainEvidence);
  if (bindingCallResult) pushStep('check_payee_binding', `payee=${payee?.merchantId}`, bindingCallResult, bindingEvidence);
  if (payeeLookupResult) {
    pushStep('lookup_payee', `merchantId=${payee?.merchantId}`, payeeLookupResult, registryEvidence);
  }
  if (priceCall) pushStep('get_price_report', `amount=${request.transactionAmount ?? 'unknown'}`, priceCall, priceEvidence);
  if (brandCall) pushStep('lookup_brand_owner', `name=${brandQuery ?? 'unknown'}`, brandCall, []);

  if (priceSkipped) {
    stepNumber += 1;
    trace.push({
      step: stepNumber,
      tool: 'get_price_report',
      why: 'Standard check',
      input: 'page claims unavailable',
      result: 'skipped',
      evidenceIds: [],
      ok: false,
      ms: 0,
    });
  }

  return {
    evidence,
    trace,
    claims: claimsCallResult.ok ? claimsCallResult.value : undefined,
    safeClaims: safe,
    payeeRecords,
    brandOwnerRecords,
    failedBaseline: failed,
    succeededBaseline: succeeded,
  };
}

async function callTool<T>(
  tool: string,
  fn: (options: CallOpts) => Promise<T>,
  deps: AgentDeps,
  timeoutMs: number
): Promise<CallOutcome<T>> {
  const started = deps.now();
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const value = await withTimeout(fn, timeoutMs);
      return { ok: true, tool, value, ms: Math.max(0, deps.now() - started) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: false,
    tool,
    error: truncate(lastError, 160),
    ms: Math.max(0, deps.now() - started),
  };
}

function withTimeout<T>(fn: (options: CallOpts) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, Math.max(1, timeoutMs));
    timer.unref?.();

    fn({ signal: controller.signal, timeoutMs }).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Turns what the page fetch actually returned into evidence. These facts explain missing data
 * (blocked, unsupported, empty, no structured product metadata); none of them adds risk points,
 * so an unavailable product page is never treated as evidence of fraud.
 */
function buildPageEvidence(claims: SafeClaims | undefined, ids: IdFactory): Evidence[] {
  if (!claims) return [];
  const evidence: Evidence[] = [];
  const access = claims.pageAccess;

  const marketplace = claims.marketplace;
  if (marketplace) {
    const region = marketplace.region ? `, ${marketplace.region}` : '';
    evidence.push({
      id: ids.next('MERCHANT_RECOGNIZED'),
      type: 'MERCHANT_RECOGNIZED',
      severity: 'low',
      confidence: 0.9,
      summary: truncate(
        `The domain is an official ${marketplace.displayName} storefront (${marketplace.officialDomain}${region}). Recognising the platform does not by itself clear the store.`,
        240,
      ),
      source: 'rule',
      deterministic: true,
      data: {
        marketplaceId: marketplace.id,
        officialDomain: marketplace.officialDomain,
        ...(marketplace.region ? { region: marketplace.region } : {}),
        verifiedVia: 'hostname',
      },
    });
  }

  if ((access?.state === 'ok' || access === undefined) && (claims.siteName || claims.claimedBrand || claims.legalName || claims.hasContactPage || claims.hasLegalPage)) {
    const siteName = claims.siteName ?? claims.claimedBrand;
    evidence.push({
      id: ids.next('SITE_NAME'),
      type: 'SITE_NAME',
      severity: 'info',
      confidence: 0.8,
      summary: siteName
        ? truncate(`The page presents itself as "${siteName}".`, 240)
        : 'The page does not publish a clear merchant name.',
      source: 'rule',
      deterministic: true,
      data: {
        siteName: siteName ?? null,
        legalName: claims.legalName ?? null,
        hasContactPage: claims.hasContactPage,
        hasLegalPage: claims.hasLegalPage,
      },
    });
  }

  if (access?.state === 'blocked') {
    evidence.push({
      id: ids.next('PAGE_BLOCKED'),
      type: 'PAGE_BLOCKED',
      severity: 'low',
      confidence: 0.9,
      summary: blockedSummary(access.reason),
      source: 'rule',
      deterministic: true,
      data: {
        state: access.state,
        ...(access.reason ? { reason: access.reason } : {}),
        ...(access.httpStatus !== undefined ? { httpStatus: access.httpStatus } : {}),
      },
    });
  } else if (access?.state === 'unreachable' || access?.state === 'unsupported') {
    evidence.push({
      id: ids.next('PAGE_UNAVAILABLE'),
      type: 'PAGE_UNAVAILABLE',
      severity: 'low',
      confidence: 0.8,
      summary: unavailableSummary(access.reason),
      source: 'rule',
      deterministic: true,
      data: {
        state: access.state,
        ...(access.reason ? { reason: access.reason } : {}),
        ...(access.httpStatus !== undefined ? { httpStatus: access.httpStatus } : {}),
      },
    });
  } else if (access?.state === 'empty') {
    evidence.push({
      id: ids.next('PAGE_EMPTY'),
      type: 'PAGE_EMPTY',
      severity: 'low',
      confidence: 0.8,
      summary: 'The merchant page returned no readable content, so page signals were not collected.',
      source: 'rule',
      deterministic: true,
      data: { state: access.state, ...(access.reason ? { reason: access.reason } : {}) },
    });
  }

  const product =
    claims.product && productLooksGrounded(claims.finalUrl, claims.product) ? claims.product : undefined;
  if (product) {
    evidence.push({
      id: ids.next('PRODUCT_METADATA'),
      type: 'PRODUCT_METADATA',
      severity: 'info',
      confidence: 0.9,
      summary: productSummary(product),
      source: 'rule',
      deterministic: true,
      data: {
        ...product,
        source: product.source,
      },
    });
  } else if (marketplace && (access?.state === 'ok' || access === undefined)) {
    evidence.push({
      id: ids.next('PRODUCT_DATA_UNAVAILABLE'),
      type: 'PRODUCT_DATA_UNAVAILABLE',
      severity: 'low',
      confidence: 0.7,
      summary:
        'The page was reachable, but no product name or price was found in its structured metadata; only merchant-level signals were available.',
      source: 'rule',
      deterministic: true,
      data: {
        marketplaceId: marketplace.id,
        pageState: access?.state ?? 'unknown',
      },
    });
  }

  return evidence;
}

function blockedSummary(reason: string | undefined): string {
  switch (reason) {
    case 'captcha':
      return 'The merchant page asked for a CAPTCHA, so product details were not available.';
    case 'bot_check':
      return 'The merchant page returned a bot-check page, so product details were not available.';
    case 'access_denied':
      return 'The merchant page refused automated access, so product details were not available.';
    case 'rate_limited':
      return 'The merchant page rate-limited the request, so product details were not available.';
    default:
      return 'The merchant page could not be read, so product details were not available.';
  }
}

function unavailableSummary(reason: string | undefined): string {
  switch (reason) {
    case 'replay_mode':
    case 'no_recorded_signals':
      return 'This API is replaying recorded signals and has no recording for this domain.';
    case 'unsafe_url':
      return 'The merchant address was rejected by the URL safety check.';
    case 'network_error':
      return 'The merchant page could not be reached, so page signals were not collected.';
    case 'service_unavailable':
      return 'The merchant page returned a temporary server error, so page signals were not collected.';
    case 'not_found':
      return 'The merchant page was not found, so page signals were not collected.';
    default:
      return 'Page signals were not available for this merchant.';
  }
}

/**
 * A page title alone is not product data. Structured metadata is treated as a product only when
 * it carries a price or brand, or when the URL is a product-style path. This keeps a homepage's
 * OpenGraph title from being presented as a product.
 */
function productLooksGrounded(
  finalUrl: string,
  product: NonNullable<SafeClaims['product']>,
): boolean {
  if (product.price !== undefined || product.brand) return true;
  try {
    const path = new URL(finalUrl).pathname;
    return /\/(?:dp|gp\/product|product|products|p|item|listing)\//i.test(`${path}/`);
  } catch {
    return false;
  }
}

function productSummary(product: NonNullable<SafeClaims['product']>): string {
  const parts: string[] = [];
  if (product.name) parts.push(product.name);
  if (product.price !== undefined) {
    parts.push(`${product.currency ? `${product.currency} ` : ''}${product.price}`);
  }
  if (product.availability) parts.push(product.availability);
  if (product.seller) parts.push(`sold by ${product.seller}`);

  const text = parts.length
    ? `Structured page data lists ${parts.join(', ')}.`
    : 'The page published structured product metadata.';
  return truncate(text, 240);
}

function registryLookupEvidence(
  outcome: CallOutcome<RegistryRecord[]> | null,
  records: readonly RegistryRecord[],
  merchantId: string | undefined,
  ids: IdFactory,
): Evidence[] {
  if (!outcome?.ok) return [];

  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!record?.merchantId || seen.has(record.merchantId)) continue;
    seen.add(record.merchantId);
    evidence.push({
      id: ids.next('REGISTRY_RECORD'),
      type: 'REGISTRY_RECORD',
      severity: 'info',
      confidence: 0.9,
      summary: truncate(
        `The merchant registry has a record for ${record.legalName || record.merchantId} (${record.merchantId}).`,
        240,
      ),
      source: 'registry',
      deterministic: true,
      data: {
        merchantId: record.merchantId,
        legalName: record.legalName,
        status: record.status,
        domain: record.domain,
        brandNames: record.brandNames,
      },
    });
  }

  if (evidence.length === 0) {
    evidence.push({
      id: ids.next('REGISTRY_EMPTY'),
      type: 'REGISTRY_EMPTY',
      severity: 'low',
      confidence: 0.8,
      summary: 'The registry was checked for the receiving account but returned no records.',
      source: 'registry',
      deterministic: true,
      data: { merchantId: merchantId ?? null },
    });
  }

  return evidence;
}

function toolUnavailable(tool: string, reason: string, ids: IdFactory): Evidence {
  return {
    id: ids.next('TOOL_UNAVAILABLE'),
    type: 'TOOL_UNAVAILABLE',
    severity: 'info',
    confidence: 1,
    summary: 'A standard check could not be completed, so the result may be incomplete.',
    source: 'rule',
    deterministic: true,
    data: { tool, reason: truncate(reason, 160) },
  };
}

function payeeUnknown(ids: IdFactory): Evidence {
  return {
    id: ids.next('PAYEE_UNKNOWN'),
    type: 'PAYEE_UNKNOWN',
    severity: 'info',
    confidence: 1,
    summary: 'No payment account was supplied, so the seller could only be assessed from the website.',
    source: 'rule',
    deterministic: true,
  };
}

function truncate(value: string, maxLength: number): string {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
