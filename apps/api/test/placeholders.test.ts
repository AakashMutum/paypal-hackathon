import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholder, llmMode, memoryEnv } from '../src/services/agent/agentPorts.js';

test('isPlaceholder: empty, missing and "your_" values are placeholders', () => {
  for (const v of [undefined, '', '   ', 'your_llm_api_key', 'YOUR_ELASTIC_API_KEY', ' your_key ']) assert.equal(isPlaceholder(v), true, String(v));
});

test('isPlaceholder: the exact known strings are placeholders', () => {
  assert.equal(isPlaceholder('https://your-elastic-deployment.example'), true);
  assert.equal(isPlaceholder('changeme'), true);
});

test('isPlaceholder: a real-looking key or URL is not, and ".example" inside text does not count', () => {
  for (const v of ['AIzaSyD4-real-looking-key-0123456789', 'sk-live-abc123', 'https://my-cluster.es.example.org:9243', 'key-for-my.example-service']) assert.equal(isPlaceholder(v), false, v);
});

test('llmMode: a placeholder key means the model is off, a real key means live', () => {
  assert.equal(llmMode({ LLM_API_KEY: 'your_llm_api_key' }), 'none');
  assert.equal(llmMode({ LLM_API_KEY: '' }), 'none');
  assert.equal(llmMode({ LLM_API_KEY: 'AIzaSyD4-real-looking-key-0123456789' }), 'live');
  assert.equal(llmMode({}), 'none');
});

test('llmMode: the GEMINI_API_KEY alias still works, even beside a placeholder LLM_API_KEY', () => {
  assert.equal(llmMode({ GEMINI_API_KEY: 'AIzaSyD4-real-looking-key-0123456789' }), 'live');
  assert.equal(llmMode({ LLM_API_KEY: 'your_llm_api_key', GEMINI_API_KEY: 'AIzaSyD4-real-looking-key-0123456789' }), 'live');
  assert.equal(llmMode({ GEMINI_API_KEY: 'your_gemini_key' }), 'none');
});

test('llmMode: LLM_MODE=live with a placeholder key falls back to none', () => {
  const quiet = console.error;
  console.error = () => undefined;
  try { assert.equal(llmMode({ LLM_MODE: 'live', LLM_API_KEY: 'your_llm_api_key' }), 'none'); } finally { console.error = quiet; }
});

test('memoryEnv removes placeholder Elastic settings from a copy and leaves everything else', () => {
  const source: NodeJS.ProcessEnv = { ELASTIC_URL: 'https://your-elastic-deployment.example', ELASTIC_API_KEY: 'your_elastic_api_key', MEMORY_MODE: 'file' };
  const out = memoryEnv(source);
  assert.equal(out.ELASTIC_URL, undefined);
  assert.equal(out.ELASTIC_API_KEY, undefined);
  assert.equal(out.MEMORY_MODE, 'file');
  assert.equal(source.ELASTIC_URL, 'https://your-elastic-deployment.example', 'the original environment is not changed');
});

test('memoryEnv keeps real Elastic settings', () => {
  const real = { ELASTIC_URL: 'https://my-cluster.es.example.org:9243', ELASTIC_API_KEY: 'abc123realkey' };
  assert.deepEqual(memoryEnv(real), real);
});
