import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const errors = [];

for (const f of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch (e) {
    errors.push(`${f}: invalid JSON (${e.message})`);
    continue;
  }
  if (Array.isArray(data.records)) {
    if (!data.records.every((record) =>
      record && typeof record === 'object' &&
      typeof record.cin === 'string' && record.cin.length > 0 &&
      typeof record.company_name === 'string' && record.company_name.length > 0
    )) {
      errors.push(`${f}: provider records must include company_name and CIN`);
    }
    continue;
  }
  for (const key of ['request', 'evidence', 'verdict']) {
    if (!(key in data)) errors.push(`${f}: missing "${key}"`);
  }
  if (!Array.isArray(data.evidence)) errors.push(`${f}: "evidence" must be an array`);
  if (typeof data.request?.storefrontUrl !== 'string' || !data.request.storefrontUrl.includes('.example')) {
    errors.push(`${f}: request.storefrontUrl must use a .example domain`);
  }
}

if (files.length === 0) errors.push('no fixtures found');
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`fixtures OK (${files.length} files)`);
