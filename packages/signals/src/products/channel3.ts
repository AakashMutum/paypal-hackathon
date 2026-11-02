import type { Evidence, ISignalCollector } from '../types.js';
import { makeEvidence } from '../util.js';

// TODO: look up each order item in the Channel3 product catalogue and emit evidence for:
//   - the typical market price range for the item
//   - how far the order price is below that range
//   - whether the claimed brand sells this product at all
// Needs a recorded fixture before it is wired in. No API key is read here yet.
export class Channel3ProductCollector implements ISignalCollector {
  name = 'channel3-products';

  async collect(): Promise<Evidence[]> {
    return [
      makeEvidence({
        type: 'NOT_IMPLEMENTED',
        severity: 'INFO',
        confidence: 1,
        summary: 'Product price lookup is not implemented yet.',
        source: this.name,
      }),
    ];
  }
}
