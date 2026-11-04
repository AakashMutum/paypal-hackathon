import Kernel from '@onkernel/sdk';
import { chromium } from 'playwright-core';
import { assertSafeUrl, UnsafeUrlError } from '../safety/url.js';
import { extractPageClaims } from './html.js';
import type { CallOpts, KernelClient, PageClaims } from './types.js';

// Only the parts of the Kernel SDK and Playwright that this client uses, so tests can inject fakes.
export interface KernelSession {
  session_id: string;
  cdp_ws_url: string;
}

export interface KernelSdkLike {
  browsers: {
    create(): Promise<KernelSession>;
    deleteByID(id: string): Promise<unknown>;
  };
}

export interface PageLike {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
}

export interface ContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
}

export interface BrowserLike {
  contexts(): ContextLike[];
  close(): Promise<void>;
}

export interface ChromiumLike {
  connectOverCDP(endpoint: string): Promise<BrowserLike>;
}

export interface KernelClientDeps {
  kernel?: KernelSdkLike;
  chromium?: ChromiumLike;
  /** DNS lookup used to reject private/reserved targets before and after navigation. */
  lookup?: (hostname: string) => Promise<string[]>;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Request aborted');
}

/** Rejects as soon as the signal aborts, without waiting for the underlying call. */
function raced<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function assertHttpUrl(input: string): void {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
}

/**
 * Loads a page in a Kernel remote browser and extracts the agent's page claims. One timeout
 * covers every step, the caller's signal is honoured at every step, and the browser and the
 * Kernel session are always cleaned up. The page text is untrusted data.
 */
export class KernelBrowserClient implements KernelClient {
  private readonly kernel: KernelSdkLike;
  private readonly chromium: ChromiumLike;
  private readonly lookup?: (hostname: string) => Promise<string[]>;

  constructor(apiKey: string, deps: KernelClientDeps = {}) {
    this.kernel = deps.kernel ?? (new Kernel({ apiKey }) as unknown as KernelSdkLike);
    this.chromium = deps.chromium ?? (chromium as unknown as ChromiumLike);
    this.lookup = deps.lookup;
  }

  /**
   * The remote browser must not be pointed at localhost, private, link-local or reserved
   * addresses. The initial URL is checked before a session exists; the final URL is checked
   * before any page content is returned. Kernel should also enforce its own egress policy.
   */
  private async validateUrl(input: string): Promise<string> {
    const safe = await assertSafeUrl(input, this.lookup ? { lookup: this.lookup } : {});
    if (safe.url.port && safe.url.port !== '80' && safe.url.port !== '443') {
      throw new UnsafeUrlError('Non-standard ports are not allowed for remote-browser navigation');
    }
    return safe.url.toString();
  }

  async getPageClaims(url: string, options: CallOpts): Promise<PageClaims> {
    const safeUrl = await this.validateUrl(url);
    if (options.signal?.aborted) throw abortReason(options.signal);

    const controller = new AbortController();
    const deadline = Date.now() + options.timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('Kernel page fetch timed out')), options.timeoutMs);
    const onCallerAbort = (): void => controller.abort(options.signal ? abortReason(options.signal) : undefined);
    if (options.signal?.aborted) onCallerAbort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const { signal } = controller;

    let session: KernelSession | undefined;
    let browser: BrowserLike | undefined;
    try {
      const creating = this.kernel.browsers.create();
      try {
        session = await raced(creating, signal);
      } catch (error) {
        // If creation finishes after we gave up, still delete the session it made.
        void creating.then((late) => this.kernel.browsers.deleteByID(late.session_id)).catch(() => undefined);
        throw error;
      }

      const connecting = this.chromium.connectOverCDP(session.cdp_ws_url);
      try {
        browser = await raced(connecting, signal);
      } catch (error) {
        void connecting.then((late) => late.close()).catch(() => undefined);
        throw error;
      }

      const context = browser.contexts()[0];
      if (!context) throw new Error('The remote browser has no context');
      const page = context.pages()[0] ?? (await raced(context.newPage(), signal));

      const remaining = Math.max(1, deadline - Date.now());
      await raced(page.goto(safeUrl, { waitUntil: 'domcontentloaded', timeout: remaining }), signal);
      const finalUrl = await this.validateUrl(page.url());
      const html = (await raced(page.content(), signal)).slice(0, 512 * 1024);
      return extractPageClaims(html, finalUrl);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
      if (browser) await browser.close().catch(() => undefined);
      if (session) await this.kernel.browsers.deleteByID(session.session_id).catch(() => undefined);
    }
  }
}
