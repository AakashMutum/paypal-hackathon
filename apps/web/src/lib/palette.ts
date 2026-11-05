// The command palette's list: pages, demo stores, theme options and, for a pasted address, "Check ...".
// Pure so it can be tested without a browser.
import { STORES } from '../data/stores';
import type { ThemeChoice } from './theme';

export type Command =
  | { id: string; label: string; hint?: string; kind: 'go'; to: string }
  | { id: string; label: string; hint?: string; kind: 'theme'; theme: ThemeChoice }
  | { id: string; label: string; hint?: string; kind: 'check'; url: string };

export const PAGES: Array<{ label: string; to: string }> = [
  { label: 'Check a website', to: '/check' },
  { label: 'Cases', to: '/investigations' },
  { label: 'Demo stores', to: '/stores' },
  { label: 'Analyst console', to: '/analyst' },
  { label: 'Register a merchant', to: '/onboarding' },
];

/** A host name with a dot, with or without a scheme and path. Spaces mean it is a search, not an address. */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  return /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#].*)?$/i.test(s);
}

export function buildCommands(input: string): Command[] {
  const all: Command[] = [];
  const q = input.trim();
  if (looksLikeUrl(q)) all.push({ id: 'check', kind: 'check', label: `Check ${q}`, hint: 'Run a check', url: q });
  for (const p of PAGES) all.push({ id: `go:${p.to}`, kind: 'go', label: p.label, hint: 'Page', to: p.to });
  for (const s of STORES) all.push({ id: `store:${s.id}`, kind: 'go', label: `${s.name}`, hint: 'Demo store', to: `/store/${s.id}` });
  for (const [theme, label] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']] as const) {
    all.push({ id: `theme:${theme}`, kind: 'theme', label: `Theme: ${label}`, hint: 'Appearance', theme });
  }
  if (!q || looksLikeUrl(q)) return all;
  const needle = q.toLowerCase();
  return all.filter((c) => c.label.toLowerCase().includes(needle) || (c.hint ?? '').toLowerCase().includes(needle));
}
