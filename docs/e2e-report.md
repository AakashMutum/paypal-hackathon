# End-to-end report

What the demo flow does, measured by `npm run test:e2e` (`apps/api/test/e2e.demo.test.ts`). The
tests drive `createApp()` with supertest, with no PayPal credentials, no database and no network.
The PayPal flow is tested against a fake `fetch`. They use the three fictional stores:

| Store | Store id | Expected decision |
| --- | --- | --- |
| Genuine | `harborline-outfitters` | ALLOW |
| Heavy discount | `bargainbarn-outlet` | WARN |
| Impersonator (payee does not match the brand) | `harborlyne-outfitters-sale` | PAUSE |

Result at the end of the build stack: 43 tests, 43 pass, 0 fail, 0 `todo`.

## Route results

| Route | Result |
| --- | --- |
| `POST /api/scan` | Pass for all three stores (ALLOW, WARN, PAUSE, four evidence cards each); bad bodies give 400 |
| `POST /api/orders` | Pass: simulated order, order token, pending investigation; malformed bodies give 400 |
| `POST /api/orders/:orderId/approved` | Pass: ALLOW captured; WARN and PAUSE held; a second approval does nothing; a wrong or missing token gives 403 |
| `POST /api/orders/:id/acknowledge` | Pass: captures a held WARN; refused (409) for PAUSE and payee mismatch |
| `GET /api/investigations`, `GET /api/investigations/:id` | Pass; the order token hash is never returned |
| `POST /api/orders/:id/cancel` | Pass: VOIDED; a captured payment gives 409 |
| `POST /api/orders/:id/review` | Pass |
| `POST /api/demo/reset` | Pass: needs `x-demo-token` when `DEMO_ADMIN_TOKEN` is set, refused in production when unset; empties the store |
| `POST /api/reports`, `POST /api/merchants` | Pass: validated; merchants are added to the registry |
| `POST /api/v1/investigations` | Pass with the MCP request shape (`merchantUrl`) and the older `domain`; bearer key enforced when `GUARDIAN_API_KEY` is set |
| `POST /api/v1/checkout/orders` and `.../finalize` | Pass: genuine captured, WARN waits for a human decision (proceed captures, abort voids), impersonator paused and its authorization voided, repeat calls do nothing |
| `PUT /api/v1/policies/:agentId` | Pass: validated, stored, and enforced (`POLICY_VIOLATION` for per-order, daily and first-purchase caps) |
| `GET /api/v1/demo/marketplace` | Pass: the canonical stores with the payee each checkout would pay |
| PayPal flow (fake fetch) | Pass: create with intent AUTHORIZE, authorize, capture or void the authorization id; `PayPal-Request-Id` on every call; failures end `FAILED` with a reason and no secret |
| `GET /health` | Pass: reports PayPal, store, signals, LLM and memory modes |

## Defects: status

The defects found in the first audit, and where they stand now.

| Id | Defect | Status |
| --- | --- | --- |
| E1 | No validation of order bodies | Fixed: zod schemas on every body |
| E2 | A captured payment could be voided | Fixed: 409 `ALREADY_CAPTURED` |
| E3 | Evidence cards and reasons were canned | Fixed: built from the agent's evidence |
| E4 | Unknown domains classified by keywords | Fixed: decided by evidence; without enough evidence a merchant is not cleared |
| E5 | An impersonator checkout through the agent route ended CAPTURED | Fixed: the route reads the MCP request, passes the payee, and a payee mismatch is never captured |
| E6 | `POST /api/v1/investigations` rejected the MCP request shape | Fixed |
| E7 | Spend policies unvalidated and not enforced | Fixed |
| E8 | No authentication on reset and cancel | Fixed: admin token, order tokens, optional bearer key |
| E9 | Capture and void used the order id; authorize never called | Fixed in code, tested with a fake `fetch` only |
| E10 | Empty `catch` blocks reported success | Fixed: failures become `FAILED` with a reason and a log line |
| E11 | Everything kept in memory | Fixed in code: migration 003 and a database store. Not run against a real database here |
| E12 | `.com` and `.net` demo domains and a brand-like name | Fixed: the three canonical `.example` stores everywhere |
| E13 | Unknown domains got almost no evidence | Fixed: `SIGNALS_MODE=auto` uses live signals for other domains |

## What remains

- **Not run against live services.** PayPal sandbox authorize, capture and void; Kernel; Channel3;
  a language model; Elasticsearch; and the migration against PostgreSQL. See "Known limitations"
  in the README.
- **Language-model recordings are not committed.** `LLM_MODE=replay` has none, so the agent uses
  its deterministic fallbacks until you record them (`npm run record:llm`, needs a key).
- **Similar cases are display only.** The agent's explanation writer does not accept extra context,
  so retrieved cases are shown next to the decision but are not passed to the explanation.
- **Demo stores are not written to memory.** A stored WARN or PAUSE would make the same demo
  store look "flagged before" and change its next score. Other domains are written.
- **The web app was built and type-checked but not exercised in a browser** in this stack.
- **PayPal webhooks** are not handled (`PAYPAL_WEBHOOK_ID` is only a placeholder).
- **Order tokens** live in the browser's session storage; there are no user accounts.
- **Rate limiting** is per client address, not per agent.
- **Identity pair ids** `P1` and `P2` in `packages/agent` are labels for the two name pairs the
  matcher compares, not people.

## What is real and what is simulated

Real:

- The Express API, validation, tokens, error envelope, spend policies and audit trail.
- The investigator agent (`runInvestigatorAgentDetailed`): scoring, hard rules, identity matching,
  explanation checks. It runs on every scan, order and agent route with the configured ports.
- The scam-pattern memory (in process, or Elasticsearch when configured) and the merchant
  registry (in process, or the `merchant_records` table).
- The decision gate: a payee mismatch and a PAUSE are never captured; a WARN waits for a person.
- PayPal sandbox calls when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set (see the caveat
  above: not run live).

Simulated:

- Payments, when no sandbox credentials are set: ids start with `SIM-` and every response says
  `simulated: true`.
- The signals for the three demo stores are recorded (`SIGNALS_MODE=replay` or `auto`), not
  fetched live. Other domains get live signals only in `live` or `auto` mode.
- The language model: off unless `LLM_MODE` is `live` (with a key); `replay` has no recordings yet.
- The web app's simulated backend, when `VITE_API_URL` is not set.
