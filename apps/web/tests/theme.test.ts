import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseTheme, THEME_KEY } from '../src/lib/theme.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8');

test('only light and dark are stored choices; anything else means system', () => {
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  for (const v of [null, undefined, '', 'system', 'blue', 'LIGHT']) assert.equal(parseTheme(v as string | null | undefined), 'system');
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
