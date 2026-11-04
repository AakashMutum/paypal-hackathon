import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Reads the real token file and checks WCAG 2.x contrast for every pair the UI uses.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

type Palette = Record<string, string>;

function block(source: string, opener: string): string {
  const start = source.indexOf(opener);
  assert.ok(start >= 0, `block not found: ${opener}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block: ${opener}`);
}

function colours(body: string): Palette {
  const out: Palette = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}

const light = colours(block(css, ':root {'));
const dark = colours(block(css, ":root[data-theme='dark']"));
const systemDark = colours(block(block(css, '@media (prefers-color-scheme: dark)'), ':root:not'));

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio]. 4.5 for text, 3 for UI edges and focus rings.
const PAIRS: Array<[string, string, number]> = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['action', 'bg', 4.5], ['action', 'surface', 4.5], ['action', 'surface-2', 4.5],
  ['action-hover', 'surface', 4.5], ['action-hover', 'bg', 4.5],
  ['on-action', 'action', 4.5], ['on-action', 'action-hover', 4.5],
  ['on-navy', 'navy', 4.5],
  ['success', 'success-bg', 4.5], ['success', 'surface', 4.5], ['success', 'bg', 4.5],
  ['warn', 'warn-bg', 4.5], ['warn', 'surface', 4.5], ['warn', 'bg', 4.5],
  ['danger', 'danger-bg', 4.5], ['danger', 'surface', 4.5], ['danger', 'bg', 4.5],
  ['border-strong', 'surface', 3], ['border-strong', 'bg', 3], ['border-strong', 'surface-2', 3],
  ['focus', 'bg', 3], ['focus', 'surface', 3], ['focus', 'surface-2', 3],
];

for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
  test(`${name} theme: every text and UI colour pair meets WCAG AA`, () => {
    const failures: string[] = [];
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(palette[fg], `${name}: missing token --${fg}`);
      assert.ok(palette[bg], `${name}: missing token --${bg}`);
      const ratio = contrast(palette[fg], palette[bg]);
      if (ratio < min) failures.push(`--${fg} on --${bg}: ${ratio.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
}

test('the system dark block matches the explicit dark block', () => {
  for (const [token, value] of Object.entries(dark)) assert.equal(systemDark[token], value, token);
  assert.deepEqual(Object.keys(systemDark).sort(), Object.keys(dark).sort());
});

test('both themes define the same colour tokens', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
});

test('the starting palette values are the specified ones', () => {
  assert.equal(light.bg, '#F7F9FC');
  assert.equal(light.navy, '#003087');
  assert.equal(light.action, '#006DDA'); // #0070E0 failed AA on surface-2 (4.37:1)
  assert.equal(dark.bg, '#0A0F1C');
  assert.equal(dark.action, '#4C9AFF');
});

test('large and bold text can use the exact status colours: every status colour is at least 3:1 on its tint', () => {
  for (const palette of [light, dark]) {
    for (const k of ['success', 'warn', 'danger']) assert.ok(contrast(palette[k], palette[`${k}-bg`]) >= 3);
  }
});
