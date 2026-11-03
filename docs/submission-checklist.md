# Submission checklist

The official submission requirements of the PayPal AI Hackathon ("Build what's next with PayPal
and AI"), one row each. Deadline: 13 Nov 2026, 1:30 am GMT+5:30 (from the Devpost page).

Status key: **Done** (verified in the repository), **Not done**, **Needs the team** (cannot be
verified from the code; someone must check or do it). Last reviewed 2026-11-03.

## Project requirements

| Requirement | Status | Note |
| --- | --- | --- |
| Meaningfully integrates a PayPal technology using the free sandbox | Done in code | OAuth, Orders v2 create and authorize, authorization capture and void (`apps/api/src/services/paypal`). Tested with a fake `fetch` only. Missing: one run against the real sandbox (`npm run test:sandbox`, needs credentials) |
| Meaningfully incorporates AI | Done in code | The investigator agent, an optional language model, MCP tools for AI agents, optional Elasticsearch memory. The language model has not been run live and no recordings are committed. Missing: a model key and `npm run record:llm` |
| Working prototype or proof of concept | Done | Runs locally in simulation with no accounts (`README.md`, "For judges"). Not a hosted build |
| Sufficient documentation for judges | Done | `README.md` and `docs/`. The placeholders in the README must be filled before submitting |
| Complies with the Official Rules | Needs the team | Read the rules and confirm eligibility and team members |
| Existing project: meaningful progress during the hackathon | Needs the team | The first commit is dated 2026-10-31. The contest start date is not in the repository. Confirm the dates and write down what existed before |

## Submission form

| Item | Status | Note |
| --- | --- | --- |
| 1. The project | Not done | Submit on Devpost |
| 2. Text description of features and functionality | Not done | Draft in `docs/devpost-draft.md`; the team must review and paste it |
| 3. Functional demo: a working build judges can run or use | Needs the team | Run instructions are in the README and `docs/agentic-demo.md`, so this is met as long as they work on a clean checkout. Missing: the hosted demo URL (`render.yaml`, `docs/deploy.md` and `npm run smoke:deploy` are ready; nothing is deployed; the README line reads "Hosted demo: TO BE ADDED after deployment") |
| Sandbox buyer login for judges (if the hosted demo uses real PayPal sandbox) | Not done | Marker in the README: "TEAM TO ADD: PayPal sandbox buyer email and password for judges". Needs three sandbox business accounts and one buyer (`docs/paypal-sandbox.md`) and the six `STORE_*` variables on the host |
| 4. Tools used (model or AI service) and how | Needs the team | Runtime tools are in the README ("AI tools and services used"). Missing: the development tools list ("TEAM TO COMPLETE" marker) and the model name and provider actually used, once a key is set |
| 5. Public, open source repository with all source, assets and instructions | Needs the team | The repository has the code, instructions and an MIT `LICENSE`. Check on GitHub that it is public |
| License visible at the top of the repository (About section) | Needs the team | Set the About section on GitHub: description, website (hosted URL), topics, and make sure the license shows |
| 6. Demo video under 3 minutes | Not done | Not recorded |
| Video shows the project working on the device it was built for | Not done | Record the real run, not slides |
| Video uploaded to YouTube and publicly visible | Not done | Missing: the YouTube link, then add it to the form and the README |
| Video has no third-party trademarks or copyrighted music or material | Needs the team | The demo uses invented brands (`npm run check:brands` passes). Check every frame, the browser tabs and the audio |
| Video shows the flow end to end: authorize, investigate, capture or void | Needs the team | Run it once against the PayPal sandbox before claiming a live capture in the video; until then say it is simulated |
| Devpost form fields (title, tagline, description, built with, links, images) | Not done | Text drafted in `docs/devpost-draft.md`; images and links missing |

## Things to set up before recording

| Item | Status | Note |
| --- | --- | --- |
| Deploy the API and web app on Render and set `CORS_ORIGIN` and `VITE_API_URL` | Not done | `docs/deploy.md` |
| Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `DEMO_ADMIN_TOKEN`, `GUARDIAN_API_KEY` and the `STORE_*` variables on the host | Needs the team | Names are in `render.yaml` with `sync: false` |
| Language-model key and recordings (`npm run record:llm`) | Not done | Until then the agent uses its deterministic fallbacks |
| Run `npm run test:sandbox` and `npm run smoke:deploy` against the deployed API | Not done | Needs credentials and a deployed API |
| Repository About description and topics | Needs the team | See the License row |

## Repository checks

| Item | Status | Note |
| --- | --- | --- |
| `README.md` has setup steps (install, environment, run, test) | Done | "For judges", "Quick start", the modes table, the variables and the tests |
| Sandbox instructions | Done | `docs/paypal-sandbox.md`; judges' test credentials still need the team |
| No secrets in git history (the CI secret scan passes) | Needs the team | The scan runs in CI; confirm it is green on the final commit |
| All brands, stores and logos in the demo are fictional | Done in the code | Three invented `.example` stores; `npm run check:brands` |
| `npm run build`, `lint`, `test:integration`, `test:e2e`, `test:packages`, `check:brands` and `check:hygiene` pass | Needs the team | Passed at the end of the build stack; re-run on the final commit. Lint has warnings, no errors |
