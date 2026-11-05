import { Link } from 'react-router-dom';
import type { Investigation, Verdict } from '../types';
import { usePageTitle } from '../hooks/usePageTitle';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { REPO_URL } from '../components/HowChecked';
import { VerdictMark } from '../components/ui';
import { VERDICT_WORDS } from '../lib/labels';
import { STORES } from '../data/stores';

const FAKE_STORE = STORES.find(s => s.kind === 'impersonator') ?? STORES[0];

/** One invented example for the picture on the front page. Nothing here is live data. */
const EXAMPLE: Investigation = {
  id: 'INV-EXAMPLE', domain: 'www.alderbrook-goods.example', claimedBrand: 'Alderbrook Goods', productName: 'Linen throw blanket',
  price: 38, benchmark: 96, currency: 'USD', payeeName: 'Northgate Trading Co.', payeeId: 'MERCH-NORTHGATE', payeeTier: 'Unverified Business',
  domainAgeDays: 9, registryRecords: 0, riskScore: 88, confidence: 90, status: 'COMPLETE', verdict: 'PAUSE', captureState: 'HELD',
  reasons: [], payeeMismatch: true, createdAt: '2026-01-01T00:00:00.000Z',
  evidence: [{ id: 'e4', node: 'PAYEE', title: 'Who gets paid', status: 'FAIL', badge: 'Mismatch', confidence: 90, fields: [] }],
};

const STEPS = [
  { title: 'The storefront says', text: 'The store names itself, shows its domain and sets a price.' },
  { title: 'PayPal pays', text: 'The business that would really receive the money for this order.' },
  { title: 'TrustOra compares them', text: 'It checks the two against each other before any money is captured.' },
];

const OUTCOMES: Array<{ v: Verdict; text: string }> = [
  { v: 'ALLOW', text: 'The account matches the store. The payment can be captured.' },
  { v: 'WARN', text: 'Something could not be verified. A person confirms before the payment is captured.' },
  { v: 'PAUSE', text: 'The account does not match the store. Nothing is captured and the authorization is voided.' },
];

const ICON: Record<Verdict, string> = { ALLOW: 'text-success', WARN: 'text-warning', PAUSE: 'text-danger' };

/** The front page: what TrustOra does, in one screen of plain text. No live data. */
export default function Home() {
  usePageTitle('Know who gets paid before you pay');
  return <div className="space-y-16 lg:space-y-20">
    <section className="max-w-3xl pt-4 lg:pt-10">
      <h1 className="text-[34px] lg:text-[44px] leading-[1.1]">Know who gets paid before you pay.</h1>
      <p className="mt-4 text-lg text-muted max-w-2xl">TrustOra compares what a store says it is with the business that PayPal would really pay, and holds the payment when the two do not match.</p>
      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to={`/check?check=${encodeURIComponent(FAKE_STORE.domain)}`} className="btn-primary">See it catch a fake store</Link>
        <Link to="/check" className="link">Check a website</Link>
      </div>
    </section>

    <section aria-labelledby="how-h">
      <h2 id="how-h" className="text-2xl font-semibold">How it works</h2>
      <ol className="mt-5 grid gap-x-8 gap-y-6 md:grid-cols-3">{STEPS.map((s, n) => <li key={s.title} className="border-t-2 border-brand pt-3">
        <p className="font-mono num text-sm text-muted">{n + 1}</p>
        <h3 className="font-semibold text-lg mt-0.5">{s.title}</h3>
        <p className="text-muted mt-1">{s.text}</p></li>)}</ol>
      <div className="mt-10">
        <p className="label mb-2">Example: an invented store, not live data</p>
        <div className="band py-6"><ClaimedVsActual inv={EXAMPLE} /></div>
      </div>
    </section>

    <section aria-labelledby="out-h">
      <h2 id="out-h" className="text-2xl font-semibold">Three outcomes</h2>
      <ul className="ruled border-y border-line mt-5">{OUTCOMES.map(o => <li key={o.v} className="grid gap-x-8 gap-y-1 py-4 md:grid-cols-[14rem_1fr] md:items-center">
        <p className="inline-flex items-center gap-2 font-semibold text-lg"><VerdictMark verdict={o.v} size={20} className={ICON[o.v]} />{VERDICT_WORDS[o.v].label}</p>
        <p className="text-muted">{o.text}</p></li>)}</ul>
    </section>

    <section aria-labelledby="agents-h" className="max-w-3xl">
      <h2 id="agents-h" className="text-2xl font-semibold">Works for shopping agents too</h2>
      <p className="mt-3 text-muted">An MCP server gives an AI agent two tools: <span className="font-mono text-sm text-content">investigate_merchant</span> checks a merchant before paying, and <span className="font-mono text-sm text-content">safe_checkout</span> holds an order and finishes it only when the check allows it or a person confirms a warning.</p>
      <p className="mt-3"><a className="link" href={`${REPO_URL}/blob/main/docs/agentic-demo.md`} target="_blank" rel="noreferrer">Read the agent demo<span className="sr-only"> (opens in a new tab)</span></a></p>
    </section>
  </div>;
}
