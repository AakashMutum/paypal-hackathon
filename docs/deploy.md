# Deploying TrustOra on Render

`render.yaml` at the repository root is a Render blueprint with three resources:

| Resource | Type | What it does |
| --- | --- | --- |
| `trustora-db` | Postgres | Holds the schema from `apps/api/src/database/migrations` |
| `trustora-api` | Web service (Node 22) | Builds the API, runs migrations, then starts it. Health check `/health` |
| `trustora-web` | Static site | Builds `apps/web`, publishes `apps/web/dist`, rewrites every path to `/index.html` |

The blueprint was written against Render's blueprint spec. Two fields (`fromDatabase` and the
static `routes` rewrite) use a nesting the spec page did not show in full; the dashboard preview
shows an error before anything is created if either is wrong.

No file in the repository holds a secret, a connection string or a database dump. Do not paste
any into chat, issues or commits.

## Create the blueprint

1. Push the branch you want to deploy to GitHub.
2. In the Render dashboard choose **New**, then **Blueprint**, and connect the repository.
3. Pick the branch. Render reads `render.yaml` and lists the three resources.
4. Render asks for the values of every variable marked `sync: false` (table below). You can
   leave `CORS_ORIGIN` and `VITE_API_URL` empty for now and set them after the first deploy.
5. Choose **Apply**. The first build takes several minutes.

## Environment variables to set in the dashboard

Names only. Values come from the places listed here.

| Variable | Service | Where to get it |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | API | PayPal developer dashboard, Apps and Credentials, the sandbox app |
| `PAYPAL_CLIENT_SECRET` | API | Same sandbox app. Keep it private |
| `CORS_ORIGIN` | API | The public URL of `trustora-web` (after the first deploy) |
| `DEMO_ADMIN_TOKEN` | API | A long random string you make up. Guards `POST /api/demo/reset` (refused in production when unset) |
| `GUARDIAN_API_KEY` | API | A long random string you make up. When set, agent routes need it as a bearer token |
| `AUDIT_ENCRYPTION_KEY` | API | A secret you generate locally: 64 hex characters (see [key-rotation.md](key-rotation.md)). Encrypts the stored investigation and payment-event JSON. Without it nothing is encrypted and `/health` says `auditEncryption: "disabled"` |
| `AUDIT_HMAC_KEY` | API | A secret you generate locally. Keeps the payee-email fingerprint stable across encryption-key changes. Set it to the current encryption key value before the first rotation |
| `AUDIT_ENCRYPTION_KEY_PREVIOUS` | API | Only while rotating: the old encryption key (see [key-rotation.md](key-rotation.md)) |
| `STORE_GENUINE_PAYEE_EMAIL`, `STORE_GENUINE_PAYEE_MERCHANT_ID` | API | A PayPal sandbox business account (see `docs/paypal-sandbox.md`) |
| `STORE_DISCOUNT_PAYEE_EMAIL`, `STORE_DISCOUNT_PAYEE_MERCHANT_ID` | API | A second sandbox business account |
| `STORE_IMPERSONATOR_PAYEE_EMAIL`, `STORE_IMPERSONATOR_PAYEE_MERCHANT_ID` | API | A third sandbox business account |
| `LLM_PROVIDER`, `LLM_API_KEY` (or `GEMINI_API_KEY`), `LLM_BASE_URL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG` | API | Your language-model provider. Only needed for `LLM_MODE=live`; also change `LLM_MODE` in the dashboard |
| `KERNEL_API_KEY`, `CHANNEL3_API_KEY`, `CHANNEL3_BASE_URL` | API | Kernel and Channel3 dashboards. Channel3 base URL is optional for a compatible endpoint |
| `CORPORATE_REGISTRY_URL`, `CORPORATE_REGISTRY_API_KEY`, `CORPORATE_REGISTRY_TIMEOUT_MS` | API | Optional corporate-registry provider. The local `merchant_records` table is used when absent |
| `VALIDATE_SECTION_PAGES` | API | Optional, default `true`. Set `false` to skip the contact, privacy and terms page checks |
| `ELASTIC_URL`, `ELASTIC_API_KEY` | API | Your Elasticsearch deployment. Without them the memory runs in the API |
| `VITE_API_URL` | Web | The public URL of `trustora-api` (after the first deploy) |
| `VITE_PAYPAL_CLIENT_ID` | Web | The sandbox client id again (public). Leave empty to use the simulated button |

Set automatically by the blueprint: `DATABASE_URL` (from the database), `NODE_ENV=production`,
`PAYPAL_MODE=sandbox`, `SIGNALS_MODE=auto` (recorded signals for the demo stores, live for any other
domain), `LLM_MODE=replay`, `AGENT_MODEL_BUDGET_MS=1200`, `MEMORY_MODE=memory`, `VITE_USE_MOCK=false`,
`VALIDATE_SECTION_PAGES=true`, `NODE_VERSION=22`. Render provides `PORT`; the API reads it.

**Scam memory is not persistent on a free Render instance.** The default file-backed memory
(`MEMORY_MODE=file`, `MEMORY_FILE`) writes to the instance's disk, which a free instance does not
keep across restarts, sleeps and deploys (per Render's documentation; confirm on the plans page), and `/health` would still say `memoryPersistent: true` for a
file. The blueprint therefore sets `MEMORY_MODE=memory` (kept in the process, reported as not
persistent). For memory that survives restarts, mount a persistent disk (not part of the free plan),
set `MEMORY_MODE=file` and point `MEMORY_FILE` at the disk, or set `ELASTIC_URL` and `ELASTIC_API_KEY`.

Everything the API and web app read, and where:

| Variable | Read in |
| --- | --- |
| `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | `apps/api/src/config/env.ts` |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_TIMEOUT_MS`, `DATABASE_MAX_CONNECTIONS` | `apps/api/src/config/env.ts` |
| `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_TIMEOUT_MS` | `apps/api/src/config/env.ts` |
| `AGENT_*` (including `AGENT_MODEL_BUDGET_MS`), `FEATURE_*` (including `FEATURE_PROMO_LANGUAGE`), `LLM_*`, `SIGNALS_*`, `ELASTIC_*`, `MEMORY_MATCH_MIN` | `packages/agent/src/config.ts`, read when the agent runs; all optional |
| `AUDIT_ENCRYPTION_KEY`, `AUDIT_ENCRYPTION_KEY_PREVIOUS`, `AUDIT_HMAC_KEY` | `apps/api/src/services/persistence/auditPrivacy.ts` |
| `MEMORY_MODE`, `MEMORY_FILE`, `GEMINI_API_KEY`, `EMBEDDING_API_KEY`, `GEMINI_EMBEDDING_MODEL` | `apps/api/src/services/agent/agentPorts.ts` and `packages/memory/src/patterns` |
| `WARMUP` | `apps/api/src/services/warmup.service.ts` (off with `WARMUP=off`; optional) |
| `KERNEL_API_KEY`, `CHANNEL3_API_KEY`, `CHANNEL3_BASE_URL` | `packages/signals/src/agentPort/liveClients.ts` (`createLiveClientsFromEnv`); the live clients are chosen in `apps/api/src/services/agent/agentPorts.ts` |
| `CORPORATE_REGISTRY_URL`, `CORPORATE_REGISTRY_API_KEY`, `CORPORATE_REGISTRY_TIMEOUT_MS` | `apps/api/src/services/registry/corporateRegistry.ts` |
| `DEMO_ADMIN_TOKEN`, `GUARDIAN_API_KEY` | `apps/api/src/config/env.ts` |
| `SIGNALS_MODE`, `LLM_MODE`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`, `LLM_FIXTURE_DIR`, `KERNEL_API_KEY`, `CHANNEL3_API_KEY`, `ELASTIC_URL`, `ELASTIC_API_KEY`, `ELASTIC_INDEX` | `apps/api/src/services/agent/agentPorts.ts` |
| `STORE_GENUINE_PAYEE_EMAIL`, `STORE_GENUINE_PAYEE_MERCHANT_ID`, and the same for `DISCOUNT` and `IMPERSONATOR` | `apps/api/src/config/storeCatalog.ts` |
| `VITE_API_URL`, `VITE_USE_MOCK` | `apps/web/src/api/apiClient.ts` |
| `VITE_PAYPAL_CLIENT_ID` | `apps/web/src/hooks/usePaypalAuth.ts` |
| `VITE_API_TARGET` | `apps/web/vite.config.ts` (local dev proxy only) |

`KERNEL_API_KEY` and `CHANNEL3_API_KEY` are read by `createLiveClientsFromEnv` in
`packages/signals`, which the API uses when `SIGNALS_MODE` is `live` or `auto`. When they are
set, live signals are collected; when they are absent, the runtime falls back to the recorded
signals.

## After the first deploy

1. Copy the public URL of `trustora-web` (for example `https://trustora-web.onrender.com`) into
   `CORS_ORIGIN` on the API service. No trailing slash.
2. Copy the public URL of `trustora-api` into `VITE_API_URL` on the web service. No trailing
   slash.
3. Redeploy the web service: `VITE_*` values are baked in at build time, so a change needs a new
   build. The API restarts by itself when its variables change.

## Smoke test

```bash
BASE_URL=https://your-api.onrender.com REQUIRE_DB=true npm run smoke:deploy
BASE_URL=https://your-api.onrender.com npm run smoke:deploy -- --flow
```

- It calls `GET /health` and prints the result and the modes (PayPal, store, signals, LLM, memory, audit
  encryption). It fails if `/health` does not report those modes. With `REQUIRE_DB=true` it fails
  unless `database.status` is `healthy`. Without it, it only warns that the API may be running in memory.
- With `REQUIRE_AUDIT_ENCRYPTION=true` it fails unless `/health` reports `auditEncryption: "enabled"`.
- For an `https` URL it also prints the TLS protocol that was negotiated and the certificate expiry
  date. This is a report only; it asserts no version.
- With `--flow` it also posts one fictional store to `POST /api/scan` and checks for a verdict of
  ALLOW, WARN or PAUSE.
- A sleeping free service can take about a minute to answer the first request; the script waits
  up to 70 seconds (`TIMEOUT_MS` changes that).

## Logs, rollback

- Logs: open the service in the dashboard and choose **Logs**. The start command prints the
  migration result before the server line.
- Roll back: open the service, choose **Events** (or **Deploys**), and redeploy an earlier
  successful deploy. A rollback does not undo database migrations.

## Free-tier limits

Checked against Render's free plan page on 2026-11-03; confirm before relying on them.

- Free web services spin down after 15 minutes without traffic and take about a minute to wake.
  Each workspace has 750 free instance hours per month.
- A free Postgres database expires 30 days after creation, has 14 days of grace to upgrade, then
  is deleted. It holds 1 GB, and a workspace can have one active free database. If the demo must
  run past 30 days, upgrade the plan or create a new database.
- Static sites are free but count against included bandwidth and pipeline minutes.

Wake the API a minute before a live demo, and run the smoke test to confirm it is up. The first request
after a sleep is cold; see [latency.md](latency.md) for what that means for a visitor.

## Not measured

No hosted instance exists yet, so none of this has been measured: uptime, the TLS version a visitor
gets (Render terminates TLS; run the smoke test against the real URL and read its TLS line), response
time on the hosted instance, or how long a sleeping instance takes to wake. Do not quote a number for
any of them until it has been measured.

## Demo mode: run everything locally with no accounts

You need Node 22 and nothing else.

```bash
npm ci
# Terminal 1: the API with no database and no PayPal credentials
npm run build
npm start

# Terminal 2: the web app. Without VITE_API_URL it uses its built-in simulated backend.
npm run dev:web        # http://localhost:5173
```

- The web app calls the API only when `VITE_API_URL` is set and `VITE_USE_MOCK` is not `true`.
  Otherwise it uses its simulated backend and does not need the API at all; a badge in the header
  says "Simulated backend" or "Live API".
- To exercise the API, set `VITE_API_URL=http://localhost:3000` in `apps/web/.env`. Without
  PayPal credentials the API simulates payments (every response says `simulated: true`); without
  `DATABASE_URL` it keeps data in memory and `/health` reports `store: memory`.
- `npm run demo:agent -- --auto-human yes` runs a shopping agent against the API with no keys. See
  [docs/agentic-demo.md](agentic-demo.md).

**Access control:** `POST /api/demo/reset` needs the `x-demo-token` header to match
`DEMO_ADMIN_TOKEN` (in production it is refused when the variable is unset). Approving, cancelling,
reviewing and acknowledging an order need the order token returned when it was created. Agent
routes need `Authorization: Bearer <GUARDIAN_API_KEY>` when that variable is set.

## Known issues

See [docs/e2e-report.md](e2e-report.md) for the defects that remain. For a deployed demo:

- The PayPal capture and void path, Kernel, Channel3, the optional corporate registry and
  Elasticsearch have not been run live from this repository, and nothing is deployed. The README
  reports that sandbox OAuth and order creation and a live Gemini model were exercised by the team;
  that was not re-run for this pass. See the "Known limitations" section of the README.
- `LLM_MODE=replay` has no committed recordings yet, so the agent uses its deterministic
  fallbacks until you record some (`packages/agent/fixtures/llm/README.md`).
- `/api/demo/reset` needs `DEMO_ADMIN_TOKEN` in production.
