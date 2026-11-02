import tls from 'node:tls';
import { assertSafeUrl } from '../safety/url.js';
import type {
  Evidence,
  EvidenceSeverity,
  ISignalCollector,
  SignalCollectorOptions,
  SignalRequest,
} from '../types.js';
import { makeEvidence } from '../util.js';

export const TLS_TIMEOUT_MS = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CertificateInfo {
  validFrom: string;
  validTo: string;
  issuer: string;
  daysToExpiry: number;
  authorized: boolean;
  authorizationError?: string;
}

/** Turns a peer certificate into evidence. Pure, so it can be tested without a network. */
export function evaluateCertificate(info: CertificateInfo, host: string): Evidence {
  let severity: EvidenceSeverity = 'INFO';
  let summary = `Certificate for ${host} is valid for ${info.daysToExpiry} more days (issuer: ${info.issuer}).`;
  if (info.daysToExpiry < 0) {
    severity = 'HIGH';
    summary = `Certificate for ${host} expired ${-info.daysToExpiry} days ago.`;
  } else if (!info.authorized) {
    severity = 'MEDIUM';
    summary = `Certificate for ${host} is not trusted (${info.authorizationError ?? 'unknown reason'}).`;
  } else if (info.daysToExpiry < 14) {
    severity = 'LOW';
    summary = `Certificate for ${host} expires in ${info.daysToExpiry} days.`;
  }
  return makeEvidence({
    type: 'CERT_STATUS',
    severity,
    confidence: 0.95,
    summary,
    source: 'tls',
    hardFail: false,
    metadata: { ...info },
  });
}

function nameOf(field: unknown): string {
  if (field && typeof field === 'object') {
    const f = field as Record<string, unknown>;
    const value = f.O ?? f.CN;
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return 'unknown';
}

function readCertificate(address: string, servername: string, timeoutMs: number): Promise<CertificateInfo> {
  return new Promise((resolve, reject) => {
    // Connect to an address that passed the safety check, and verify the certificate for the name.
    const socket = tls.connect({ host: address, port: 443, servername, rejectUnauthorized: false });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${servername} timed out`));
    });
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) throw new Error('No certificate presented');
        const validTo = Date.parse(cert.valid_to);
        resolve({
          validFrom: new Date(cert.valid_from).toISOString(),
          validTo: new Date(validTo).toISOString(),
          issuer: nameOf(cert.issuer),
          daysToExpiry: Math.floor((validTo - Date.now()) / DAY_MS),
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        });
      } catch (e) {
        reject(e);
      } finally {
        socket.end();
      }
    });
  });
}

export class TlsCertificateCollector implements ISignalCollector {
  name = 'tls';

  async collect(request: SignalRequest, options: SignalCollectorOptions): Promise<Evidence[]> {
    const { hostname, addresses } = await assertSafeUrl(request.merchantUrl, {
      lookup: options.lookupImpl,
    });
    const info = await readCertificate(addresses[0], hostname, options.timeoutMs ?? TLS_TIMEOUT_MS);
    return [evaluateCertificate(info, hostname)];
  }
}
