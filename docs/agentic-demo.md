# Agentic checkout demo

TrustOra gives an AI shopping agent three tools through an MCP server. The agent investigates a
merchant before paying, holds an order, and only finishes the payment when the guardian allows
it (or a person overrules a warning). A paused payment is never captured.

All stores in the demo are fictional. This document says what is real and what is simulated at
the end.

## What you need

- Node 22 and `npm ci` done once.
- No accounts and no keys for the default run.

## 1. Start the API

```bash
npm run build
npm start
```

The API listens on `http://localhost:3000`. Without PayPal credentials it runs in explicit
simulation (every response carries `simulated: true`); without `DATABASE_URL` it keeps data in
memory. Check `http://localhost:3000/health` for the modes.

Optional protection, both set as environment variables on the API: `GUARDIAN_API_KEY` makes the
agent routes require `Authorization: Bearer <key>`. If you set it, give the MCP server and the
demo agent the same value in `GUARDIAN_API_KEY`.

## 2. Run the demo shopper

In a second terminal:

```bash
npm run demo:agent -- --auto-human yes
```

- With no `LLM_API_KEY`, a scripted shopper runs. It needs no language model: it follows the same
  rules a model is prompted to follow.
- With `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL_STRONG` set, a live language model decides
  what to do instead (`--llm live`, chosen automatically).
- `--auto-human yes|no|ask` sets who answers the human questions. `ask` prompts you in the
  terminal. Other options are listed by `npm run demo:agent -- --help`.
- `--llm replay` runs the older offline scenario with recorded model actions and its own
  fictional fixture. It does not use the API.

The shopper starts the MCP server itself over stdio, sets a spend policy for the agent
(`demo-shopper`), and walks through the three canonical stores:

| Store | What the guardian finds | What the shopper does |
| --- | --- | --- |
| Harborline Outfitters (genuine) | ALLOW | holds an order, the human approves, the payment is captured |
| Bargain Barn Outlet (heavy discount) | WARN | holds an order, a human decides; proceed captures, decline aborts and voids |
| Harborlyne Outfitters Sale (impersonator, wrong payee) | PAUSE | stops and does not pay |

### Sample run

```text
Checkout Guardian demo: scripted shopper (no language model)
Goal: Buy one canvas weekender bag for under $100. Budget: 100 USD
Spend policy saved: up to 100 per order, 300 per day.

== Canvas weekender bag - Harborline Outfitters
   1. The agent checks the merchant with Guardian before doing anything else.
   2. Guardian says ALLOW (risk 0). The seller's identity, website age and price are consistent.
   3. The agent holds the order (CHK-82079A, AWAITING_APPROVAL). Nothing is captured yet.
   4. The human approved the payment.
   5. Result: CAPTURED (SIM-CAP-606E7135).

== Insulated trail jacket - Bargain Barn Outlet
   2. Guardian says WARN (risk 42). The seller's website is not linked to the account receiving the payment.; ...
   4. Guardian warned, so a human decides: proceed.
   5. Result: CAPTURED (SIM-CAP-2B952ECC).

== Canvas weekender bag - Harborline Outfitters
   seller Quickpay Holdings, 29 USD
   2. Guardian says PAUSE (risk 88). The site presents itself as a known brand, but the payee is not linked to that brand.; ...
   3. The agent stops. It does not pay this seller.
```

A JSON log of each run is written to `demo-runs/` (ignored by git).

## 3. Connect your own MCP client

The server name is `checkout-guardian`. It reads `GUARDIAN_API_URL` (default
`http://localhost:3000`) and `GUARDIAN_API_KEY`.

**stdio** (most clients start the process themselves):

```bash
npm run mcp:dev
```

Example client configuration:

```json
{
  "mcpServers": {
    "checkout-guardian": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/index.ts"],
      "cwd": "<path to this repository>",
      "env": { "GUARDIAN_API_URL": "http://localhost:3000" }
    }
  }
}
```

**HTTP** (streamable HTTP, bearer token required):

```bash
MCP_TRANSPORT=http MCP_PORT=3333 MCP_BEARER_TOKEN=<token> npm run mcp:dev
```

Connect to `http://localhost:3333/mcp` and send `Authorization: Bearer <token>`.

## The tools

| Tool | Purpose | Main inputs | Returns |
| --- | --- | --- | --- |
| `investigate_merchant` | Check a merchant before paying | `merchantUrl`, `claimedBrand`, `amount`, `currency`, `merchantId`, `payeeEmail`, `agentId` | The guardian decision (ALLOW, WARN or PAUSE), score, summary and evidence |
| `safe_checkout` | Hold an order, then finish it | `phase` (`create` or `finalize`), `merchantUrl`, `amount`, `currency`, `merchantId`, `payeeEmail`, `agentId`, `checkoutId`, `humanDecision` (`proceed` or `abort`) | A checkout status: `AWAITING_APPROVAL`, `CAPTURED`, `PAUSED`, `NEEDS_HUMAN_DECISION`, `ABORTED` or `FAILED` |
| `set_spend_policy` | Set per-order, daily and first-purchase caps for an agent | `agentId`, `perOrderCap`, `dailyCap`, `firstPurchaseCap`, `currency` | The saved policy |

The demo marketplace listing (`GET /api/v1/demo/marketplace`) returns the canonical stores with the
payee each checkout would pay.

### Error codes

The API answers in an error envelope. The MCP server turns these codes into plain messages.

| Code | When |
| --- | --- |
| `VALIDATION_ERROR` | The request body is not valid |
| `POLICY_VIOLATION` | The purchase is over the agent's per-order, daily or first-purchase cap (`details.cap` says which) |
| `ORDER_NOT_FOUND` | No checkout has that id |
| `UNAUTHORIZED` | The API requires `GUARDIAN_API_KEY` and the bearer token is missing or wrong |
| `PAYPAL_ERROR`, `UPSTREAM_ERROR` | The payment provider could not complete a step; nothing was captured (the MCP server shows a general message for `PAYPAL_ERROR`) |

A pause is not an error. A paused checkout is returned as a normal result with status `PAUSED`
(its authorization is voided), and a warning that needs a person is returned with status
`NEEDS_HUMAN_DECISION`. The MCP server knows the codes `GUARDIAN_PAUSED` and `REQUIRES_DECISION`
too, but the API does not send them.

## What is simulated

- Without PayPal sandbox credentials, orders, authorizations and captures are made up locally. The
  ids start with `SIM-` and responses carry `simulated: true`. See `docs/paypal-sandbox.md` to use
  the real sandbox.
- The signals the guardian sees for the three stores are recorded (`SIGNALS_MODE=replay`), not
  fetched from the live internet. Unknown domains need `SIGNALS_MODE=live` or `auto`.
- The scripted shopper is deterministic; it is not an AI model. A live model is used only when
  `LLM_API_KEY` is set, and this has not been run against a live model in this repository.
- The human is you (`--auto-human ask`) or a flag (`yes`, `no`).
