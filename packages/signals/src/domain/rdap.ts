import { assertSafeUrl } from '../safety/url.js';
import type { Evidence, ISignalCollector, SignalCollectorOptions, SignalRequest } from '../types.js';
import { fetchWithTimeout, hostnameOf, makeEvidence, readLimitedText, registrableDomain } from '../util.js';

export const RDAP_TIMEOUT_MS = 6000;
export const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_TTL_MS = 60 * 60 * 1000;

interface RdapBootstrap {
  at: number;
  byTld: Map<string, string>;
}

let bootstrapCache: RdapBootstrap | undefined;

const FALLBACK_BASES = new Map<string, string>([
  ['com', 'https://rdap.verisign.com/com/v1/'],
  ['net', 'https://rdap.verisign.com/net/v1/'],
  ['in', 'https://rdap.nixiregistry.in/rdap/'],
]);

/**
 * Resolves the authoritative RDAP base URL for a domain from the IANA bootstrap. If the
 * bootstrap is unavailable, known registry endpoints are used, then rdap.org as a last resort.
 */
export async function rdapUrlFor(
  domain: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal; now?: () => number } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const tld = domain.toLowerCase().replace(/\.$/, '').split('.').pop() ?? '';

  let base = bootstrapCache && now() - bootstrapCache.at < BOOTSTRAP_TTL_MS ? bootstrapCache.byTld.get(tld) : undefined;
  if (!base) {
    try {
      const res = await fetchWithTimeout(fetchImpl, RDAP_BOOTSTRAP_URL, Math.min(options.timeoutMs ?? 3000, 3000), {
        headers: { accept: 'application/json' },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (res.ok) {
        const body = JSON.parse(await readLimitedText(res, 512 * 1024)) as { services?: unknown };
        const byTld = new Map(FALLBACK_BASES);
        if (Array.isArray(body.services)) {
          for (const service of body.services) {
            if (!Array.isArray(service) || service.length < 2) continue;
            const [tlds, urls] = service as [unknown, unknown];
            if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
            const first = urls.find((url): url is string => typeof url === 'string' && url.startsWith('https://'));
            if (!first) continue;
            for (const entry of tlds) {
              if (typeof entry === 'string' && entry.length > 0) byTld.set(entry.toLowerCase(), first);
            }
          }
        }
        base = byTld.get(tld);
        bootstrapCache = { at: now(), byTld };
      }
    } catch {
      // Fall through to the known registry endpoints.
    }
  }

  if (!base) base = FALLBACK_BASES.get(tld);
  if (!base) return `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(`domain/${encodeURIComponent(domain)}`, normalized).toString();
}

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

function vcardName(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const properties = value[1];
  if (!Array.isArray(properties)) return null;
  for (const property of properties) {
    if (!Array.isArray(property) || property[0] !== 'fn') continue;
    const name = property[3];
    if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  }
  return null;
}

/** Reads the registrar name from RDAP entities. Missing or malformed data returns null. */
export function findRegistrarName(rdap: unknown): string | null {
  const entities = (rdap as { entities?: unknown })?.entities;
  if (!Array.isArray(entities)) return null;
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    const record = entity as { roles?: unknown; vcardArray?: unknown; handle?: unknown };
    const roles = record.roles;
    if (!Array.isArray(roles) || !roles.includes('registrar')) continue;
    const name = vcardName(record.vcardArray);
    if (name) return name;
    if (typeof record.handle === 'string' && record.handle.trim().length > 0) {
      return record.handle.trim();
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
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = await rdapUrlFor(domain, {
      fetchImpl,
      timeoutMs: options.timeoutMs ?? RDAP_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const res = await fetchWithTimeout(fetchImpl, url, options.timeoutMs ?? RDAP_TIMEOUT_MS, {
      headers: { accept: 'application/rdap+json, application/json' },
      signal: options.signal,
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
    const registrar = findRegistrarName(body);

    if (registration === null || ageDays === null) {
      return [
        makeEvidence({
          type: 'DOMAIN_AGE_UNKNOWN',
          severity: 'LOW',
          confidence: 0.3,
          summary: `No registration date found for ${domain}.`,
          source: this.name,
          artifactUrl: url,
          metadata: { domain, ...(registrar ? { registrar } : {}) },
        }),
      ];
    }

    const severity = ageDays < 30 ? 'MEDIUM' : ageDays < 90 ? 'LOW' : 'INFO';
    return [
      makeEvidence({
        type: 'DOMAIN_AGE',
        severity,
        confidence: 0.9,
        summary: registrar
          ? `${domain} was registered ${ageDays} days ago with ${registrar}.`
          : `${domain} was registered ${ageDays} days ago.`,
        source: this.name,
        hardFail: false,
        artifactUrl: url,
        metadata: { domain, registrationDate: registration, ageDays, ...(registrar ? { registrar } : {}) },
      }),
    ];
  }
}
