# Submission checklist

Work through this before submitting to the PayPal AI Hackathon.

Status key: **Done** (verified in the repository), **Not done**, **Needs the team** (cannot be
verified from the code; someone must check or do it). Last reviewed 2026-11-03 (after the payment core, agent pipeline, frontend and agentic demo changes).

## Repository

| Item | Status | Note |
| --- | --- | --- |
| Repository is public | Needs the team | Check the repository settings |
| License (MIT) is visible in the repository's About section | Needs the team | `LICENSE` is in the repository; the About panel must show it on GitHub |
| `README.md` has setup steps (install, environment, run, test) | Done | Quick start, demo mode, database mode, variables, tests |
| `README.md` includes sandbox credentials or instructions to create them | Done | Variable names are listed; `docs/paypal-sandbox.md` explains the developer app, the three business accounts and the buyer account, and `docs/deploy.md` says where each value goes. Judges' test credentials, if offered, still need the team |
| No secrets in git history (the CI secret scan passes) | Needs the team | The scan runs in CI; confirm it is green on the final commit |

## Demo

| Item | Status | Note |
| --- | --- | --- |
| A hosted demo URL is live, or the README has clear run instructions | Not done | Run instructions are in the README and `docs/agentic-demo.md`. `render.yaml`, `docs/deploy.md` and `npm run smoke:deploy` are ready; nothing has been deployed. The README line reads "Hosted demo: TO BE ADDED after deployment" |
| All brands, stores and logos in the demo are fictional | Done in the code | The API, the web app, the fixtures and the MCP demo use the three invented `.example` stores, and `npm run check:brands` passes. Check the video and any logo files by eye |
| YouTube video is under 3 minutes | Needs the team | |
| Video shows no trademarks and uses no copyrighted music | Needs the team | Check every frame and the audio |
| Video shows the full flow: authorize, investigate, then capture or void | Needs the team | The code follows authorize, then capture or void the authorization id, but it has only been run in simulation and against a fake `fetch`. Run it once against the PayPal sandbox before claiming a live capture in the video |

## README content

| Item | Status | Note |
| --- | --- | --- |
| A section maps the project to each of the five judging criteria | Not done | The README has a "Judging criteria" table marked TO BE CONFIRMED: the Devpost page could not be read, so no criteria were guessed |
| A "Tools used" section lists the AI tools used and how they were used | Needs the team | The README lists the runtime components (language model, Elasticsearch, Kernel, Channel3, MCP). The block "TEAM TO COMPLETE BEFORE SUBMISSION" still asks for the development tools used |
| A note states what was built during the submission period | Needs the team | The README gives the first commit date (2026-10-31) and a "TEAM TO CONFIRM" marker |

## Final checks

| Item | Status | Note |
| --- | --- | --- |
| `npm run build`, `npm run lint`, `npm test`, `npm run test:contracts`, `npm run test:e2e` and `npm run test:packages` pass | Done | Passed at the end of the build stack on 2026-11-03 (lint has warnings, no errors). Re-run on the final commit |
| `npm run test:sandbox` has been run manually against the PayPal sandbox | Not done | Needs sandbox credentials |
| Submission form fields match the README and video | Needs the team | |

## Added by the build stack

| Item | Status | Note |
| --- | --- | --- |
| Set `DEMO_ADMIN_TOKEN` and `GUARDIAN_API_KEY` on the hosted API | Needs the team | Names are in `render.yaml` with `sync: false` |
| Create three PayPal sandbox business accounts and set the `STORE_*` variables | Needs the team | See `docs/paypal-sandbox.md` |
| Record language-model answers (`npm run record:llm`) | Needs the team | Needs a model key; until then `LLM_MODE=replay` uses the deterministic fallbacks |
| Run the sandbox flow once (authorize, capture, void) and the smoke test on the deployed API | Not done | `npm run test:sandbox` and `npm run smoke:deploy` |
