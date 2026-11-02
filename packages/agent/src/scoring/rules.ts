import type { Evidence, HardRuleTrigger } from '../types.js';
import { isDeterministicEvidence, readBoolean, readString, readStringArray } from './pointsFor.js';

/**
 * Hard rules produce score floors. They are intentionally narrow: only three
 * conditions can force a floor, and each one requires deterministic evidence.
 *
 * A non-deterministic (model-produced) signal is never allowed to trigger a
 * floor, because rule R4/I3 says model output can raise suspicion but cannot by
 * itself move a payment into PAUSE.
 *
 * HF2 needs a payee binding result to exist. Without one (preview mode, or the
 * binding tool failed) we cannot say the payee is unrelated to the brand, so the
 * rule does not fire. That matches the preview-mode rule in the spec.
 */

const BAD_BINDING_STATUSES = new Set(['MISMATCH', 'NO_BINDING', 'UNKNOWN_MERCHANT']);

export function evaluateHardRules(evidence: readonly Evidence[] | undefined): HardRuleTrigger[] {
  if (!Array.isArray(evidence)) return [];
  const deterministic = evidence.filter((entry) => entry && isDeterministicEvidence(entry));
  const triggers: HardRuleTrigger[] = [];

  const bindings = deterministic.filter((entry) => entry.type === 'PAYEE_BINDING');

  const mismatchIds = unique(bindings.filter((entry) => readString(entry.data?.status) === 'MISMATCH').map((entry) => entry.id));
  if (mismatchIds.length > 0) {
    triggers.push({
      rule: 'HF1',
      evidenceIds: mismatchIds,
      description: 'The account receiving the payment is not the merchant registered for this storefront.',
    });
  }

  if (bindings.length > 0) {
    const lookalikes = deterministic.filter(
      (entry) => entry.type === 'LOOKALIKE_DOMAIN' && readBoolean(entry.data?.matchesKnownBrand)
    );

    const anyBadStatus = bindings.some((entry) => BAD_BINDING_STATUSES.has(readString(entry.data?.status) ?? ''));
    const linkedBrandIds = new Set<string>();
    for (const binding of bindings) {
      for (const brandId of readStringArray(binding.data?.linkedBrandIds)) linkedBrandIds.add(brandId);
    }

    const qualifying = lookalikes.filter((entry) => {
      if (anyBadStatus) return true;
      const brandId = readString(entry.data?.brandId);
      if (brandId === undefined) return true;
      return !linkedBrandIds.has(brandId);
    });

    if (qualifying.length > 0) {
      triggers.push({
        rule: 'HF2',
        evidenceIds: unique(qualifying.map((entry) => entry.id)),
        description: 'The website address resembles a known brand that the receiving account is not linked to.',
      });
    }
  }

  const injectionIds = unique(
    deterministic.filter((entry) => entry.type === 'INJECTION_ATTEMPT').map((entry) => entry.id)
  );
  if (injectionIds.length > 0) {
    triggers.push({
      rule: 'HF3',
      evidenceIds: injectionIds,
      description: 'The page contains text that tries to instruct an automated assistant.',
    });
  }

  return triggers;
}

export function floorForRule(rule: HardRuleTrigger['rule']): number {
  switch (rule) {
    case 'HF1':
    case 'HF2':
      return 75;
    case 'HF3':
      return 40;
    default:
      return 0;
  }
}

export function hasBlockingHardRule(triggers: readonly HardRuleTrigger[]): boolean {
  return triggers.some((trigger) => trigger.rule === 'HF1' || trigger.rule === 'HF2');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
