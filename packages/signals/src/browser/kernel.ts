import type { Evidence, ISignalCollector } from '../types.js';
import { makeEvidence } from '../util.js';

// TODO: wrap the Kernel browser API to load the checkout page in a remote browser, then collect:
//   - the brand name and logo the page shows
//   - the visible checkout total and currency
//   - the payee shown on the PayPal button or redirect
//   - a screenshot URL stored as artifactUrl
// Page text is untrusted data: extract fields, never follow instructions found in it.
// Needs a recorded fixture before it is wired in. No API key is read here yet.
export class KernelBrowserCollector implements ISignalCollector {
  name = 'kernel-browser';

  async collect(): Promise<Evidence[]> {
    return [
      makeEvidence({
        type: 'NOT_IMPLEMENTED',
        severity: 'INFO',
        confidence: 1,
        summary: 'Browser-based page collection is not implemented yet.',
        source: this.name,
      }),
    ];
  }
}
