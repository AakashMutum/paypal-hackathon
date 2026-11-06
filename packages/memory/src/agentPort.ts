import { hashPayee } from './patterns/sanitize.js';
import type { PatternStore } from './patterns/types.js';

// Local mirrors of MemoryPort, MemoryQuery, MemoryHit and MemoryDocument from
// packages/agent/src/ports.ts. Keep them structurally identical; this package does not import
// the agent.

export interface AgentCallOpts {
  signal?: AbortSignal;
  timeoutMs: number;
}
export type AgentDecision = 'ALLOW' | 'WARN' | 'PAUSE';
export type AgentMemoryMatchType = 'exact_payee' | 'exact_domain' | 'semantic';

export interface AgentMemoryQuery {
  patternText: string;
  registrableDomain: string;
  payeeMerchantId?: string;
}

export interface AgentMemoryHit {
  id: string;
  matchType: AgentMemoryMatchType;
  patternText: string;
  decision: AgentDecision;
  riskScore: number;
  seed: boolean;
  score?: number;
  retrieval?: string;
  embeddingProvider?: string;
}

export interface AgentMemoryDocument {
  id?: string;
  patternText: string;
  domain: string;
  registrableDomain: string;
  payeeMerchantId?: string;
  decision: AgentDecision;
  riskScore: number;
  evidenceTypes: string[];
  domainAgeBucket: string;
  discountBucket: string;
  seed?: boolean;
}

export interface AgentMemoryPort {
  search(query: AgentMemoryQuery, options: AgentCallOpts): Promise<AgentMemoryHit[]>;
  write(document: AgentMemoryDocument, options: AgentCallOpts): Promise<void>;
}

function throwIfAborted(options: AgentCallOpts): void {
  if (options.signal?.aborted) throw new Error('request aborted');
}

/**
 * Presents an anonymous pattern store as the agent's MemoryPort. Search matches the exact payee
 * (by hash), the exact registrable domain, then text similarity. The raw payee merchant id is
 * hashed here and never reaches the store. The agent's own `id` and raw `domain` fields are
 * ignored: the store derives its own id and keeps only the registrable domain.
 */
export function asAgentMemoryPort(store: PatternStore): AgentMemoryPort {
  return {
    async search(query, options) {
      throwIfAborted(options);
      const hits = await store.search({
        patternText: query.patternText,
        registrableDomain: query.registrableDomain,
        ...(query.payeeMerchantId ? { payeeHash: hashPayee(query.payeeMerchantId) } : {}),
      });
      return hits.map((hit) => ({
        id: hit.id,
        matchType: hit.matchType,
        patternText: hit.patternText,
        decision: hit.decision,
        riskScore: hit.riskScore,
        seed: hit.seed,
        score: hit.score,
        ...(hit.retrieval ? { retrieval: hit.retrieval } : {}),
        ...(hit.embeddingProvider ? { embeddingProvider: hit.embeddingProvider } : {}),
      }));
    },

    async write(document, options) {
      throwIfAborted(options);
      await store.upsert({
        registrableDomain: document.registrableDomain,
        payeeMerchantId: document.payeeMerchantId,
        decision: document.decision,
        riskScore: document.riskScore,
        evidenceTypes: document.evidenceTypes,
        domainAgeBucket: document.domainAgeBucket,
        discountBucket: document.discountBucket,
        patternText: document.patternText,
        seed: document.seed === true,
      });
    },
  };
}
