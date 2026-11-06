# TrustOra — AI-Powered Merchant Risk Investigation

**Investigate Before You Trust.**

TrustOra checks who is really getting paid before a PayPal payment is captured. A shopper sees a checkout page that claims to be one merchant, but the PayPal account that receives the money can belong to someone else. A fake outlet can copy a brand's look, undercut its price and route the payment to a personal account. TrustOra connects the two sides: the merchant the storefront **claims** to be, and the **actual payee** on the PayPal order — then decides whether to authorize, hold, or block the payment before money moves.

---

## Hosted demo

**Frontend:** `https://trustora-demo.vercel.app/`
**Backend health:** `https://trust-ora.onrender.com/health`

You do not need an account to try it. The default run uses a built-in simulation of PayPal (payment ids start with `SIM-`, every response says `simulated: true`). Real PayPal sandbox approval appears only when the API runs with sandbox credentials and the web app has `VITE_PAYPAL_CLIENT_ID` set.

---

## What TrustOra does (verified in code)

1. **Authorize.** The API creates the PayPal order with intent `AUTHORIZE`, so the money is held rather than taken (`apps/api/src/controllers/frontendApi.controller.ts`).
2. **Investigate.** The investigator agent (`packages/agent`) gathers evidence: domain age and certificate, payee binding (does the site publish its payee?), lookalike check against known brands, price against comparable sellers, registry record of the payee, claimed-name vs registered-name comparison, and past scam patterns from memory.
3. **Decide.** Evidence is scored on four weighted buckets (domain 30, merchant identity 40, pricing 20, technical 10) and turned into a decision (`packages/agent/src/scoring/decide.ts`):

   | Score | Decision | Meaning |
   |-------|----------|---------|
   | 0–39  | ALLOW    | Eligible for capture |
   | 40–74 | WARN     | Held until a person confirms |
   | 75–100| PAUSE    | Capture is blocked |

4. **Capture or void.** In the web flow only an ALLOW reaches capture; WARN and PAUSE are held, and a held order can be cancelled, which voids the authorization. On the agent routes a person can approve a WARN, but the code never captures a PAUSE decision.

**Hard rules the language model cannot override** (`packages/agent/src/scoring/rules.ts`):
- The site publishes a merchant id that differs from the PayPal payee → score floor 75 (PAUSE).
- The domain imitates a known brand and the payee is not linked to that brand → score floor 75.
- Hidden text on the page tries to instruct an AI assistant → score floor 40.

Hard rules need deterministic evidence. Anything written by a language model can raise suspicion but cannot reach PAUSE on its own, and page text is treated as untrusted data throughout.

---

## AI Implementation and Intelligence

### AI model

TrustOra uses **Google Gemini** through an OpenAI-compatible HTTP endpoint.

| Setting | Default | Notes |
|---------|---------|-------|
| `LLM_PROVIDER` | `openai-compatible` | Set `gemini` to use Gemini |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `LLM_MODEL_FAST` | `gpt-4o-mini` | Gemini: `gemini-3.5-flash` |
| `LLM_MODEL_STRONG` | `gpt-4o-mini` | Gemini: `gemini-3.5-flash` |
| `LLM_MODE` | `live` when a key is set, else `none` | `live`, `record`, `replay`, `none` |
| `LLM_API_KEY` / `GEMINI_API_KEY` | (none) | Read server-side only; never exposed to the frontend |

The model name is **not hardcoded to Gemini** — it reads `LLM_PROVIDER`/`LLM_BASE_URL`. Gemini is used only when `LLM_PROVIDER=gemini` (or `LLM_BASE_URL` points at `generativelanguage.googleapis.com`) and a key is configured. Otherwise the default provider is OpenAI-compatible with `gpt-4o-mini`.

How the model is called: `packages/agent/src/agentPorts.ts` (`getLlmClient`) builds an HTTP JSON client against the configured provider. `packages/agent/src/llm/httpProvider.ts` sends the request; `packages/agent/src/llm/json.ts` validates structured replies through Zod; `packages/agent/src/llm/recordReplay.ts` supports record/replay mode so the model is not required for tests.

### AI's role in TrustOra

```
Merchant URL / Investigation Request
    ↓
Website Signals and Available Evidence   (RDAP, TLS, page text, payee binding, price)
    ↓
AI Investigation Processing              (optional Gemini; deterministic fallback when unavailable)
    ↓
Structured Investigation Findings        (evidence nodes, citations, confidence)
    ↓
Risk Assessment Presented to User        (ALLOW / WARN / PAUSE)
```

Verify this flow against: `packages/agent/src/agentPorts.ts` (`createAgentWiring`), `packages/agent/src/scoring/decide.ts`, `packages/agent/src/scoring/rules.ts`.

### AI inference vs AI developer tools

**AI inference inside the application** (production runtime):
- Google Gemini (when `LLM_PROVIDER=gemini` and a key is set), used for follow-up investigation steps, name comparison, promotional-language reading, memory pattern sentences, retrieved-case relevance, and plain-language explanations.
- All LLM output is validated through Zod schemas and can never override hard rules or change the deterministic decision.

**AI developer tools used during coding** (not the production engine):
- Google Antigravity (Google DeepMind AI coding assistant) — backend and integration work
- GitHub Copilot — inline code completion during development
- ChatGPT / GPT-4o — research, prompt design for the LLM investigation step, architecture brainstorming

Antigravity, Claude, and ChatGPT are **not** the production AI engine. They supported prompting, code generation, code improvement, debugging, testing assistance, and documentation during development only.

### AI reliability (verified mechanisms)

- Structured results: every LLM reply is validated through Zod; schema violations are repaired once, then rejected (`packages/agent/src/llm/json.ts`).
- Evidence handling: model-written evidence never adds points and never lowers a score (`packages/agent/src/scoring/pointsFor.ts`).
- Unknown states: price, payee, and registry checks return explicit `UNKNOWN` / `NOT_CHECKED` / `ERROR` statuses — never fabricated matches (Bug 7 fix).
- Error handling: model failure is reported, not thrown; deterministic fallbacks remain when the model is unavailable.
- Similar-case filtering: retrieved cases are filtered by a `MIN_CASE_SIMILARITY` (0.5) threshold; low-confidence matches are dropped, not shown merely to fill the list (Bug 9 fix).
- Latency measurement: every live scan records `latencyMs` and reports whether it met the under-2-second target (Bug 11).
- Validation: Zod schemas validate config, evidence, and LLM replies (Bug 12 fix — zod upgraded to `^4.6.7`).

AI output **assists investigation and does not guarantee** that a merchant is safe or fraudulent.

### AI transparency

| Information | Source |
|-------------|--------|
| Domain age, registrar, TLS certificate | Website signals (RDAP / TLS) |
| Payee binding match/mismatch | Backend investigation logic |
| Merchant identity vs payee | Backend rules + registry |
| Price deviation vs market | Channel3 catalogue (when configured) |
| Past scam patterns | Memory store (file / Elasticsearch) |
| Plain-language explanation, name comparison | AI (Gemini / OpenAI-compatible, optional) |

---

## PayPal Developer Platform Integration

### What is actually used

TrustOra integrates the **PayPal Orders API v2** and **Payments API v2** against the **PayPal Sandbox** only. The API refuses to start unless `PAYPAL_MODE=sandbox` (`apps/api/src/config/env.ts`).

| Capability | Endpoint | Where |
|------------|----------|-------|
| OAuth 2.0 client credentials | `POST /v1/oauth2/token` | `apps/api/src/services/paypal/paypalAuth.service.ts` |
| Orders v2: create (intent `AUTHORIZE`) | `POST /v2/checkout/orders` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Orders v2: authorize | `POST /v2/checkout/orders/{id}/authorize` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Payments v2: capture an authorization | `POST /v2/payments/authorizations/{id}/capture` | `apps/api/src/services/paypal/paypalOrders.service.ts` |
| Payments v2: void an authorization | `POST /v2/payments/authorizations/{id}/void` | `apps/api/src/services/paypal/paypalOrders.service.ts` |

Create, authorize, capture and void send a `PayPal-Request-Id` header for idempotency. The flow is orchestrated by `apps/api/src/services/payments/paymentFlow.service.ts`.

### How PayPal connects to merchant investigation

The checkout flow authorizes first, then the investigator agent decides ALLOW/WARN/PAUSE **before** any capture:
- ALLOW → capture the authorization.
- WARN → held until a person acknowledges; then captured.
- PAUSE → never captured; can be voided (cancellation).

No funds are captured until the investigation completes. The web app loads PayPal's own JavaScript SDK button (`intent=authorize`) when the API is in sandbox mode and `VITE_PAYPAL_CLIENT_ID` is set (`apps/web/src/hooks/usePaypalAuth.ts`, `apps/web/src/lib/payment.ts`).

**Do not claim:** production payment processing, that PayPal automatically blocks fraudulent websites, or that payment operations work with real money. All PayPal activity here is sandbox/test-mode only.

### Sandbox testing process

Real sandbox OAuth, order creation and retrieval were verified live (the `PayPal Sandbox Live Integration Suite` test obtains a real OAuth token and creates/retrieves a real sandbox order). Authorize/capture require a buyer approval that is not automated in the committed tests.

---

## Additional Sponsor Integrations

### Channel3

**Role:** product catalogue used for price comparison in live signals, providing market context (median/min price, offer count, sample domains) for the investigated merchant.

**Integration:** `packages/signals/src/agentPort/channel3Client.ts` — `POST https://api.trychannel3.com/v1/search` with an `x-api-key` header; body `{ query, filters, limit }`; response `{ products: [{ offers: [...] }] }`. The API key is sent server-side only and is redacted from errors/logs. When not configured, price comparison is reported as `PRICE_UNKNOWN` — no comparison is invented.

**MCP demo:** `apps/mcp/demo-agent/marketplace.ts` uses Channel3 for market context in the demo shopper.

### Render

**Deployment:** the backend API is hosted on Render. `render.yaml` defines one Postgres database (`trustora-db`), the API web service (`trustora-api`), and the static web app (`trustora-web`).

- API build: `npm ci --include=dev && npm run build -w @checkout-guardian/api`
- API start: `node apps/api/dist/src/database/migrate.js && node apps/api/dist/src/server.js`
- Health check path: `/health`
- Web static publish path: `apps/web/dist` with SPA rewrite to `/index.html`

All secrets (`PAYPAL_CLIENT_SECRET`, `LLM_API_KEY`, `AUDIT_ENCRYPTION_KEY`, etc.) are `sync: false` and set in the Render dashboard — none live in `render.yaml`.

**Not claimed:** Render Workflows were not used unless actual workflows exist in the repository.

### Not listed

APIMatic, AG Grid is used (analyst console table, Community edition), Postman, Astropods, or other sponsor tools are **not** listed because they were not actually used in this repository.

---

## Tech Stack

| Technology | Purpose | Actual usage |
|------------|---------|--------------|
| React + Vite | Frontend | `apps/web` — storefronts, checkout, investigation view, analyst console |
| TypeScript | Language | All packages |
| Node.js + Express | Backend API | `apps/api` — PayPal orders, investigation routes, MCP agent routes |
| PayPal Orders/Payments API v2 | Sandbox payments | authorize → capture/void, sandbox only |
| Google Gemini (OpenAI-compatible) | Optional AI | explanations, name comparison, promo language, memory patterns |
| PostgreSQL | Persistence | investigations, checkout sessions, policies, risk assessments, payment decisions |
| Channel3 | Price comparison | optional catalogue, `x-api-key` header |
| Elasticsearch | Optional scam memory | semantic `semantic_text` search; file-backed JSON fallback |
| data.gov.in | Corporate registry | FR-003 wired adapter (UNKNOWN fallback when unavailable) |
| AG Grid (Community) | Analyst table | sorting, filters, CSV export |
| MCP | Agent tools | `investigate_merchant`, `safe_checkout`, `set_spend_policy` |
| Zod | Validation | config, evidence, LLM replies (upgraded to `^4.6.7` for security) |

---

## Architecture

```
Shopper / AI shopping agent
    │
    ▼
┌─────────────┐
│ apps/web    │  React + Vite frontend (storefront, checkout, case, payment)
│ (Vercel)    │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────┐
│ apps/api    │  Express API (Render)
│ (Render)    │  ├ PayPal Sandbox (authorize/capture/void)
└──────┬──────┘  ├ Investigator agent (packages/agent)
       │         ├ Signals (RDAP, TLS, payee binding, price/Channel3)
       ▼         ├ Memory (file / Elasticsearch / in-memory)
┌─────────────┐  └ LLM (Gemini / OpenAI-compatible, optional)
│ PostgreSQL  │
│ (Render)    │  investigations, payments, policies
└─────────────┘
```

The frontend is deployed on Vercel; the Express backend is deployed separately on Render (an Express `app.listen()` server is not Vercel Functions-compatible).

---

## Project Structure

```
checkout-guardian/
├── apps/
│   ├── api/              # Express API: PayPal, investigation, agent routes, migrations
│   ├── mcp/              # MCP server: investigate_merchant, safe_checkout, set_spend_policy
│   └── web/              # React + Vite frontend
├── packages/
│   ├── contracts/        # Shared types and constants
│   ├── agent/            # Investigator agent: scoring, hard rules, identity, explanations
│   ├── signals/          # Evidence collectors and signals port
│   ├── memory/           # Scam-pattern memory (file / Elasticsearch / in-memory)
│   └── eval/             # Evaluation harness and reports
├── demo-sites/           # Fictional stores (invented brands, .example domains)
├── docs/                 # Deployment, sandbox, AI judge guide, acceptance tests
├── tests/                # Shared fixtures and cross-package tests
├── infra/                # Deployment and environment setup
├── scripts/              # Repo checks (brands, hygiene, smoke deploy)
├── LICENSE               # MIT
├── package.json          # npm workspaces + build orchestration
├── render.yaml           # Render blueprint (API + Postgres + static web)
└── vercel.json           # Vercel frontend config (output: apps/web/dist)
```

---

## Setup Instructions

### Prerequisites

- Node.js 22
- npm (comes with Node)

### Installation

```bash
# Clone the repository
git clone https://github.com/Shravan2307/paypal-hackathon.git
cd paypal-hackathon

# Install all workspace dependencies
npm ci
```

### Build

```bash
# Builds all workspace packages (contracts, signals, memory, agent) then api, mcp, web, eval
npm run build
```

### Type check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### Environment setup

Copy the example files and fill in values (placeholders only — never commit real secrets):

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

See "Environment Variables" below.

### Database setup

```bash
# Apply migrations 001–003
npm run migrate

# Check migration status
npm run migrate:status
```

Without `DATABASE_URL`, the API runs in memory mode (data lost on restart) and `/health` reports `not_configured` for the database.

### Start the backend (API)

```bash
npm start                 # API on http://localhost:3000
```

### Start the frontend (dev)

```bash
# In a second terminal
npm run dev:web           # http://localhost:5173
```

To make the web app call the API instead of its built-in simulated backend, set `VITE_API_URL=http://localhost:3000` (or `VITE_USE_MOCK=false`) in `apps/web/.env`.

### Run the demo

Open `/stores`, pick each of the three fictional stores, add the item and check out:

| Store | Expected decision | Expected outcome |
|-------|-------------------|------------------|
| Harborline Outfitters (genuine) | ALLOW | Captured |
| Bargain Barn Outlet (discount) | WARN | Held until acknowledged, then captured |
| Harborlyne Outfitters Sale (impersonator) | PAUSE | Never captured; authorization voided |

`/analyst` shows every investigation with its evidence.

To watch an AI shopping agent through the MCP server (API must be running):

```bash
npm run demo:agent -- --auto-human yes
```

---

## Environment Variables

Names only; values never belong in the repository. See `.env.example` and `apps/web/.env.example`.

| Variable | Read in | Notes |
|----------|---------|-------|
| `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | `apps/api/src/config/env.ts` | |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_TIMEOUT_MS`, `DATABASE_MAX_CONNECTIONS` | `apps/api/src/config/env.ts` | PostgreSQL |
| `AUDIT_ENCRYPTION_KEY`, `AUDIT_ENCRYPTION_KEY_PREVIOUS`, `AUDIT_HMAC_KEY` | `apps/api/src/services/persistence/auditPrivacy.ts` | Generate 64 hex chars locally; never commit |
| `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_TIMEOUT_MS` | `apps/api/src/config/env.ts` | `PAYPAL_MODE=sandbox` required |
| `DEMO_ADMIN_TOKEN`, `GUARDIAN_API_KEY` | `apps/api/src/config/env.ts` | Access control |
| `STORE_*_PAYEE_EMAIL`, `STORE_*_PAYEE_MERCHANT_ID` | `apps/api/src/config/storeCatalog.ts` | Demo store payees |
| `LLM_PROVIDER`, `LLM_API_KEY`, `GEMINI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`, `LLM_MODE`, `LLM_FIXTURE_DIR` | `packages/agent/src/config.ts` | Gemini when `LLM_PROVIDER=gemini` |
| `KERNEL_API_KEY` | `packages/signals` | Optional remote browser |
| `CHANNEL3_API_KEY`, `CHANNEL3_BASE_URL` | `packages/signals/src/agentPort/channel3Client.ts` | Optional price comparison |
| `ELASTIC_URL`, `ELASTIC_API_KEY`, `ELASTIC_INDEX`, `ELASTIC_INFERENCE_ID` | `packages/agent/src/config.ts`, `packages/memory` | Optional scam memory |
| `MEMORY_MODE`, `MEMORY_FILE` | `packages/memory` | `file` / `elastic` / `memory` |
| `SIGNALS_MODE` | `apps/api/src/services/agent/agentPorts.ts` | `replay` / `live` / `auto` |
| `AGENT_MODEL_BUDGET_MS`, `AGENT_TIMEOUT_MS`, `AGENT_MAX_FOLLOWUPS` | `packages/agent/src/config.ts` | Agent limits |
| `VITE_API_URL`, `VITE_USE_MOCK` | `apps/web/src/api/apiClient.ts` | Frontend→API wiring |
| `VITE_PAYPAL_CLIENT_ID` | `apps/web/src/hooks/usePaypalAuth.ts` | PayPal sandbox client id (public) |

`.env` and `apps/web/.env` are git-ignored. Never commit secrets.

---

## Testing

| Command | What it runs |
|---------|--------------|
| `npm run test:integration` | API tests with mocked PayPal (no network, no credentials) |
| `npm run test:e2e` | End-to-end API tests: demo flow, agent routes, PayPal authorize/capture/void (fake `fetch`) |
| `npm run test:packages` | Agent, MCP, signals, memory, eval, web and scripts package tests |
| `npm run test:contracts` | Contracts type check and fixture validation |
| `npm run test:agent` | Investigator agent |
| `npm run test:mcp` | MCP server |
| `npm test -w @checkout-guardian/signals` | Signals package |
| `npm test -w @checkout-guardian/memory` | Memory package |
| `npm test -w @checkout-guardian/eval` | Eval package |
| `npm run test:sandbox` | Real PayPal sandbox calls (needs credentials; manual) |
| `npm run check:brands` | Fictional-brand guard |
| `npm run check:hygiene` | Repository checks |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Production build (all packages) |
| `npm audit --audit-level=critical` | Critical dependency vulnerabilities |

### Verified test results (this branch)

- Agent: 500/500 pass
- MCP: 73/73 pass
- Signals: 116/116 pass
- Memory: 46/46 pass (1 live-Elastic test skipped without credentials)
- Eval: 31/31 pass
- Web: 68/68 pass
- API: 163/163 pass (incl. real PayPal sandbox OAuth + order create/retrieve)
- Scripts: 11/11 pass
- Contracts: pass
- Brands: OK (411 files scanned)
- Hygiene: OK (467 tracked files)
- Lint: 0 errors (3 pre-existing warnings in `apps/mcp`)
- Typecheck: workspace packages pass
- Build: all packages pass
- `npm audit --audit-level=critical`: no critical vulnerabilities

Automated tests use mocks/fakes; real PayPal sandbox and real Gemini calls require credentials and are not part of CI.

---

## Judge Testing Guide

### Live demo

- Frontend: `https://trustora-demo.vercel.app/`
- Backend health: `https://trust-ora.onrender.com/health`

### Local setup

See "Setup Instructions" above. The API runs without any accounts or database (payments simulated, data in memory).

### Merchant investigation workflow

1. Start the API (`npm start`) and web app (`npm run dev:web`).
2. Open `/stores`, choose a fictional store, check out.
3. Observe the decision (ALLOW / WARN / PAUSE) and the evidence in `/engine/:id` or `/pay/:id`.
4. Open `/analyst` to see the investigation table with filters and CSV export.

### PayPal Sandbox test workflow

1. Set `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `DATABASE_URL` in the API `.env`.
2. Set `VITE_API_URL` and `VITE_PAYPAL_CLIENT_ID` (public sandbox client id) in `apps/web/.env`.
3. Restart both. The PayPal SDK renders a real approval button; a sandbox buyer approves.
4. After approval the backend authorizes and applies ALLOW/WARN/PAUSE. Capture/void require valid authorization.

### Required credentials

None for the default simulated run. Sandbox testing requires PayPal sandbox client id/secret (obtained from the PayPal Developer Dashboard — never commit them).

### Limitations

- The hosted Render instance is on the free tier and sleeps after ~15 minutes; the first request is cold and slow.
- Real sandbox authorize/capture require buyer approval (not automated).
- Live Gemini and Channel3 require keys not configured in this repository.

---

## Bug Fixes and Engineering Contributions (Bugs 7–12)

- **Bug 7 — Unknown statuses:** Added `UNKNOWN`, `NOT_CHECKED`, `ERROR` to `EvidenceStatus`. Unknown price/payee checks are never labelled PASS or CHECKED; empty evidence returns `NOT_CHECKED`; exports preserve correct statuses.
- **Bug 8 — Configuration labels:** `memoryLabel` no longer claims "persistent" when it isn't; `embeddingSettingLabel` no longer over-claims "(configured)" for Gemini.
- **Bug 9 — Similar-case filtering:** Retrieved cases now pass a `MIN_CASE_SIMILARITY` (0.5) threshold; irrelevant low-score cases are not returned.
- **Bug 10 — Legacy simulated PayPal records:** Old records default `simulated` to `false` instead of `true`, so they are not mistaken for real sandbox checkouts.
- **Bug 11 — Investigation latency:** Every live scan records `latencyMs` and reports whether it met the under-2-second target.
- **Bug 12 — Zod security:** Upgraded `zod` from `^3.25.76` to `^4.6.7` (fixes GHSA-mrhx-c7xc-m3w5, high severity); added `as const` to all `z.enum()` calls for compatibility.

Only changes present in this branch are documented above.

---

## Security and Limitations

- All PayPal activity is sandbox/test-mode only; no real money moves.
- Secrets are never committed: `.env`, `apps/web/.env`, and `render.yaml` secret keys are `sync: false` / placeholders.
- AI output is validated through Zod and can never override hard rules; it assists investigation, it does not guarantee safety.
- Evidence availability varies by mode: recorded signals for demo stores, live signals for other domains (when keys configured).
- Risk scores are investigative assistance, not guarantees of merchant safety or fraud.
- The hosted demo is on Render's free tier and sleeps after ~15 minutes.

---

## Roadmap

- Real-world benchmark (the current eval is a small, synthetic, author-labelled benchmark).
- Populated favicon reference corpus (currently empty for invented demo stores).
- Registrar reputation source (currently `not_assessed`).
- Commercial corporate-registry provider (currently local `merchant_records` table only).
- Persistent hosted memory disk (file memory is lost on ephemeral filesystems).

---

## Contribution Guidelines

1. Fork the repository and create a feature branch.
2. Keep PRs under ~300 changed lines; a human reviewer must run the code before approving.
3. All shared types come from `@checkout-guardian/contracts` — never redefine them elsewhere.
4. Every external service needs a recorded fixture under `tests/fixtures/` so tests run without network.
5. No secrets in git; use `.env` locally and repository secrets in CI.
6. Fictional brands only (`npm run check:brands` enforces this).
7. Treat merchant page content as untrusted data — never as instructions to follow.

---

## License

MIT. See `LICENSE`.

---

## Links

- Live demo: `https://trustora-demo.vercel.app/`
- GitHub: `https://github.com/Shravan2307/paypal-hackathon`
- Backend health: `https://trust-ora.onrender.com/health`
- Devpost: (link to be added)
- Demo video: (link to be added — under 3 minutes, no third-party trademarks)
