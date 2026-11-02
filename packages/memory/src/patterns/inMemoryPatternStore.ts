import { patternId, sanitizePastInvestigation } from './sanitize.js';
import type {
  PastInvestigation,
  PatternHit,
  PatternMatchType,
  PatternQuery,
  PatternStore,
  PatternStoreOptions,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK = { ALLOW: 0, WARN: 1, PAUSE: 2 } as const;
const MAX_HITS = 5;

export function tokens(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  );
}

/** Token overlap (Jaccard) between two texts, from 0 to 1. */
export function tokenSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function resolvePatternOptions(options: PatternStoreOptions = {}): Required<PatternStoreOptions> {
  return {
    now: options.now ?? Date.now,
    ttlDays: options.ttlDays ?? 180,
    halfLifeDays: options.halfLifeDays ?? 60,
    minSimilarity: options.minSimilarity ?? 0.12,
  };
}

/** Weight of a sighting from 1 (now) falling by half every halfLifeDays. Seeds do not decay. */
export function decayFactor(record: Pick<PastInvestigation, 'seed' | 'timestamp'>, nowMs: number, halfLifeDays: number): number {
  if (record.seed) return 1;
  const ageDays = Math.max(0, (nowMs - Date.parse(record.timestamp)) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function isExpired(record: Pick<PastInvestigation, 'seed' | 'timestamp'>, nowMs: number, ttlDays: number): boolean {
  return !record.seed && nowMs - Date.parse(record.timestamp) > ttlDays * DAY_MS;
}

/** Combines a new sighting with a stored one for the same domain and payee. */
export function mergeSightings(existing: PastInvestigation, incoming: PastInvestigation): PastInvestigation {
  const newer = Date.parse(incoming.timestamp) >= Date.parse(existing.timestamp) ? incoming : existing;
  return {
    ...newer,
    decision: RANK[incoming.decision] >= RANK[existing.decision] ? incoming.decision : existing.decision,
    riskScore: Math.max(existing.riskScore, incoming.riskScore),
    evidenceTypes: [...new Set([...existing.evidenceTypes, ...incoming.evidenceTypes])].sort(),
    seed: existing.seed && incoming.seed,
    seenCount: existing.seenCount + 1,
  };
}

export class InMemoryPatternStore implements PatternStore {
  private readonly records = new Map<string, PastInvestigation>();
  private readonly options: Required<PatternStoreOptions>;

  constructor(options: PatternStoreOptions = {}) {
    this.options = resolvePatternOptions(options);
  }

  async upsert(input: unknown): Promise<PastInvestigation> {
    const incoming = sanitizePastInvestigation(input, { now: this.options.now() });
    this.dropExpired();
    const existing = this.records.get(incoming.id);
    const stored = existing ? mergeSightings(existing, incoming) : incoming;
    this.records.set(incoming.id, stored);
    return { ...stored };
  }

  async search(query: PatternQuery): Promise<PatternHit[]> {
    const nowMs = this.options.now();
    this.dropExpired();
    const exactPayee: PatternHit[] = [];
    const exactDomain: PatternHit[] = [];
    const semantic: PatternHit[] = [];

    for (const record of this.records.values()) {
      const weight = decayFactor(record, nowMs, this.options.halfLifeDays);
      const hit = (matchType: PatternMatchType, score: number): PatternHit => ({
        id: record.id,
        matchType,
        patternText: record.patternText,
        decision: record.decision,
        riskScore: record.riskScore,
        seed: record.seed,
        score: Number((score * weight).toFixed(4)),
      });
      if (query.payeeHash && record.payeeHash === query.payeeHash) {
        exactPayee.push(hit('exact_payee', 1));
      } else if (query.registrableDomain && record.registrableDomain === query.registrableDomain) {
        exactDomain.push(hit('exact_domain', 1));
      } else {
        const similarity = tokenSimilarity(record.patternText, query.patternText);
        if (similarity >= this.options.minSimilarity) semantic.push(hit('semantic', similarity));
      }
    }
    const byScore = (a: PatternHit, b: PatternHit) => b.score - a.score;
    return [...exactPayee.sort(byScore), ...exactDomain.sort(byScore), ...semantic.sort(byScore)].slice(0, MAX_HITS);
  }

  async purgeExpired(): Promise<number> {
    return this.dropExpired();
  }

  async size(): Promise<number> {
    this.dropExpired();
    return this.records.size;
  }

  /** Stored patterns, for tests and tooling. */
  all(): PastInvestigation[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  idFor(registrableDomain: string, payeeHash?: string): string {
    return patternId(registrableDomain, payeeHash);
  }

  private dropExpired(): number {
    const nowMs = this.options.now();
    let removed = 0;
    for (const [id, record] of this.records) {
      if (isExpired(record, nowMs, this.options.ttlDays)) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
