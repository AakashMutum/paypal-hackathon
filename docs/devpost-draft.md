# Devpost draft

Draft text for the Devpost submission form. Every statement was checked against the code or the
docs in this repository. Anything in capitals starting with TEAM or TO BE ADDED is a placeholder
the team must fill or confirm. Do not paste placeholders into the form.

## Title

TrustOra

## Tagline (under 60 characters)

Verify who gets paid before PayPal captures a payment

## Inspiration

A checkout page can claim to be one merchant while the PayPal account that receives the money
belongs to someone else. A copycat store can borrow a brand's look, undercut its price and route
the payment to a personal account. A fraud score on the page alone does not catch that. AI
shopping agents make it worse: an agent that reads a page can be steered by text hidden in it.

TEAM TO CONFIRM: add a real story or source for the problem if you have one. This draft does
not cite statistics because none were gathered.

## What it does

TrustOra authorizes a PayPal order, investigates the merchant behind it, and only then captures
or voids the payment.

1. The API creates the order with intent `AUTHORIZE`, so the money is held, not taken.
2. An investigator agent collects evidence: domain age and certificate, whether the site
   publishes its payee, a lookalike check against known brands, price against comparable sellers,
   the registry record of the payee, how the claimed name compares with the registered name, and
   similar past scam patterns from memory.
3. The evidence is scored into ALLOW, WARN or PAUSE. A site that publishes a merchant id that
   differs from the payee, or that imitates a known brand while being paid to an unlinked account,
   is forced to PAUSE by a hard rule that a language model cannot override.
4. Only an ALLOW is captured. A WARN is held until a person acknowledges it. A PAUSE is never
   captured, and a held authorization can be voided.

There is a web app (storefronts, checkout, an investigation view, an analyst console with an
AG Grid table), and an MCP server with three tools (`investigate_merchant`, `safe_checkout`,
`set_spend_policy`) so an AI shopping agent can use the same guard, with spend caps per order,
per day and for a first purchase.

## How we built it

- **Payments:** an Express API in TypeScript calls PayPal OAuth, Orders v2 (create, authorize) and
  the authorization capture and void endpoints, each write with a `PayPal-Request-Id`. The API
  refuses to start unless `PAYPAL_MODE` is `sandbox`. Capture states and an audit trail are
  stored (PostgreSQL when `DATABASE_URL` is set, otherwise memory, with a warning).
- **Agent:** `packages/agent` is a rule-based investigator with weighted scoring, hard rules,
  identity matching and a check that explanations match the evidence. Page text is treated as
  untrusted data. An optional language model writes the plain-language explanation and helps with
  name comparison; every step has a deterministic fallback.
- **Signals and memory:** `packages/signals` collects domain, certificate, payee-binding, page and
  price evidence (live checks, or recorded ones for the demo stores). `packages/memory` keeps an
  anonymous store of past scam patterns, in process or in Elasticsearch.
- **Agent access:** `apps/mcp` exposes the guard to AI agents over stdio or streamable HTTP, and
  includes a scripted demo shopper that runs without any key.
- **Web:** React and Vite, with AG Grid Community for the analyst console.
- **Tests:** 43 end-to-end API tests drive the demo flow with a fake `fetch` standing in for PayPal
  (`npm run test:e2e`), plus integration and package tests.

## Challenges

TEAM TO CONFIRM: replace with the real challenges you faced. Challenges visible in the repository:

- Deciding what a language model may and may not do. Hard rules need deterministic evidence, so
  model output can raise suspicion but cannot force a PAUSE alone.
- Keeping a demo honest without live services. The default run simulates PayPal, and every
  simulated response says so.
- Making sure a PAUSE or a payee mismatch can never be captured, including through the agent
  routes.

## Accomplishments

- A complete authorize, investigate, then capture-or-void flow, with a rule that a payee mismatch
  is never captured.
- A guard that an AI shopping agent can call through MCP, with spend policies.
- A demo that runs locally with no accounts, and an end-to-end test suite for it.
- Honest labelling: modes, provenance and `simulated` flags show what is live and what is not.

## What we learned

TEAM TO COMPLETE: write this in the team's own words. This draft does not invent lessons.

## What's next

From the known limitations in the README:

- Run the PayPal sandbox flow, a live language model, Kernel, Channel3, Elasticsearch and the
  PostgreSQL store for real (all are written and tested with fakes only).
- Record language-model answers so the replay mode has recordings.
- Handle PayPal webhooks.
- Pass retrieved similar cases to the explanation writer (they are shown today but not used in it).
- Grow and independently label the evaluation benchmark.

## Built with

TypeScript, Node.js 22, Express, React, Vite, Tailwind CSS, AG Grid Community, PayPal Orders v2
and Payments v2 APIs (sandbox), PostgreSQL, Model Context Protocol SDK, zod, Elasticsearch
(optional), Kernel (optional), Channel3 (optional), an OpenAI-compatible language model provider
(optional), Render (deployment config only).

TEAM TO COMPLETE: add the model name and provider actually used once a key is set, and any
development tools you want to disclose.

## Try it out

- Hosted demo: TO BE ADDED after deployment
- Source code: TEAM TO ADD the public repository URL
- Demo video (YouTube): TO BE ADDED

## Testing instructions for judges

**Hosted demo:** TO BE ADDED after deployment.

**Sandbox buyer login:** TEAM TO ADD: PayPal sandbox buyer email and password for judges. The
login is only needed if the hosted demo is connected to the real PayPal sandbox. The default
local run needs no login.

**The three stores** (all fictional). Open `/stores`, pick a store, add the item and check out:

| Store | Expected decision | Expected outcome |
| --- | --- | --- |
| Harborline Outfitters (genuine) | ALLOW | Captured |
| Bargain Barn Outlet (heavy discount) | WARN | Held until you acknowledge the warning, then captured |
| Harborlyne Outfitters Sale (impersonator) | PAUSE | Never captured |

`/analyst` lists every investigation with its evidence.

**Run it locally with no accounts** (Node 22):

```bash
npm ci && npm run build
npm start                 # API on http://localhost:3000
npm run dev:web           # in a second terminal: http://localhost:5173
```

Copy `apps/web/.env.example` to `apps/web/.env` and set `VITE_API_URL=http://localhost:3000` to
use the API instead of the web app's built-in simulated backend. In a third terminal,
`npm run demo:agent -- --auto-human yes` runs a scripted AI shopper against the three stores.

**What is live and what is not:**

- Payments are simulated (`SIM-` ids, `simulated: true`) unless PayPal sandbox credentials are set.
  The sandbox calls have been tested with a fake `fetch` and not yet run live.
- The signals for the three stores are recorded, not fetched live.
- The language model is off by default, so the agent uses its deterministic logic. The README
  reports a live Gemini run by the team; no recordings are committed and it was not re-run for
  this draft.
- Data is kept in memory unless `DATABASE_URL` is set.
- The repository includes a small, synthetic, author-labelled benchmark (62 cases written and
  labelled by the team, see `docs/eval-results.md`). It shows the rules behave as designed on
  those cases. It is not a measure of real-world accuracy, says nothing about false positives on
  real merchants, and is not quoted as one. No benchmark on real merchants exists yet
  (`docs/benchmark-roadmap.md`).
