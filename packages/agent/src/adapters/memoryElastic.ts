import type {
  CallOpts,
  MemoryDocument,
  MemoryHit,
  MemoryMatchType,
  MemoryPort,
  MemoryQuery,
} from '../ports.js';
import { memoryIdFor } from '../memory/store.js';
import { scamMemoryMapping } from '../memory/indexMappings.js';

/**
 * Memory adapters.
 *
 * `InMemoryMemory` is the test double: it implements exact matching and a simple
 * token-overlap score for semantic matching, so the whole pipeline can be tested
 * without Elastic.
 *
 * `createElasticMemory` talks to the Elasticsearch REST API with fetch. Only two
 * requests matter: a `_search` (semantic + exact) and an `_update` upsert.
 */

interface StoredDocument extends MemoryDocument {
  id: string;
  seenCount: number;
  createdAt: string;
  lastSeenAt: string;
}

const BASE_TIME = Date.UTC(2026, 0, 1);

export class InMemoryMemory implements MemoryPort {
  private readonly documents = new Map<string, StoredDocument>();
  readonly searchCalls: MemoryQuery[] = [];
  readonly writeCalls: MemoryDocument[] = [];
  private tick = 0;

  load(documents: MemoryDocument[]): void {
    for (const document of documents) this.put(document);
  }

  async search(query: MemoryQuery, _options: CallOpts): Promise<MemoryHit[]> {
    this.searchCalls.push({ ...query });

    const exact: MemoryHit[] = [];
    const semantic: MemoryHit[] = [];

    for (const document of this.documents.values()) {
      if (query.payeeMerchantId && document.payeeMerchantId === query.payeeMerchantId) {
        exact.push(this.toHit(document, 'exact_payee', 1));
        continue;
      }
      if (query.registrableDomain && document.registrableDomain === query.registrableDomain) {
        exact.push(this.toHit(document, 'exact_domain', 1));
        continue;
      }

      const score = tokenSimilarity(document.patternText, query.patternText);
      if (score > 0) semantic.push(this.toHit(document, 'semantic', score));
    }

    semantic.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return [...exact, ...semantic].slice(0, 5);
  }

  async write(document: MemoryDocument, _options: CallOpts): Promise<void> {
    this.writeCalls.push({ ...document });
    this.put(document);
  }

  get size(): number {
    return this.documents.size;
  }

  get(id: string): StoredDocument | undefined {
    return this.documents.get(id);
  }

  all(): StoredDocument[] {
    return [...this.documents.values()];
  }

  private put(document: MemoryDocument): void {
    const id = document.id ?? memoryIdFor(document.registrableDomain, document.payeeMerchantId);
    const existing = this.documents.get(id);
    const now = new Date(BASE_TIME + this.tick * 1000).toISOString();
    this.tick += 1;

    this.documents.set(
      id,
      existing
        ? { ...existing, ...document, id, seenCount: existing.seenCount + 1, lastSeenAt: now }
        : { ...document, id, seenCount: 1, createdAt: now, lastSeenAt: now }
    );
  }

  private toHit(document: StoredDocument, matchType: MemoryMatchType, score: number): MemoryHit {
    return {
      id: document.id,
      matchType,
      patternText: document.patternText,
      decision: document.decision,
      riskScore: document.riskScore,
      seed: document.seed === true,
      score,
    };
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

function tokenSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export interface ElasticMemoryConfig {
  url: string;
  apiKey: string;
  index: string;
  inferenceId?: string;
}

interface ElasticSearchHit {
  _id?: string;
  _score?: number;
  _source?: Record<string, unknown>;
}

interface ElasticSearchResponse {
  hits?: { hits?: ElasticSearchHit[] };
}

const SOURCE_FIELDS = [
  'patternText',
  'decision',
  'riskScore',
  'seed',
  'registrableDomain',
  'payeeMerchantId',
  'domain',
  'evidenceTypes',
  'domainAgeBucket',
  'discountBucket',
];

export function createElasticMemory(
  config: ElasticMemoryConfig,
  fetchImpl: typeof fetch = fetch
): MemoryPort {
  const base = config.url.replace(/\/+$/, '');
  const index = config.index;

  const request = async <T>(path: string, method: string, body: unknown, options: CallOpts): Promise<T> => {
    if (options.signal?.aborted) throw new Error('request aborted');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
    timer.unref?.();
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `ApiKey ${config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Elastic ${method} ${path} failed with ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };

  const semanticSearch = async (query: MemoryQuery, options: CallOpts): Promise<MemoryHit[]> => {
    const response = await request<ElasticSearchResponse>(
      `/${index}/_search`,
      'POST',
      { size: 5, _source: SOURCE_FIELDS, query: { semantic: { field: 'pattern', query: query.patternText } } },
      options
    );
    return (response.hits?.hits ?? []).map((hit) => toHit(hit, 'semantic'));
  };

  const keywordSearch = async (query: MemoryQuery, options: CallOpts): Promise<MemoryHit[]> => {
    const response = await request<ElasticSearchResponse>(
      `/${index}/_search`,
      'POST',
      { size: 5, _source: SOURCE_FIELDS, query: { match: { patternText: query.patternText } } },
      options
    );
    return (response.hits?.hits ?? []).map((hit) => toHit(hit, 'semantic'));
  };

  return {
    async search(query, options) {
      const should: Record<string, unknown>[] = [];
      if (query.payeeMerchantId) should.push({ term: { payeeMerchantId: query.payeeMerchantId } });
      should.push({ term: { registrableDomain: query.registrableDomain } });

      const [exactResponse, approximated] = await Promise.all([
        request<ElasticSearchResponse>(
          `/${index}/_search`,
          'POST',
          {
            size: 5,
            _source: SOURCE_FIELDS,
            query: { bool: { minimum_should_match: 1, should } },
          },
          options
        ),
        semanticSearch(query, options).catch(() => keywordSearch(query, options)),
      ]);

      const exact = (exactResponse.hits?.hits ?? []).map((hit) =>
        toHit(
          hit,
          hit._source?.payeeMerchantId === query.payeeMerchantId ? 'exact_payee' : 'exact_domain'
        )
      );

      const exactIds = new Set(exact.map((hit) => hit.id));
      return [...exact, ...approximated.filter((hit) => !exactIds.has(hit.id))];
    },

    async write(document, options) {
      const id = document.id ?? memoryIdFor(document.registrableDomain, document.payeeMerchantId);
      await request(
        `/${index}/_update/${encodeURIComponent(id)}`,
        'POST',
        {
          doc: { ...document },
          upsert: { ...document, id, seenCount: 1 },
        },
        options
      );
    },
  };
}

function toHit(hit: ElasticSearchHit, matchType: MemoryMatchType): MemoryHit {
  const source = hit._source ?? {};
  const decision =
    source.decision === 'ALLOW' || source.decision === 'WARN' || source.decision === 'PAUSE'
      ? source.decision
      : 'WARN';

  return {
    id: typeof hit._id === 'string' ? hit._id : '',
    matchType,
    patternText: typeof source.patternText === 'string' ? source.patternText : '',
    decision,
    riskScore: typeof source.riskScore === 'number' ? source.riskScore : 0,
    seed: source.seed === true,
    score: typeof hit._score === 'number' ? hit._score : 0,
  };
}

export async function ensureScamMemoryIndex(
  config: ElasticMemoryConfig,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const base = config.url.replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/${config.index}`, {
    method: 'PUT',
    headers: {
      authorization: `ApiKey ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ mappings: scamMemoryMapping({ inferenceId: config.inferenceId }) }),
  });

  if (response.ok) return;

  const text = await response.text();
  if (response.status === 400 && /resource_already_exists_exception/.test(text)) return;

  throw new Error(`Failed to create Elastic index: ${response.status} ${text.slice(0, 200)}`);
}
