import { Router, type Router as ExpressRouter } from 'express';
import {
  investigateMerchant,
  createAgentCheckout,
  finalizeAgentCheckout,
  setSpendPolicy,
  getMarketplaceListings,
} from '../controllers/agentBridge.controller.js';

export const agentBridgeRouter: ExpressRouter = Router();

agentBridgeRouter.post('/investigations', investigateMerchant);
agentBridgeRouter.post('/checkout/orders', createAgentCheckout);
agentBridgeRouter.post('/checkout/orders/:checkoutId/finalize', finalizeAgentCheckout);
agentBridgeRouter.put('/policies/:agentId', setSpendPolicy);
agentBridgeRouter.get('/demo/marketplace', getMarketplaceListings);
