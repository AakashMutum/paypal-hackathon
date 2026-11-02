
import Kernel from '@onkernel/sdk';
import { chromium } from 'playwright';
import type { CallOpts, KernelClient } from './types.js';
import { extractPageClaims } from './html.js';

export class KernelBrowserClient implements KernelClient {
  private kernel: Kernel;

  constructor(apiKey: string) {
    this.kernel = new Kernel({ apiKey });
  }

  async getPageClaims(url: string, options: CallOpts) {
    if (options.signal?.aborted) {
      throw new Error('Request aborted');
    }

    const session = await this.kernel.browsers.create();
    let browser;

    try {
      browser = await chromium.connectOverCDP(session.cdp_ws_url);

      const context = browser.contexts()[0];
      const page = context.pages()[0] ?? await context.newPage();

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
      });

      if (options.signal?.aborted) {
        throw new Error('Request aborted');
      }

      const html = await page.content();
      const finalUrl = page.url();

      return extractPageClaims(html, finalUrl);
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }

      await this.kernel.browsers.deleteByID(session.session_id)
        .catch(() => undefined);
    }
  }
}
