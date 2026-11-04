import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { FrontendInvestigation } from '../investigation/investigation.types.js';

/**
 * Privacy controls for anything that leaves process memory.
 *
 * Two independent layers:
 *  1. Redaction always runs. Buyer identifiers and email-shaped strings are masked, and known
 *     sensitive keys are replaced. This keeps useful audit evidence while never persisting a
 *     raw buyer email.
 *  2. Encryption runs when AUDIT_ENCRYPTION_KEY is configured. The investigation JSON and the
 *     payment-event detail are sealed with AES-256-GCM before they reach PostgreSQL. Existing
 *     plaintext rows still read correctly, so the change is backwards compatible.
 *
 * AUDIT_ENCRYPTION_KEY_PREVIOUS supports key rotation. It is tried for decryption only, and only
 * when the current key cannot open a record. It is never used to encrypt. See docs/key-rotation.md.
 */

const ENCRYPTION_KEY_ENV = 'AUDIT_ENCRYPTION_KEY';
const PREVIOUS_KEY_ENV = 'AUDIT_ENCRYPTION_KEY_PREVIOUS';
const HMAC_KEY_ENV = 'AUDIT_HMAC_KEY';
const ENVELOPE_MARKER = '__trustoraAudit';
const ALGORITHM = 'aes-256-gcm';

export type AuditEncryptionStatus = 'enabled' | 'disabled' | 'invalid';

export interface SealedAuditPayload {
  [ENVELOPE_MARKER]: 1;
  alg: typeof ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

function parseKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function encryptionKey(): Buffer | null {
  return parseKey(process.env[ENCRYPTION_KEY_ENV]);
}

function previousKey(): Buffer | null {
  return parseKey(process.env[PREVIOUS_KEY_ENV]);
}

function hmacKey(): Buffer | null {
  const raw = process.env[HMAC_KEY_ENV]?.trim();
  if (!raw) return encryptionKey();
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'utf8');
}

/**
 * enabled: a valid current key, and the previous key (if any) is valid too.
 * disabled: no key at all.
 * invalid: a key is set but unusable, or a previous key is set without a valid current one.
 * Nothing about the key values is ever reported.
 */
export function auditEncryptionStatus(): AuditEncryptionStatus {
  const current = process.env[ENCRYPTION_KEY_ENV]?.trim();
  const previous = process.env[PREVIOUS_KEY_ENV]?.trim();
  if (!current) return previous ? 'invalid' : 'disabled';
  if (!encryptionKey()) return 'invalid';
  if (previous && !previousKey()) return 'invalid';
  return 'enabled';
}

export function auditEncryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isSealedAuditPayload(value: unknown): value is SealedAuditPayload {
  return (
    isRecord(value) &&
    value[ENVELOPE_MARKER] === 1 &&
    value.alg === ALGORITHM &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

/** Encrypts a JSON value when a key is configured; otherwise returns it unchanged. */
export function sealAuditPayload(value: unknown): unknown {
  const key = encryptionKey();
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value ?? null), 'utf8'),
    cipher.final(),
  ]);

  return {
    [ENVELOPE_MARKER]: 1,
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  } satisfies SealedAuditPayload;
}

function decryptWith(key: Buffer, value: SealedAuditPayload): unknown {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as unknown;
}

/** Which key opens a stored value. 'plaintext' rows predate encryption and need no key. */
export type AuditPayloadKey = 'plaintext' | 'current' | 'previous' | 'unreadable';

export function classifyAuditPayload(value: unknown): AuditPayloadKey {
  if (!isSealedAuditPayload(value)) return 'plaintext';
  const current = encryptionKey();
  if (current) {
    try {
      decryptWith(current, value);
      return 'current';
    } catch {
      // Fall through to the previous key.
    }
  }
  const previous = previousKey();
  if (previous) {
    try {
      decryptWith(previous, value);
      return 'previous';
    } catch {
      // Neither key opens it.
    }
  }
  return 'unreadable';
}

/**
 * Decrypts a sealed value. The current key is tried first; the previous key only when the current
 * one cannot open the record. Plaintext rows from before encryption are returned unchanged.
 */
export function openAuditPayload(value: unknown): unknown {
  if (!isSealedAuditPayload(value)) return value;

  const current = encryptionKey();
  const previous = previousKey();
  if (!current && !previous) {
    throw new Error(`An encrypted audit record cannot be read without ${ENCRYPTION_KEY_ENV}.`);
  }

  if (current) {
    try {
      return decryptWith(current, value);
    } catch (error) {
      if (!previous) throw error;
    }
  }
  if (previous) return decryptWith(previous, value);
  throw new Error(`An encrypted audit record cannot be read without ${ENCRYPTION_KEY_ENV}.`);
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function maskEmail(value: string): string {
  const email = value.trim();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '[redacted]';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

function maskEmailsInText(value: string): string {
  return value.replace(EMAIL_PATTERN, (email) => maskEmail(email));
}

const SENSITIVE_KEYS = new Set([
  'buyeremail',
  'customeremail',
  'expectedpayeeemail',
  'payeeemail',
  'email',
  'phone',
  'phonenumber',
  'phonenumbers',
  'shippingaddress',
  'billingaddress',
  'cardnumber',
  'cardnumbers',
  'cvv',
  'cvc',
  'ssn',
  'password',
  'secret',
  'accesstoken',
  'refreshtoken',
]);

/**
 * Deep-copies a persisted value while masking email-shaped strings and replacing known
 * sensitive keys. It is intentionally conservative: audit evidence, domains, evidence ids,
 * amounts and decisions are preserved.
 */
export function redactAuditValue(value: unknown, parentKey = ''): unknown {
  if (typeof value === 'string') return maskEmailsInText(value);
  if (Array.isArray(value)) return value.map((entry) => redactAuditValue(entry, parentKey));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = typeof entry === 'string' && entry.includes('@')
        ? maskEmail(entry)
        : '[redacted]';
      continue;
    }
    out[key] = redactAuditValue(entry, lower);
  }
  return out;
}

export function redactInvestigationForStorage(inv: FrontendInvestigation): FrontendInvestigation {
  return redactAuditValue(inv) as FrontendInvestigation;
}

export function redactAuditDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  return (detail ? redactAuditValue(detail) : {}) as Record<string, unknown>;
}

/**
 * Stores only a one-way fingerprint of the expected payee email. The PayPal approval path can
 * compare the observed payee email against it without keeping the address itself in the database.
 * A configured HMAC key is used when available; otherwise a plain SHA-256 fingerprint is used.
 */
export function hashPayeeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const key = hmacKey();
  if (key) return `hmac-sha256:${createHmac('sha256', key).update(normalized).digest('hex')}`;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}
