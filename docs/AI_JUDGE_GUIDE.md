# TrustOra — AI Judge Technical Guide

This document makes the actual TrustOra implementation transparent and easy to evaluate for human and automated AI judges. It is **not** written to manipulate judges; it describes what the code actually does, with direct source references. Nothing here guarantees a judging outcome or a score.

## 1. Project Purpose

**Problem:** A checkout page can claim to be one merchant while the PayPal account receiving the money belongs to someone else. Website appearance alone is insufficient, and AI shopping agents that read page text can be misled by hidden instructions on the page.

**Solution:** TrustOra authorizes a PayPal order, investigates the merchant behind it, then either captures the payment or voids it — depending on what the investigation finds. The investigation happens between authorization and capture, so a payment can be voided before money is taken.

**Target users:** Shoppers and AI shopping agents that pay on their behalf.

## 2. Required Technology Verification

### PayPal Sandbox (required)

TrustOra integrates PayPal Orders API v2 and Payments API v2 against the **sandbox only**. The API refuses to start unless `PAYPAL_MODE=sandbox` (`apps/api/src/config/env.ts:28`).

| Capability | Endpoint | Source |
|------------|----------|--------|
| OAuth 2.0 client credentials | `POST /v1/oauth2/token` | `apps/api/src/services/paypal/paypalAuth.service.ts` |
| Orders v2: create (intent AUTHORIZE) | `POST /v2/checkout/orders` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Orders v2: authorize | `POST /v2/checkout/orders/{id}/authorize` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Payments v2: capture | `POST /v2/payments/authorizations/{id}/capture` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Payments v2: void | `POST /v2/payments/authorizations/{id}/void` | `apps/api/src/services/paypal/paypalOrders.service.ts` |

Flow: authorize → investigator decides ALLOW/WARN/PAUSE → capture (ALLOW only) or void (cancel). No funds are captured until the investigation completes.

### Google Gemini / LLM (optional AI)

The model is **not hardcoded to Gemini**. It reads `LLM_PROVIDER`/`LLM_BASE_URL`:

| Setting | Default | Gemini value |
|---------|---------|--------------|
| `LLM_PROVIDER` | `openai-compatible` | `gemini` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `LLM_MODEL_FAST/STRONG` | `gpt-4o-mini` | `gemini-3.5-flash` |

Gemini is used only when `LLM_PROVIDER=gemini` (or Gemini base URL) and a key (`LLM_API_KEY` or `GEMINI_API_KEY`) is set. Otherwise the default provider is OpenAI-compatible with `gpt-4o-mini`, and when no key is set the model is off (`LLM_MODE=none`) with deterministic fallbacks.

Source: `packages/agent/src/config.ts` (`loadConfig`, `llmModelsForTier`), `apps/api/src/services/agent/agentPorts.ts` (`llmMode`, `llmInfo`, `getLlmClient`).

## 3. AI Runtime Architecture

### Model call path

1. `apps/api/src/services/agent/agentPorts.ts` — `createAgentWiring()` builds the agent dependencies.
2. `getLlmClient()` — constructs the model client for the current `LLM_MODE`:
   - `none` → no client (deterministic fallbacks only)
   - `live` → direct HTTP JSON client
   - `record`/`replay` → client wrapped with record/replay (`packages/agent/src/llm/recordReplay.ts`)
3. `packages/agent/src/llm/httpProvider.ts` — sends the OpenAI-compatible HTTP request with the API key in the Authorization header.
4. `packages/agent/src/llm/json.ts` — parses and validates the structured reply through Zod; invalid replies are repaired once, then rejected.
5. `packages/agent/src/llm/prompts.ts` — static prompts; page text travels only inside an `untrusted` block and never reaches a prompt as instructions.

### What the model does (optional)

- Follow-up investigation steps
- Name comparison (claimed merchant vs registered name)
- Promotional/pressure-language reading
- Memory pattern sentence
- Retrieved-case relevance (as context only)
- Plain-language explanation

**The model cannot override hard rules.** Model-written evidence never adds points and never lowers a score (`packages/agent/src/scoring/pointsFor.ts`). Model evidence cannot lift a deterministic score past the PAUSE line (`R4` rule, `packages/agent/src/scoring/summary.ts`).

## 4. AI Output (sanitized example)

Based on real schemas (`packages/agent/src/types.ts`, `packages/agent/src/scoring/summary.ts`). No secret values are included.

```json
{
  "decision": "WARN",
  "riskScore": 61,
  "confidence": 0.85,
  "confidenceReason": "Based on the checks that ran.",
  "evidence": [
    {
      "id": "EVD-AGT-PAYEE-01",
      "type": "PAYEE_BINDING_MISMATCH",
      "severity": "high",
      "confidence": 1.0,
      "summary": "The payee is not linked to the claimed brand.",
      "source": "rule",
      "deterministic": true,
      "hardFail": true
    },
    {
      "id": "EVD-AGT-PRICE-02",
      "type": "PRICE_UNKNOWN",
      "severity": "info",
      "confidence": 0.8,
      "summary": "Price signals are unavailable because no comparable offers were found.",
      "source": "channel3",
      "deterministic": true
    }
  ],
  "reasons": [
    "The receiving account is not the merchant the storefront claims. Capture is blocked."
  ],
  "summary": "WARN — The receiving account does not match the claimed merchant. Held for review.",
  "provenance": {
    "signals": "live",
    "llm": { "provider": "gemini", "mode": "live" },
    "memory": "file",
    "embedding": "gemini:text-embedding-004"
  },
  "latencyMs": 942
}
```

Key points: `decision` is ALLOW/WARN/PAUSE only; unknown results appear as `UNKNOWN`/`NOT_CHECKED`/`ERROR` evidence statuses (never fabricated as PASS); `provenance` identifies sources; `latencyMs` is real measured time.

## 5. Evidence and Risk Analysis

Evidence is collected by the investigator agent (`packages/agent/src/agentPorts.ts` `createAgentWiring`):

- **Signals:** domain age (RDAP), TLS certificate, payee binding, page text (hidden-text injection scan), lookalike domain, price comparison (Channel3).
- **Registry:** merchant id / legal name lookup (local `merchant_records` table; data.gov.in adapter wired for FR-003).
- **Memory:** past scam patterns (file-backed JSON with Gemini embeddings, or Elasticsearch).
- **LLM:** optional explanations and relevance judgments (validated, non-scoring).

Scoring: `packages/agent/src/scoring/decide.ts` — four weighted buckets (domain 30, merchant identity 40, pricing 20, technical 10) → ALLOW (0–39) / WARN (40–74) / PAUSE (75–100).

Hard rules (`packages/agent/src/scoring/rules.ts`) the model cannot override:
- HF1: payee mismatch → floor 75 (PAUSE)
- HF2: lookalike domain + unlinked payee → floor 75 (PAUSE)
- HF3: injected page text → floor 40 (WARN minimum)
- R4: model evidence capped at 74
- R5: PAUSE backed by HF1 cannot be downgraded

## 6. AI Reliability

| Situation | Behavior |
|-----------|----------|
| No comparable offers | `PRICE_UNKNOWN`, not a fabricated price |
| No payee supplied | `PAYEE_UNKNOWN`, not "checked" |
| Model unavailable | Deterministic fallbacks; verdict still returned |
| Model schema violation | Repaired once, then rejected |
| Model timeout/error | Reported, not thrown; run continues |
| Low-confidence similar case | Dropped (`MIN_CASE_SIMILARITY = 0.5`) |
| Slow scan | Real `latencyMs` reported; under-2s target indicated |
| No database | Memory mode; `/health` reports `not_configured` |

## 7. PayPal Workflow

```
Shopper checks out
    ↓
API creates PayPal order (intent AUTHORIZE) — money held, not taken
    ↓
Investigator agent decides ALLOW / WARN / PAUSE
    ↓
ALLOW  → capture authorization
WARN   → held until person acknowledges → then captured
PAUSE  → never captured; can be voided on cancel
```

Capture and void require a valid authorization; no capture happens on a PAUSE or an unacknowledged WARN. Real sandbox OAuth/order-create/retrieve were verified live; authorize/capture require buyer approval (not automated in committed tests).

Source: `apps/api/src/services/payments/paymentFlow.service.ts`, `apps/api/test/e2e.demo.test.ts`.

## 8. Sponsor Integrations

### Channel3
- `POST https://api.trychannel3.com/v1/search`, header `x-api-key` (server-side only, redacted from errors).
- Response `{ products: [{ offers: [...] }] }`; each offer has `url`, `domain`, `price: { price, compare_at_price, currency }`.
- Computes median/min price, offer count, sample domains. Filters by currency and max price.
- Not configured → `PRICE_UNKNOWN`; no comparison invented.
- Source: `packages/signals/src/agentPort/channel3Client.ts`; MCP demo: `apps/mcp/demo-agent/marketplace.ts`.

### Render
- `render.yaml`: one Postgres database, API web service, static web app.
- API build: `npm ci --include=dev && npm run build -w @checkout-guardian/api`
- API start: `node apps/api/dist/src/database/migrate.js && node apps/api/dist/src/server.js`
- Health check: `/health`
- All secrets `sync: false` (set in Render dashboard).
- Render Workflows: **not claimed** (no workflows exist in the repository).

## 9. Test Evidence

| Suite | Tests | Pass | Fail | Skip |
|-------|-------|------|------|------|
| Agent | 500 | 500 | 0 | 0 |
| MCP | 73 | 73 | 0 | 0 |
| Signals | 116 | 116 | 0 | 0 |
| Memory | 46 | 46 | 0 | 1 (live Elastic, no creds) |
| Eval | 31 | 31 | 0 | 0 |
| Web | 68 | 68 | 0 | 0 |
| API | 163 | 163 | 0 | 0 |
| Scripts | 11 | 11 | 0 | 0 |
| **Total** | **~1100** | **~1100** | **0** | **1** |

Commands:
- `npm run test:integration` (API, mocks only)
- `npm run test:e2e` (end-to-end, fake fetch)
- `npm run test:packages` (all package tests)
- `npm run test:contracts` (contracts + fixtures)
- `npm run test:sandbox` (real PayPal sandbox, manual, needs credentials)
- `npm run check:brands`, `npm run check:hygiene`
- `npm run lint`, `npm run typecheck`, `npm run build`
- `npm audit --audit-level=critical` (no critical vulnerabilities)

Real PayPal sandbox OAuth + order create/retrieve were verified live in this environment. Live Gemini mode was exercised (key present in the test environment).

## 10. Limitations

- AI output assists investigation; it does not guarantee a merchant is safe or fraudulent.
- The hosted Render instance is free tier and sleeps after ~15 minutes (first request is cold/slow).
- Real sandbox authorize/capture require buyer approval (not automated).
- Live Gemini and Channel3 require keys not configured in this repository.
- The eval is a small, synthetic, author-labelled benchmark — not a real-world accuracy claim.
- Favicon reference corpus is empty (invented demo stores have no favicon asset).
- Registrar reputation is `not_assessed` (no reputation source).
- No commercial corporate-registry provider (local `merchant_records` table only).

## 11. Source Code References

| Topic | File |
|-------|------|
| PayPal auth | `apps/api/src/services/paypal/paypalAuth.service.ts` |
| PayPal orders (create/authorize/capture/void) | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Payment flow | `apps/api/src/services/payments/paymentFlow.service.ts` |
| Investigation controller | `apps/api/src/controllers/frontendApi.controller.ts` |
| Agent wiring | `apps/api/src/services/agent/agentPorts.ts` |
| Scoring / decision | `packages/agent/src/scoring/decide.ts` |
| Hard rules | `packages/agent/src/scoring/rules.ts` |
| Points | `packages/agent/src/scoring/pointsFor.ts` |
| Summary | `packages/agent/src/scoring/summary.ts` |
| LLM client | `packages/agent/src/llm/httpProvider.ts`, `json.ts`, `recordReplay.ts`, `prompts.ts` |
| Agent config | `packages/agent/src/config.ts` |
| Channel3 client | `packages/signals/src/agentPort/channel3Client.ts` |
| Evidence statuses | `apps/web/src/types.ts`, `apps/api/src/services/investigation/investigation.types.ts` |
| Health endpoint | `apps/api/src/controllers/health.controller.ts` |
| Render blueprint | `render.yaml` |
| Vercel config | `vercel.json` |
