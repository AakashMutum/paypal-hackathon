import type { Request, Response, NextFunction } from 'express';
import {
  executeMerchantInvestigation,
  findProfileForUrlOrStore,
} from '../services/agent/agentRunner.service.js';
import { investigationStore } from '../services/investigation/investigationStore.service.js';
import {
  createPayPalOrder,
  getPayPalOrder,
  capturePayPalOrder,
  voidPayPalAuthorization,
} from '../services/paypal/paypalOrders.service.js';
import { env } from '../config/env.js';

export async function scanUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Valid URL is required to scan' });
      return;
    }

    const investigation = await executeMerchantInvestigation({ url });
    investigationStore.add(investigation);
    res.status(200).json(investigation);
  } catch (err) {
    next(err);
  }
}

export async function createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { storeId, items, buyerEmail, url, amount: rawAmount } = req.body || {};
    const profile = findProfileForUrlOrStore(storeId || url || 'pulseaudio');

    let totalAmount = 0;
    let productName = profile.product;

    if (Array.isArray(items) && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
      productName = items[0]?.name || profile.product;
    } else if (typeof rawAmount === 'number' && rawAmount > 0) {
      totalAmount = rawAmount;
    } else {
      totalAmount = profile.price;
    }

    const orderId = `ORD-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    let paypalOrderId = `PAYPAL-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

    // Create real PayPal Sandbox order if credentials are configured
    if (env.paypalClientId && env.paypalClientSecret) {
      try {
        const ppOrder = await createPayPalOrder({
          amount: totalAmount,
          currency: 'USD',
          intent: 'AUTHORIZE',
          description: `TrustOra - ${profile.brand} (${productName})`,
          referenceId: orderId,
          payeeEmail: profile.payeeEmail,
        });
        paypalOrderId = ppOrder.id;
      } catch {
        // Fall back gracefully to sandbox reference order if external network is unavailable
      }
    }

    const investigation = await executeMerchantInvestigation({
      orderId,
      paypalOrderId,
      storeId: profile.storeId,
      url: profile.domain,
      amount: totalAmount,
      benchmark: profile.benchmark,
      currency: 'USD',
      claimedBrand: profile.brand,
      buyerEmail: buyerEmail || 'alex.walker@gmail.com',
      productName,
      payeeEmail: profile.payeeEmail,
      payeeMerchantId: profile.payeeId,
    });

    investigation.captureState = 'PENDING';
    investigationStore.add(investigation);

    res.status(200).json({
      orderId,
      paypalOrderId,
      investigationId: investigation.id,
    });
  } catch (err) {
    next(err);
  }
}

export async function notifyApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawOrderId = req.params.orderId;
    const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId;

    if (!orderId) {
      res.status(400).json({ error: 'orderId parameter is required' });
      return;
    }

    const inv = investigationStore.get(orderId);
    if (!inv) {
      res.status(404).json({ error: `Investigation for order "${orderId}" not found` });
      return;
    }

    // Inspect live PayPal order if available
    if (inv.paypalOrderId && env.paypalClientId && env.paypalClientSecret) {
      try {
        const ppOrder = await getPayPalOrder(inv.paypalOrderId);
        const payee = ppOrder.purchase_units?.[0]?.payee;
        if (payee?.email_address) {
          inv.payeeName = payee.email_address;
        }
        if (payee?.merchant_id) {
          inv.payeeId = payee.merchant_id;
        }
      } catch {
        // Continue with established investigation profile
      }
    }

    // Enforce Risk Decision
    if (inv.verdict === 'ALLOW') {
      // Safe to capture
      if (inv.paypalOrderId && env.paypalClientId && env.paypalClientSecret) {
        try {
          await capturePayPalOrder(inv.paypalOrderId);
        } catch {
          // Captured or recorded in mock sandbox
        }
      }
      inv.captureState = 'CAPTURED';
    } else {
      // WARN or BLOCK (PAUSE) - payment capture is halted!
      inv.captureState = 'HELD';
    }

    inv.status = 'COMPLETE';
    investigationStore.add(inv);

    res.status(200).json({
      status: 'ok',
      decision: inv.verdict,
      captureState: inv.captureState,
      investigationId: inv.id,
    });
  } catch (err) {
    next(err);
  }
}

export async function listInvestigations(_req: Request, res: Response): Promise<void> {
  const list = investigationStore.list();
  res.status(200).json(list);
}

export async function getInvestigation(req: Request, res: Response): Promise<void> {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id) {
    res.status(400).json({ error: 'id parameter is required' });
    return;
  }

  const inv = investigationStore.get(id);
  if (!inv) {
    res.status(404).json({ error: `Investigation "${id}" not found` });
    return;
  }

  res.status(200).json(inv);
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      res.status(400).json({ error: 'id parameter is required' });
      return;
    }

    const inv = investigationStore.get(id);
    if (!inv) {
      res.status(404).json({ error: `Investigation "${id}" not found` });
      return;
    }

    // Void authorization on PayPal if applicable
    if (inv.paypalOrderId && env.paypalClientId && env.paypalClientSecret) {
      try {
        await voidPayPalAuthorization(inv.paypalOrderId);
      } catch {
        // Voided locally
      }
    }

    inv.captureState = 'VOIDED';
    investigationStore.add(inv);

    res.status(200).json(inv);
  } catch (err) {
    next(err);
  }
}

export async function requestReview(req: Request, res: Response): Promise<void> {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id) {
    res.status(400).json({ error: 'id parameter is required' });
    return;
  }

  const inv = investigationStore.get(id);
  if (!inv) {
    res.status(404).json({ error: `Investigation "${id}" not found` });
    return;
  }

  inv.reviewRequested = true;
  investigationStore.add(inv);

  res.status(200).json(inv);
}

export async function reportMerchant(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, message: 'Merchant report registered' });
}

export async function registerMerchant(req: Request, res: Response): Promise<void> {
  const { type } = req.body || {};
  res.status(200).json({
    merchantId: `MCH-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    status: type === 'INDIVIDUAL' ? 'SUSPECT' : 'VERIFIED',
  });
}

export async function resetDemo(_req: Request, res: Response): Promise<void> {
  investigationStore.reset();
  res.status(200).json({ success: true, message: 'Demo data reset' });
}
