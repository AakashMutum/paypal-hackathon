# Integration gaps

Audit of how the areas fit together on `main` (commit `b6f9495`). Every statement cites the file
it came from. "Not found" means a search of the repository did not find it.

## (a) Endpoints called versus endpoints served

Routes served by `apps/api` (`apps/api/src/app.ts:27-29`, `apps/api/src/routes/order.routes.ts`,
`apps/api/src/routes/health.routes.ts`):

| Method and path | Served by apps/api |
| --- | --- |
| `GET /health` | yes (`apps/api/src/app.ts:27`) |
| `GET /api/v1/health` | yes (`apps/api/src/routes/health.routes.ts`) |
| `POST /api/v1/orders` | yes (`apps/api/src/routes/order.routes.ts`) |
| `GET /api/v1/orders/:orderId` | yes (`apps/api/src/routes/order.routes.ts`) |
| `GET /api/v1/orders/:orderId/decision` | yes (`apps/api/src/routes/order.routes.ts`) |
| `POST /api/v1/orders/:orderId/capture` | yes (`apps/api/src/routes/order.routes.ts`) |

Calls made by `apps/web` (`apps/web/src/api/apiClient.ts:13-22`). The web client uses the mock
backend unless `VITE_USE_MOCK=false` (`apps/web/src/api/apiClient.ts:5`).

| Call | Served by apps/api |
| --- | --- |
| `POST /api/scan` | no, not found |
| `POST /api/orders` | no (the API serves `/api/v1/orders`) |
| `POST /api/orders/:id/approved` | no, not found |
| `GET /api/investigations` | no, not found |
| `GET /api/investigations/:id` | no, not found |
| `POST /api/orders/:id/cancel` | no, not found |
| `POST /api/orders/:id/review` | no, not found |
| `POST /api/reports` | no, not found |
| `POST /api/merchants` | no, not found |
| `POST /api/demo/reset` | no, not found |

Calls made by `apps/mcp` (`apps/mcp/src/apiClient.ts:120-143`):

| Call | Served by apps/api |
| --- | --- |
| `POST /api/v1/investigations` | no, not found |
| `POST /api/v1/checkout/orders` | no, not found |
| `POST /api/v1/checkout/orders/:checkoutId/finalize` | no, not found |
| `PUT /api/v1/policies/:agentId` | no, not found |

Calls the agent's live signals adapter would make (`packages/agent/src/adapters/signalsAdapter.ts:64-69`,
marked provisional at line 55): `POST /signals/page-claims`, `/signals/domain-report`,
`/signals/price-report`, `/signals/payee-binding`, `/signals/page-section`,
`/signals/compare-offers`. A service that serves them: not found.

`apps/api` imports no other workspace package except `@checkout-guardian/contracts`
(`apps/api/package.json:17`). A call from `apps/api` to `packages/agent`: not found.

## (b) Decision, status and capture-state words

| Area | Words | Source |
| --- | --- | --- |
| contracts / api | decisions ALLOW, WARN, PAUSE; actions EVALUATED, PROCEED, WARN_DISPLAYED, CAPTURE_PAUSED, USER_OVERRIDE, USER_ABANDONED; session status CREATED, EVALUATING, PENDING_REVIEW, ALLOWED, WARNED, PAUSED, COMPLETED, CANCELLED; payment state COMPLETED, PAUSED, FAILED | `packages/contracts/src/index.ts` |
| agent | decision ALLOW, WARN, PAUSE; recommended action PROCEED, WARN_DISPLAYED, CAPTURE_PAUSED; severity info, low, medium, high | `packages/agent/src/types.ts` |
| mcp | order status AWAITING_APPROVAL; demo words ALLOW, WARN, PAUSE, CAPTURED; error codes GUARDIAN_PAUSED, REQUIRES_DECISION | `apps/mcp/demo-agent/shopper.ts:12,260`, `apps/mcp/src/apiClient.ts:58-59` |
| memory | decision ALLOW, WARN, PAUSE | `packages/memory/src/types/contracts-fallback.ts:13`, `packages/memory/src/types/historicalRecord.ts` |
| eval | predicted-fraud decisions WARN, PAUSE, BLOCK | `packages/eval/src/baselines/types.ts:25,60` |
| web | verdict ALLOW, WARN, **BLOCK**; investigation status QUEUED, RUNNING, COMPLETE, FAILED; evidence status PASS, WARN, FAIL; capture state PENDING, AUTHORIZED, CAPTURED, HELD, VOIDED | `apps/web/src/types.ts:5-9` |
| signals | none, by design (evidence only) | `packages/signals/README.md` |

Mismatch: the web app and the eval package use BLOCK, while contracts, agent and memory use PAUSE.
The web capture state VOIDED has no counterpart in contracts: not found.

## (c) Evidence shape, severity, source and type names

Shapes:

- agent: `id, type, severity, confidence, summary, source, deterministic, hardFail?, data?`
  (`packages/agent/src/types.ts`, `EvidenceSchema`).
- signals: `id, type, severity, confidence, summary, source, hardFail, artifactUrl?, metadata?`
  (`packages/signals/src/types.ts`). It has no `deterministic` and no `data`.
- memory: no Evidence type. It stores `flaggedEvidenceTypes: string[]`
  (`packages/memory/src/types/historicalRecord.ts`).
- eval: no Evidence type. It produces `findings: string[]`
  (`packages/eval/src/baselines/signalsStandIn.ts`).
- web: `id, node, title, status, badge, confidence, fields[]` with `node` in SURFACE, MERCHANT,
  PRICE, PAYEE and `status` in PASS, WARN, FAIL (`apps/web/src/types.ts:5-14`).
- contracts: `OrderDecisionResponse.evidence` is `Record<string, unknown>`
  (`packages/contracts/src/index.ts`). An `Evidence` type: not found.

Severity values: agent `info, low, medium, high` (`packages/agent/src/types.ts`); signals
`INFO, LOW, MEDIUM, HIGH, CRITICAL` (`packages/signals/src/types.ts`); web uses its own PASS,
WARN, FAIL.

Source values: agent `rdap, tls, kernel, channel3, registry, paypal, elastic, llm, rule`
(`packages/agent/src/types.ts`); signals uses free-form strings such as `rdap`, `tls`,
`payee-binding`, `kernel-browser`, `channel3-products`, `mock-fixture`
(`packages/signals/src/**`). `payee-binding`, `kernel-browser`, `channel3-products` and
`mock-fixture` are not in the agent's list.

Evidence type names:

- agent emits: `DOMAIN_AGE, PAYEE_BINDING, PAYEE_UNKNOWN, PAYEE_FREE_EMAIL, PRICE_DEVIATION,
  PRICE_UNKNOWN, OFFER_COMPARISON, LOOKALIKE_DOMAIN, TLS_INVALID, REGISTRY_RECORD,
  IDENTITY_MATCH, IDENTITY_UNVERIFIABLE, CLAIMED_BRAND_MISMATCH, PAGE_SECTION_CLAIMS,
  SCAM_MEMORY_MATCH, INJECTION_ATTEMPT, INVESTIGATION_NOTE, TOOL_UNAVAILABLE, AGENT_ERROR`
  (search of `packages/agent/src`).
- signals emits: `DOMAIN_AGE, DOMAIN_AGE_UNKNOWN, CERT_STATUS, PAYEE_BINDING_OK,
  PAYEE_BINDING_MISSING, PAYEE_BINDING_MISMATCH, PAYEE_BINDING_SKIPPED,
  PAYEE_EMAIL_DOMAIN_DIFFERS, COLLECTOR_ERROR, NOT_IMPLEMENTED, MOCK_NO_FIXTURE`
  (`packages/signals/README.md`). Only `DOMAIN_AGE` is shared with the agent. `CERT_STATUS`
  versus `TLS_INVALID` and `PAYEE_BINDING_*` versus `PAYEE_BINDING` differ.
- memory, eval, web: no evidence type names. The web mock uses badge strings such as INGESTED,
  MATCHED and DECODED (`apps/web/src/api/mock.ts:31-34`).

## (d) SignalsPort versus packages/signals

`SignalsPort` has six methods (`packages/agent/src/ports.ts`). `packages/signals` exports
`gatherAllSignals` and individual collectors (`packages/signals/src/index.ts`).

| SignalsPort method | Provided by packages/signals |
| --- | --- |
| `getPageClaims(url, opts)` | no. The Kernel collector is a stub that returns `NOT_IMPLEMENTED` (`packages/signals/src/browser/kernel.ts`) |
| `getDomainReport(domain, opts)` | partly. `RdapCollector` and `TlsCertificateCollector` exist, but take a `SignalRequest`, not a domain, and return signals-shaped evidence |
| `getPriceReport(input, opts)` | no. The Channel3 collector is a stub (`packages/signals/src/products/channel3.ts`) |
| `checkPayeeBinding(input, opts)` | partly. `PayeeBindingCollector` exists with different type names (see section c) |
| `fetchPageSection(input, opts)` | no, not found |
| `compareOffers(input, opts)` | no, not found |

No export of `packages/signals` is an object with these six methods: not found. The agent can
only use a fixture port or the HTTP adapter (`packages/agent/src/adapters/signalsAdapter.ts`).

## (e) Overlapping memory code

| Concern | `packages/agent` | `packages/memory` |
| --- | --- | --- |
| In-memory store | `InMemoryMemory` (`packages/agent/src/adapters/memoryElastic.ts:32`) | `InMemoryMemoryStore` (`packages/memory/src/store/inMemoryMemoryStore.ts`) |
| Elastic store | `createElasticMemory` (`packages/agent/src/adapters/memoryElastic.ts:159`) | `ElasticMemoryStore` (`packages/memory/src/store/elasticMemoryStore.ts:40`) |
| Index mapping | `packages/agent/src/memory/indexMappings.ts` | `ELASTIC_MEMORY_MAPPING` (`packages/memory/src/store/elasticMemoryStore.ts:19`) |
| Interface | `MemoryPort` with `search` and `write` (`packages/agent/src/ports.ts`) | `MemoryStore` (`packages/memory/src/store/memoryStore.interface.ts:34`) |
| Record shape | `MemoryDocument` with a pattern sentence and buckets | `HistoricalRecord` with domain, payee email and ids (`packages/memory/src/types/historicalRecord.ts`) |
| Seeds | `packages/agent/src/memory/seeds.ts` | not found |
| Sanitizer | not found | `packages/memory/src/sanitizer.ts` |
| Elastic env vars | `ELASTIC_URL, ELASTIC_API_KEY, ELASTIC_INDEX, ELASTIC_INFERENCE_ID` (`packages/agent/src/config.ts`) | `ELASTIC_URL, ELASTIC_NODE, ELASTIC_API_KEY, ELASTIC_INDEX` (`packages/memory/src/store/factory.ts`) |

Default index names are not compared here. `packages/memory` stores payee emails
(`historicalRecord.ts`), while `MemoryDocument` stores only a payee merchant id.
`packages/eval` uses `packages/memory`, not the agent (`packages/eval/src/baselines/signalsStandIn.ts`).

## (f) Environment variables read (names only)

- apps/api: `NODE_ENV, HOST, PORT, CORS_ORIGIN, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, DATABASE_URL,
  DATABASE_SSL, DATABASE_TIMEOUT_MS, DATABASE_MAX_CONNECTIONS, PAYPAL_MODE, PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET, PAYPAL_TIMEOUT_MS` (`apps/api/src/config/env.ts`).
- apps/mcp: `MCP_TRANSPORT, MCP_PORT, MCP_BEARER_TOKEN, GUARDIAN_API_URL, GUARDIAN_API_KEY,
  GUARDIAN_REQUEST_TIMEOUT_MS, GUARDIAN_FINALIZE_TIMEOUT_MS` (`apps/mcp/src/config.ts`); also
  `CHANNEL3_API_KEY, CHANNEL3_BASE_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_FAST,
  LLM_MODEL_STRONG, GUARDIAN_MCP_COMMAND` (search of `apps/mcp`).
- packages/agent (`packages/agent/src/config.ts`): `AGENT_TIMEOUT_MS, AGENT_MAX_FOLLOWUPS,
  AGENT_CONF_THRESHOLD, FEATURE_IDENTITY_LLM, FEATURE_INVESTIGATOR_LOOP, FEATURE_SCAM_MEMORY,
  MEMORY_MATCH_MIN, LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_FAST, LLM_MODEL_STRONG,
  LLM_MODE, LLM_FIXTURE_DIR, SIGNALS_MODE, SIGNALS_BASE_URL, SIGNALS_FIXTURE_DIR, ELASTIC_URL,
  ELASTIC_API_KEY, ELASTIC_INDEX, ELASTIC_INFERENCE_ID, GUARDIAN_API_URL, GUARDIAN_API_KEY`.
- packages/signals: none (`packages/signals/src`).
- packages/memory: `ELASTIC_URL, ELASTIC_NODE, ELASTIC_API_KEY, ELASTIC_INDEX`
  (`packages/memory/src/store/factory.ts`).
- packages/eval: none (`packages/eval/src`).
- apps/web: `VITE_API_URL, VITE_API_TARGET, VITE_USE_MOCK, VITE_PAYPAL_CLIENT_ID`
  (`apps/web/src/api/apiClient.ts`, `apps/web/src/hooks/usePaypalAuth.ts`, `apps/web/vite.config.ts`).

## (g) Smallest ordered set of changes for one fictional store end to end

The flow is: web or mcp request, api creates the PayPal order, api asks the agent for a verdict
using signals and memory, api enforces the decision, then captures or voids.

1. **contracts and every area**: settle one decision vocabulary (PAUSE versus BLOCK) and one
   Evidence shape. Owner: `packages/contracts`, reviewed by agent and api owners.
2. **signals**: provide an object with the six `SignalsPort` methods that the agent can call
   in-process, with evidence type names the agent scores. Owner: `packages/signals`.
3. **agent**: select the in-process signals port in its config instead of only the HTTP adapter.
   Owner: `packages/agent`.
4. **memory**: pick one memory layer (agent's `MemoryPort` or `packages/memory`), and make the
   other an adapter. Owner: `packages/memory` with `packages/agent`.
5. **api**: add a route that runs the agent for an order and stores the verdict, and the
   investigation, checkout and policy routes that `apps/mcp` calls. Owner: `apps/api`.
6. **api**: enforce the agent verdict before capture, and add the void path. Owner: `apps/api`.
7. **web**: point the client at the real routes and set `VITE_USE_MOCK=false`. Owner: `apps/web`.
8. **mcp**: confirm its calls match the routes from step 5. Owner: `apps/mcp`.
9. **infra**: fix the lockfile so a fresh `npm ci` can load `@elastic/elasticsearch`
   (`tslib` is missing from `package-lock.json`), and decide how the package tests run in CI.
   Owner: root config.
10. **tests**: add a smoke script that replays one fixture store through steps 5 to 7.
    Owner: `tests/`.
