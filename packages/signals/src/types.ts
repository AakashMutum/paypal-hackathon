// Provisional local types. Move to @checkout-guardian/contracts once the team agrees on the
// shared Evidence shape; until then this package keeps its own copy.
//
// This package only collects evidence. It never produces a decision and never calls PayPal.

export type EvidenceSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Evidence {
  id: string;
  /** Machine-readable evidence type, for example DOMAIN_AGE or PAYEE_BINDING_MISMATCH. */
  type: string;
  severity: EvidenceSeverity;
  /** Confidence in the observation, from 0 to 1. */
  confidence: number;
  summary: string;
  /** Where the observation came from, for example "rdap" or "tls". */
  source: string;
  /** True when this single observation is strong enough to stop the flow on its own. */
  hardFail: boolean;
  artifactUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SignalRequest {
  orderId: string;
  merchantUrl: string;
  claimedBrand?: string;
  payee?: {
    merchantId?: string;
    email?: string;
  };
}

export interface SignalCollectorOptions {
  timeoutMs?: number;
  /** Use offline fixture-backed collectors instead of the network. */
  useMocks?: boolean;
  /** Inject a fetch implementation (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Inject a DNS lookup returning the addresses of a hostname (tests). */
  lookupImpl?: (hostname: string) => Promise<string[]>;
  /** Caller cancellation. Combined with the timeout. */
  signal?: AbortSignal;
}

export interface ISignalCollector {
  name: string;
  collect(request: SignalRequest, options: SignalCollectorOptions): Promise<Evidence[]>;
}
