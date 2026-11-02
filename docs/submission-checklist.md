# Submission checklist

Work through this before submitting to the PayPal AI Hackathon.

## Repository

- [ ] Repository is public.
- [ ] License (MIT) is visible in the repository's About section.
- [ ] `README.md` has setup steps (install, environment, run, test).
- [ ] `README.md` includes sandbox credentials or clear instructions to create them.
- [ ] No secrets in git history (the CI secret scan passes).

## Demo

- [ ] A hosted demo URL is live, or the README has clear run instructions.
- [ ] All brands, stores and logos in the demo are fictional (`npm run check:brands` passes).
- [ ] YouTube video is under 3 minutes.
- [ ] Video shows no trademarks and uses no copyrighted music.
- [ ] Video shows the full flow: authorize, investigate, then capture or void.

## README content

- [ ] A section maps the project to each of the five judging criteria.
- [ ] A "Tools used" section lists the AI tools used and how they were used.
- [ ] A note states what was built during the submission period.

## Final checks

- [ ] `npm run build`, `npm run lint`, `npm test` and `npm run test:contracts` pass on main.
- [ ] `npm run test:sandbox` has been run manually against the PayPal sandbox.
- [ ] Submission form fields match the README and video.
