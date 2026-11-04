// Pure checks used by scripts/smoke-deploy.mjs. No network, so they can be tested on their own.

export const REQUIRED_MODES = ['paypal', 'store', 'signals', 'llm', 'memory'];

/** Returns the problems with the modes /health reported. An empty list means all are present. */
export function checkModes(modes) {
  if (!modes || typeof modes !== 'object') return ['/health did not report modes'];
  const missing = REQUIRED_MODES.filter((key) => typeof modes[key] !== 'string' || modes[key] === '');
  return missing.length ? [`/health modes are missing: ${missing.join(', ')}`] : [];
}

/**
 * With REQUIRE_AUDIT_ENCRYPTION=true, /health must say auditEncryption is "enabled". The message
 * never includes any key value; /health does not carry one.
 */
export function checkAuditEncryption(modes, required) {
  const status = modes && typeof modes === 'object' ? modes.auditEncryption : undefined;
  if (!required) return { problem: undefined, status };
  if (status === 'enabled') return { problem: undefined, status };
  const shown = status === undefined ? 'not reported' : `"${String(status)}"`;
  return {
    problem:
      `REQUIRE_AUDIT_ENCRYPTION=true but /health reports auditEncryption ${shown}. ` +
      'Set AUDIT_ENCRYPTION_KEY (64 hex characters) on the API and redeploy; see docs/key-rotation.md.',
    status,
  };
}

/** Whole days from now until a certificate's valid_to date, or null when it cannot be read. */
export function daysUntil(validTo, now = Date.now()) {
  const time = Date.parse(validTo);
  if (!Number.isFinite(time)) return null;
  return Math.floor((time - now) / 86400000);
}

/** One line describing what the TLS connection negotiated. Reports only; it asserts nothing. */
export function describeTls(info) {
  if (!info) return 'TLS: not checked (the URL is not https)';
  if (info.error) return `TLS: could not be read (${info.error})`;
  const days = daysUntil(info.validTo);
  const expiry = info.validTo
    ? `certificate expires ${new Date(info.validTo).toISOString().slice(0, 10)}${days === null ? '' : ` (${days} days)`}`
    : 'certificate expiry not available';
  const trust = info.authorized ? 'trusted' : `NOT trusted${info.authorizationError ? `: ${info.authorizationError}` : ''}`;
  return `TLS: negotiated ${info.protocol ?? 'unknown'}, ${expiry}, ${trust}`;
}
