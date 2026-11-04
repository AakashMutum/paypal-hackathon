# TrustOra requirement checklist

Status of the PRD requirements against the current implementation. Last verified: 2026-11-04
(final closure pass).

Status values: **COMPLETE** (implemented and tested), **PARTIAL** (implemented with an external
dependency or an accounted limitation), **BLOCKED** (waiting on credentials or an external action).

## Functional requirements

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| FR-001 | Website information collection | PARTIAL | `packages/signals/src/agentPort/html.ts` extracts title, site name, contact details, legal links and structured product metadata. Contact details or a link count as a contact page; readable pages with neither contact nor legal evidence emit low `CONTACT_LEGAL_MISSING`. Live contact/privacy/terms links are fetched with bounded, SSRF-safe checks; failures emit informational `CONTACT_LEGAL_UNVERIFIED`, not a legitimacy claim. A true favicon mismatch still needs a trusted reference favicon and is never invented. |
| FR-002 | Domain authenticity analysis | COMPLETE | RDAP resolves the authoritative IANA endpoint (with registry fallbacks), extracts registration date, age and registrar name; TLS validity/issuer is reported separately. Registrar reputation history is not scored. |
| FR-003 | Merchant identity verification | PARTIAL | Local `merchant_records` is authoritative and is checked first. An optional schema-validated corporate-registry HTTP adapter (`CORPORATE_REGISTRY_URL`, API key, timeout) is used only when local records are empty; malformed, failed or timed-out responses fall back to local-only. No provider is configured here, so missing records remain explicit UNKNOWN/UNVERIFIED. |
| FR-004 | Product and price analysis | PARTIAL | Structured JSON-LD/OpenGraph/microdata product data is extracted. Channel3 now has response validation, normalized currency, configurable endpoint, source/provider/fetched-at provenance and explicit `history: unavailable`. Without `CHANNEL3_API_KEY` the result is `PRICE_UNKNOWN`; no market price or historical norm is invented. |
| FR-005 | Payment recipient verification | COMPLETE | Payee binding and PayPal payee comparison produce deterministic evidence. A scan without a payee is labelled a merchant-level scan, not an identity check. |
| FR-006 | AI risk assessment | COMPLETE | Deterministic scoring with hard-rule floors plus live Gemini structured analysis; the model cannot override the rules. |
| FR-007 | Risk explanation generation | COMPLETE | Gemini explanations are validated against Zod schemas and the explanation checker; unsafe or uncited output falls back to neutral templates. |
| FR-008 | Payment intervention | COMPLETE | PayPal AUTHORIZE -> investigation -> capture/void gate. Capture/void are mock-tested; a real sandbox capture needs buyer approval. |
| FR-009 | Customer dashboard | COMPLETE | Counters and the defended amount are derived only from persisted investigations (empty store shows zero). History, analyst console, engine and payment views are present. |
| FR-010 | Transaction and risk logging | COMPLETE | PostgreSQL `investigations`, `payment_events` and `spend_policies`. Buyer email is masked, expected payee email is stored only as a fingerprint, and `AUDIT_ENCRYPTION_KEY` enables AES-256-GCM for both JSONB payloads. |

## Non-functional requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Latency under 2 seconds | PARTIAL | With `AGENT_MODEL_BUDGET_MS=1200`, five live ambiguous scans of the same public page measured 1733, 1848, 1887, 2055 and 3740 ms (the first was a cold request). Warm median: **1887 ms**; 4 of 5 under 2 s. Slow model calls fall back to the existing template explanation; the deterministic decision is unchanged. A cold process can still exceed 2 s. |
| Security and privacy | COMPLETE | No secrets in source or responses; URL safety checks; page text sanitized; memory stores anonymous pattern records. Persisted buyer PII is redacted; audit JSON is encrypted when `AUDIT_ENCRYPTION_KEY` is set and `/health` reports the encryption status. |
| Reliability and graceful degradation | COMPLETE | Bounded retries for transient failures only; blocked/CAPTCHA/unavailable/empty states are distinct; model, registry and memory failures fall back explicitly. |
| Explainability | COMPLETE | Every decision cites evidence; availability and missing-data reasons are shown separately. |

## AI, memory and payments

| Area | Status | Evidence |
| --- | --- | --- |
| Live Gemini provider | COMPLETE | `GEMINI_API_KEY` accepted; provider/model/fallback reported by `/health`; real structured JSON verified. |
| Deterministic rule precedence | COMPLETE | Hard rules are evaluated before and independently of the model; model evidence is non-deterministic and capped. |
| RAG storage and retrieval | COMPLETE | Persistent JSON file with Gemini embeddings (`gemini-embedding-001`); exact, embedding and lexical retrieval; citations and relevance are validated. |
| RAG persistence across restarts | COMPLETE | A case stored in one process was retrieved by a restarted process with `retrieval: embedding (gemini)`. |
| PayPal sandbox OAuth/order | COMPLETE | Live sandbox OAuth, order creation and retrieval passed. |
| PayPal capture/void | BLOCKED (external) | Code and tests cover ALLOW/WARN/PAUSE, unapproved authorization, payee fingerprint mismatch, capture failure, idempotency and void. A real sandbox buyer approval/capture/void has not occurred. |
| Real PayPal JS approval | PARTIAL | The SDK loads when `VITE_PAYPAL_CLIENT_ID` is set and `onApprove` calls the backend gate. The public client id is empty locally, so the simulated button is used. No real buyer approval has occurred. |
| CI-equivalent checks | PARTIAL | Focused tests, build, typecheck, lint, contracts, brands and hygiene pass locally. PR #37 CI is green on the prior fix branch; this new branch needs its own PR for CI. |

## Live external-provider status (2026-11-04)

- **Corporate registry: BLOCKED.** No `CORPORATE_REGISTRY_URL` or API key is configured. The
  adapter, schema validation, timeout and local fallback tests pass; no live lookup was made.
- **Channel3: BLOCKED.** No `CHANNEL3_API_KEY` is configured. The adapter, currency, provenance,
  schema, timeout and fallback tests pass; no live offers were requested.
- **Kernel remote browser: BLOCKED.** No `KERNEL_API_KEY` is configured. Unit tests cover success,
  timeout, provider failure, cleanup, private/credential targets, non-standard ports and private
  final URLs; no JavaScript-rendered page was fetched live.

## Remaining external configuration

- `AUDIT_ENCRYPTION_KEY`: generate a local 32-byte key (64 hex characters) and set it in the API
  `.env` to enable encryption at rest. Without it, redaction still applies.
- `KERNEL_API_KEY`: enables the remote browser for JavaScript-heavy pages.
- `CHANNEL3_API_KEY`: enables live price comparison; optional `CHANNEL3_BASE_URL` points at a
  compatible endpoint.
- `CORPORATE_REGISTRY_URL`, `CORPORATE_REGISTRY_API_KEY`, `CORPORATE_REGISTRY_TIMEOUT_MS`: enable
  the optional corporate-registry adapter. Without them, identity is local-only and explicit.
- `AGENT_MODEL_BUDGET_MS=1200`: bounds model calls and protects the warm latency target.
- `VALIDATE_SECTION_PAGES=true`: enables the bounded contact/legal link checks.
- `VITE_PAYPAL_CLIENT_ID` plus sandbox API credentials and a sandbox buyer approval: required for a
  real capture/void. No capture occurs without buyer approval and a valid authorization.

## Known limitations

- Hosted persistent memory needs a mounted disk or Elasticsearch; the local JSON file survives
  restarts on the local machine.
- Kernel remote-browser and Channel3 catalogue keys are not configured. RDAP, TLS, page metadata,
  product metadata and structured server-rendered pages are live.
- A reference-backed favicon mismatch and registrar reputation history are not implemented.
- Historical product-price norms are not implemented. Only a genuine persisted/provider source may
  supply them; the current evidence reports `history: unavailable`.
- PayPal webhooks are not handled.
- Web UI was built and type-checked; browser automation was not available in this environment.
- The latency target is met on warm runs but not guaranteed for cold starts or slow external
  providers.
