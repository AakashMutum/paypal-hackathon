import { Router, type Router as ExpressRouter } from 'express';
import {
  scanUrl,
  createOrder,
  notifyApproval,
  listInvestigations,
  getInvestigation,
  cancelOrder,
  requestReview,
  reportMerchant,
  registerMerchant,
  resetDemo,
} from '../controllers/frontendApi.controller.js';

export const frontendApiRouter: ExpressRouter = Router();

frontendApiRouter.post('/scan', scanUrl);
frontendApiRouter.post('/orders', createOrder);
frontendApiRouter.post('/orders/:orderId/approved', notifyApproval);
frontendApiRouter.get('/investigations', listInvestigations);
frontendApiRouter.get('/investigations/:id', getInvestigation);
frontendApiRouter.post('/orders/:id/cancel', cancelOrder);
frontendApiRouter.post('/orders/:id/review', requestReview);
frontendApiRouter.post('/reports', reportMerchant);
frontendApiRouter.post('/merchants', registerMerchant);
frontendApiRouter.post('/demo/reset', resetDemo);
