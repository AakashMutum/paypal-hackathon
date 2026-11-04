# Promotional and pressure language

**Requirement (PRD, section 9, "AI and Risk Assessment Requirements"):** the hybrid architecture
combines deterministic verification rules with "LLM-powered semantic analysis (evaluating
promotional language, anomaly detection in product descriptions, and generating natural language
risk explanations)". The same section says: "LLM outputs are treated as probabilistic indicators
rather than definitive proof of fraud. The decision engine requires corroborating deterministic
evidence before triggering high-risk payment pauses." The TRD also lists "Contextual evaluation of
deceptive promotional text" for the LLM service.

## Which option

Before this change none of the model prompts (`packages/agent/src/llm/prompts.ts`) read the page
for promotional or pressure wording: the investigator picks follow-up checks, the identity prompt
compares names, the pattern prompt describes a scheme from evidence types, and the explanation
prompt writes from existing evidence. So the requirement was not covered, and one dedicated
evidence type was added instead of relabelling an existing output.

## What it does

`PROMOTIONAL_LANGUAGE` (`packages/agent/src/promo/promo.ts`, prompt `PROMO_SYSTEM`):

- Runs only on the ambiguous path, in parallel with the identity match and the pattern sentence,
  with a model configured, and when `FEATURE_PROMO_LANGUAGE` is not turned off (default on). The
  deterministic fast paths make no model call, and without a model there is no evidence.
- Sends the shield-cleaned visible text (at most 3000 characters) inside an `untrusted_data`
  block. The system prompt is static.
- The model may only return tactics from a fixed list: `false_urgency`, `scarcity_claim`,
  `guarantee_claim`, `pay_now_pressure`, `discount_claim`. The reply schema is strict, so extra
  keys, unknown tactics and free text are rejected. No model-written text reaches the evidence;
  the summary is built in code.
- The evidence has `source: "llm"`, `deterministic: false`, severity `low` (one tactic) or
  `medium` (two or more), and no scoring weight (`pointsFor` has no case for it). It cannot change
  the score, the decision or a hard rule, so it cannot reach PAUSE.
- No noisy duplicates: the call is skipped when `INJECTION_ATTEMPT` is already present (the page
  text is hostile and not worth classifying) or when the evidence is already present, and
  `discount_claim` is dropped when `PRICE_DEVIATION` already covers the price.

## Tests

`packages/agent/tests/promo.test.ts`, with a fake model and a scripted provider (no network):
evidence shape and severity, no change to score, decision, buckets or hard rules, discount
deduplication, a hostile page (the call is skipped), hostile model replies (extra keys, unknown
tactics, free text) rejected through the real JSON client, model errors, and no call without a
model, with the flag off or on the fast path.

## Not verified

No real model has been asked to do this. Whether a real model picks sensible tactics, and how
often it flags ordinary sales wording, has not been measured.
