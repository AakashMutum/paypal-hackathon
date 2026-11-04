# Favicon reference integrity

TrustOra can compare a page's favicon with a trusted reference favicon for the brand the page
claims to be. This is a medium-severity signal worth at most 5 points in the technical bucket
(`packages/agent/src/scoring/pointsFor.ts`). It cannot reach PAUSE on its own and sets no hard
rule (`packages/agent/tests/baseline.favicon.test.ts`).

## The reference corpus

`packages/signals/data/favicon-references.json` is versioned (`"version": 1`). Each entry has:

| Field | Meaning |
| --- | --- |
| `brandDomain` | Registrable domain that owns the brand |
| `brandNames` | Names the brand goes by. The page's claimed brand must equal one (case and spacing ignored; no fuzzy match) |
| `hash` | `sha256:` plus 64 lowercase hex characters over the raw favicon bytes |
| `source` | Where the reference favicon came from |
| `provenance` | `suppliedBy` and `suppliedOn` (who supplied it and when) |
| `retrievedOn` | Date the favicon was retrieved (YYYY-MM-DD) |

`validateFaviconReferences` (`packages/signals/src/agentPort/favicon.ts`) drops any malformed
entry and reports why. A missing or unreadable file means no references.

**The shipped corpus is empty.** The three demo stores are invented and the repository has no
favicon asset for them, so there is nothing honest to put in it. The corpus is the extension
point: add an entry only for a favicon you are allowed to use and whose origin you can state.
Never copy a real brand's icon into this repository (`npm run check:brands` guards the demo
content, not this file).

To add an entry, hash the file locally and fill in the other fields:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log('sha256:'+c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" path/to/icon.png
```

## When a mismatch is emitted

`FAVICON_MISMATCH` is emitted only when all of these hold:

1. A valid reference exists for the claimed brand.
2. The page's favicon was fetched and hashed (under the same URL safety checks as page fetches,
   at most 64 KB, and only if it looks like an image).
3. The hash differs from the reference.
4. The page's own registrable domain is not the reference's `brandDomain`.

The favicon is fetched only when condition 1 holds and the page is not on the reference domain.
Every other outcome is `FAVICON_OBSERVED` with an explicit `integrity` value: `no_reference`,
`reference_domain`, `no_favicon`, `fetch_failed`, `too_large`, `invalid` or `match`. A favicon
served from a third-party CDN is compared on its hash like any other and is not a mismatch by
itself. The agent re-checks conditions 3 and 4 before it emits the mismatch.

## What is not verified

Nothing here has been run against a real site. The tests use a fake `fetch` and invented bytes.
A matching hash only shows the same file was served; a copycat can serve the genuine icon.
