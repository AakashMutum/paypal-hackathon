# End-to-end report

What the demo flow does today, measured by `npm run test:e2e` (`apps/api/test/e2e.demo.test.ts`).
The tests drive `createApp()` with supertest, with no PayPal credentials, no database and no
network. They use three fictional stores, named by the store ids the API knows:

| Store | Store id | Expected verdict |
| --- | --- | --- |
| Genuine | `pulseaudio` | ALLOW |
| Heavy discount | `mega-deals` | WARN |
| Impersonator (payee does not match the brand) | `luxaura-outlet` | PAUSE, shown as BLOCK |

Result on `main` at the time of writing: 28 tests, 19 pass, 0 fail, 9 `todo`. A `todo` test asserts
the correct behaviour and currently fails because of a defect below. It keeps CI green and keeps
the defect visible. When a defect is fixed, remove its `todo` option.

## Route results

| Route | Fixture | Result |
| --- | --- | --- |
| `POST /api/scan` | genuine, discount, impersonator | Pass: ALLOW, WARN, BLOCK, four evidence nodes |
| `POST /api/scan` | missing or non-string `url` | Pass: 400 |
| `POST /api/orders` | all three | Pass: returns `orderId`, `paypalOrderId`, `investigationId`; capture state PENDING |
| `POST /api/orders` | malformed body | **Defect E1**: no validation, returns 200 |
| `POST /api/orders/:orderId/approved` | genuine | Pass: CAPTURED |
| `POST /api/orders/:orderId/approved` | discount | Pass: HELD, never CAPTURED |
| `POST /api/orders/:orderId/approved` | impersonator | Pass: HELD, never CAPTURED |
| `POST /api/orders/:orderId/approved` | unknown id | Pass: 404 |
| `GET /api/investigations`, `GET /api/investigations/:id` | new order; unknown id | Pass: listed; 404 |
| `POST /api/orders/:id/cancel` | impersonator; unknown id | Pass: VOIDED; 404 |
| `POST /api/orders/:id/cancel` | captured order | **Defect E2**: a captured payment is marked VOIDED |
| `POST /api/orders/:id/review` | discount; unknown id | Pass: `reviewRequested`; 404 |
| `POST /api/demo/reset` | after creating an order | Pass: created investigations removed. It restores three built-in seed cases rather than emptying the store |
| `POST /api/reports`, `POST /api/merchants` | any | Pass: simulated answers |
| `POST /api/v1/investigations` | legacy `domain` field | Pass: 200 with a verdict |
| `POST /api/v1/investigations` | no merchant | Pass: 400 |
| `POST /api/v1/investigations` | MCP request shape (`merchantUrl`) | **Defect E6**: 400, the API requires `domain` |
| `POST /api/v1/checkout/orders` | MCP request shape | Pass: AWAITING_APPROVAL, but see E5 |
| `POST /api/v1/checkout/orders/:id/finalize` | unknown id | Pass: 404 |
| `POST /api/v1/checkout/orders/:id/finalize` | impersonator created with the MCP shape | **Defect E5**: ends CAPTURED |
| `PUT /api/v1/policies/:agentId` | valid policy | Pass: stored and echoed |
| `PUT /api/v1/policies/:agentId` | invalid policy | **Defect E7**: no validation |
| `POST /api/demo/reset`, `/cancel` | no credentials | **Defect E8**: open |
| Capture and void with PayPal credentials (fake fetch) | genuine | **Defect E9**: wrong ids and flow |

## Defects

Paths are relative to the repository root. None of these files was changed.

| Id | Where | What is wrong | Suggested fix | Owner |
| --- | --- | --- | --- | --- |
| E5 (serious) | `apps/api/src/controllers/agentBridge.controller.ts:70`, `:143` to `:195` | `createAgentCheckout` reads `merchant.domain`, but the MCP client sends `merchantUrl`, `merchantId`, `payeeEmail`, so every checkout is stored as `unknown.example` with no payee. `finalizeAgentCheckout` then investigates `unknown.example` without a payee and an impersonator store ends **CAPTURED** | Read the fields the MCP client sends, store the payee, pass it to the agent, and capture only after a real ALLOW | api |
| E9 | `apps/api/src/controllers/frontendApi.controller.ts:133` (capture), `:200` (void); `apps/api/src/controllers/agentBridge.controller.ts:189` | Orders are created with intent AUTHORIZE, but capture is sent to `/v2/checkout/orders/{id}/capture` and void is sent the **order** id. `authorizePayPalOrder` is never called outside its own file. PayPal's AUTHORIZE flow is: authorize the approved order, then capture or void using the **authorization id** from the response | After approval call `authorizePayPalOrder`, store the authorization id, then capture with `/v2/payments/authorizations/{id}/capture` or void it. Verify against PayPal's current docs | api |
| E10 | `apps/api/src/controllers/frontendApi.controller.ts:63`, `:123`, `:134`, `:201`; `apps/api/src/controllers/agentBridge.controller.ts:87`, `:190`; `apps/api/src/services/agent/agentRunner.service.ts:297` | Empty `catch` blocks that carry on as if the call worked. A failed capture still sets CAPTURED (`frontendApi.controller.ts:138`, `agentBridge.controller.ts:195`), a failed void still sets VOIDED (`:206`), a failed order create invents an order id, and an agent exception returns a canned verdict | Return an error, or record `CAPTURE_FAILED` / `VOID_FAILED`, instead of success | api |
| E3 | `apps/api/src/services/agent/agentRunner.service.ts:136` to `:166`, `:300` onward | The agent's verdict is used only for the decision, score and confidence. The four evidence cards, the reasons and the payee details are built from a canned profile (`KNOWN_PROFILES`, or a profile guessed from words in the domain), not from the agent's evidence | Build the cards and reasons from `verdict.evidence` and `verdict.explanation` | api, with web |
| E4 | `apps/api/src/services/agent/agentRunner.service.ts:146` to `:148` | An unknown domain is classified by keywords (`outlet`, `deal`, `luxaura`, and so on) and assigned the agent's scenario A, B or C | Run the agent on real signals for unknown domains; do not map keywords to a scenario | api |
| E6 | `apps/api/src/controllers/agentBridge.controller.ts:29` to `:30` | `POST /api/v1/investigations` requires `domain` and ignores `orderId`, `merchantUrl` and `agentId`, which `apps/mcp/src/apiClient.ts` sends. The MCP tool gets a 400 | Accept `merchantUrl` (and keep `domain` as an alias) | api |
| E1, E7 | `apps/api/src/controllers/frontendApi.controller.ts:33`; `apps/api/src/controllers/agentBridge.controller.ts:210` | No validation of order bodies or spend policies. Policies are stored but never checked when a checkout is created | Validate bodies; enforce `perOrderCap`, `dailyCap`, `firstPurchaseCap` | api |
| E2 | `apps/api/src/controllers/frontendApi.controller.ts:206` | `cancel` sets VOIDED even when the state is CAPTURED | Reject cancel with 409 once captured | api |
| E8 | `apps/api/src/app.ts:32` to `:33`; `apps/api/src/controllers/frontendApi.controller.ts:248` | No authentication anywhere. `/api/demo/reset` wipes demo data and `/cancel` voids any order for anyone who can reach the API | Protect with a shared secret or disable `reset` outside demo mode | api, infra |
| E11 | `apps/api/src/services/investigation/investigationStore.service.ts:5`; `apps/api/src/controllers/agentBridge.controller.ts:24` to `:25` | Investigations, checkouts and policies live in process memory. A restart or a second instance loses them. `reset()` restores seeds (`:275`) rather than emptying | Persist in Postgres through the existing migrations | api |
| E12 | `apps/api/src/services/agent/agentRunner.service.ts:84` to `:130`, `apps/api/src/controllers/agentBridge.controller.ts:233` | The built-in stores use `.com` and `.net` domains and the brand name "PulseAudio", which does not follow the fictional-brand and `.example` policy | Rename to invented brands on `.example` domains | api, web |
| E13 | `apps/api/src/services/agent/agentRunner.service.ts:226` | Outside the known scenarios the agent runs on `createLocalSignalsPort({ mode: 'mock' })`, which only replays the three fixture stores, so unknown domains produce almost no evidence and tend to look safe | Use live clients (`createLiveClientsFromEnv`) when keys exist, and treat "no evidence" as a reason to warn | api, signals |

## What is real and what is simulated today

Real:

- The Express API, its routes, status codes and the in-process store.
- The investigator agent code (`runInvestigatorAgentDetailed`) with its scoring, hard rules and
  explanation checks. It is called on every scan and order.
- The anonymous scam-pattern memory (`@checkout-guardian/memory`), in process.
- The decision gate: only an ALLOW reaches the capture step; WARN and PAUSE are held.
- Calls to the PayPal sandbox **when** `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set
  (order creation, and the capture and void requests, with the id problems in E9).

Simulated:

- The signals the agent sees for the three demo stores: they come from the agent's recorded
  scenarios A, B and C (`createFixtureSignals`, `createFixtureRegistry`), not from the network.
- Everything shown on the evidence cards: domain age, registry records, price benchmark and
  payee details are canned (E3).
- Unknown domains: classified by keywords (E4) or by the mock signals port (E13).
- Kernel and Channel3: no live client is wired into the API.
- Without PayPal credentials, every order id and capture result is generated locally.
- Merchant reports, merchant registration and spend-policy enforcement answer without doing
  anything (E7).
- The language model: the API passes no language-model client, so the agent uses its
  deterministic fallbacks.
- Persistence: none (E11).

The demo is therefore a faithful run of the agent's decision logic on recorded inputs. It is not
yet a live investigation of a real storefront, and capture and void are not yet correct against
PayPal's AUTHORIZE flow.
