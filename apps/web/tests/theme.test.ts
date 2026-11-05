import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseTheme, THEME_KEY } from '../src/lib/theme.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8');

test('light is the default; only dark and system are other choices', () => {
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('system'), 'system');
  for (const v of [null, undefined, '', 'blue', 'LIGHT']) assert.equal(parseTheme(v as string | null | undefined), 'light');
});

test('the page starts light whatever the system prefers', () => {
  assert.match(html, /<html[^>]*data-theme="light"/);
  assert.match(html, /t === 'dark'/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
});

test('index.html sets the theme before the app loads, from the same storage key', () => {
  assert.ok(html.includes(`'${THEME_KEY}'`), 'the inline script must use the same key as the app');
  assert.ok(html.indexOf('data-theme') < html.indexOf('/src/main.tsx'), 'the theme script must come before the module script');
  assert.match(html, /try \{[\s\S]*catch/, 'storage access must be wrapped');
});

test('no font or script is loaded from a CDN', () => {
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|cdn\./i);
});

test('Tailwind takes every colour from the CSS variables', () => {
  assert.doesNotMatch(config, /#[0-9a-fA-F]{6}/, 'no hard-coded hex colour in the Tailwind config');
});
