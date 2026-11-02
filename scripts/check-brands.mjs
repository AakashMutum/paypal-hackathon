import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const denylistPath = join(root, 'scripts', 'brand-denylist.txt');
const scanDirs = ['demo-sites', 'tests/fixtures', 'docs'];
const skipDirs = new Set(['node_modules', 'dist', '.git']);
const binaryExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.woff', '.woff2']);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const brands = readFileSync(denylistPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const patterns = brands.map((b) => ({
  brand: b,
  re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(b).replace(/\s+/g, '\\s+')}(?![A-Za-z0-9])`, 'i'),
}));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const hits = [];
let scanned = 0;
for (const d of scanDirs) {
  const dir = join(root, d);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (file === denylistPath) continue;
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (binaryExt.has(ext)) continue;
    scanned += 1;
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const { brand, re } of patterns) {
          if (re.test(line)) hits.push(`${relative(root, file)}:${i + 1}: "${brand}"`);
        }
      });
  }
}

if (hits.length > 0) {
  console.error('Real brand names found in demo content:');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check:brands OK (${scanned} files scanned, ${brands.length} brands denied)`);
