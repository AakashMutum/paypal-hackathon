# @checkout-guardian/memory

Investigation memory and historical risk indicators module for Checkout Guardian.

> **Key Rule for Signals & Risk Engineering (Person 2):**  
> Historical flags are **contextual indicators**, not permanent blacklists or proof of fraud. Past records must be weighed as signals alongside current session facts.

---

## Features

- **Strict PII Protection:** Strips customer names, card numbers, CVV, shipping/billing addresses, and any unallowed fields via an explicit allowlist before indexing.
- **Resilient Storage:** Connects to Elasticsearch when configured (`ELASTIC_NODE` / `ELASTIC_API_KEY`) and automatically falls back to an in-memory store if Elasticsearch is unreachable.
- **Person 2 Signal API:** Clean, documented functions for retrieving prior signals and persisting investigation findings.
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

Use `lookupPriorSignals` inside your risk engine or signal aggregator (Person 2) before rendering a payment decision:

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
