# TrustOra requirement checklist

Status of the PRD requirements against the current implementation. Last verified: 2026-11-03.

Status values: **COMPLETE** (implemented and tested), **PARTIAL** (implemented with an external
dependency or an accounted limitation), **BLOCKED** (waiting on credentials or an external action).

## Functional requirements

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| FR-001 | Website information collection | COMPLETE | `packages/signals/src/agentPort/html.ts` extracts title, site name, contacts, legal text, links and structured product metadata. |
| FR-002 | Domain authenticity analysis | COMPLETE | `packages/signals/src/domain/rdap.ts` resolves the authoritative RDAP endpoint from the IANA bootstrap (with known registry fallbacks); TLS validity is reported separately. |
| FR-003 | Merchant identity verification | PARTIAL | The agent compares claimed names with the merchant registry and identifies official marketplace hostnames. A production corporate-registry provider is not configured; the local `merchant_records` table is the configured source. Missing records are disclosed, never invented. |
| FR-004 | Product and price analysis | PARTIAL | Structured JSON-LD/OpenGraph/microdata product data is extracted. Comparable-price analysis needs Channel3 (`CHANNEL3_API_KEY`), which is not configured; the response says `price: unavailable` rather than inventing a price. |
| FR-005 | Payment recipient verification | COMPLETE | Payee binding and PayPal payee comparison produce deterministic evidence. A scan without a payee is labelled a merchant-level scan, not an identity check. |
| FR-006 | AI risk assessment | COMPLETE | Deterministic scoring with hard-rule floors plus live Gemini structured analysis; the model cannot override the rules. |
| FR-007 | Risk explanation generation | COMPLETE | Gemini explanations are validated against Zod schemas and the explanation checker; unsafe or uncited output falls back to neutral templates. |
| FR-008 | Payment intervention | COMPLETE | PayPal AUTHORIZE → investigation → capture/void gate. Capture/void are mock-tested; real sandbox capture needs buyer approval. |
| FR-009 | Customer dashboard | COMPLETE | React scanner, engine, payment view, history and analyst console. |
| FR-010 | Transaction and risk logging | COMPLETE | PostgreSQL `investigations`, `payment_events` and `spend_policies`; migration 003 applied locally. |

## Non-functional requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Latency under 2 seconds | PARTIAL | The deterministic path is fast. Live Gemini explanation/pattern calls add seconds and are bounded by `AGENT_TIMEOUT_MS` and per-call timeouts. |
| Security and privacy | COMPLETE | No secrets in source or responses; URL safety checks; page text sanitized; memory stores anonymous pattern records; no PII. |
| Reliability and graceful degradation | COMPLETE | Bounded retries for transient failures only; blocked/CAPTCHA/unavailable/empty states are distinct; model and memory failures fall back explicitly. |
| Explainability | COMPLETE | Every decision cites evidence; availability and missing-data reasons are shown separately. |

## AI, memory and payments

| Area | Status | Evidence |
| --- | --- | --- |
| Live Gemini provider | COMPLETE | `GEMINI_API_KEY` accepted; provider/model/fallback reported by `/health`; real structured JSON verified. |
| Deterministic rule precedence | COMPLETE | Hard rules are evaluated before and independently of the model; model evidence is non-deterministic and capped. |
| RAG storage and retrieval | COMPLETE | Persistent JSON file with Gemini embeddings (`gemini-embedding-001`); exact, embedding and lexical retrieval; citations and relevance are validated. |
| RAG persistence across restarts | COMPLETE | A case stored in one process was retrieved by a restarted process with `retrieval: embedding (gemini)`. |
| PayPal sandbox OAuth/order | COMPLETE | Live sandbox OAuth, order creation and retrieval passed. |
| PayPal capture/void | BLOCKED (external) | Requires sandbox buyer approval; the gate and capture/void paths are mock-tested. |
| CI-equivalent checks | PARTIAL | Package and integration suites pass. Final full build/lint/hygiene and the pushed CI run are the remaining verification steps. |

## Known limitations

- Hosted persistent memory needs a mounted disk or Elasticsearch; the local JSON file survives restarts on the local machine.
- Kernel remote-browser and Channel3 catalogue keys are not configured. RDAP, TLS, page metadata and structured product data are live.
- PayPal webhooks are not handled.
- Web UI was built and type-checked; browser automation was not available in this environment.
