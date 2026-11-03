import type { Evidence } from '../types.js';
import type {
  CallOpts,
  OfferSummary,
  PageClaims,
  SectionHint,
  SectionResult,
  SignalsPort,
} from '../ports.js';
import type { ScenarioFixture } from '../fixtures/types.js';
import { clone, createGate, type FixtureBehaviour } from './fixtureGate.js';
import { postJson } from './http.js';

const DOMAIN_TYPES = ['DOMAIN_AGE', 'LOOKALIKE_DOMAIN', 'TLS_INVALID'];
const PRICE_TYPES = ['PRICE_DEVIATION', 'PRICE_UNKNOWN'];
const BINDING_TYPES = ['PAYEE_BINDING'];

export function createFixtureSignals(
  fixture: ScenarioFixture,
  behaviour: FixtureBehaviour = {}
): SignalsPort {
  const gate = createGate(behaviour);
  const pick = (...types: string[]): Evidence[] =>
    fixture.signalsEvidence.filter((entry) => types.includes(entry.type)).map(clone);

  return {
    async getPageClaims(_url: string, _options: CallOpts): Promise<PageClaims> {
      await gate('getPageClaims');
      return clone(fixture.claims);
    },
    async getDomainReport(_domain: string, _options: CallOpts): Promise<Evidence[]> {
      await gate('getDomainReport');
      return pick(...DOMAIN_TYPES);
    },
    async getPriceReport(): Promise<Evidence[]> {
      await gate('getPriceReport');
      return pick(...PRICE_TYPES);
    },
    async checkPayeeBinding(): Promise<Evidence[]> {
      await gate('checkPayeeBinding');
      return pick(...BINDING_TYPES);
    },
    async fetchPageSection(input: { baseUrl: string; hint: SectionHint }): Promise<SectionResult> {
      await gate('fetchPageSection');
      return clone(fixture.sections?.[input.hint] ?? { found: false });
    },
    async compareOffers(): Promise<OfferSummary> {
      await gate('compareOffers');
      return clone(fixture.offers ?? { offerCount: 0, sampleDomains: [] });
    },
  };
}

/**
 * Live implementation. Endpoint paths are provisional until the Signals service
 * (signals area) is available; they are all declared here so only this file changes.
 */
export function createHttpSignals(baseUrl: string, fetchImpl: typeof fetch = fetch): SignalsPort {
  const base = baseUrl.replace(/\/+$/, '');
  const post = <T>(path: string, body: unknown, options: CallOpts): Promise<T> =>
    postJson<T>(`${base}${path}`, body, options, fetchImpl);

  return {
    getPageClaims: (url, options) => post('/signals/page-claims', { url }, options),
    getDomainReport: (domain, options) => post('/signals/domain-report', { domain }, options),
    getPriceReport: (input, options) => post('/signals/price-report', input, options),
    checkPayeeBinding: (input, options) => post('/signals/payee-binding', input, options),
    fetchPageSection: (input, options) => post('/signals/page-section', input, options),
    compareOffers: (input, options) => post('/signals/compare-offers', input, options),
  };
}
