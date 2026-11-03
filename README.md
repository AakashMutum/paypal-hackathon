# TrustOra

TrustOra checks who is really getting paid before a PayPal payment is captured.

## The problem

A shopper sees a checkout page that claims to be one merchant, but the PayPal account that
receives the money belongs to someone else. A fake outlet can copy a brand's look, undercut its
price and route the payment to a personal account. A fraud score on the page alone does not catch
that, and an AI shopping agent that reads the page can be talked into paying by text hidden in it.

TrustOra connects the two sides: the merchant the storefront **claims** to be, and the **actual
payee** on the PayPal order.

## How it works

1. **Authorize.** The API creates the PayPal order with intent `AUTHORIZE`, so the money is held
   rather than taken (`apps/api/src/controllers/frontendApi.controller.ts`).
2. **Investigate.** The investigator agent (`packages/agent`) gathers evidence: domain age and
   certificate, whether the site publishes its payee ("payee binding"), a lookalike check against
   known brands, price against comparable sellers, the registry record of the payee, how the
   claimed name compares with the registered name, and past scam patterns from memory.
3. **Decide.** Evidence is scored on four weighted buckets (domain 30, merchant identity 40,
   pricing 20, technical 10) and turned into a decision:

   | Score | Decision | Meaning |
   | --- | --- | --- |
   | 0 to 39 | ALLOW | Eligible for capture |
   | 40 to 74 | WARN | Held until a person confirms |
   | 75 to 100 | PAUSE | Capture is blocked |

   (`packages/agent/src/scoring/decide.ts`.) The web app shows PAUSE as "BLOCK".
4. **Capture or void.** In the web flow only an ALLOW reaches capture; WARN and PAUSE are held,
   and a held order can be cancelled, which voids the authorization. On the agent routes a person
   can approve a WARN, but the code never captures a PAUSE decision.

**Hard rules the language model cannot override** (`packages/agent/src/scoring/rules.ts`):

- The site publishes a merchant id that differs from the PayPal payee: score floor 75, so PAUSE.
- The domain imitates a known brand and the payee is not linked to that brand: score floor 75.
- Hidden text on the page tries to instruct an AI assistant: score floor 40.

Hard rules need deterministic evidence. Anything written by a language model can raise suspicion
but cannot reach PAUSE on its own, and page text is treated as untrusted data throughout. A
language model only writes plain-language explanations and helps compare names; every step has a
deterministic fallback.

## Architecture

```mermaid
flowchart LR
  Shopper[Shopper or AI shopping agent] --> Web[apps/web<br/>React app]
  Shopper --> MCP[apps/mcp<br/>MCP server]
  Web --> API[apps/api<br/>Express API]
  MCP --> API
  API --> PayPal[PayPal sandbox<br/>authorize, capture, void]
  API --> Agent[packages/agent<br/>investigator]
  Agent --> Signals[packages/signals<br/>domain, TLS, binding, page, price]
  Agent --> Memory[packages/memory<br/>past scam patterns]
  Agent --> Registry[Merchant registry]
  API --> DB[(PostgreSQL)]
  Agent -. optional .-> LLM[Language model]
  Memory -. optional .-> Elastic[(Elasticsearch)]
```

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/api` | Express API: PayPal orders, the demo routes the web app calls, the agent routes the MCP server calls, migrations |
| `apps/web` | React app: storefronts, checkout, the investigation view, analyst console |
| `apps/mcp` | MCP server with the tools `investigate_merchant`, `safe_checkout`, `set_spend_policy`, and a demo shopping agent |
| `packages/contracts` | Shared types and constants |
| `packages/agent` | Investigator agent: scoring, hard rules, identity matching, explanations, memory use |
| `packages/signals` | Evidence collectors and an in-process signals port for the agent |
| `packages/memory` | Anonymous memory of past scam patterns (in memory or Elasticsearch) |
| `packages/eval` | Benchmark and metrics |
| `demo-sites`, `tests`, `infra`, `scripts`, `docs` | Fictional demo notes, shared fixtures, deployment, repo checks, documentation |

## Quick start

You need Node 22.

```bash
npm ci
npm run build
```

### Demo mode (no accounts, no database)

```bash
# API: runs without PayPal credentials or a database (payments are simulated, data stays in memory)
npm start

# Web app, in a second terminal
cp apps/web/.env.example apps/web/.env
npm run dev:web      # http://localhost:5173
```

Without `VITE_API_URL` the web app uses its built-in simulated backend (badge: "Simulated
backend"). To make it call the API, set `VITE_API_URL=http://localhost:3000` in `apps/web/.env`
(badge: "Live API").

Open `/stores` and buy from each of the three demo storefronts: the genuine one is captured, the
heavy-discount one is held until you acknowledge the warning, and the impersonator is paused.
`/analyst` is the analyst console. To watch an AI shopping agent do the same through the MCP server:

```bash
npm run demo:agent -- --auto-human yes     # needs the API running; no keys
```

See `docs/agentic-demo.md`.

### Modes

`GET /health` reports how the API runs:

| Mode | Values | Meaning |
| --- | --- | --- |
| `paypal` | `sandbox`, `simulated` | `sandbox` when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set, otherwise payments are simulated and marked `simulated: true` |
| `store` | `database`, `memory` | PostgreSQL when `DATABASE_URL` is set and migrated, otherwise memory (a warning is logged) |
| `signals` (`SIGNALS_MODE`) | `replay`, `live`, `auto` | Recorded signals for the demo stores; live signals; or replay for the demo stores and live for any other domain |
| `llm` (`LLM_MODE`) | `live`, `replay`, `none` | A language model (needs `LLM_API_KEY`), recorded answers, or the agent's deterministic fallbacks |
| `memory` | `elastic`, `memory` | Elasticsearch when `ELASTIC_URL` and `ELASTIC_API_KEY` are set |

Every investigation also carries a `provenance` object with the signals, LLM and memory it used.
The API refuses to start if `PAYPAL_MODE` is anything but `sandbox`.

### With a database

```bash
cp .env.example .env     # set DATABASE_URL, then PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET for the sandbox
npm run migrate
npm start
```

Deployment on Render is described in `docs/deploy.md`. Using the real PayPal sandbox is described in
`docs/paypal-sandbox.md`.

## Environment variables

Names only; values never belong in the repository. See `.env.example` and `apps/web/.env.example`.

| Variable | Read in |
| --- | --- |
| `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | `apps/api/src/config/env.ts` |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_TIMEOUT_MS`, `DATABASE_MAX_CONNECTIONS` | `apps/api/src/config/env.ts` |
| `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_TIMEOUT_MS` | `apps/api/src/config/env.ts` |
| `DEMO_ADMIN_TOKEN`, `GUARDIAN_API_KEY` | `apps/api/src/config/env.ts` |
| `STORE_GENUINE_PAYEE_EMAIL`, `STORE_GENUINE_PAYEE_MERCHANT_ID`, and the same for `DISCOUNT` and `IMPERSONATOR` | `apps/api/src/config/storeCatalog.ts` |
| `SIGNALS_MODE`, `LLM_MODE`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`, `LLM_FIXTURE_DIR`, `KERNEL_API_KEY`, `CHANNEL3_API_KEY`, `ELASTIC_URL`, `ELASTIC_API_KEY`, `ELASTIC_INDEX` | `apps/api/src/services/agent/agentPorts.ts` |
| `AGENT_TIMEOUT_MS`, `AGENT_MAX_FOLLOWUPS`, `AGENT_CONF_THRESHOLD`, `FEATURE_*`, `MEMORY_MATCH_MIN` | `packages/agent/src/config.ts` |
| `LLM_PROVIDER` | `packages/agent/src/config.ts` |
| `SIGNALS_BASE_URL`, `SIGNALS_FIXTURE_DIR` | `packages/agent/src/config.ts` |
| `ELASTIC_URL`, `ELASTIC_API_KEY`, `ELASTIC_INDEX`, `ELASTIC_INFERENCE_ID` | `packages/agent/src/config.ts`; `ELASTIC_NODE` also in `packages/memory/src/store/factory.ts` |
| `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BEARER_TOKEN`, `GUARDIAN_API_URL`, `GUARDIAN_API_KEY`, `GUARDIAN_REQUEST_TIMEOUT_MS`, `GUARDIAN_FINALIZE_TIMEOUT_MS` | `apps/mcp/src/config.ts` |
| `CHANNEL3_API_KEY`, `CHANNEL3_BASE_URL`, `LLM_*` | `apps/mcp/demo-agent` |
| `VITE_API_URL`, `VITE_USE_MOCK` | `apps/web/src/api/apiClient.ts` (the API is used when `VITE_API_URL` is set and `VITE_USE_MOCK` is not `true`) |
| `VITE_PAYPAL_CLIENT_ID` | `apps/web/src/hooks/usePaypalAuth.ts` |
| `VITE_API_TARGET` | `apps/web/vite.config.ts` (local dev proxy) |

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:integration` | API tests with mocked PayPal (no network, no credentials) |
| `npm run test:e2e` | End-to-end API tests for the demo flow, the agent routes and the PayPal authorize, capture and void flow (fake `fetch`) |
| `npm run test:packages` | Agent, MCP, signals, memory and eval package tests |
| `npm run test:contracts` | Contracts type check and fixture validation |
| `npm run test:agent` | Investigator agent |
| `npm run test:mcp` | MCP server |
| `npm test -w @checkout-guardian/signals` | Signals package (also `-w @checkout-guardian/memory`, `-w @checkout-guardian/eval`) |
| `npm run test:sandbox` | Real PayPal sandbox calls. Needs credentials; skips without them |
| `npm run check:brands`, `npm run check:hygiene` | Fictional-brand guard and repository checks |
| `npm run lint`, `npm run typecheck` | Lint and type check |

## Evaluation

`npm run eval -w @checkout-guardian/eval` compares two baselines with the full agent on a
labelled benchmark and writes `docs/eval-results.md`. It is a small synthetic benchmark written by
the team, not a claim about real-world accuracy.

## What is real and what is simulated

| Part | Real | Simulated or not yet live |
| --- | --- | --- |
| API, validation, tokens, spend policies, audit trail | Yes | |
| Investigator agent (scoring, hard rules, identity, explanations) | Yes: runs on every scan, order and agent route | |
| Signals for the three demo stores | | Recorded (`SIGNALS_MODE=replay` or `auto`) |
| Signals for any other domain | Live RDAP, TLS and payee-binding checks in `live` or `auto` mode (Kernel and Channel3 with keys) | Not cleared without evidence in `replay` mode |
| Payments | PayPal sandbox calls when sandbox credentials are set | Simulated otherwise: `SIM-` ids and `simulated: true` |
| Language model | Used when `LLM_MODE=live` and a key is set | Off by default; `replay` has no committed recordings yet |
| Memory | In process; Elasticsearch when configured | The demo stores are not written to memory |
| Persistence | PostgreSQL when `DATABASE_URL` is set | Memory otherwise |
| Web app | Calls the API when `VITE_API_URL` is set | Built-in simulated backend otherwise |

Only an ALLOW is captured. A WARN waits for a person to acknowledge it. A PAUSE, and any payee
mismatch, is never captured. The defects that remain are listed in `docs/e2e-report.md`.

## Known limitations

Be clear about what has not been run live. These parts are written and tested against fakes, but
**have not been run against the real service from this repository**:

- PayPal sandbox authorize, capture and void (tested with a fake `fetch`).
- Kernel remote browser and Channel3 catalogue (tested with fake clients).
- A language model (`LLM_MODE=live`), and recorded model answers (none are committed).
- Elasticsearch scam memory (tested with a fake `fetch`; the live test skips without credentials).
- The PostgreSQL migration and the database store (the migration test uses a mock pool).
- The web app in a browser (it builds and type-checks).

Other limits: the evaluation is a small synthetic benchmark; retrieved similar cases are shown but
are not passed to the explanation writer; PayPal webhooks are not handled.

Hosted demo: TO BE ADDED after deployment

## AI tools and services used

Runtime components that exist in the code:

| Component | Where | Use |
| --- | --- | --- |
| Language model through an OpenAI-compatible HTTP provider (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`) | `packages/agent/src/config.ts`, `packages/agent/src/llm` | Follow-up investigation steps, name comparison, the memory pattern sentence, the plain-language explanation. Optional: used only when `LLM_MODE=live` and a key is set (see Modes), otherwise the agent uses its deterministic fallbacks |
| Elasticsearch (`semantic_text`) | `packages/agent/src/adapters/memoryElastic.ts`, `packages/memory/src/patterns/elasticPatternStore.ts` | Scam-pattern memory when `ELASTIC_URL` and `ELASTIC_API_KEY` are set; otherwise an in-memory store |
| Channel3 catalogue (`@channel3/sdk`) | `apps/mcp/demo-agent/marketplace.ts` | Market context for the demo shopping agent, with a fixture fallback |
| Kernel remote browser | `packages/signals/src/agentPort/kernelClient.ts` | Loads the checkout page in a remote browser for live signals (needs `KERNEL_API_KEY`) |
| Channel3 catalogue | `packages/signals/src/agentPort/channel3Client.ts` | Price comparison for live signals (needs `CHANNEL3_API_KEY`) |
| MCP server | `apps/mcp` | Lets an AI shopping agent call `investigate_merchant`, `safe_checkout` and `set_spend_policy` |

**TEAM TO COMPLETE BEFORE SUBMISSION: development tools used (the hackathon requires disclosure).**
List each AI coding or design tool used while building the project and what it was used for.

## Judging criteria

TO BE CONFIRMED against the Devpost page (https://paypalaihackathon.devpost.com/). The page could
not be read when this README was written, so the criteria are not listed here and none are
guessed. Fill in the table from the page, then map each criterion to the features and files below.

| Criterion | How TrustOra addresses it | Where |
| --- | --- | --- |
| TO BE CONFIRMED | TO BE CONFIRMED | TO BE CONFIRMED |

Features and files likely to be cited: payee-binding hard rule (`packages/agent/src/scoring/rules.ts`),
authorize then capture or void (`apps/api`), prompt-injection shield (`packages/agent/src/guard`),
agent-facing MCP tools (`apps/mcp`), anonymous scam memory (`packages/memory`), evaluation
(`docs/eval-results.md`).

## Built during the contest period

The first commit in this repository is dated 2026-10-31 (from `git log`). TEAM TO CONFIRM against
the contest dates on the Devpost page, and note anything that existed before the contest.

## Fictional brands

Every store, brand, logo and domain in demos, fixtures and docs is invented, and demo domains use
the `.example` suffix. The hackathon bans third-party trademarks in the demo video.
`npm run check:brands` scans demo content for a list of real brand names and runs in CI.

## License

MIT. See `LICENSE`.
