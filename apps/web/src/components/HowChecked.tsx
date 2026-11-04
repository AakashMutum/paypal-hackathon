import { useState } from 'react';
import type { Investigation, SignalAvailability } from '../types';
import { USE_MOCK } from '../api/apiClient';
import { embeddingSettingLabel, memoryLabel } from '../lib/labels';
import { Disclosure, Icon, Modal } from './ui';
import { useHealth } from './Provenance';
import { CheckCircle2, MinusCircle, AlertTriangle } from 'lucide-react';

/** "How this was checked": the sources behind one investigation, tucked into a disclosure. */
export function HowChecked({ inv }: { inv: Pick<Investigation, 'provenance' | 'simulated' | 'mode'> }) {
  const p = inv.provenance;
  if (!p) return null;
  const rows: Array<[string, string]> = [
    ['Signals', p.signals === 'live' ? 'Fetched live from the site and public records' : 'Recorded signals for the demo stores (nothing fetched live)'],
    ['Language model', p.llm === 'none' ? 'Not used. Plain rules decided, and wrote the explanation' : `${p.llm}${p.llmProvider ? ` (${p.llmProvider}${p.llmModel ? `/${p.llmModel}` : ''})` : ''}`],
    ['Past cases', memoryLabel(p.memory, p.memory === 'file' ? undefined : p.memoryPersistent)],
    ['Similarity search', embeddingSettingLabel(p.embeddings) ?? 'not reported'],
    ['Payment', inv.simulated ? 'Simulated: no PayPal call was made' : 'PayPal sandbox'],
  ];
  if (p.modelBudget?.exhausted) rows.push(['Time budget', 'The model ran out of its time budget, so plain rules wrote the explanation']);
  if (p.llmError) rows.push(['Language model error', p.llmError]);
  return <Disclosure title="How this was checked">
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr] text-sm">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
  </Disclosure>;
}

const CHECKS: Array<[keyof SignalAvailability, string, (v: string) => 'ok' | 'gap']> = [
  ['page', 'Merchant page read', (v) => (v === 'ok' ? 'ok' : 'gap')],
  ['domainAge', 'Domain age known', (v) => (v === 'known' ? 'ok' : 'gap')],
  ['registry', 'Registered business looked up', (v) => (v === 'found' || v === 'empty' ? 'ok' : 'gap')],
  ['price', 'Price compared', (v) => (v === 'known' ? 'ok' : 'gap')],
  ['tls', 'Security certificate checked', (v) => (v === 'valid' || v === 'invalid' ? 'ok' : 'gap')],
  ['payee', 'Receiving account supplied', (v) => (v === 'provided' ? 'ok' : 'gap')],
  ['registrarReputation', 'Registrar reputation', () => 'gap'],
];
const GAP_WORD: Record<string, string> = { blocked: 'blocked the checker', empty: 'nothing to read', unavailable: 'could not be checked', not_checked: 'not checked', not_provided: 'not supplied', not_assessed: 'not assessed (no source)' };

/** A compact checklist of what was and was not checked. */
export function SignalChecklist({ availability, reason }: { availability?: SignalAvailability; reason?: string }) {
  if (!availability) return null;
  return <section className="card space-y-3" aria-label="What was checked">
    <h2 className="font-semibold">What was checked</h2>
    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">{CHECKS.map(([key, label, ok]) => {
      const value = String(availability[key]);
      const state = ok(value);
      const glyph = state === 'ok' ? CheckCircle2 : value === 'blocked' ? AlertTriangle : MinusCircle;
      return <li key={key} className="flex items-start gap-2">
        <span className={state === 'ok' ? 'text-success' : value === 'blocked' ? 'text-warning' : 'text-muted'}><Icon icon={glyph} size={16} label={state === 'ok' ? 'Checked' : 'Not checked'} /></span>
        <span>{label}{state === 'ok' ? '' : <span className="text-muted"> · {GAP_WORD[value] ?? value.replace(/_/g, ' ')}</span>}</span></li>;
    })}</ul>
    {reason && <p className="text-xs text-muted">{reason}</p>}
  </section>;
}

/** The footer: independence line and a link to an honest panel of how this deployment is running. */
export function SiteFooter() {
  const [open, setOpen] = useState(false);
  return <footer className="text-center text-xs text-muted space-y-1 py-4">
    <p>TrustOra is an independent hackathon project and is not affiliated with PayPal.</p>
    <button type="button" className="underline text-action" onClick={() => setOpen(true)}>About this demo</button>
    {open && <AboutDemo onClose={() => setOpen(false)} />}
  </footer>;
}

function AboutDemo({ onClose }: { onClose: () => void }) {
  const { health, error } = useHealth();
  const m = health?.modes;
  const rows: Array<[string, string]> = USE_MOCK
    ? [['Backend', 'Simulated, inside this browser tab. Nothing is sent to a server, to PayPal or to any other service.'], ['Data', 'Stored in this browser only (local storage) and lost if you clear it.']]
    : error
      ? [['Server', `Not reachable (${error})`]]
      : !m
        ? [['Server', 'Loading…']]
        : [
          ['PayPal', m.paypal === 'sandbox' ? 'Sandbox: test money only' : 'Simulated: no PayPal call is made'],
          ['Signals', m.signals === 'replay' ? 'Recorded for the demo stores; other sites are not checked' : m.signals === 'auto' ? 'Recorded for the demo stores, fetched live for other sites' : 'Fetched live'],
          ['Language model', m.llm === 'none' ? 'Off. Plain rules decide and explain' : m.llm === 'replay' ? 'Replays recorded answers, if any exist' : `On (${m.llmProvider ?? 'provider'}${m.llmModel ? `/${m.llmModel}` : ''})`],
          ['Past cases', memoryLabel(m.memory, m.memoryPersistent)],
          ['Data store', m.store === 'database' ? 'A database' : 'The server\'s memory: lost on restart'],
          ['Record encryption', m.auditEncryption ?? 'not reported'],
        ];
  return <Modal open onClose={onClose} title="About this demo">
    <p className="text-sm text-muted mb-3">The stores are fictional. This is how this deployment is running right now.</p>
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr] text-sm">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
    <p className="text-xs text-muted mt-4">The decision comes from fixed scoring rules and hard rules. A language model, when on, can add cautious evidence and writes the explanation, but it cannot override a hard rule or clear a payee mismatch.</p>
  </Modal>;
}
