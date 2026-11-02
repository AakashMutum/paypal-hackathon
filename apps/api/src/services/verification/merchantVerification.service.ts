import type { MerchantVerificationSummary } from '@TRUSTORA/contracts';
import type { PayPalOrderResponse, PayPalPayee } from '../paypal/paypalOrders.service.js';

export interface ExpectedMerchant {
  id?: string;
  merchant_id?: string | null;
  domain: string;
  claimed_name: string;
  payee_email?: string | null;
  verification_status?: string;
  reputation_score?: number | string;
}

export interface VerificationResult {
  isMatch: boolean;
  matchStatus: 'MATCH' | 'MISMATCH' | 'MISSING_PAYEE' | 'UNVERIFIED_MERCHANT';
  merchantConsistencyScore: number; // 0.00 (lowest risk) to 100.00 (highest risk)
  evidence: {
    expectedMerchantId?: string;
    expectedPayeeEmail?: string;
    expectedClaimedName?: string;
    expectedDomain?: string;
    observedMerchantId?: string;
    observedPayeeEmail?: string;
    reasons: string[];
  };
  summary: MerchantVerificationSummary;
}

/**
 * Compares observed PayPal order payee information against the expected merchant identity.
 * Evaluates identity consistency, flags anomalies, and determines the Merchant Consistency risk component.
 */
export function verifyMerchantIdentity(
  order: PayPalOrderResponse,
  expectedMerchant: ExpectedMerchant | null | undefined
): VerificationResult {
  const purchaseUnit = order.purchase_units?.[0];
  const observedPayee: PayPalPayee | undefined = purchaseUnit?.payee;
  const reasons: string[] = [];

  const observedMerchantId = observedPayee?.merchant_id?.trim();
  const observedPayeeEmail = observedPayee?.email_address?.trim().toLowerCase();

  // Case 1: Missing payee in PayPal order
  if (!observedMerchantId && !observedPayeeEmail) {
    reasons.push('PayPal order does not provide payee or merchant identification details');
    return {
      isMatch: false,
      matchStatus: 'MISSING_PAYEE',
      merchantConsistencyScore: 85.00,
      evidence: {
        expectedClaimedName: expectedMerchant?.claimed_name,
        expectedDomain: expectedMerchant?.domain,
        expectedMerchantId: expectedMerchant?.merchant_id || undefined,
        expectedPayeeEmail: expectedMerchant?.payee_email || undefined,
        reasons,
      },
      summary: {
        isMatch: false,
        matchStatus: 'MISSING_PAYEE',
        expectedMerchantId: expectedMerchant?.merchant_id || undefined,
        expectedPayeeEmail: expectedMerchant?.payee_email || undefined,
        expectedClaimedName: expectedMerchant?.claimed_name,
        observedMerchantId: undefined,
        observedPayeeEmail: undefined,
        reasons,
      },
    };
  }

  // Case 2: Storefront has no expected merchant record
  if (!expectedMerchant) {
    reasons.push('Storefront domain has no registered merchant identity in TRUSTORA');
    return {
      isMatch: false,
      matchStatus: 'UNVERIFIED_MERCHANT',
      merchantConsistencyScore: 80.00,
      evidence: {
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
      summary: {
        isMatch: false,
        matchStatus: 'UNVERIFIED_MERCHANT',
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
    };
  }

  const expectedMerchantId = expectedMerchant.merchant_id?.trim();
  const expectedPayeeEmail = expectedMerchant.payee_email?.trim().toLowerCase();
  const verificationStatus = expectedMerchant.verification_status || 'UNVERIFIED';

  // Flag confirmed fraud immediately
  if (verificationStatus === 'CONFIRMED_FRAUD') {
    reasons.push('Merchant identity is marked as CONFIRMED_FRAUD in TRUSTORA records');
    return {
      isMatch: false,
      matchStatus: 'MISMATCH',
      merchantConsistencyScore: 100.00,
      evidence: {
        expectedClaimedName: expectedMerchant.claimed_name,
        expectedDomain: expectedMerchant.domain,
        expectedMerchantId,
        expectedPayeeEmail,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
      summary: {
        isMatch: false,
        matchStatus: 'MISMATCH',
        expectedMerchantId,
        expectedPayeeEmail,
        expectedClaimedName: expectedMerchant.claimed_name,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
    };
  }

  // Cross-reference checking
  let merchantIdMatched = false;
  let emailMatched = false;
  let mismatchFound = false;

  if (expectedMerchantId && observedMerchantId) {
    if (expectedMerchantId === observedMerchantId) {
      merchantIdMatched = true;
    } else {
      mismatchFound = true;
      reasons.push(
        `Observed PayPal merchant ID "${observedMerchantId}" does not match registered merchant ID "${expectedMerchantId}"`
      );
    }
  }

  if (expectedPayeeEmail && observedPayeeEmail) {
    if (expectedPayeeEmail === observedPayeeEmail) {
      emailMatched = true;
    } else {
      mismatchFound = true;
      reasons.push(
        `Observed PayPal payee email "${observedPayeeEmail}" does not match registered merchant email "${expectedPayeeEmail}"`
      );
    }
  }

  // If a direct mismatch was detected
  if (mismatchFound) {
    return {
      isMatch: false,
      matchStatus: 'MISMATCH',
      merchantConsistencyScore: 100.00,
      evidence: {
        expectedClaimedName: expectedMerchant.claimed_name,
        expectedDomain: expectedMerchant.domain,
        expectedMerchantId,
        expectedPayeeEmail,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
      summary: {
        isMatch: false,
        matchStatus: 'MISMATCH',
        expectedMerchantId,
        expectedPayeeEmail,
        expectedClaimedName: expectedMerchant.claimed_name,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
    };
  }

  // If at least one identifier matched and no mismatch occurred
  if (merchantIdMatched || emailMatched) {
    let score = 0.00;
    if (verificationStatus === 'FLAGGED_SUSPICIOUS') {
      score = 45.00;
      reasons.push('Payee matches registered record, but merchant is flagged for past suspicious activity');
    } else {
      reasons.push('PayPal payee identity matches verified merchant record');
    }

    return {
      isMatch: true,
      matchStatus: 'MATCH',
      merchantConsistencyScore: score,
      evidence: {
        expectedClaimedName: expectedMerchant.claimed_name,
        expectedDomain: expectedMerchant.domain,
        expectedMerchantId,
        expectedPayeeEmail,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
      summary: {
        isMatch: true,
        matchStatus: 'MATCH',
        expectedMerchantId,
        expectedPayeeEmail,
        expectedClaimedName: expectedMerchant.claimed_name,
        observedMerchantId,
        observedPayeeEmail,
        reasons,
      },
    };
  }

  // Neither identifier was available on expected record to cross-reference
  reasons.push('Merchant registered without verified payee credentials; identity cannot be conclusively verified');
  return {
    isMatch: false,
    matchStatus: 'UNVERIFIED_MERCHANT',
    merchantConsistencyScore: 80.00,
    evidence: {
      expectedClaimedName: expectedMerchant.claimed_name,
      expectedDomain: expectedMerchant.domain,
      observedMerchantId,
      observedPayeeEmail,
      reasons,
    },
    summary: {
      isMatch: false,
      matchStatus: 'UNVERIFIED_MERCHANT',
      expectedClaimedName: expectedMerchant.claimed_name,
      observedMerchantId,
      observedPayeeEmail,
      reasons,
    },
  };
}
