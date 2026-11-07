import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 10 * 1024 * 1024;
const requiredScripts = [
  'build',
  'lint',
  'typecheck',
  'test',
  'test:contracts',
  'test:integration',
  'test:sandbox',
  'check:brands',
  'check:hygiene',
];
const requiredIgnores = [
  'node_modules',
  'dist',
  '.env',
  '.env.*',
  '!.env.example',
  '.cache/',
  'coverage/',
];
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const problems = [];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

// a. tracked build output, installed packages and large files
for (const file of tracked) {
  const parts = file.split('/');
  if (parts.includes('node_modules')) problems.push(`tracked file under node_modules/: ${file}`);
  if (parts.includes('dist')) problems.push(`tracked file under dist/: ${file}`);
  const full = join(root, file);
  if (existsSync(full)) {
    const size = statSync(full).size;
    if (size > MAX_BYTES) {
      problems.push(`tracked file larger than 10 MB: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    }
  }
}

// b. lowercase package names and dependency scopes
const packageFiles = tracked.filter((f) => f === 'package.json' || f.endsWith('/package.json'));
for (const file of packageFiles) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (e) {
    problems.push(`${file}: invalid JSON (${e.message})`);
    continue;
  }
  if (typeof pkg.name === 'string' && /[A-Z]/.test(pkg.name)) {
    problems.push(`${file}: "name" contains uppercase letters: ${pkg.name}`);
  }
  for (const field of dependencyFields) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      const scope = dep.startsWith('@') ? dep.split('/')[0] : '';
      if (/[A-Z]/.test(scope)) {
        problems.push(`${file}: ${field} scope contains uppercase letters: ${dep}`);
      }
    }
  }
}

// c. required root scripts
const rootPkgPath = join(root, 'package.json');
if (existsSync(rootPkgPath)) {
  const scripts = JSON.parse(readFileSync(rootPkgPath, 'utf8')).scripts ?? {};
  for (const name of requiredScripts) {
    if (!(name in scripts)) problems.push(`root package.json is missing script "${name}"`);
  }
} else {
  problems.push('root package.json not found');
}

// d. required .gitignore entries
const ignorePath = join(root, '.gitignore');
if (existsSync(ignorePath)) {
  const lines = new Set(
    readFileSync(ignorePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
  for (const entry of requiredIgnores) {
    // Directory entries may be written with or without a trailing slash.
    const alternatives = entry.endsWith('/') || !entry.includes('.') ? [entry, entry.replace(/\/$/, ''), `${entry.replace(/\/$/, '')}/`] : [entry];
    if (!alternatives.some((a) => lines.has(a))) {
      problems.push(`root .gitignore is missing "${entry}"`);
    }
  }
} else {
  problems.push('root .gitignore not found');
}

if (problems.length > 0) {
  console.error('Repo hygiene check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `check:hygiene OK (${tracked.length} tracked files, ${packageFiles.length} package.json files)`,
);
