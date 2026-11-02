import { assertSafeUrl } from '../safety/url.js';
import type { Evidence, ISignalCollector, SignalCollectorOptions, SignalRequest } from '../types.js';
import { fetchWithTimeout, makeEvidence, readLimitedText, registrableDomain } from '../util.js';

// The file name may change with the project name. Keep it in one place.
export const BINDING_PATH = '/.well-known/checkout-guardian.json';
export const BINDING_TIMEOUT_MS = 6000;

function parseMerchantId(text: string): string | null {
  try {
    const data: unknown = JSON.parse(text);
    const id = (data as { merchant_id?: unknown })?.merchant_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export class PayeeBindingCollector implements ISignalCollector {
  name = 'payee-binding';

  async collect(request: SignalRequest, options: SignalCollectorOptions): Promise<Evidence[]> {
    const expected = request.payee?.merchantId;
    const { hostname } = await assertSafeUrl(request.merchantUrl, { lookup: options.lookupImpl });
    const url = `https://${hostname}${BINDING_PATH}`;
    const evidence: Evidence[] = [];

    if (!expected) {
      evidence.push(
        makeEvidence({
          type: 'PAYEE_BINDING_SKIPPED',
          severity: 'INFO',
          confidence: 1,
          summary: 'No payee merchant id was supplied, so the binding file was not compared.',
          source: this.name,
        }),
      );
    } else {
      evidence.push(await this.checkBinding(url, expected, options));
    }

    const emailEvidence = this.checkEmailDomain(request, hostname);
    if (emailEvidence) evidence.push(emailEvidence);
    return evidence;
  }

  private async checkBinding(url: string, expected: string, options: SignalCollectorOptions): Promise<Evidence> {
    const fetchImpl = options.fetchImpl ?? fetch;
    let text: string | null = null;
    let status = 0;
    try {
      // Redirects are not followed: a redirect could point at an unchecked host.
      const res = await fetchWithTimeout(fetchImpl, url, options.timeoutMs ?? BINDING_TIMEOUT_MS, {
        redirect: 'manual',
        headers: { accept: 'application/json' },
      });
      status = res.status;
      if (res.ok) text = await readLimitedText(res);
    } catch {
      text = null;
    }

    const observed = text === null ? null : parseMerchantId(text);
    if (observed === null) {
      return makeEvidence({
        type: 'PAYEE_BINDING_MISSING',
        severity: 'MEDIUM',
        confidence: 0.7,
        summary: 'The merchant site does not publish a usable payee binding file.',
        source: this.name,
        hardFail: false,
        artifactUrl: url,
        metadata: { status },
      });
    }
    if (observed !== expected) {
      return makeEvidence({
        type: 'PAYEE_BINDING_MISMATCH',
        severity: 'CRITICAL',
        confidence: 0.95,
        summary: 'The merchant id published by the site differs from the payee on the order.',
        source: this.name,
        hardFail: true,
        artifactUrl: url,
        metadata: { expectedMerchantId: expected, observedMerchantId: observed.slice(0, 128) },
      });
    }
    return makeEvidence({
      type: 'PAYEE_BINDING_OK',
      severity: 'INFO',
      confidence: 0.95,
      summary: 'The merchant id published by the site matches the payee on the order.',
      source: this.name,
      artifactUrl: url,
      metadata: { merchantId: expected },
    });
  }

  /** Extra weak signal only. Small shops often use webmail addresses, so this never hard-fails. */
  private checkEmailDomain(request: SignalRequest, hostname: string): Evidence | null {
    const email = request.payee?.email;
    const at = email?.lastIndexOf('@') ?? -1;
    if (!email || at < 0) return null;
    const emailDomain = registrableDomain(email.slice(at + 1));
    const siteDomain = registrableDomain(hostname);
    if (emailDomain === siteDomain) return null;
    return makeEvidence({
      id: 'payee-binding:payee_email_domain_differs',
      type: 'PAYEE_EMAIL_DOMAIN_DIFFERS',
      severity: 'LOW',
      confidence: 0.4,
      summary: 'The payee email domain differs from the website domain.',
      source: this.name,
      hardFail: false,
      metadata: { emailDomain, siteDomain },
    });
  }
}
