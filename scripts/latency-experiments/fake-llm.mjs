// A local stand-in for an OpenAI-compatible provider that answers slowly. Not a real model.
//   DELAY=700 node scripts/latency-experiments/fake-llm.mjs
// Then start the API with LLM_MODE=live LLM_API_KEY=local-fake-key LLM_BASE_URL=http://127.0.0.1:3199/v1
// and compare AGENT_MODEL_BUDGET_MS=0 with the default. The key above is a placeholder, not a secret.
import { createServer } from 'node:http';

const delay = Number(process.env.DELAY ?? 700);
const port = Number(process.env.FAKE_PORT ?? 3199);
let calls = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    calls += 1;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // An answer that parses but fits no schema, so every step falls back after its repair try.
      res.end(JSON.stringify({ choices: [{ message: { content: '{"note":"fake"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }, delay);
  });
}).listen(port, '127.0.0.1', () => console.log(`fake llm on ${port}, delay ${delay} ms`));
setInterval(() => console.log(`calls so far: ${calls}`), 60000).unref();
