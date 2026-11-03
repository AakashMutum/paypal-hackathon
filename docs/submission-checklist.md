# Submission checklist

Work through this before submitting to the PayPal AI Hackathon.

Status key: **Done** (verified in the repository), **Not done**, **Needs the team** (cannot be
verified from the code; someone must check or do it). Last reviewed 2026-11-03.

## Repository

| Item | Status | Note |
| --- | --- | --- |
| Repository is public | Needs the team | Check the repository settings |
| License (MIT) is visible in the repository's About section | Needs the team | `LICENSE` is in the repository; the About panel must show it on GitHub |
| `README.md` has setup steps (install, environment, run, test) | Done | Quick start, demo mode, database mode, variables, tests |
| `README.md` includes sandbox credentials or instructions to create them | Done | Variable names are listed and `docs/deploy.md` says where to get the sandbox client id and secret. Judges' test credentials, if offered, still need the team |
| No secrets in git history (the CI secret scan passes) | Needs the team | The scan runs in CI; confirm it is green on the final commit |

## Demo

| Item | Status | Note |
| --- | --- | --- |
| A hosted demo URL is live, or the README has clear run instructions | Not done | Run instructions are in the README. `render.yaml` and `docs/deploy.md` are ready; the README line reads "Hosted demo: TO BE ADDED after deployment" |
| All brands, stores and logos in the demo are fictional | Not done | `npm run check:brands` passes, but the built-in demo stores in `apps/api/src/services/agent/agentRunner.service.ts` and the web app use `.com` and `.net` domains and the name "PulseAudio", which should be replaced by invented names on `.example` domains |
| YouTube video is under 3 minutes | Needs the team | |
| Video shows no trademarks and uses no copyrighted music | Needs the team | Check every frame and the audio |
| Video shows the full flow: authorize, investigate, then capture or void | Needs the team | The flow works in the demo, but capture and void do not yet follow PayPal's authorization-id flow; do not claim a live capture in the video until that is fixed |

## README content

| Item | Status | Note |
| --- | --- | --- |
| A section maps the project to each of the five judging criteria | Not done | The README has a "Judging criteria" table marked TO BE CONFIRMED: the Devpost page could not be read, so no criteria were guessed |
| A "Tools used" section lists the AI tools used and how they were used | Needs the team | The README lists runtime components. The block "TEAM TO COMPLETE BEFORE SUBMISSION" asks for the development tools used |
| A note states what was built during the submission period | Needs the team | The README gives the first commit date (2026-10-31) and a "TEAM TO CONFIRM" marker |

## Final checks

| Item | Status | Note |
| --- | --- | --- |
| `npm run build`, `npm run lint`, `npm test` and `npm run test:contracts` pass | Done | Passed on `main` on 2026-11-03 (lint has warnings, no errors). Re-run on the final commit |
| `npm run test:sandbox` has been run manually against the PayPal sandbox | Not done | Needs sandbox credentials |
| Submission form fields match the README and video | Needs the team | |
