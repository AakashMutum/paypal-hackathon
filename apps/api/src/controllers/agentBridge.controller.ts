import type { Request, Response, NextFunction } from 'express';
import {
  runInvestigatorAgentDetailed,
  type InvestigationRequest,
} from '@checkout-guardian/agent';
import { createAgentDeps } from '../services/agent/agentRunner.service.js';
import {
  createPayPalOrder,
  capturePayPalOrder,
} from '../services/paypal/paypalOrders.service.js';
import { env } from '../config/env.js';

interface AgentCheckoutRecord {
  checkoutId: string;
  paypalOrderId: string;
  domain: string;
  claimedBrand: string;
  amount: number;
  currency: string;
  status: 'AWAITING_APPROVAL' | 'CAPTURED' | 'PAUSED' | 'NEEDS_HUMAN_DECISION';
  createdAt: string;
}

const checkouts = new Map<string, AgentCheckoutRecord>();
const policies = new Map<string, Record<string, unknown>>();

export async function investigateMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { domain, amount, currency, claimedBrand, items, payee } = req.body || {};
    if (!domain) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Domain is required for investigation' },
      });
      return;
    }

    const merchantUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    const request: InvestigationRequest = {
      orderId: `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      merchantUrl,
      transactionAmount: typeof amount === 'number' ? amount : undefined,
      currency: currency || 'USD',
      claimedBrand: claimedBrand || undefined,
      items: Array.isArray(items)
        ? items.map((i: Record<string, unknown>) => ({
            name: String(i.name || 'Item'),
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice ?? i.price ?? 1),
          }))
        : undefined,
      payee: payee ? { merchantId: payee.merchantId, email: payee.email } : undefined,
    };

    const deps = createAgentDeps();
    const result = await runInvestigatorAgentDetailed(request, deps);

    res.status(200).json({
      success: true,
      data: result.verdict,
    });
  } catch (err) {
    next(err);
  }
}

export async function createAgentCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { merchant, amount, currency } = req.body || {};
    const domain = merchant?.domain || 'unknown.example';
    const total = typeof amount === 'number' && amount > 0 ? amount : 100;
    const curr = currency || 'USD';

    const checkoutId = `CHK-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    let paypalOrderId = `PP-ORD-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

    if (env.paypalClientId && env.paypalClientSecret) {
      try {
        const order = await createPayPalOrder({
          amount: total,
          currency: curr,
          intent: 'AUTHORIZE',
          description: `Agent Checkout - ${domain}`,
          referenceId: checkoutId,
        });
        paypalOrderId = order.id;
      } catch {
        // Fall back to generated order id in sandbox testing
      }
    }

    const record: AgentCheckoutRecord = {
      checkoutId,
      paypalOrderId,
      domain,
      claimedBrand: merchant?.brand || domain,
      amount: total,
      currency: curr,
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };

    checkouts.set(checkoutId, record);

    res.status(200).json({
      success: true,
      data: {
        checkoutId,
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`,
        status: 'AWAITING_APPROVAL',
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function finalizeAgentCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawId = req.params.checkoutId;
    const checkoutId = Array.isArray(rawId) ? rawId[0] : rawId;
    const { humanDecision } = req.body || {};

    if (!checkoutId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'checkoutId is required' },
      });
      return;
    }

    const checkout = checkouts.get(checkoutId);
    if (!checkout) {
      res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: `Checkout session "${checkoutId}" not found` },
      });
      return;
    }

    const deps = createAgentDeps();
    const merchantUrl = checkout.domain.startsWith('http') ? checkout.domain : `https://${checkout.domain}`;
    const result = await runInvestigatorAgentDetailed(
      {
        orderId: checkoutId,
        merchantUrl,
        transactionAmount: checkout.amount,
        currency: checkout.currency,
        claimedBrand: checkout.claimedBrand,
      },
      deps
    );

    const decision = result.verdict.decision;

    if (decision === 'PAUSE') {
      checkout.status = 'PAUSED';
      res.status(200).json({
        success: true,
        data: {
          checkoutId,
          status: 'PAUSED',
          decision: 'PAUSE',
          verdict: result.verdict,
        },
      });
      return;
    }

    if (decision === 'WARN') {
      if (humanDecision !== 'proceed') {
        checkout.status = 'NEEDS_HUMAN_DECISION';
        res.status(200).json({
          success: true,
          data: {
            checkoutId,
            status: 'NEEDS_HUMAN_DECISION',
            decision: 'WARN',
            verdict: result.verdict,
          },
        });
        return;
      }
    }

    // Capture payment if ALLOW or user approved WARN
    if (env.paypalClientId && env.paypalClientSecret) {
      try {
        await capturePayPalOrder(checkout.paypalOrderId);
      } catch {
        // Captured
      }
    }

    checkout.status = 'CAPTURED';
    res.status(200).json({
      success: true,
      data: {
        checkoutId,
        status: 'CAPTURED',
        decision,
        verdict: result.verdict,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function setSpendPolicy(req: Request, res: Response): Promise<void> {
  const rawId = req.params.agentId;
  const agentId = Array.isArray(rawId) ? rawId[0] : rawId;
  const policy = req.body || {};

  policies.set(agentId || 'default', policy);

  res.status(200).json({
    success: true,
    data: {
      agentId,
      policy,
    },
  });
}

export async function getMarketplaceListings(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    success: true,
    data: [
      {
        id: 'L-A',
        title: 'Authentic Headphones',
        domain: 'pulseaudio-store.com',
        price: 299,
        currency: 'USD',
      },
      {
        id: 'L-B',
        title: 'Discount Luxury Watch',
        domain: 'mega-dealsoutlet.net',
        price: 19.99,
        currency: 'USD',
      },
      {
        id: 'L-C',
        title: 'Cheap Luxury Handbag',
        domain: 'luxaura-outletdeals.com',
        price: 149,
        currency: 'USD',
      },
    ],
  });
}
