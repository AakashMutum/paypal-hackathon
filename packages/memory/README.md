# @checkout-guardian/memory

Investigation memory and historical risk indicators module for Checkout Guardian.

> **Key rule for the signals and agent areas:**  
> Historical flags are **contextual indicators**, not permanent blacklists or proof of fraud. Past records must be weighed as signals alongside current session facts.

---

## Features

- **Strict PII Protection:** Strips customer names, card numbers, CVV, shipping/billing addresses, and any unallowed fields via an explicit allowlist before indexing.
- **Resilient Storage:** Connects to Elasticsearch when configured (`ELASTIC_NODE` / `ELASTIC_API_KEY`) and automatically falls back to an in-memory store if Elasticsearch is unreachable.
- **Signal API:** Clean, documented functions for retrieving prior signals and persisting investigation findings.
- **Zero Agent Logic:** Purely deterministic storage and retrieval.

---

## Installation & Import

Import directly in workspace packages:

```typescript
import {
  lookupPriorSignals,
  saveInvestigation,
  type PriorSignalsResult,
} from '@checkout-guardian/memory';
```

---

## Usage Examples

### 1. Lookup Prior Signals for Risk Evaluation

Use `lookupPriorSignals` inside your risk engine or signal aggregator before rendering a payment decision:

```typescript
import { lookupPriorSignals } from '@checkout-guardian/memory';

async function evaluateHistoricalSignals(
  storefrontUrl: string,
  payeeMerchantId?: string,
  payeeEmail?: string,
) {
  // Query prior findings using any combination of domain, merchant ID, or payee email:
  const signals = await lookupPriorSignals(storefrontUrl, payeeMerchantId, payeeEmail);

  console.log(`Prior investigations found: ${signals.priorMatches}`);
  console.log(`Prior blocks/pauses: ${signals.priorBlockCount}`);
  console.log(`Common flagged evidence: ${signals.evidenceTypes.join(', ')}`);
  console.log(`Note: ${signals.note}`);
  // Output note: "These are historical indicators, not proof of fraud or permanent blacklists. Evaluate in current session context."

  // Example weighting in your signal engine:
  if (signals.priorBlockCount > 0) {
    return {
      historicalRiskBoost: Math.min(signals.priorBlockCount * 10, 30),
      evidence: signals.evidenceTypes,
    };
  }

  return { historicalRiskBoost: 0, evidence: [] };
}
```

#### Return Type: `PriorSignalsResult`

| Property          | Type       | Description                                                                            |
| ----------------- | ---------- | -------------------------------------------------------------------------------------- |
| `priorMatches`    | `number`   | Count of prior investigations matching the domain, merchant ID, or payee email.        |
| `priorBlockCount` | `number`   | Count of prior investigations that resulted in a `BLOCK` or `PAUSE` decision.          |
| `evidenceTypes`   | `string[]` | Distinct list of flagged evidence types observed across previous investigations.       |
| `note`            | `string`   | Mandatory disclaimer stating that these are historical indicators, not proof of fraud. |

---

### 2. Persisting an Investigation After Decision

When an order decision is finalized, record the investigation in memory:

```typescript
import { saveInvestigation } from '@checkout-guardian/memory';

async function onInvestigationCompleted(investigation: {
  investigationId: string;
  domain: string;
  claimedBrand: string;
  payeeMerchantId: string;
  payeeEmail: string;
  riskScore: number;
  decision: 'ALLOW' | 'WARN' | 'PAUSE';
  flaggedEvidenceTypes: string[];
  timestamp: string;
  // Any customer PII passed here is automatically stripped:
  customerName?: string;
  cardNumber?: string;
}) {
  const savedRecord = await saveInvestigation(investigation);
  console.log(`Successfully saved investigation ${savedRecord.investigationId}`);
}
```

---

### 3. Using Custom Store / In-Memory Store for Testing

For unit tests or offline local development, you can inject or configure `InMemoryMemoryStore`:

```typescript
import {
  InMemoryMemoryStore,
  lookupPriorSignals,
  saveInvestigation,
} from '@checkout-guardian/memory';

// Create a local isolated in-memory store
const testStore = new InMemoryMemoryStore();

// Pass the store explicitly:
await saveInvestigation(myRecord, testStore);
const signals = await lookupPriorSignals('example.com', undefined, undefined, testStore);
```

---

## Environment Configuration

When using Elasticsearch:

- `ELASTIC_NODE`: Elasticsearch endpoint (e.g. `http://localhost:9200` or Elastic Cloud endpoint).
- `ELASTIC_API_KEY`: Optional API key for Elastic authentication.
- `ELASTIC_INDEX`: Optional index name (defaults to `checkout-guardian-memory`).

If `ELASTIC_NODE` is not set or the cluster is unreachable within 1500ms, the system logs a warning and automatically falls back to the in-memory store without breaking.

---

## Anonymous scam-pattern memory

`src/patterns/` stores past investigations as anonymous indicators so the agent can recognise a
repeated scam pattern. A stored pattern holds only: registrable domain, a SHA-256 hash of the
payee merchant id, decision (`ALLOW`, `WARN`, `PAUSE`), risk score (0 to 1), evidence type names,
domain-age and discount buckets, one pattern sentence, a timestamp and a seed flag.

- **Sanitizer.** `sanitizePastInvestigation` keeps only those fields and refuses (throws
  `PatternSanitizationError`) when free text contains an email address, phone number, street
  address, postal box, web address or a person's name (titles, role words such as "owner" or
  "run by" followed by a name, or a self-introduction). The raw payee id is hashed and dropped.
- **Dedupe.** The id is a hash of domain and payee. A repeat sighting merges into the stored one:
  newest timestamp, highest risk, most severe decision, union of evidence types, `seenCount + 1`.
- **Expiry and decay.** Non-seed patterns expire after `ttlDays` (default 180) and their match
  score halves every `halfLifeDays` (default 60). Seeds never expire or decay.
- **Seeds.** `loadSeeds` writes 28 fictional patterns (`SEED_PATTERN_COUNT`). None describes a
  real store, person or brand.
- **Stores.** `InMemoryPatternStore` is the default and needs no services. `ElasticPatternStore`
  (REST with fetch) is used by `createPatternStore` only when `ELASTIC_URL` and `ELASTIC_API_KEY`
  are set; `ELASTIC_INDEX` (default `guardian-scam-memory`) and `ELASTIC_INFERENCE_ID` are
  optional. Create the index with `npm run index:create -w @checkout-guardian/memory`. The live
  Elastic test skips without those variables.
- **Agent port.** `asAgentMemoryPort(store)` exposes `search` and `write` in the shape of the
  agent's `MemoryPort` (`packages/agent/src/ports.ts`), using local mirror types. Search matches
  the exact payee (by hash), then the exact registrable domain, then text similarity (token
  overlap in memory, semantic or keyword query in Elastic).

```ts
import { asAgentMemoryPort, createPatternStore } from '@checkout-guardian/memory';

const memory = asAgentMemoryPort(await createPatternStore());
```

## The two memory layers compared

| | `packages/agent` memory | `packages/memory` history store | `packages/memory` pattern store |
| --- | --- | --- | --- |
| Interface | `MemoryPort` (`search`, `write`) in `ports.ts` | `MemoryStore` (`indexInvestigation`, `findBy...`, `getHistorySummary`) | `PatternStore` (`upsert`, `search`), used through `asAgentMemoryPort` |
| Record | `MemoryDocument`: pattern sentence, buckets, evidence types, raw payee merchant id | `HistoricalRecord`: domain, brand, payee merchant id, payee email, score, decision | `PastInvestigation`: domain, payee hash, buckets, evidence types, pattern sentence |
| Personal data | raw payee id stored; no sanitizer | payee email stored; allowlist sanitizer | no email or raw id; sanitizer refuses personal data |
| In-memory | `InMemoryMemory` | `InMemoryMemoryStore` | `InMemoryPatternStore` |
| Elastic | `createElasticMemory` (fetch) | `ElasticMemoryStore` (client) | `ElasticPatternStore` (fetch) |
| Expiry and decay | none | none | yes |
| Seeds | 8 | none | 28 |
| Used by | the agent | the eval baselines | the agent, through the port |

The pattern store is the one meant for the agent. The history store stays for the existing
lookup API and the eval baselines.
