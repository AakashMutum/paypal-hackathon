import { Router, type Router as ExpressRouter } from 'express';
import {
  investigateMerchant,
  createAgentCheckout,
  finalizeAgentCheckout,
  setSpendPolicy,
  getMarketplaceListings,
} from '../controllers/agentBridge.controller.js';

import { requireGuardianKey } from '../middleware/auth.js';

export const agentBridgeRouter: ExpressRouter = Router();

// Every agent route requires the bearer token when GUARDIAN_API_KEY is set.
agentBridgeRouter.use(requireGuardianKey);

agentBridgeRouter.post('/investigations', investigateMerchant);
agentBridgeRouter.post('/checkout/orders', createAgentCheckout);
agentBridgeRouter.post('/checkout/orders/:checkoutId/finalize', finalizeAgentCheckout);
agentBridgeRouter.put('/policies/:agentId', setSpendPolicy);
agentBridgeRouter.get('/demo/marketplace', getMarketplaceListings);
