import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const denylistPath = join(root, 'scripts', 'brand-denylist.txt');
// Directories and single files to scan. PDFs, reference.txt and package-lock.json are
// deliberately not listed, and node_modules is always skipped.
const scanPaths = [
  'demo-sites',
  'tests',
  'docs',
  'apps/web/src',
  'apps/web/index.html',
  'README.md',
  'AGENTS.md',
  // A * matches any one directory name.
  'packages/*/src',
  'packages/*/tests',
  'packages/*/README.md',
  'apps/*/src',
  // Checked-in test data and fixtures are scanned too: a real brand must not be saved as if it
  // were demo content.
  'apps/*/test',
  'apps/*/tests',
  'apps/*/fixtures',
];
const skipDirs = new Set(['node_modules', 'dist', '.git']);
const binaryExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.woff', '.woff2', '.mp4', '.mov', '.webm']);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const brands = readFileSync(denylistPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const patterns = brands.map((b) => ({
  brand: b,
  re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(b).replace(/\s+/g, '\\s+')}(?![A-Za-z0-9])`, 'i'),
}));

/** Expands a path where * stands for any one directory name. Missing paths expand to nothing. */
function expand(pattern) {
  let current = [root];
  for (const part of pattern.split('/')) {
    const next = [];
    for (const base of current) {
      if (part === '*') {
        if (!existsSync(base) || !statSync(base).isDirectory()) continue;
        for (const name of readdirSync(base)) {
          if (skipDirs.has(name)) continue;
          const full = join(base, name);
          if (statSync(full).isDirectory()) next.push(full);
        }
      } else {
        next.push(join(base, part));
      }
    }
    current = next;
  }
  return current.filter((p) => existsSync(p));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Real merchant names are allowed in a source file only when it implements recognition of a real
// merchant (for example an official marketplace hostname list). This is functional data, not demo
// content. The marker must be in the file header; it is never used in demo-sites, fixtures or docs.
const BRAND_CHECK_ALLOW = '@brand-check-allow';

const hits = [];
let scanned = 0;
for (const target of scanPaths.flatMap(expand)) {
  const files = statSync(target).isDirectory() ? walk(target) : [target];
  for (const file of files) {
    if (file === denylistPath) continue;
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (binaryExt.has(ext)) continue;
    scanned += 1;
    const contents = readFileSync(file, 'utf8');
    if (contents.includes(BRAND_CHECK_ALLOW)) continue;
    contents.split(/\r?\n/).forEach((line, i) => {
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
