# Recorded language-model answers

`LLM_MODE=replay` reads answers from this folder instead of calling a model. Each file is named
by the hash of the request (tier, schema, system prompt and user message) and holds only the
model's JSON answer.

No recordings are committed yet: recording needs a model key. To record the three demo stores:

```bash
LLM_API_KEY=<your key> LLM_BASE_URL=<optional> npm run record:llm
```

Then read the new files before committing them. They must contain no key and no personal data.
If a request has no recording, replay reports a miss and the agent uses its deterministic
fallback for that step, so the decision is unchanged.
