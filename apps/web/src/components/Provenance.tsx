import { useEffect, useState } from 'react';
import type { Health, Investigation, SimilarCase } from '../types';
import { api, USE_MOCK } from '../api/apiClient';
import { cn } from '../lib/format';
import { VERDICT_WORDS, closeCases, embeddingSettingLabel, memoryLabel, MIN_CASE_SIMILARITY, retrievalLabel } from '../lib/labels';
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
  ['paypal', 'PayPal'], ['signals', 'Signals'], ['llm', 'Language model'], ['store', 'Data store'],
];

/** A small footer built from GET /health showing how the API is running. */
export function ModesFooter() {
  const { health, error } = useHealth();
  if (USE_MOCK) return <p className="text-center text-[11px] text-muted font-mono">Simulated backend: nothing here talks to PayPal or any other service.</p>;
  if (error) return <p className="text-center text-[11px] text-bad font-mono">API health unavailable: {error}</p>;
  if (!health?.modes) return null;
  const modes = health.modes;
  return <p className="text-center text-[11px] text-muted font-mono flex flex-wrap gap-x-3 gap-y-1 justify-center">
    {MODE_LABEL.map(([k, label]) => {
      const value = String(modes[k] ?? '');
      return <span key={k}>{label}: <b className={cn(value === 'simulated' || value === 'replay' || value === 'none' ? 'text-warn' : 'text-ok')}>{value}</b></span>;
    })}
    <span>Memory: <b className="text-muted">{memoryLabel(modes.memory, modes.memoryPersistent)}</b>{modes.memory === 'elastic' && typeof modes.memorySize === 'number' ? ` (${modes.memorySize} cases)` : ''}</span>
    {modes.llmProvider && modes.llm !== 'none' && <span>Provider: <b className="text-ok">{modes.llmProvider}{modes.llmModel ? `/${modes.llmModel}` : ''}</b></span>}
    {modes.llmError && <span className="text-bad">Language model error: {modes.llmError}</span>}
    {modes.auditEncryption && <span>Record encryption: <b className={modes.auditEncryption === 'enabled' ? 'text-ok' : 'text-warn'}>{modes.auditEncryption}</b></span>}
  </p>;
}

/** Chips showing what produced one investigation. */
export function ProvenanceChips({ inv }: { inv: Pick<Investigation, 'provenance' | 'simulated'> }) {
  const p = inv.provenance;
  if (!p) return null;
  const llmText = p.llmProvider
    ? `${p.llm} (${p.llmProvider}${p.llmModel ? `/${p.llmModel}` : ''})`
    : p.llm;
  const embedding = embeddingSettingLabel(p.embeddings);
  return <div className="flex flex-wrap gap-1.5" aria-label="How this was checked">
    <Pill tone={p.signals === 'live' ? 'ok' : 'warn'}>signals: {p.signals}</Pill>
    <Pill tone={p.llm === 'live' ? 'ok' : 'neutral'}>language model: {llmText}</Pill>
    <Pill tone="neutral">memory: {memoryLabel(p.memory, p.memory === 'file' ? undefined : p.memoryPersistent)}</Pill>
    {embedding && <Pill tone="neutral">embedding setting: {embedding}</Pill>}
    {p.llmError && <Pill tone="bad">{p.llmError}</Pill>}
    {inv.simulated && <Pill tone="warn">payment: simulated</Pill>}
  </div>;
}

const MATCH_LABEL: Record<SimilarCase['matchType'], string> = {
  exact_payee: 'Same payee', exact_domain: 'Same domain', semantic: 'Similar pattern',
};

/** The closest past cases retrieved from memory. Shown for context; they never change a decision. */
export function SimilarCases({ cases }: { cases?: SimilarCase[] }) {
  const close = closeCases(cases);
  if (!close.length) return null;
  return <section aria-label="Similar past cases">
    <h3 className="font-semibold">Similar past cases <span className="font-normal text-muted num">({close.length})</span></h3>
    <ul className="ruled border-y border-line mt-2">{close.map((c, n) => <li key={c.caseId ?? n} className="py-3 text-sm">
        <div className="flex flex-wrap gap-x-3 items-center mb-1">
          <span className="font-medium">{VERDICT_WORDS[c.decision].label}</span>
          <span>{MATCH_LABEL[c.matchType]}</span>
          <span className="text-muted num">similarity {c.score.toFixed(2)}</span></div>
        <p>{c.patternSentence}</p>
        <p className="label mt-1">Found by: {retrievalLabel(c.retrieval)}</p></li>)}</ul>
    <p className="label mt-2">For context only. A past case never overrides a decision. Only matches with similarity {MIN_CASE_SIMILARITY} or higher are shown.</p>
  </section>;
}
