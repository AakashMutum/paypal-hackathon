# Test fixtures

Recorded inputs and expected outputs for the three fictional stores used across tests and the demo.
All brands and domains are invented; domains use the `.example` TLD.

| File | Store | Expected decision |
| --- | --- | --- |
| `genuine-store.json` | Harborline Outfitters | ALLOW |
| `discount-store.json` | Bargain Barn Outlet | WARN |
| `impersonator-store.json` | Lookalike of Harborline Outfitters | PAUSE |

Each file has `description`, `request`, `evidence` and `verdict`.

Field names come from `@TRUSTORA/contracts` as it exists today:
`request` follows `CreateOrderRequest`, and `verdict` follows `OrderDecisionResponse`
(with `evidence` omitted from the verdict, because it is supplied separately here).
Scores use the contract weights (domain 0.30, merchant consistency 0.40, pricing 0.20, ssl 0.10)
and decision thresholds (ALLOW up to 39, WARN 40 to 74, PAUSE from 75).

## TODO: contract mismatches

- TODO: the contract has no `InvestigationRequest` type. `request` uses `CreateOrderRequest`.
  Decide whether investigation gets its own request type.
- TODO: the contract has no `Evidence` type. `OrderDecisionResponse.evidence` is
  `Record<string, unknown>`, so the `evidence` array here (`id`, `kind`, `source`, `observation`,
  `severity`) is a proposed shape, not a contract shape.
- TODO: the contract has no `Verdict` type. `verdict` follows `OrderDecisionResponse`.
- TODO: other docs expect `flaggedEvidenceIds` (a list of evidence ids) where the contract has an
  `evidence` object. Fixtures do not include `flaggedEvidenceIds`.
- TODO: other docs expect a `summary` field where the contract has `reasons: string[]`.
  Fixtures use `reasons`.
- TODO: other docs may use a verdict value such as BLOCK or VOID; the contract only has
  ALLOW, WARN and PAUSE.
- TODO: `successResponse` wraps API results in `{ success, data, meta }`. Fixtures hold the inner
  `data` only.
