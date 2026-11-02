# @checkout-guardian/signals

Collects evidence about a merchant and a checkout. It reports what it observed and how
severe that is. It does not make payment decisions: it never outputs ALLOW, WARN, BLOCK or any
other verdict, and it never calls PayPal. Everything fetched from a merchant website is treated
as untrusted data.

## Run

From the repository root:

```
npm run build -w @checkout-guardian/signals
npm test -w @checkout-guardian/signals
npm run typecheck -w @checkout-guardian/signals
```

```ts
import { gatherAllSignals } from '@checkout-guardian/signals';

const evidence = await gatherAllSignals(
  { orderId: 'order-1', merchantUrl: 'https://shop.example/checkout', payee: { merchantId: 'M-1' } },
  { useMocks: true }, // offline: replays tests/fixtures/*.json
);
```

`gatherAllSignals` never throws. A collector that fails becomes a `COLLECTOR_ERROR` evidence
item (severity LOW, not a hard fail).

Options: `timeoutMs`, `useMocks`, `fetchImpl` (inject fetch, used by tests) and `lookupImpl`
(inject DNS lookup, used by tests).

## Evidence types

| Type | Severity | Hard fail | Source |
| --- | --- | --- | --- |
| `DOMAIN_AGE` | MEDIUM under 30 days, LOW under 90 days, else INFO | no | RDAP |
| `DOMAIN_AGE_UNKNOWN` | LOW | no | RDAP |
| `CERT_STATUS` | INFO, LOW (expires within 14 days), MEDIUM (not trusted), HIGH (expired) | no | TLS |
| `PAYEE_BINDING_OK` | INFO | no | binding file |
| `PAYEE_BINDING_MISSING` | MEDIUM | no | binding file |
| `PAYEE_BINDING_MISMATCH` | CRITICAL | yes | binding file |
| `PAYEE_BINDING_SKIPPED` | INFO | no | binding file |
| `PAYEE_EMAIL_DOMAIN_DIFFERS` | LOW | no | binding file |
| `COLLECTOR_ERROR` | LOW | no | any collector |
| `NOT_IMPLEMENTED` | INFO | no | stub collectors |
| `MOCK_NO_FIXTURE` | INFO | no | mock collector |

The payee binding file is fetched from `https://<domain>/.well-known/checkout-guardian.json`
(see `BINDING_PATH`) and must look like `{ "merchant_id": "..." }`. The payee email differing from
the website domain is only a weak LOW signal, because small shops often use webmail addresses.

All collectors that touch the network call `assertSafeUrl` first. It allows only http(s) URLs
without credentials, rejects localhost, private, loopback and link-local addresses (10/8,
172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), and checks every address the host
resolves to. Redirects are not followed when fetching the binding file.

## Types are provisional

`src/types.ts` defines `Evidence`, `SignalRequest` and the collector interface locally. Move
them to `@checkout-guardian/contracts` once the team agrees on the shared shape.

## Mock fixtures

`FixtureMockCollector` replays the evidence in `tests/fixtures/*.json` at the repository root,
matched by the host of `request.storefrontUrl`. The fixture shape differs from this package's
`Evidence`, so it is mapped defensively:

- Fixture items have `kind`, `observation` and lowercase `severity`. They map to `type`
  (`domain` to `DOMAIN_AGE`, `ssl` to `CERT_STATUS`, `merchant_identity` to `MERCHANT_IDENTITY`,
  `pricing` to `PRICE_ANOMALY`, anything else upper-cased), `summary` and upper-case `severity`.
- Fixtures have no `confidence` or `hardFail`. Mocks use confidence 0.8 and `hardFail: false`,
  so the impersonator fixture does not produce a hard fail.
- Fixtures have no `artifactUrl` or `metadata`.
- The fixture `verdict` is ignored on purpose, because this package never produces decisions.
- Fixture `source` is always `fixture`; mock evidence uses the source `mock-fixture`.

## Not implemented yet

- Kernel browser collector (`src/browser/kernel.ts`): returns `NOT_IMPLEMENTED`.
- Channel3 product price lookup (`src/products/channel3.ts`): returns `NOT_IMPLEMENTED`.
- Brand verification (does the page's brand match the claimed brand).
- Registrable-domain detection uses a simple heuristic, not a public suffix list.
- Recorded fixtures for RDAP, TLS and the binding file responses.

## Who does what next

- Kernel wrapper: load the checkout page in a remote browser, extract brand, total and payee as
  data, store a screenshot as `artifactUrl`.
- Channel3 lookup: compare order prices against catalogue prices and emit price evidence.
- Brand verification: compare the claimed brand with what the page and catalogue show.
- Binding polish: agree the final file name, publish the format for merchants, and add caching.

## Agent port

`createLocalSignalsPort(options)` returns an object with the six methods of the investigation
agent's `SignalsPort` (`packages/agent/src/ports.ts`), so the agent can use real signals in
process instead of the HTTP signals service.

```ts
import { createLocalSignalsPort } from '@checkout-guardian/signals';

const signals = createLocalSignalsPort({
  mode: 'live', // or 'mock' to replay tests/fixtures/*.json
  knownBrandDomains: ['brand-example.example'],
  // kernel: yourKernelClient,    // interface only: getPageClaims(url, opts)
  // channel3: yourChannel3Client // interface only: searchOffers(query, opts)
});
```

Options: `mode`, `fetchImpl`, `lookupImpl`, `kernel`, `channel3`, `knownBrandDomains`,
`claimedBrand`, `now`, `tlsProbe`, `fixturesDir`. No method throws on a failed lookup and none
returns a decision. A failed lookup becomes `TOOL_UNAVAILABLE` evidence (severity `info`,
`deterministic: false`) or an empty result. Page text is untrusted data: it is extracted and
capped, never followed.

### Agent port mapping

What the agent scores (from `packages/agent/src/scoring/pointsFor.ts`, `scoring/rules.ts` and
the recorded scenarios in `packages/agent/src/fixtures/scenario-*.ts`) and what this port emits.
Severities are lowercase (`info`, `low`, `medium`, `high`).

| Method | Agent evidence type | Source | Data fields the agent reads | Severity produced | Hard fail |
| --- | --- | --- | --- | --- | --- |
| `getDomainReport` | `DOMAIN_AGE` | `rdap` | `ageDays` | under 7 days high, under 30 medium, under 90 low, else info | no |
| `getDomainReport` | `TLS_INVALID` | `tls` | none read; port adds `expired`, `daysToExpiry`, `issuer`, `reason` | high if expired, medium if untrusted | no |
| `getDomainReport` | `LOOKALIKE_DOMAIN` | `rule` | `matchesKnownBrand`, `brandId` | high | no (the agent derives a hard rule from it) |
| `checkPayeeBinding` | `PAYEE_BINDING` | `kernel` | `status` (`MATCH`, `MISMATCH`, `NO_BINDING`, `UNKNOWN_MERCHANT`), `expectedMerchantId`, `actualMerchantId`, `linkedBrandIds` | match info, no binding medium, mismatch high | yes on `MISMATCH` |
| `getPriceReport` | `PRICE_DEVIATION` | `channel3` | `discountPct`, `price`, `medianPrice`, `offerCount` | 90 or more high, 70 or more medium, 40 or more low, else info | no |
| `getPriceReport` | `PRICE_UNKNOWN` | `channel3` | `reason` | info | no |
| any | `TOOL_UNAVAILABLE` | the failing tool's source | `tool`, `reason` | info | no |

Notes:

- Evidence is `deterministic: true` except `TOOL_UNAVAILABLE`. The agent ignores model-written
  evidence for hard rules, so only deterministic checks are marked deterministic.
- The agent's rules give a payee binding `MISMATCH` a floor of 75 and a `LOOKALIKE_DOMAIN` with
  `matchesKnownBrand` a floor of 75 when the payee is not linked to the brand. This package only
  reports the evidence; the agent decides.
- `PAYEE_BINDING` comes from the merchant's published binding file (`BINDING_PATH`). The agent's
  own recorded scenarios label that source `registry`; this port uses `kernel` because the data
  is fetched from the merchant's site.
- The lookalike check compares the merchant's registrable domain with `knownBrandDomains` (near
  miss, or the brand's name as a whole word in a different domain) and, when only a brand name is
  known, flags near misses of that name. A domain equal to a known brand domain never counts.
  The brand name comes from `claimedBrand` or from the last `getPageClaims` for that domain.
- `getPageClaims` uses the injected `kernel` client if present. Otherwise it makes a plain GET
  through `assertSafeUrl` with a size cap, the call's `timeoutMs`, the call's `AbortSignal`, and
  every redirect target re-checked. It returns title, site name, emails, phones, address text,
  linked domains, visible text and hidden text (`display:none`, `visibility:hidden`, `hidden`,
  `aria-hidden`, HTML comments).
- `fetchPageSection` tries the usual paths for each hint (about, contact, returns, terms,
  privacy, shipping) and returns `{ found: false }` when none loads.
- Without a `channel3` client, `getPriceReport` returns `PRICE_UNKNOWN` and `compareOffers`
  returns an empty `OfferSummary`. No keys are read and no request is made.
- Mock mode maps `tests/fixtures/*.json` kinds to agent types: `domain` to `DOMAIN_AGE` (age
  parsed from the sentence) and `LOOKALIKE_DOMAIN`, `ssl` to `TLS_INVALID` when high severity,
  `merchant_identity` to `PAYEE_BINDING` (low is `MATCH`, medium is `NO_BINDING`, high is
  `MISMATCH`), `pricing` to `PRICE_DEVIATION` (`discountPct` parsed from the sentence).
  The fixture verdict is never read.
- `src/agentPort/types.ts` holds local mirrors of the agent's types. A contract test loads
  `packages/agent/src/fixtures/scenario-*.ts` and checks the port uses only type names those
  scenarios use.
