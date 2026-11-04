import { readCertificate } from '../certificate/tls.js';
import { domainAgeDays, findRegistrarName, findRegistrationDate, rdapUrlFor } from '../domain/rdap.js';
import { PayeeBindingCollector } from '../payee/binding.js';
import { assertSafeUrl, UnsafeUrlError } from '../safety/url.js';
import { readLimitedText, registrableDomain } from '../util.js';
import { classifyPageAccess, extractPageClaims, extractSection, SECTION_PATHS } from './html.js';
import { safeGet } from './http.js';
import { detectLookalike } from './lookalike.js';
import { recognizeMarketplace } from './marketplace.js';
import { createMockPort } from './mock.js';
import type {
  AgentEvidence,
  AgentEvidenceSource,
  AgentSeverity,
  AgentSignalsPort,
  CallOpts,
  LocalSignalsPortOptions,
  OfferSummary,
  PageAccess,
  PageClaims,
  SectionHint,
  SectionResult,
  SectionValidation,
} from './types.js';

export const ageSeverity = (ageDays: number): AgentSeverity =>
  ageDays < 7 ? 'high' : ageDays < 30 ? 'medium' : ageDays < 90 ? 'low' : 'info';

export const discountSeverity = (discountPct: number): AgentSeverity =>
  discountPct >= 90 ? 'high' : discountPct >= 70 ? 'medium' : discountPct >= 40 ? 'low' : 'info';

const emptyOffers = (): OfferSummary => ({ offerCount: 0, sampleDomains: [] });

function emptyClaims(url: string, access: PageAccess): PageClaims {
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
    pageAccess: access,
    ...(marketplace ? { marketplace } : {}),
  };
}

function withMarketplace(claims: PageClaims): PageClaims {
  if (claims.marketplace) return claims;
  const marketplace = recognizeMarketplace(claims.domain || claims.finalUrl);
  return marketplace ? { ...claims, marketplace } : claims;
}

export function createLocalSignalsPort(options: LocalSignalsPortOptions): AgentSignalsPort {
  if (options.mode === 'mock') return createMockPort(options);

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const known = options.knownBrandDomains ?? [];
  const bindingCollector = new PayeeBindingCollector();
  const brandByDomain = new Map<string, string>();
  let counter = 0;

  const evidence = (
    type: string,
    source: AgentEvidenceSource,
    severity: AgentSeverity,
    summary: string,
    data: Record<string, unknown>,
    extra: { hardFail?: boolean; confidence?: number } = {},
  ): AgentEvidence => {
    counter += 1;
    return {
      id: `EVD-SIG-${type}-${String(counter).padStart(2, '0')}`,
      type,
      severity,
      confidence: extra.confidence ?? 1,
      summary,
      source,
      deterministic: true,
      ...(extra.hardFail ? { hardFail: true } : {}),
      data,
    };
  };

  const unavailable = (tool: string, source: AgentEvidenceSource, reason: unknown): AgentEvidence => ({
    ...evidence('TOOL_UNAVAILABLE', source, 'info', `${tool} could not be completed.`, {
      tool,
      reason: String(reason instanceof Error ? reason.message : reason).slice(0, 160),
    }),
    deterministic: false,
    confidence: 0.2,
  });

  const lookup = options.lookupImpl;
  const getOpts = (o: CallOpts) => ({
    fetchImpl,
    lookup,
    timeoutMs: o.timeoutMs,
    signal: o.signal,
  });

  async function validateSection(url: string, o: CallOpts): Promise<SectionValidation> {
    try {
      const page = await safeGet(url, {
        ...getOpts(o),
        timeoutMs: Math.min(o.timeoutMs, 1200),
        maxBytes: 128 * 1024,
        maxRetries: 0,
      });
      const contentType = page.contentType?.split(';')[0]?.trim().toLowerCase();
      const textual =
        !contentType ||
        contentType === 'text/html' ||
        contentType === 'application/xhtml+xml' ||
        contentType === 'text/plain';
      const section = page.ok ? extractSection(page.text, page.finalUrl, 4000, page.status) : { found: false };
      const meaningful =
        page.ok && textual && section.found && (section.text?.trim().length ?? 0) >= 80;
      return {
        url: page.finalUrl,
        reachable: page.ok,
        status: page.status,
        ...(contentType ? { contentType } : {}),
        meaningful,
        ...(meaningful
          ? {}
          : { reason: !page.ok ? 'http_error' : !textual ? 'not_textual' : 'not_meaningful' }),
      };
    } catch (error) {
      return {
        url,
        reachable: false,
        meaningful: false,
        reason: error instanceof UnsafeUrlError ? 'unsafe_url' : 'unreachable',
      };
    }
  }

  async function domainAge(domain: string, o: CallOpts): Promise<AgentEvidence[]> {
    const rdapDomain = registrableDomain(domain);
    const url = await rdapUrlFor(rdapDomain, {
      fetchImpl,
      timeoutMs: o.timeoutMs,
      ...(o.signal ? { signal: o.signal } : {}),
    });
    const timeout = AbortSignal.timeout(o.timeoutMs);
    const res = await fetchImpl(url, {
      headers: { accept: 'application/rdap+json, application/json' },
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
    if (!res.ok) return [unavailable('domain age lookup', 'rdap', `HTTP ${res.status}`)];
    let body: unknown = null;
    try {
      body = JSON.parse(await readLimitedText(res, 512 * 1024));
    } catch {
      body = null;
    }
    const registered = findRegistrationDate(body);
    const ageDays = registered ? domainAgeDays(registered, new Date(now())) : null;
    const registrar = findRegistrarName(body);
    if (registered === null || ageDays === null) {
      return [unavailable('domain age lookup', 'rdap', 'no registration date')];
    }
    return [
      evidence(
        'DOMAIN_AGE',
        'rdap',
        ageSeverity(ageDays),
        registrar
          ? `The domain was registered ${ageDays} days ago with ${registrar}.`
          : `The domain was registered ${ageDays} days ago.`,
        {
          ageDays,
          registrationDate: registered,
          ...(registrar ? { registrar } : {}),
        },
      ),
    ];
  }

  async function tlsReport(domain: string, o: CallOpts, addresses: string[]): Promise<AgentEvidence[]> {
    const probe =
      options.tlsProbe ?? ((host: string, address: string, ms: number) => readCertificate(address, host, ms));
    const cert = await probe(domain, addresses[0], o.timeoutMs);
    if (cert.daysToExpiry < 0 || !cert.authorized) {
      return [
        evidence(
          'TLS_INVALID',
          'tls',
          cert.daysToExpiry < 0 ? 'high' : 'medium',
          cert.daysToExpiry < 0 ? 'The security certificate has expired.' : 'The security certificate is not trusted.',
          {
            expired: cert.daysToExpiry < 0,
            daysToExpiry: cert.daysToExpiry,
            issuer: cert.issuer,
            reason: cert.authorizationError,
          },
        ),
      ];
    }
    return [
      evidence(
        'TLS_VALID',
        'tls',
        'info',
        `The security certificate is valid for ${cert.daysToExpiry} more days.`,
        {
          daysToExpiry: cert.daysToExpiry,
          issuer: cert.issuer,
          validFrom: cert.validFrom,
          validTo: cert.validTo,
        },
      ),
    ];
  }

  return {
    async getPageClaims(url, o) {
      try {
        let claims = options.kernel
          ? withMarketplace(await options.kernel.getPageClaims(url, o))
          : await (async () => {
              const page = await safeGet(url, { ...getOpts(o), maxBytes: 512 * 1024 });
              if (!page.ok) {
                return emptyClaims(page.finalUrl, classifyPageAccess('', undefined, page.status, ''));
              }
              return extractPageClaims(page.text, page.finalUrl, page.status);
            })();
        const brand = claims.claimedBrand ?? claims.siteName;
        if (brand && claims.domain && claims.pageAccess?.state !== 'blocked') {
          brandByDomain.set(registrableDomain(claims.domain), brand);
        }
        if (options.validateSectionPages && claims.pageAccess?.state === 'ok') {
          const contactUrl = claims.sectionLinks.contact;
          const legalUrl = claims.sectionLinks.terms ?? claims.sectionLinks.privacy;
          const [contactValidation, legalValidation] = await Promise.all([
            contactUrl ? validateSection(contactUrl, o) : Promise.resolve(undefined),
            legalUrl ? validateSection(legalUrl, o) : Promise.resolve(undefined),
          ]);
          claims = {
            ...claims,
            ...(contactValidation ? { contactValidation } : {}),
            ...(legalValidation ? { legalValidation } : {}),
          };
        }
        return claims;
      } catch (error) {
        const access: PageAccess =
          error instanceof UnsafeUrlError
            ? { state: 'unsupported', reason: 'unsafe_url' }
            : { state: 'unreachable', reason: 'network_error' };
        return emptyClaims(url, access);
      }
    },

    async getDomainReport(domain, o) {
      let addresses: string[];
      try {
        ({ addresses } = await assertSafeUrl(`https://${domain}/`, { lookup }));
      } catch (e) {
        return [unavailable('domain report', 'rule', e)];
      }
      const [age, tls] = await Promise.allSettled([domainAge(domain, o), tlsReport(domain, o, addresses)]);
      const out: AgentEvidence[] = [];
      if (age.status === 'fulfilled') out.push(...age.value);
      else out.push(unavailable('domain age lookup', 'rdap', age.reason));
      if (tls.status === 'fulfilled') out.push(...tls.value);
      else out.push(unavailable('certificate check', 'tls', tls.reason));

      const brand = brandByDomain.get(registrableDomain(domain)) ?? options.claimedBrand;
      const match = detectLookalike(domain, known, brand);
      if (match) {
        out.push(
          evidence('LOOKALIKE_DOMAIN', 'rule', 'high', `The address closely resembles the ${match.brandName} brand address.`, {
            ...match,
          }),
        );
      }
      return out;
    },

    async getPriceReport(input, o) {
      const item = input.items?.[0];
      const price = item?.unitPrice ?? input.amount ?? input.claims.product?.price;
      const productQuery = item?.name ?? input.claims.product?.name ?? input.claims.siteName;
      if (!options.channel3 || !price || !productQuery) {
        const reason = !options.channel3 ? 'no_catalogue' : !price ? 'no_price' : 'no_product';
        return [
          evidence('PRICE_UNKNOWN', 'channel3', 'info', 'No price comparison was available.', {
            reason,
            history: 'unavailable',
            ...(input.claims.product?.source ? { productSource: input.claims.product.source } : {}),
          }),
        ];
      }
      try {
        const offers = await options.channel3.searchOffers({ productQuery, maxPrice: price, currency: input.currency }, o);
        if (offers.offerCount === 0 || !offers.medianPrice) {
          return [
            evidence('PRICE_UNKNOWN', 'channel3', 'info', 'No comparable offers were found.', {
              reason: 'no_offers',
              history: 'unavailable',
            }),
          ];
        }
        const discountPct = Math.max(0, Math.round(((offers.medianPrice - price) / offers.medianPrice) * 100));
        return [
          evidence(
            'PRICE_DEVIATION',
            'channel3',
            discountSeverity(discountPct),
            discountPct >= 40 ? 'The price is far below comparable sellers.' : 'The price is in line with comparable sellers.',
            {
              discountPct,
              price,
              medianPrice: offers.medianPrice,
              offerCount: offers.offerCount,
              currency: offers.currency ?? input.currency,
              ...(offers.source ? { source: offers.source } : {}),
              ...(offers.provider ? { provider: offers.provider } : {}),
              ...(offers.fetchedAt ? { fetchedAt: offers.fetchedAt } : {}),
              history: offers.history ?? 'unavailable',
            },
          ),
        ];
      } catch (e) {
        return [unavailable('price comparison', 'channel3', e)];
      }
    },

    async checkPayeeBinding(input, o) {
      const merchantId = input.payee?.merchantId;
      if (!merchantId) return [];
      try {
        const found = await bindingCollector.collect(
          { orderId: 'agent-port', merchantUrl: `https://${input.domain}/`, payee: { merchantId } },
          { fetchImpl, lookupImpl: lookup, timeoutMs: o.timeoutMs, signal: o.signal },
        );
        const result = found.find((e) => e.type.startsWith('PAYEE_BINDING_') && e.type !== 'PAYEE_BINDING_SKIPPED');
        if (!result) return [];
        if (result.type === 'PAYEE_BINDING_MISMATCH') {
          const observed = String(result.metadata?.observedMerchantId ?? '');
          return [
            evidence(
              'PAYEE_BINDING',
              'kernel',
              'high',
              'The receiving account is not the merchant the website names.',
              { status: 'MISMATCH', expectedMerchantId: observed, actualMerchantId: merchantId, linkedBrandIds: [] },
              { hardFail: true },
            ),
          ];
        }
        if (result.type === 'PAYEE_BINDING_OK') {
          return [
            evidence('PAYEE_BINDING', 'kernel', 'info', 'The receiving account matches the merchant the website names.', {
              status: 'MATCH',
              expectedMerchantId: merchantId,
              actualMerchantId: merchantId,
              linkedBrandIds: [],
            }),
          ];
        }
        return [
          evidence('PAYEE_BINDING', 'kernel', 'medium', 'The website does not publish which account receives its payments.', {
            status: 'NO_BINDING',
            actualMerchantId: merchantId,
            linkedBrandIds: [],
          }),
        ];
      } catch (e) {
        return [unavailable('payee check', 'kernel', e)];
      }
    },

    async fetchPageSection(input, o): Promise<SectionResult> {
      const base = input.baseUrl;
      for (const path of SECTION_PATHS[input.hint as SectionHint] ?? []) {
        try {
          const url = new URL(path, base).toString();
          const page = await safeGet(url, { ...getOpts(o), maxBytes: 256 * 1024 });
          if (page.ok && page.text) {
            const section = extractSection(page.text, page.finalUrl, 4000, page.status);
            if (section.found) return section;
          }
        } catch {
          // Try the next usual path; an unsafe or failing URL is simply "not found".
        }
      }
      return { found: false };
    },

    async compareOffers(input, o) {
      if (!options.channel3) return emptyOffers();
      try {
        return await options.channel3.searchOffers(input, o);
      } catch {
        return emptyOffers();
      }
    },
  };
}
