import type { CreateOrderRequest, CaptureOrderRequest } from '@checkout-guardian/contracts';
import { OrchestrationError } from '../services/orders/orderOrchestration.service.js';

export function validateCreateOrderInput(body: unknown): CreateOrderRequest {
  if (!body || typeof body !== 'object') {
    throw new OrchestrationError('Request body must be a JSON object', 'INVALID_REQUEST_BODY', 400);
  }

  const {
    storefrontUrl,
    amount,
    currency,
    merchantId,
    claimedMerchantName,
    payeeEmail,
    orderItems,
    buyerReference,
    metadata,
  } = body as Record<string, unknown>;

  if (!storefrontUrl || typeof storefrontUrl !== 'string' || !storefrontUrl.trim()) {
    throw new OrchestrationError('storefrontUrl is required and must be a valid URL', 'VALIDATION_ERROR', 400);
  }

  try {
    const parsed = new URL(storefrontUrl.startsWith('http') ? storefrontUrl : `https://${storefrontUrl}`);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      throw new Error('Invalid host');
    }
  } catch {
    throw new OrchestrationError('storefrontUrl must be a valid website URL with domain', 'VALIDATION_ERROR', 400);
  }

  const parsedAmount = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new OrchestrationError('amount is required and must be a positive number greater than zero', 'VALIDATION_ERROR', 400);
  }

  let finalCurrency = 'USD';
  if (currency !== undefined) {
    if (typeof currency !== 'string' || currency.trim().length !== 3) {
      throw new OrchestrationError('currency must be a 3-letter ISO code (e.g. USD)', 'VALIDATION_ERROR', 400);
    }
    finalCurrency = currency.trim().toUpperCase();
  }

  if (payeeEmail !== undefined && payeeEmail !== null) {
    if (typeof payeeEmail !== 'string' || !payeeEmail.includes('@') || !payeeEmail.includes('.')) {
      throw new OrchestrationError('payeeEmail must be a valid email address format', 'VALIDATION_ERROR', 400);
    }
  }

  return {
    storefrontUrl: storefrontUrl.trim(),
    amount: parsedAmount,
    currency: finalCurrency,
    merchantId: typeof merchantId === 'string' ? merchantId.trim() : undefined,
    claimedMerchantName: typeof claimedMerchantName === 'string' ? claimedMerchantName.trim() : undefined,
    payeeEmail: typeof payeeEmail === 'string' ? payeeEmail.trim().toLowerCase() : undefined,
    orderItems: Array.isArray(orderItems) ? orderItems : undefined,
    buyerReference: typeof buyerReference === 'string' ? buyerReference.trim() : undefined,
    metadata: metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : undefined,
  };
}

export function validateCaptureOrderInput(body: unknown): CaptureOrderRequest {
  if (!body || typeof body !== 'object') {
    return { userAcknowledged: false };
  }

  const { userAcknowledged, overrideReason } = body as Record<string, unknown>;

  return {
    userAcknowledged: Boolean(userAcknowledged),
    overrideReason: typeof overrideReason === 'string' ? overrideReason.trim() : undefined,
  };
}

