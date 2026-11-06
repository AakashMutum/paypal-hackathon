# Benchmark roadmap: genuine merchants

**Status: none of this exists yet.** The only evaluation in this repository is
`docs/eval-results.md`: a small, synthetic, author-labelled benchmark of invented cases. It shows
the rules behave as designed on those cases. It says nothing about how TrustOra treats real
merchants, and in particular nothing about how often it would wrongly flag a genuine one. No
evaluation has been run against real sites.

This page describes what a representative, authorized benchmark of genuine merchants would
require. It is a plan, not a result.

## Principles

- **Consent first.** Only merchants who agree, in writing, to be part of the benchmark. No
  scraping, scanning or purchasing from a real store without that permission, and no use of a
  merchant's name in published results without it.
- **Real money and real checkout stay out.** The benchmark would read public pages and public
  registration data the way the product does. It would never place an order or enter payment
  details on a real store. Payee data would come from a merchant who volunteers a sandbox or test
  arrangement, not from live checkouts.
- **Independent labels.** Labels must not come from the people who built the rules.

## What it would require

1. **A sampling plan.** Decide which population the result should describe (for example small
   online merchants in one region and category), how many stores are enough to give usefully
   narrow confidence intervals for a false-positive rate, and how stores are chosen so the sample
   is not just the easy ones. Include new stores, stores with unusual setups (marketplaces,
   resellers, regional domains) and stores with a thin online presence, because those are where
   false positives are likely.
2. **Merchant consent records.** A signed agreement or equivalent for each merchant: what is
   collected, that it is limited to public information, how long it is kept, and how to withdraw.
   Store the records outside this repository.
3. **Labelling rules.** A written guide that says what makes a merchant "genuine" or "not
   genuine" and what evidence is needed to decide. At least two reviewers who did not write the
   detection rules label each case independently; disagreements are resolved by a third reviewer
   and recorded. Report the agreement rate.
4. **A frozen snapshot.** Capture the inputs once (page text, domain data, certificate data) so a
   result can be reproduced and a rule change cannot silently change the data. Store only what the
   consent covers; strip personal data.
5. **Both kinds of error.** Genuine merchants alone only measure false positives. A fair benchmark
   also needs examples of real fraud that were reported and confirmed by someone other than the
   authors, to measure what is missed, handled under the same care and without naming anyone
   unfairly.
6. **Separation from tuning.** Keep a held-out set that nobody looks at while changing rules or
   thresholds, and say so in the report.

## How results would be reported

- State the sample size, the population it describes, how stores were chosen, who labelled them
  and how often reviewers agreed.
- Give each rate with a confidence interval, not a single percentage, and say plainly when the
  interval is wide.
- Report the false-positive rate on genuine merchants and the miss rate on confirmed fraud
  separately, for WARN and PAUSE separately.
- Keep merchants anonymous unless each agreed to be named.
- List the limits: sampling bias, the date of the snapshot, signals that were unavailable.
- Never describe the result as "zero false positives" or as a guarantee; it describes one sample
  at one time.

## What is not claimed today

No document in this repository claims real-world accuracy, a measured false-positive rate on real
merchants, or zero false positives. The numbers in `docs/eval-results.md` are labelled synthetic
and author-labelled, and the evaluation was not run against real sites.
