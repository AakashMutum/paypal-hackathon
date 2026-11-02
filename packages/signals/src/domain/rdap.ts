import { assertSafeUrl } from '../safety/url.js';
import type { Evidence, ISignalCollector, SignalCollectorOptions, SignalRequest } from '../types.js';
import { fetchWithTimeout, hostnameOf, makeEvidence, readLimitedText, registrableDomain } from '../util.js';

export const RDAP_TIMEOUT_MS = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RdapEvent {
  eventAction?: unknown;
  eventDate?: unknown;
}

/** Whole days between the registration date and now, or null if the date is not usable. */
export function domainAgeDays(registrationDate: string, now: Date = new Date()): number | null {
  const registered = Date.parse(registrationDate);
  if (Number.isNaN(registered)) return null;
  return Math.max(0, Math.floor((now.getTime() - registered) / DAY_MS));
}

export function findRegistrationDate(rdap: unknown): string | null {
  const events = (rdap as { events?: unknown })?.events;
  if (!Array.isArray(events)) return null;
  for (const event of events as RdapEvent[]) {
    if (event?.eventAction === 'registration' && typeof event.eventDate === 'string') {
      return event.eventDate;
    }
  }
  return null;
}

export class RdapCollector implements ISignalCollector {
  name = 'rdap';

  async collect(request: SignalRequest, options: SignalCollectorOptions): Promise<Evidence[]> {
    // Validates the merchant URL (and rejects private hosts) before we derive a domain from it.
    const { hostname } = await assertSafeUrl(request.merchantUrl, { lookup: options.lookupImpl });
    const domain = registrableDomain(hostname || hostnameOf(request.merchantUrl));
    const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    const fetchImpl = options.fetchImpl ?? fetch;

    const res = await fetchWithTimeout(fetchImpl, url, options.timeoutMs ?? RDAP_TIMEOUT_MS, {
      headers: { accept: 'application/rdap+json, application/json' },
    });

    if (!res.ok) {
      return [
        makeEvidence({
          type: 'DOMAIN_AGE_UNKNOWN',
          severity: 'LOW',
          confidence: 0.3,
          summary: `Registration data for ${domain} was not available (HTTP ${res.status}).`,
          source: this.name,
          artifactUrl: url,
          metadata: { domain, status: res.status },
        }),
      ];
    }

    let body: unknown;
    try {
      body = JSON.parse(await readLimitedText(res, 512 * 1024));
    } catch {
      body = null;
    }
    const registration = findRegistrationDate(body);
    const ageDays = registration ? domainAgeDays(registration) : null;

    if (registration === null || ageDays === null) {
      return [
        makeEvidence({
          type: 'DOMAIN_AGE_UNKNOWN',
          severity: 'LOW',
          confidence: 0.3,
          summary: `No registration date found for ${domain}.`,
          source: this.name,
          artifactUrl: url,
          metadata: { domain },
        }),
      ];
    }

    const severity = ageDays < 30 ? 'MEDIUM' : ageDays < 90 ? 'LOW' : 'INFO';
    return [
      makeEvidence({
        type: 'DOMAIN_AGE',
        severity,
        confidence: 0.9,
        summary: `${domain} was registered ${ageDays} days ago.`,
        source: this.name,
        hardFail: false,
        artifactUrl: url,
        metadata: { domain, registrationDate: registration, ageDays },
      }),
    ];
  }
}
