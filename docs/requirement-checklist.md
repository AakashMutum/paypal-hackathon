# TrustOra requirement checklist

Status of the PRD requirements against the current implementation. Last verified: 2026-11-03
(gap-closure pass).
Status of the PRD requirements against the current implementation. Last verified: 2026-11-03.

Status values: **COMPLETE** (implemented and tested), **PARTIAL** (implemented with an external
dependency or an accounted limitation), **BLOCKED** (waiting on credentials or an external action).

## Functional requirements

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| FR-001 | Website information collection | PARTIAL | `packages/signals/src/agentPort/html.ts` extracts title, site name, contact details, legal links and structured product metadata. Contact details or a contact link count as a contact page; a readable page with neither contact nor privacy/terms evidence emits a low `CONTACT_LEGAL_MISSING` signal. The declared favicon URL and same-origin flag are recorded in `FAVICON_OBSERVED`. A medium `FAVICON_MISMATCH` is emitted only against a configured reference (`packages/signals/data/favicon-references.json`, `docs/favicon-references.md`); the shipped corpus is empty because the invented demo stores have no favicon asset, so no mismatch is produced today without a reference someone adds. |
| FR-002 | Domain authenticity analysis | COMPLETE | RDAP resolves the authoritative IANA endpoint (with registry fallbacks), extracts registration date, age and registrar name; TLS validity/issuer is reported separately. Registrar reputation is reported as `not_assessed` because no reputation source exists; the registrar name is shown but never scored. |
| FR-003 | Merchant identity verification | PARTIAL | The agent compares claimed names with the local `merchant_records` registry and identifies official marketplace hostnames. No external corporate-registry provider is configured; missing records are disclosed, never invented. |
| FR-004 | Product and price analysis | PARTIAL | Structured JSON-LD/OpenGraph/microdata product data is extracted. Comparable-price analysis needs Channel3 (`CHANNEL3_API_KEY`); without it the response says `price: unavailable` instead of inventing a price. |
| FR-005 | Payment recipient verification | COMPLETE | Payee binding and PayPal payee comparison produce deterministic evidence. A scan without a payee is labelled a merchant-level scan, not an identity check. |
| FR-006 | AI risk assessment | COMPLETE | Deterministic scoring with hard-rule floors plus live Gemini structured analysis; the model cannot override the rules. |
| FR-007 | Risk explanation generation | COMPLETE | Gemini explanations are validated against Zod schemas and the explanation checker; unsafe or uncited output falls back to neutral templates. |
| FR-008 | Payment intervention | COMPLETE | PayPal AUTHORIZE -> investigation -> capture/void gate. Capture/void are mock-tested; a real sandbox capture needs buyer approval. |
| FR-009 | Customer dashboard | COMPLETE | Counters and the defended amount are derived only from persisted investigations (empty store shows zero). History, analyst console, engine and payment views are present. |
| FR-010 | Transaction and risk logging | COMPLETE | PostgreSQL `investigations`, `payment_events` and `spend_policies`. Buyer email is masked, expected payee email is stored only as a fingerprint, and `AUDIT_ENCRYPTION_KEY` enables AES-256-GCM for both JSONB payloads. |
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
| Latency under 2 seconds | PARTIAL | Not shown for a live scan. With recorded signals and no model every request to the demo stores took under 150 ms (`docs/latency.md`, one machine). A live ambiguous scan took 7.08 seconds before the model time budget existed; `AGENT_MODEL_BUDGET_MS` (default 1200) now caps model time and falls back to deterministic output, and with a simulated 700 ms model warm scans stayed under 2 seconds. A real model and the hosted instance were not measured. The model is not disabled to meet the target. |
| Security and privacy | COMPLETE | No secrets in source or responses; URL safety checks; page text sanitized; memory stores anonymous pattern records. Persisted buyer PII is redacted; audit JSON is encrypted when `AUDIT_ENCRYPTION_KEY` is set and `/health` reports the encryption status. |
| Reliability and graceful degradation | COMPLETE | Bounded retries for transient failures only; blocked/CAPTCHA/unavailable/empty states are distinct; model, registry and memory failures fall back explicitly. |
| Latency under 2 seconds | PARTIAL | Not shown for a live scan. With recorded signals and no model every request to the demo stores took under 150 ms (`docs/latency.md`, one machine). A live ambiguous scan took 7.08 seconds before the model time budget existed; `AGENT_MODEL_BUDGET_MS` (default 1200) now caps model time and falls back to deterministic output, and with a simulated 700 ms model warm scans stayed under 2 seconds. A real model and the hosted instance were not measured. The model is not disabled to meet the target. |
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
| Real PayPal JS approval | PARTIAL | The SDK loads when `VITE_PAYPAL_CLIENT_ID` is set and `onApprove` calls the backend gate. The public client id is empty locally, so the simulated button is used. No real buyer approval has occurred. |
| CI-equivalent checks | PARTIAL | Focused tests, build, typecheck, lint, contracts, brands and hygiene pass locally. The workflow runs on a pull request or a push to `main`; the feature-branch push has not triggered it. |

## Remaining external configuration

- `AUDIT_ENCRYPTION_KEY`: generate a local 32-byte key (64 hex characters) and set it in the API
  `.env` to enable encryption at rest. Without it, redaction still applies.
- `KERNEL_API_KEY`: enables the remote browser for JavaScript-heavy pages.
- `CHANNEL3_API_KEY`: enables live price comparison.
- Corporate registry: no adapter is wired; the local `merchant_records` table is the identity
  source. A provider adapter would be required for a commercial registry.
- `VITE_PAYPAL_CLIENT_ID` plus sandbox API credentials and a sandbox buyer approval: required for a
  real capture/void. No capture occurs without buyer approval and a valid authorization.

## Known limitations

- Hosted persistent memory needs a mounted disk or Elasticsearch; the local JSON file survives
  restarts on the local machine.
- Kernel remote-browser and Channel3 catalogue keys are not configured. RDAP, TLS, page metadata,
  product metadata and structured server-rendered pages are live.
- The favicon reference corpus is empty (see `docs/favicon-references.md`), so no favicon mismatch is produced until references are added. Registrar reputation is not assessed (no source).
| CI-equivalent checks | PARTIAL | Package and integration suites pass. Final full build/lint/hygiene and the pushed CI run are the remaining verification steps. |

## Known limitations

- Hosted persistent memory needs a mounted disk or Elasticsearch; the local JSON file survives restarts on the local machine.
- Kernel remote-browser and Channel3 catalogue keys are not configured. RDAP, TLS, page metadata and structured product data are live.
- PayPal webhooks are not handled.
- Web UI was built and type-checked; browser automation was not available in this environment.
