import { loadFixtures, type Fixture } from '../mocks/fixtures.js';
import { hostnameOf } from '../util.js';
import type {
  AgentEvidence,
  AgentSeverity,
  AgentSignalsPort,
  LocalSignalsPortOptions,
  PageClaims,
} from './types.js';

// Mock mode replays tests/fixtures/*.json. Fixture evidence has only a kind, a severity and a
// sentence, so the agent's data fields are recovered defensively from that sentence. The fixture
// verdict is never read: this package does not produce decisions.

const DAY = { day: 1, week: 7, month: 30, year: 365 } as const;

function severityOf(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : 'info';
}

function ageFrom(text: string): number | undefined {
  const m = text.match(/(\d+)\s*(day|week|month|year)s?/i);
  return m ? Number(m[1]) * DAY[m[2].toLowerCase() as keyof typeof DAY] : undefined;
}

function ageSeverity(days: number): AgentSeverity {
  return days < 7 ? 'high' : days < 30 ? 'medium' : days < 90 ? 'low' : 'info';
}

function mk(
  fixtureHost: string,
  index: number,
  type: string,
  source: AgentEvidence['source'],
  severity: AgentSeverity,
  summary: string,
  data: Record<string, unknown>,
  hardFail = false,
): AgentEvidence {
  return {
    id: `EVD-MOCK-${fixtureHost}-${type}-${index}`.slice(0, 80),
    type,
    severity,
    confidence: 0.8,
    summary: summary.slice(0, 240),
    source,
    deterministic: true,
    ...(hardFail ? { hardFail: true } : {}),
    data,
  };
}

interface Item {
  kind: string;
  severity: string;
  text: string;
}

function itemsOf(fixture: Fixture): Item[] {
  return fixture.evidence.map((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      kind: typeof r.kind === 'string' ? r.kind : 'unknown',
      severity: severityOf(r.severity),
      text: typeof r.observation === 'string' ? r.observation : '',
    };
  });
}

export function createMockPort(options: LocalSignalsPortOptions): AgentSignalsPort {
  const fixtures = loadFixtures(options.fixturesDir);
  const find = (host: string): Fixture | undefined => fixtures.find((f) => f.storefrontHost === host.toLowerCase());
  const hostOf = (value: string): string => {
    try {
      return value.includes('://') ? hostnameOf(value) : value.toLowerCase();
    } catch {
      return '';
    }
  };

  return {
    async getPageClaims(url) {
      const host = hostOf(url);
      const f = find(host);
      const req = f?.request ?? {};
      const brand = typeof req.claimedBrandName === 'string' ? req.claimedBrandName : (req.claimedMerchantName as string | undefined);
      const email = typeof req.payeeEmail === 'string' ? [req.payeeEmail] : [];
      const claims: PageClaims = {
        finalUrl: url,
        domain: host,
        siteName: brand,
        claimedBrand: brand,
        contacts: { emails: email, phones: [] },
        linkedDomains: [],
        visibleText: brand ? `${brand}. Checkout.` : '',
        hiddenText: '',
        sectionLinks: {},
        hasContactPage: false,
        hasLegalPage: false,
      };
      return claims;
    },

    async getDomainReport(domain) {
      const f = find(hostOf(domain));
      if (!f) return [];
      const out: AgentEvidence[] = [];
      itemsOf(f).forEach((item, i) => {
        if (item.kind === 'domain') {
          const days = ageFrom(item.text);
          if (days !== undefined) {
            out.push(mk(f.storefrontHost, i, 'DOMAIN_AGE', 'rdap', ageSeverity(days), item.text, { ageDays: days }));
          }
          if (/one character off|lookalike|resembles|imperson/i.test(item.text)) {
            out.push(mk(f.storefrontHost, i, 'LOOKALIKE_DOMAIN', 'rule', 'high', item.text, { matchesKnownBrand: true, distance: 1 }));
          }
        }
        if (item.kind === 'ssl' && (item.severity === 'high' || item.severity === 'critical' || /expired|different organi[sz]ation|not trusted/i.test(item.text))) {
          out.push(mk(f.storefrontHost, i, 'TLS_INVALID', 'tls', 'high', item.text, {}));
        }
      });
      return out;
    },

    async getPriceReport(input) {
      const f = find(hostOf(input.claims.domain));
      if (!f) return [];
      const out: AgentEvidence[] = [];
      itemsOf(f).forEach((item, i) => {
        if (item.kind !== 'pricing') return;
        const below = item.text.match(/(\d+)\s*percent below/i);
        const discountPct = below ? Number(below[1]) : 0;
        const severity: AgentSeverity = discountPct >= 90 ? 'high' : discountPct >= 70 ? 'medium' : discountPct >= 40 ? 'low' : 'info';
        out.push(mk(f.storefrontHost, i, 'PRICE_DEVIATION', 'channel3', severity, item.text, { discountPct }));
      });
      return out;
    },

    async checkPayeeBinding(input) {
      if (!input.payee?.merchantId) return [];
      const f = find(hostOf(input.domain));
      if (!f) return [];
      const out: AgentEvidence[] = [];
      itemsOf(f).forEach((item, i) => {
        if (item.kind !== 'merchant_identity') return;
        const status = item.severity === 'low' || item.severity === 'info' ? 'MATCH' : item.severity === 'medium' ? 'NO_BINDING' : 'MISMATCH';
        const severity: AgentSeverity = status === 'MATCH' ? 'info' : status === 'NO_BINDING' ? 'medium' : 'high';
        out.push(
          mk(
            f.storefrontHost,
            i,
            'PAYEE_BINDING',
            'kernel',
            severity,
            item.text,
            { status, actualMerchantId: input.payee?.merchantId, linkedBrandIds: [] },
            status === 'MISMATCH',
          ),
        );
      });
      return out;
    },

    async fetchPageSection() {
      return { found: false };
    },

    async compareOffers() {
      return { offerCount: 0, sampleDomains: [] };
    },
  };
}
