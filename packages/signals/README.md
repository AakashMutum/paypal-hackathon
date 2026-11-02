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
