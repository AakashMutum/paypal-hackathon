import { ElasticPatternStore } from '../src/patterns/elasticPatternStore.js';

const url = process.env.ELASTIC_URL;
const apiKey = process.env.ELASTIC_API_KEY;

if (!url || !apiKey) {
  console.error('Set ELASTIC_URL and ELASTIC_API_KEY first. Without them the memory runs in process and needs no index.');
  process.exit(1);
}

const store = new ElasticPatternStore({
  url,
  apiKey,
  index: process.env.ELASTIC_INDEX,
  inferenceId: process.env.ELASTIC_INFERENCE_ID,
});

const created = await store.ensureIndex();
console.log(created ? 'Index created.' : 'Index already exists.');
