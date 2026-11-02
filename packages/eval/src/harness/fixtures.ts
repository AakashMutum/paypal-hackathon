/**
 * Builds the agent's inputs from a case's raw observables. Nothing here reads `label` or
 * `category`: a case can only influence a system through what a collector would have seen.
 */

import type {
  Evidence,
  InvestigationRequest,
  PageClaims,
  RegistryPort,
  RegistryRecord,
  SignalsPort,
} from '@checkout-guardian/agent';
import type { EvaluationCase } from '../dataset/schema.js';

/**
 * The dataset only uses .example addresses. `freemail.example` stands for a consumer webmail
 * provider; the agent recognises real provider domains, so the harness substitutes one when it
 * builds the agent's request. Both are invented-data stand-ins and are never contacted.
 */
export const FREEMAIL_PLACEHOLDER = 'freemail.example';
export const FREEMAIL_STAND_IN = 'gmail.com';

export function hostOfUrl(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function registrableOf(host: string): string {
  const labels = host.replace(/^www\./, '').split('.');
  return labels.slice(-2).join('.');
}

export function buildRequest(c: EvaluationCase): InvestigationRequest {
  const email = c.payeeEmail.endsWith(`@${FREEMAIL_PLACEHOLDER}`)
    ? c.payeeEmail.replace(FREEMAIL_PLACEHOLDER, FREEMAIL_STAND_IN)
    : c.payeeEmail;
  return {
    orderId: c.id,
    merchantUrl: c.merchantUrl,
    claimedBrand: c.claimedBrand,
    transactionAmount: c.listedPrice,
    currency: 'USD',
    payee: { merchantId: c.payeeMerchantId, email },
    items: [{ name: 'Catalogue item', quantity: 1, unitPrice: c.listedPrice }],
  };
}

export function discountPct(c: EvaluationCase): number {
  return Math.max(0, Math.round(((c.referencePrice - c.listedPrice) / c.referencePrice) * 100));
}

function labelOf(domain: string): string {
  return domain.split('.')[0] ?? domain;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Does the store's domain imitate the real brand domain? Pure string comparison. */
export function isLookalike(merchantHost: string, brandDomain: string): boolean {
  const own = registrableOf(merchantHost);
  if (own === registrableOf(brandDomain)) return false;
  const a = labelOf(own).replace(/[^a-z0-9]/g, '');
  const b = labelOf(registrableOf(brandDomain)).replace(/[^a-z0-9]/g, '');
  const near = editDistance(a, b) / Math.max(a.length, b.length) <= 0.25;
  const brandToken = labelOf(registrableOf(brandDomain)).split('-')[0];
  const contains = brandToken.length >= 4 && labelOf(own).split('-').includes(brandToken);
  return near || contains;
}

let sequence = 0;
function evidence(
  type: string,
  source: Evidence['source'],
  severity: Evidence['severity'],
  summary: string,
  data: Record<string, unknown>,
  hardFail = false,
): Evidence {
  sequence += 1;
  return {
    id: `EVD-EVAL-${type}-${String(sequence).padStart(4, '0')}`,
    type,
    severity,
    confidence: 1,
    summary,
    source,
    deterministic: true,
    ...(hardFail ? { hardFail: true } : {}),
    data,
  };
}

export function domainAgeEvidence(c: EvaluationCase): Evidence {
  const age = c.domainAgeDays;
  const severity = age < 7 ? 'high' : age < 30 ? 'medium' : age < 90 ? 'low' : 'info';
  return evidence('DOMAIN_AGE', 'rdap', severity, `The domain was registered ${age} days ago.`, { ageDays: age });
}

export function priceEvidence(c: EvaluationCase): Evidence {
  const pct = discountPct(c);
  const severity = pct >= 90 ? 'high' : pct >= 70 ? 'medium' : pct >= 40 ? 'low' : 'info';
  return evidence('PRICE_DEVIATION', 'channel3', severity, 'The price compared with similar sellers.', {
    discountPct: pct,
    price: c.listedPrice,
    medianPrice: c.referencePrice,
    offerCount: 9,
  });
}

export function bindingEvidence(c: EvaluationCase): Evidence {
  if (c.bindingMerchantId === null) {
    return evidence('PAYEE_BINDING', 'kernel', 'medium', 'The website does not publish its receiving account.', {
      status: 'NO_BINDING',
      actualMerchantId: c.payeeMerchantId,
      linkedBrandIds: [],
    });
  }
  if (c.bindingMerchantId === c.payeeMerchantId) {
    return evidence('PAYEE_BINDING', 'kernel', 'info', 'The receiving account matches the website.', {
      status: 'MATCH',
      expectedMerchantId: c.bindingMerchantId,
      actualMerchantId: c.payeeMerchantId,
      linkedBrandIds: [],
    });
  }
  return evidence(
    'PAYEE_BINDING',
    'kernel',
    'high',
    'The receiving account is not the one the website names.',
    { status: 'MISMATCH', expectedMerchantId: c.bindingMerchantId, actualMerchantId: c.payeeMerchantId, linkedBrandIds: [] },
    true,
  );
}

export function lookalikeEvidence(c: EvaluationCase): Evidence | null {
  if (!c.brandOwner) return null;
  if (!isLookalike(hostOfUrl(c.merchantUrl), c.brandOwner.domain)) return null;
  return evidence('LOOKALIKE_DOMAIN', 'rule', 'high', 'The address closely resembles a known brand address.', {
    matchesKnownBrand: true,
    brandId: `BRAND-${c.brandOwner.merchantId}`,
    brandName: c.claimedBrand,
  });
}

export function pageClaims(c: EvaluationCase): PageClaims {
  const host = hostOfUrl(c.merchantUrl);
  return {
    finalUrl: c.merchantUrl,
    domain: host,
    siteName: c.claimedBrand,
    ...(c.pageLegalName ? { legalName: c.pageLegalName } : {}),
    claimedBrand: c.claimedBrand,
    contacts: { emails: [c.payeeEmail], phones: [] },
    linkedDomains: [],
    visibleText: c.pageText,
    hiddenText: c.hiddenText ?? '',
    sectionLinks: {},
    hasContactPage: true,
    hasLegalPage: c.pageLegalName !== null,
  };
}

export interface SignalSwitches {
  domain?: boolean;
  price?: boolean;
  binding?: boolean;
}

export function buildSignals(c: EvaluationCase, on: SignalSwitches = {}): SignalsPort {
  const { domain = true, price = true, binding = true } = on;
  return {
    async getPageClaims() {
      return pageClaims(c);
    },
    async getDomainReport() {
      if (!domain) return [];
      const lookalike = lookalikeEvidence(c);
      return [domainAgeEvidence(c), ...(lookalike ? [lookalike] : [])];
    },
    async getPriceReport() {
      return price ? [priceEvidence(c)] : [];
    },
    async checkPayeeBinding() {
      return binding ? [bindingEvidence(c)] : [];
    },
    async fetchPageSection() {
      return { found: false };
    },
    async compareOffers() {
      return { offerCount: 0, sampleDomains: [] };
    },
  };
}

function toRegistryRecord(r: { merchantId: string; legalName: string; brandNames: string[]; domain?: string; city?: string; country?: string }): RegistryRecord {
  return {
    merchantId: r.merchantId,
    legalName: r.legalName,
    brandNames: r.brandNames,
    domain: r.domain ?? '',
    ...(r.city ? { city: r.city } : {}),
    ...(r.country ? { country: r.country } : {}),
    status: 'verified',
    linkedBrandIds: [],
  };
}

export function payeeRegistryRecord(c: EvaluationCase): RegistryRecord | null {
  if (!c.registryRecord) return null;
  return toRegistryRecord({ merchantId: c.payeeMerchantId, ...c.registryRecord });
}

export function buildRegistry(c: EvaluationCase, enabled = true): RegistryPort {
  const payee = payeeRegistryRecord(c);
  const owner = c.brandOwner ? toRegistryRecord(c.brandOwner) : null;
  return {
    async lookup(input) {
      if (!enabled) return [];
      const q = input.query.toLowerCase();
      const out: RegistryRecord[] = [];
      const push = (r: RegistryRecord | null) => {
        if (r && !out.some((x) => x.merchantId === r.merchantId)) out.push(r);
      };
      if (input.by === 'merchantId') {
        if (payee && payee.merchantId.toLowerCase() === q) push(payee);
        if (owner && owner.merchantId.toLowerCase() === q) push(owner);
      } else if (input.by === 'name') {
        for (const r of [payee, owner]) {
          if (r && r.brandNames.some((n) => n.toLowerCase() === q)) push(r);
        }
      } else {
        for (const r of [payee, owner]) {
          if (r && r.domain.toLowerCase() === q) push(r);
        }
      }
      return out.slice(0, 5);
    },
  };
}
