import { decayFactor, isExpired, resolvePatternOptions } from './inMemoryPatternStore.js';
import { sanitizePastInvestigation } from './sanitize.js';
import type {
  PastInvestigation,
  PatternHit,
  PatternMatchType,
  PatternQuery,
  PatternStore,
  PatternStoreOptions,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_FIELDS = [
  'registrableDomain',
  'payeeHash',
  'decision',
  'riskScore',
  'evidenceTypes',
  'domainAgeBucket',
  'discountBucket',
  'patternText',
  'timestamp',
  'seed',
  'seenCount',
];

export interface ElasticPatternStoreConfig extends PatternStoreOptions {
  url: string;
  apiKey: string;
  index?: string;
  /** Inference endpoint for the semantic_text field. Elastic uses its default when omitted. */
  inferenceId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function patternIndexMapping(inferenceId?: string): Record<string, unknown> {
  return {
    properties: {
      pattern: { type: 'semantic_text', ...(inferenceId ? { inference_id: inferenceId } : {}) },
      patternText: { type: 'text' },
      registrableDomain: { type: 'keyword' },
      payeeHash: { type: 'keyword' },
      decision: { type: 'keyword' },
      riskScore: { type: 'float' },
      evidenceTypes: { type: 'keyword' },
      domainAgeBucket: { type: 'keyword' },
      discountBucket: { type: 'keyword' },
      seed: { type: 'boolean' },
      seenCount: { type: 'integer' },
      timestamp: { type: 'date' },
    },
  };
}

interface Hit {
  _id?: string;
  _source?: Partial<PastInvestigation>;
}
interface SearchResponse {
  hits?: { hits?: Hit[] };
}

/**
 * Elasticsearch-backed pattern store using the REST API with fetch. Only used when ELASTIC_URL
 * and ELASTIC_API_KEY are set. Expiry and decay are applied on read as well as in the query.
 */
export class ElasticPatternStore implements PatternStore {
  private readonly base: string;
  private readonly index: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly options: Required<PatternStoreOptions>;

  constructor(private readonly config: ElasticPatternStoreConfig) {
    this.base = config.url.replace(/\/+$/, '');
    this.index = config.index ?? 'guardian-scam-memory';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.options = resolvePatternOptions(config);
  }

  private async request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `ApiKey ${this.config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`Elastic ${method} ${path} failed with ${response.status}`);
    return (await response.json()) as T;
  }

  /** Creates the index with its mapping when it does not exist. Returns true if it was created. */
  async ensureIndex(): Promise<boolean> {
    const head = await this.fetchImpl(`${this.base}/${this.index}`, {
      method: 'HEAD',
      headers: { authorization: `ApiKey ${this.config.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (head.ok) return false;
    if (head.status !== 404) throw new Error(`Elastic HEAD /${this.index} failed with ${head.status}`);
    await this.request('PUT', `/${this.index}`, { mappings: patternIndexMapping(this.config.inferenceId) });
    return true;
  }

  async upsert(input: unknown): Promise<PastInvestigation> {
    const incoming = sanitizePastInvestigation(input, { now: this.options.now() });
    const { id, ...doc } = incoming;
    const document = { ...doc, pattern: incoming.patternText };
    await this.request('POST', `/${this.index}/_update/${encodeURIComponent(id)}?refresh=wait_for`, {
      script: {
        lang: 'painless',
        source:
          "ctx._source.seenCount = (ctx._source.seenCount == null ? 1 : ctx._source.seenCount) + 1;" +
          "ctx._source.timestamp = params.doc.timestamp;" +
          "ctx._source.patternText = params.doc.patternText;" +
          "ctx._source.pattern = params.doc.patternText;" +
          "ctx._source.riskScore = Math.max(ctx._source.riskScore, params.doc.riskScore);" +
          "if (params.rank.get(params.doc.decision) >= params.rank.get(ctx._source.decision)) { ctx._source.decision = params.doc.decision; }" +
          "for (t in params.doc.evidenceTypes) { if (!ctx._source.evidenceTypes.contains(t)) { ctx._source.evidenceTypes.add(t); } }",
        params: { doc: document, rank: { ALLOW: 0, WARN: 1, PAUSE: 2 } },
      },
      upsert: { ...document, seenCount: 1 },
    });
    return incoming;
  }

  async search(query: PatternQuery): Promise<PatternHit[]> {
    const nowMs = this.options.now();
    const cutoff = new Date(nowMs - this.options.ttlDays * DAY_MS).toISOString();
    const alive = {
      bool: {
        should: [{ term: { seed: true } }, { range: { timestamp: { gte: cutoff } } }],
        minimum_should_match: 1,
      },
    };

    const exactShould: Record<string, unknown>[] = [{ term: { registrableDomain: query.registrableDomain } }];
    if (query.payeeHash) exactShould.push({ term: { payeeHash: query.payeeHash } });

    const run = async (q: Record<string, unknown>): Promise<Hit[]> => {
      const res = await this.request<SearchResponse>('POST', `/${this.index}/_search`, {
        size: 5,
        _source: SOURCE_FIELDS,
        query: { bool: { filter: [alive], must: [q] } },
      });
      return res?.hits?.hits ?? [];
    };

    const semanticQuery = { semantic: { field: 'pattern', query: query.patternText } };
    const keywordQuery = { match: { patternText: query.patternText } };
    const [exact, approximate] = await Promise.all([
      run({ bool: { should: exactShould, minimum_should_match: 1 } }),
      run(semanticQuery).catch(() => run(keywordQuery)),
    ]);

    const toHit = (hit: Hit, matchType: PatternMatchType): PatternHit | null => {
      const s = hit._source;
      if (!s || !hit._id || !s.timestamp || !s.decision) return null;
      const record = { seed: s.seed === true, timestamp: s.timestamp };
      if (isExpired(record, nowMs, this.options.ttlDays)) return null;
      return {
        id: hit._id,
        matchType,
        patternText: s.patternText ?? '',
        decision: s.decision,
        riskScore: s.riskScore ?? 0,
        seed: record.seed,
        score: Number((1 * decayFactor(record, nowMs, this.options.halfLifeDays)).toFixed(4)),
      };
    };

    const exactHits = exact
      .map((hit) => toHit(hit, query.payeeHash && hit._source?.payeeHash === query.payeeHash ? 'exact_payee' : 'exact_domain'))
      .filter((h): h is PatternHit => h !== null);
    const seen = new Set(exactHits.map((h) => h.id));
    const semanticHits = approximate
      .map((hit) => toHit(hit, 'semantic'))
      .filter((h): h is PatternHit => h !== null && !seen.has(h.id));
    return [...exactHits, ...semanticHits].slice(0, 5);
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.options.now() - this.options.ttlDays * DAY_MS).toISOString();
    const res = await this.request<{ deleted?: number }>('POST', `/${this.index}/_delete_by_query?refresh=true`, {
      query: {
        bool: { must_not: [{ term: { seed: true } }], filter: [{ range: { timestamp: { lt: cutoff } } }] },
      },
    });
    return res?.deleted ?? 0;
  }

  async size(): Promise<number> {
    const res = await this.request<{ count?: number }>('GET', `/${this.index}/_count`, undefined, true);
    return res?.count ?? 0;
  }
}
