import type { Request, Response, NextFunction } from 'express';
import {
  successResponse,
  errorResponse,
  type CreateOrderResponse,
  type CaptureOrderResponse,
  type OrderDecisionResponse,
} from '@checkout-guardian/contracts';
import { validateCreateOrderInput, validateCaptureOrderInput } from '../validators/order.validator.js';
import {
  createCheckoutOrder,
  captureCheckoutOrder,
  evaluateOrderRisk,
  findCheckoutSession,
  OrchestrationError,
} from '../services/orders/orderOrchestration.service.js';
import { getPayPalOrder, PayPalOrderError } from '../services/paypal/paypalOrders.service.js';

export async function createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validatedInput = validateCreateOrderInput(req.body);
    const result: CreateOrderResponse = await createCheckoutOrder(validatedInput);

    res.status(201).json(
      successResponse(result, {
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    if (error instanceof OrchestrationError) {
      res.status(error.status).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    if (error instanceof PayPalOrderError) {
      res.status(error.status || 502).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    next(error);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawOrderId = req.params.orderId;
    const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId;
    if (!orderId) {
      res.status(400).json(errorResponse('VALIDATION_ERROR', 'orderId parameter is required'));
      return;
    }

    const session = await findCheckoutSession(orderId);
    const paypalOrderId = session?.paypal_order_id || orderId;

    let paypalOrder;
    try {
      paypalOrder = await getPayPalOrder(paypalOrderId);
    } catch (paypalErr) {
      if (paypalErr instanceof PayPalOrderError && paypalErr.code === 'ORDER_NOT_FOUND' && !session) {
        res.status(404).json(errorResponse('ORDER_NOT_FOUND', `Order "${orderId}" was not found`));
        return;
      }
      throw paypalErr;
    }

    res.status(200).json(
      successResponse(
        {
          orderId: paypalOrder.id,
          sessionId: session?.id,
          status: paypalOrder.status,
          sessionStatus: session?.status,
          amount: paypalOrder.purchase_units?.[0]?.amount?.value,
          currency: paypalOrder.purchase_units?.[0]?.amount?.currency_code,
          storefrontDomain: session?.domain,
          payee: paypalOrder.purchase_units?.[0]?.payee,
          createTime: paypalOrder.create_time,
          links: paypalOrder.links,
        },
        { timestamp: new Date().toISOString() }
      )
    );
  } catch (error) {
    if (error instanceof PayPalOrderError) {
      res.status(error.status || 502).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    if (error instanceof OrchestrationError) {
      res.status(error.status).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    next(error);
  }
}

export async function getOrderDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawOrderId = req.params.orderId;
    const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId;
    if (!orderId) {
      res.status(400).json(errorResponse('VALIDATION_ERROR', 'orderId parameter is required'));
      return;
    }

    const decisionReport: OrderDecisionResponse = await evaluateOrderRisk(orderId);
    res.status(200).json(
      successResponse(decisionReport, {
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    if (error instanceof PayPalOrderError) {
      res.status(error.status || 502).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    if (error instanceof OrchestrationError) {
      res.status(error.status).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    next(error);
  }
}

export async function captureOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawOrderId = req.params.orderId;
    const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId;
    if (!orderId) {
      res.status(400).json(errorResponse('VALIDATION_ERROR', 'orderId parameter is required'));
      return;
    }

    const captureOptions = validateCaptureOrderInput(req.body);
    const result: CaptureOrderResponse = await captureCheckoutOrder(orderId, captureOptions);

    res.status(200).json(
      successResponse(result, {
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    if (error instanceof OrchestrationError) {
      res.status(error.status).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    if (error instanceof PayPalOrderError) {
      res.status(error.status || 502).json(errorResponse(error.code, error.message, error.details));
      return;
    }
    next(error);
  }
}
