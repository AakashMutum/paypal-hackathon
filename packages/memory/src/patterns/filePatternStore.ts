import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { cosineSimilarity, LocalHashEmbeddingProvider, type EmbeddingProvider } from './embeddings.js';
import {
  decayFactor,
  isExpired,
  mergeSightings,
  resolvePatternOptions,
  tokenSimilarity,
} from './inMemoryPatternStore.js';
import { sanitizePastInvestigation } from './sanitize.js';
import type {
  EmbeddingInfo,
  PastInvestigation,
  PatternHit,
  PatternMatchType,
  PatternQuery,
  PatternStore,
  PatternStoreOptions,
  ResolvedPatternOptions,
} from './types.js';

const MAX_HITS = 5;
const FILE_VERSION = 1;

interface StoreFile {
  version: number;
  updatedAt: string;
  records: PastInvestigation[];
}

export interface FilePatternStoreConfig extends PatternStoreOptions {
  filePath: string;
  log?: (event: Record<string, unknown>) => void;
}

/**
 * A JSON-file-backed pattern store with optional embeddings.
 *
 * The file is written atomically (temporary sibling + rename) and survives restarts. Stored
 * records are re-sanitized on load, so a hand-edited file cannot inject PII. Retrieval uses
 * exact domain/payee matches first, then embedding cosine similarity, then lexical overlap.
 */
export class FilePatternStore implements PatternStore {
  readonly filePath: string;
  private readonly records = new Map<string, PastInvestigation>();
  private readonly options: ResolvedPatternOptions;
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly localHash = new LocalHashEmbeddingProvider();
  private readonly log?: (event: Record<string, unknown>) => void;
  private loaded = false;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(config: FilePatternStoreConfig) {
    this.filePath = config.filePath;
    this.options = resolvePatternOptions(config);
    this.embeddingProvider = config.embeddingProvider;
    this.log = config.log;
  }

  embeddingInfo(): EmbeddingInfo {
    const provider = this.embeddingProvider ?? this.localHash;
    return { provider: provider.name, ...(provider.model ? { model: provider.model } : {}) };
  }

  location(): string {
    return this.filePath;
  }

  /** Creates the directory and an empty file when they do not exist. */
  async ensureIndex(): Promise<boolean> {
    await this.ensureLoaded();
    try {
      await readFile(this.filePath, 'utf8');
      return false;
    } catch {
      await this.persist();
      return true;
    }
  }

  async upsert(input: unknown): Promise<PastInvestigation> {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const incoming = sanitizePastInvestigation(input, { now: this.options.now() });
      const embedding = await this.computeEmbedding(incoming.patternText, incoming.seed);
      const existing = this.records.get(incoming.id);
      const merged = existing ? mergeSightings(existing, incoming) : { ...incoming };

      if (embedding) {
        merged.embedding = embedding.vector;
        merged.embeddingProvider = embedding.provider;
        merged.embeddingModel = embedding.model;
      } else if (existing?.embedding) {
        merged.embedding = existing.embedding;
        merged.embeddingProvider = existing.embeddingProvider;
        merged.embeddingModel = existing.embeddingModel;
      }

      this.records.set(incoming.id, merged);
      this.dropExpired();
      await this.persist();
      return clone(merged);
    });
  }

  async search(query: PatternQuery): Promise<PatternHit[]> {
    await this.ensureLoaded();
    this.dropExpired();

    const queryVector = this.embeddingProvider ? await this.embeddingProvider.embed(query.patternText) : null;
    const localQueryVector = await this.localHash.embed(query.patternText);
    const exactPayee: PatternHit[] = [];
    const exactDomain: PatternHit[] = [];
    const semantic: PatternHit[] = [];
    const nowMs = this.options.now();

    for (const record of this.records.values()) {
      const weight = decayFactor(record, nowMs, this.options.halfLifeDays);
      const base = {
        id: record.id,
        patternText: record.patternText,
        decision: record.decision,
        riskScore: record.riskScore,
        seed: record.seed,
        ...(record.embeddingProvider ? { embeddingProvider: record.embeddingProvider } : {}),
      };

      if (query.payeeHash && record.payeeHash === query.payeeHash) {
        exactPayee.push({ ...base, matchType: 'exact_payee', score: round(weight), retrieval: 'exact' });
        continue;
      }
      if (query.registrableDomain && record.registrableDomain === query.registrableDomain) {
        exactDomain.push({ ...base, matchType: 'exact_domain', score: round(weight), retrieval: 'exact' });
        continue;
      }

      const lexical = tokenSimilarity(record.patternText, query.patternText);
      let embeddingScore = 0;
      let retrieval: string = 'lexical';
      if (record.embedding) {
        if (record.embeddingProvider === this.embeddingProvider?.name && queryVector) {
          embeddingScore = cosineSimilarity(queryVector, record.embedding);
        } else if (record.embeddingProvider === this.localHash.name && localQueryVector) {
          embeddingScore = cosineSimilarity(localQueryVector, record.embedding);
        }
        if (embeddingScore > lexical) retrieval = 'embedding';
      }

      const similarity = Math.max(lexical, embeddingScore);
      if (similarity >= this.options.minSimilarity) {
        semantic.push({
          ...base,
          matchType: 'semantic' as PatternMatchType,
          score: round(similarity * weight),
          retrieval,
        });
      }
    }

    const byScore = (a: PatternHit, b: PatternHit): number => b.score - a.score;
    return [...exactPayee.sort(byScore), ...exactDomain.sort(byScore), ...semantic.sort(byScore)].slice(0, MAX_HITS);
  }

  async purgeExpired(): Promise<number> {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const removed = this.dropExpired();
      if (removed > 0) await this.persist();
      return removed;
    });
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    this.dropExpired();
    return this.records.size;
  }

  /** Stored records, for tests and tooling. */
  all(): PastInvestigation[] {
    return [...this.records.values()].map(clone);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      if (!Array.isArray(parsed.records)) throw new Error('records must be an array');
      for (const item of parsed.records) {
        try {
          const sanitized = sanitizePastInvestigation(item, { now: this.options.now() });
          const stored: PastInvestigation = {
            ...sanitized,
            seenCount: Number((item as PastInvestigation)?.seenCount) || 1,
            ...(validVector((item as PastInvestigation)?.embedding)
              ? { embedding: (item as PastInvestigation).embedding }
              : {}),
            ...(typeof (item as PastInvestigation)?.embeddingProvider === 'string'
              ? { embeddingProvider: (item as PastInvestigation).embeddingProvider }
              : {}),
            ...(typeof (item as PastInvestigation)?.embeddingModel === 'string'
              ? { embeddingModel: (item as PastInvestigation).embeddingModel }
              : {}),
          };
          this.records.set(stored.id, stored);
        } catch (error) {
          this.log?.({
            evt: 'memory_record_skipped',
            detail: error instanceof Error ? error.message.slice(0, 120) : 'invalid record',
          });
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        this.log?.({
          evt: 'memory_file_unreadable',
          file: this.filePath,
          detail: error instanceof Error ? error.message.slice(0, 160) : 'unknown error',
        });
      }
    }
  }

  private async persist(): Promise<void> {
    const payload: StoreFile = {
      version: FILE_VERSION,
      updatedAt: new Date(this.options.now()).toISOString(),
      records: [...this.records.values()].map(clone),
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }

  private async computeEmbedding(
    text: string,
    seed: boolean,
  ): Promise<{ vector: number[]; provider: string; model?: string } | undefined> {
    // Seeds use the local hash so first-run seeding does not make 25 network calls.
    const provider = seed ? this.localHash : (this.embeddingProvider ?? this.localHash);
    const vector = await provider.embed(text);
    if (!vector) return undefined;
    return { vector, provider: provider.name, ...(provider.model ? { model: provider.model } : {}) };
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

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
