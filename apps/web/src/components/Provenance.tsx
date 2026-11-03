import { useEffect, useState } from 'react';
import type { Health, Investigation, SimilarCase } from '../types';
import { api, USE_MOCK } from '../api/apiClient';
import { cn } from '../lib/format';
import { Pill } from './ui';

/** The API's modes, read once from GET /health. Null in the simulated backend or while loading. */
export function useHealth(): { health: Health | null; error: string | null } {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    api.health().then(h => { if (!stop) setHealth(h); }).catch((e: Error) => { if (!stop) setError(e.message); });
    return () => { stop = true; };
  }, []);
  return { health, error };
}

/** "Simulated backend" in mock mode, "Live API" otherwise. */
export function ModeBadge() {
  return USE_MOCK
    ? <Pill tone="warn" className="whitespace-nowrap">Simulated backend</Pill>
    : <Pill tone="ok" className="whitespace-nowrap">Live API</Pill>;
}

const MODE_LABEL: Array<[keyof NonNullable<Health['modes']>, string]> = [
  ['paypal', 'PayPal'], ['signals', 'Signals'], ['llm', 'LLM'], ['memory', 'Memory'], ['store', 'Store'],
];

/** A small footer built from GET /health showing how the API is running. */
export function ModesFooter() {
  const { health, error } = useHealth();
  if (USE_MOCK) return <p className="text-center text-[11px] text-muted font-mono">Simulated backend: nothing here talks to PayPal or any other service.</p>;
  if (error) return <p className="text-center text-[11px] text-bad font-mono">API health unavailable: {error}</p>;
  if (!health?.modes) return null;
  const modes = health.modes;
  return <p className="text-center text-[11px] text-muted font-mono flex flex-wrap gap-x-3 gap-y-1 justify-center">
    {MODE_LABEL.map(([k, label]) => <span key={k}>{label}: <b className={cn(modes[k] === 'simulated' || modes[k] === 'replay' || modes[k] === 'none' ? 'text-warn' : 'text-ok')}>{modes[k]}</b></span>)}
  </p>;
}

/** Chips showing what produced one investigation. */
export function ProvenanceChips({ inv }: { inv: Pick<Investigation, 'provenance' | 'simulated'> }) {
  const p = inv.provenance;
  if (!p) return null;
  return <div className="flex flex-wrap gap-1.5" aria-label="Provenance">
    <Pill tone={p.signals === 'live' ? 'ok' : 'warn'}>signals: {p.signals}</Pill>
    <Pill tone={p.llm === 'live' ? 'ok' : 'neutral'}>llm: {p.llm}</Pill>
    <Pill tone={p.memory === 'elastic' ? 'ok' : 'neutral'}>memory: {p.memory}</Pill>
    {inv.simulated && <Pill tone="warn">payment: simulated</Pill>}
  </div>;
}

const MATCH_LABEL: Record<SimilarCase['matchType'], string> = {
  exact_payee: 'Same payee', exact_domain: 'Same domain', semantic: 'Similar pattern',
};

/** The most similar past cases retrieved from memory. Shown for context; they never change a decision. */
export function SimilarCases({ cases }: { cases?: SimilarCase[] }) {
  return <section className="card space-y-3" aria-label="Similar past cases">
    <div className="flex justify-between items-center"><h2 className="font-semibold">Similar past cases</h2><span className="mono-label bg-tint px-2 py-1 rounded">{cases?.length ?? 0} found</span></div>
    {!cases?.length
      ? <p className="text-sm text-muted">No similar past case was found in memory.</p>
      : <ul className="space-y-2">{cases.map((c, n) => <li key={n} className="rounded-lg bg-tint p-3 text-sm">
        <div className="flex flex-wrap gap-2 items-center mb-1">
          <Pill tone={c.decision === 'PAUSE' ? 'bad' : c.decision === 'WARN' ? 'warn' : 'ok'}>{c.decision}</Pill>
          <span className="mono-label">{MATCH_LABEL[c.matchType]}</span>
          <span className="font-mono text-xs text-muted">score {c.score.toFixed(2)}</span></div>
        <p className="text-ink/80">{c.patternSentence}</p></li>)}</ul>}
    <p className="text-[11px] text-muted">For context only. A past case never overrides a decision.</p>
  </section>;
}
