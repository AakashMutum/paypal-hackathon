import { Router, type Router as ExpressRouter } from 'express';
import {
  createOrder,
  getOrder,
  getOrderDecision,
  captureOrder,
} from '../controllers/order.controller.js';

export const orderRouter: ExpressRouter = Router();

orderRouter.post('/', createOrder);
orderRouter.get('/:orderId', getOrder);
orderRouter.get('/:orderId/decision', getOrderDecision);
orderRouter.post('/:orderId/capture', captureOrder);

