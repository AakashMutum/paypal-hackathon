import { z } from 'zod';

import {
  listingById,
  type GuardianVerdictFixture,
  type Listing,
  type MarketplaceResult,
  type ScenarioFixture,
} from './marketplace.js';
import { buildShopperUser, DEMO_SHOPPER_SYSTEM } from './prompts.js';

export type GuardianDecision = 'ALLOW' | 'WARN' | 'PAUSE';

export interface GuardianVerdict {
  decision: GuardianDecision;
  score: number;
  summary?: string;
}

export interface CheckoutHandle {
  checkoutId: string;
  status: string;
  approvalUrl?: string;
}

export interface CheckoutResult {
  status: string;
  captureId?: string;
  verdict?: GuardianVerdict;
}

export interface GuardianClient {
  investigate(listing: Listing): Promise<GuardianVerdict>;
  startCheckout(listing: Listing): Promise<CheckoutHandle>;
  finalizeCheckout(
    checkoutId: string,
    options: { humanDecision: 'proceed' | 'abort'; approvedByHuman: boolean }
  ): Promise<CheckoutResult>;
}

export interface UnguardedPayResult {
  status: 'COMPLETED' | 'SIMULATED';
  reference?: string;
}

export interface UnguardedPayClient {
  pay(listing: Listing): Promise<UnguardedPayResult>;
}

export interface DemoModelInput {
  goal: string;
  budget: number;
  currency: string;
  guardian: 'on' | 'off';
  listings: Listing[];
  marketContext: {
    medianPrice: number;
    offerCount: number;
    currency: string;
  };
  history: Array<{
    step: number;
    action: string;
    accepted: boolean;
    code?: string;
    listingId?: string;
    status?: string;
  }>;
  step: number;
}

export interface DemoModel {
  next(input: DemoModelInput): Promise<unknown>;
}

const WhySchema = z.string().max(160).optional();

export const DemoActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(200),
    maxPrice: z.number().positive().max(1_000_000).optional(),
    why: WhySchema,
  }),
  z.object({
    action: z.literal('investigate'),
    listingId: z.string().min(1).max(128),
    why: WhySchema,
  }),
  z.object({
    action: z.literal('start_checkout'),
    listingId: z.string().min(1).max(128),
    why: WhySchema,
  }),
  z.object({
    action: z.literal('finalize_checkout'),
    checkoutId: z.string().min(1).max(128).optional(),
    listingId: z.string().min(1).max(128).optional(),
    why: WhySchema,
  }),
  z.object({
    action: z.literal('pay_unchecked'),
    listingId: z.string().min(1).max(128),
    why: WhySchema,
  }),
  z.object({
    action: z.literal('ask_human'),
    question: z.string().min(1).max(300),
  }),
  z.object({
    action: z.literal('done'),
    summary: z.string().min(1).max(300),
  }),
]);

export type DemoAction = z.infer<typeof DemoActionSchema>;

export type HumanQuestionKind = 'warn' | 'proceed' | 'ask';

export interface HumanQuestion {
  kind: HumanQuestionKind;
  listingId?: string;
  title?: string;
  amount?: number;
  currency?: string;
  verdict?: GuardianVerdict;
  question?: string;
}

export type HumanPrompt = (question: HumanQuestion) => Promise<boolean>;

export interface ShopperEvent {
  step: number;
  action: string;
  accepted: boolean;
  listingId?: string;
  code?: string;
  detail?: string;
  status?: string;
  verdict?: GuardianVerdict;
}

export type ShopperOutcomeStatus =
  | 'CAPTURED'
  | 'SIMULATED'
  | 'STOPPED'
  | 'STEP_LIMIT'
  | 'TIME_LIMIT'
  | 'STEP_TIMEOUT'
  | 'MODEL_ERROR';

export interface ShopperOutcome {
  status: ShopperOutcomeStatus;
  listingId?: string;
  captureId?: string;
  spent: number;
  reason: string;
}

export interface ShopperResult {
  scenario: string;
  goal: string;
  budget: number;
  currency: string;
  guardian: 'on' | 'off';
  marketplaceSource: 'api' | 'fixture';
  contextSource: 'api' | 'channel3' | 'fixture';
  events: ShopperEvent[];
  outcome: ShopperOutcome;
  modelCalls: number;
}

export interface ShopperOptions {
  scenario: ScenarioFixture;
  marketplace: MarketplaceResult;
  model: DemoModel;
  guardian?: GuardianClient;
  unguardedPay?: UnguardedPayClient;
  guardianMode: 'on' | 'off';
  budget?: number;
  autoHuman?: 'ask' | 'yes' | 'no';
  humanPrompt?: HumanPrompt;
  maxSteps?: number;
  stepTimeoutMs?: number;
  totalTimeoutMs?: number;
  now?: () => number;
}

class StepTimeoutError extends Error {
  constructor() {
    super('step timeout');
    this.name = 'StepTimeoutError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function actionName(value: unknown): string {
  return isRecord(value) && typeof value.action === 'string'
    ? value.action
    : 'invalid';
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createReplayModel(actions: unknown[]): DemoModel {
  let index = 0;

  return {
    async next() {
      const action = actions[index];
      index += 1;
      return action ?? { action: 'done', summary: 'No more recorded actions.' };
    },
  };
}

export function createRecordingModel(model: DemoModel, sink: unknown[]): DemoModel {
  return {
    async next(input) {
      const action = await model.next(input);
      sink.push(action);
      return action;
    },
  };
}

export function createFixtureGuardianClient(
  verdicts: Record<string, GuardianVerdictFixture>
): GuardianClient {
  const verdictFor = (listing: Listing): GuardianVerdict =>
    verdicts[listing.id] ?? { decision: 'ALLOW', score: 0 };

  return {
    async investigate(listing) {
      return verdictFor(listing);
    },
    async startCheckout(listing) {
      return {
        checkoutId: `chk-${listing.id}`,
        status: 'AWAITING_APPROVAL',
        approvalUrl: `https://approval.example/${listing.id}`,
      };
    },
    async finalizeCheckout(checkoutId, options) {
      if (!options.approvedByHuman || options.humanDecision !== 'proceed') {
        return { status: 'NEEDS_HUMAN_DECISION' };
      }
      return { status: 'CAPTURED', captureId: `CAPTURE-${checkoutId}` };
    },
  };
}

export interface UnguardedPayOptions {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createUnguardedPayClient(
  options: UnguardedPayOptions = {}
): UnguardedPayClient {
  return {
    async pay(listing) {
      if (!options.apiUrl) {
        return { status: 'SIMULATED', reference: `SIMULATED-${listing.id}` };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);

      try {
        const response = await (options.fetchImpl ?? fetch)(
          `${options.apiUrl.replace(/\/+$/, '')}/api/v1/demo/unguarded-pay`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              listingId: listing.id,
              merchantUrl: listing.url,
              amount: listing.price,
              currency: listing.currency,
            }),
            signal: controller.signal,
          }
        );

        const raw = await response.text();
        if (!response.ok) throw new Error(`unguarded payment failed: ${response.status}`);

        const body: unknown = raw.length > 0 ? JSON.parse(raw) : null;
        const data =
          isRecord(body) && body.success === true && 'data' in body ? body.data : body;

        return {
          status: 'COMPLETED',
          reference:
            isRecord(data) && typeof data.reference === 'string'
              ? data.reference
              : undefined,
        };
      } catch {
        return { status: 'SIMULATED', reference: `SIMULATED-${listing.id}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface ToolResultLike {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolCaller {
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<ToolResultLike>;
}

function textOf(result: ToolResultLike): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}

function normalizeVerdict(value: unknown): GuardianVerdict | undefined {
  if (!isRecord(value)) return undefined;
  const decision = value.decision;
  const score = value.score;
  if (
    (decision !== 'ALLOW' && decision !== 'WARN' && decision !== 'PAUSE') ||
    typeof score !== 'number'
  ) {
    return undefined;
  }
  return {
    decision,
    score,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
  };
}

function requiredRecord(
  result: ToolResultLike,
  key: string,
  tool: string
): Record<string, unknown> {
  if (result.isError) {
    throw new Error(textOf(result) || `${tool} failed`);
  }

  const payload = result.structuredContent;
  const candidate =
    isRecord(payload) && isRecord(payload[key]) ? payload[key] : payload;

  if (!isRecord(candidate)) {
    throw new Error(`${tool} returned no structured result`);
  }
  return candidate;
}

export function createMcpGuardianClient(
  caller: ToolCaller,
  options: { agentId?: string } = {}
): GuardianClient {
  const agentId = options.agentId ?? 'demo-shopper';

  return {
    async investigate(listing) {
      const result = await caller.callTool({
        name: 'investigate_merchant',
        arguments: {
          merchantUrl: listing.url,
          amount: listing.price,
          currency: listing.currency,
          merchantId: listing.merchantId,
          payeeEmail: listing.payeeEmail,
          claimedBrand: listing.claimedBrand,
          agentId,
        },
      });

      const verdict = normalizeVerdict(
        isRecord(result.structuredContent)
          ? result.structuredContent.verdict
          : undefined
      );
      if (!verdict) {
        throw new Error(result.isError ? textOf(result) : 'No verdict returned');
      }
      return verdict;
    },

    async startCheckout(listing) {
      const result = await caller.callTool({
        name: 'safe_checkout',
        arguments: {
          phase: 'create',
          merchantUrl: listing.url,
          amount: listing.price,
          currency: listing.currency,
          merchantId: listing.merchantId ?? listing.id,
          payeeEmail: listing.payeeEmail,
          claimedBrand: listing.claimedBrand,
          agentId,
          items: [
            { name: listing.title, quantity: 1, unitPrice: listing.price },
          ],
        },
      });

      const checkout = requiredRecord(result, 'checkout', 'safe_checkout');
      const checkoutId = checkout.checkoutId;
      if (typeof checkoutId !== 'string' || checkoutId.length === 0) {
        throw new Error('safe_checkout returned no checkout id');
      }

      return {
        checkoutId,
        status:
          typeof checkout.status === 'string'
            ? checkout.status
            : 'AWAITING_APPROVAL',
        approvalUrl:
          typeof checkout.approvalUrl === 'string'
            ? checkout.approvalUrl
            : undefined,
      };
    },

    async finalizeCheckout(checkoutId, options) {
      if (!options.approvedByHuman) {
        throw new Error('human approval is required before finalize');
      }

      const result = await caller.callTool({
        name: 'safe_checkout',
        arguments: {
          phase: 'finalize',
          checkoutId,
          humanDecision: options.humanDecision,
        },
      });

      const finalized = requiredRecord(result, 'result', 'safe_checkout');
      return {
        status:
          typeof finalized.status === 'string' ? finalized.status : 'UNKNOWN',
        captureId:
          typeof finalized.captureId === 'string'
            ? finalized.captureId
            : undefined,
        verdict: normalizeVerdict(finalized.verdict),
      };
    },
  };
}

export function parseModelJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('model reply did not contain a JSON object');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export interface HttpModelOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpModel(options: HttpModelOptions): DemoModel {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    async next(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

        const response = await (options.fetchImpl ?? fetch)(
          `${baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: options.model,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: DEMO_SHOPPER_SYSTEM },
                { role: 'user', content: buildShopperUser(input) },
              ],
            }),
            signal: controller.signal,
          }
        );

        const raw = await response.text();
        if (!response.ok) {
          throw new Error(`model request failed with ${response.status}`);
        }

        const body: unknown = raw.length > 0 ? JSON.parse(raw) : null;
        const content =
          isRecord(body) &&
          Array.isArray(body.choices) &&
          isRecord(body.choices[0]) &&
          isRecord(body.choices[0].message) &&
          typeof body.choices[0].message.content === 'string'
            ? body.choices[0].message.content
            : undefined;

        if (!content) throw new Error('model returned no text content');
        return parseModelJson(content);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function runShopper(options: ShopperOptions): Promise<ShopperResult> {
  const { scenario, marketplace } = options;
  const budget = options.budget ?? scenario.budget;
  const autoHuman = options.autoHuman ?? 'ask';
  const maxSteps = options.maxSteps ?? 10;
  const stepTimeoutMs = options.stepTimeoutMs ?? 8_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 90_000;
  const now = options.now ?? Date.now;
  const startedAt = now();

  if (options.guardianMode === 'on' && !options.guardian) {
    throw new Error('a guardian client is required when the guardian is on');
  }

  const events: ShopperEvent[] = [];
  const investigations = new Map<string, GuardianVerdict>();
  const openCheckouts = new Map<
    string,
    { listingId: string; verdict: GuardianVerdict; price: number; currency: string }
  >();
  const checkoutByListing = new Map<string, string>();

  let spent = 0;
  let modelCalls = 0;

  const result = (outcome: ShopperOutcome): ShopperResult => ({
    scenario: scenario.scenario,
    goal: scenario.goal,
    budget,
    currency: scenario.currency,
    guardian: options.guardianMode,
    marketplaceSource: marketplace.source,
    contextSource: marketplace.contextSource,
    events,
    outcome,
    modelCalls,
  });

  const ask = async (question: HumanQuestion): Promise<boolean> => {
    if (autoHuman === 'yes') return true;
    if (autoHuman === 'no') return false;
    if (!options.humanPrompt) return false;

    try {
      return await options.humanPrompt(question);
    } catch {
      return false;
    }
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (now() - startedAt > totalTimeoutMs) {
      return result({
        status: 'TIME_LIMIT',
        spent,
        reason: `The ${Math.round(totalTimeoutMs / 1_000)} second demo budget was exhausted.`,
      });
    }

    const input: DemoModelInput = {
      goal: scenario.goal,
      budget,
      currency: scenario.currency,
      guardian: options.guardianMode,
      listings: marketplace.listings,
      marketContext: marketplace.marketContext,
      history: events.map((event) => ({
        step: event.step,
        action: event.action,
        accepted: event.accepted,
        code: event.code,
        listingId: event.listingId,
        status: event.status,
      })),
      step: step + 1,
    };

    let raw: unknown;
    try {
      raw = await withTimeout(options.model.next(input), stepTimeoutMs);
    } catch (error) {
      if (error instanceof StepTimeoutError) {
        return result({
          status: 'STEP_TIMEOUT',
          spent,
          reason: `The model did not reply within ${stepTimeoutMs} ms.`,
        });
      }
      return result({
        status: 'MODEL_ERROR',
        spent,
        reason: messageOf(error),
      });
    }

    modelCalls += 1;

    const parsed = DemoActionSchema.safeParse(raw);
    if (!parsed.success) {
      events.push({
        step: step + 1,
        action: actionName(raw),
        accepted: false,
        code: 'invalid_action',
        detail: 'The model reply did not match the action protocol.',
      });
      continue;
    }

    const action = parsed.data;
    const event: ShopperEvent = {
      step: step + 1,
      action: action.action,
      accepted: false,
    };

    if ('listingId' in action && action.listingId !== undefined) {
      event.listingId = action.listingId;
    }

    if (action.action === 'done') {
      events.push({ ...event, accepted: true, detail: action.summary });
      return result({ status: 'STOPPED', spent, reason: action.summary });
    }

    if (action.action === 'search') {
      events.push({
        ...event,
        accepted: true,
        detail: `Search requested: ${action.query}`,
      });
      continue;
    }

    if (action.action === 'ask_human') {
      const yes = await ask({ kind: 'ask', question: action.question });
      events.push({
        ...event,
        accepted: true,
        detail: yes ? 'The human answered yes.' : 'The human answered no.',
      });
      continue;
    }

    if (action.action === 'pay_unchecked') {
      if (options.guardianMode !== 'off') {
        events.push({
          ...event,
          code: 'guardian_on',
          detail: 'Unchecked payment is blocked while the guardian is on.',
        });
        continue;
      }

      const listing = listingById(marketplace.listings, action.listingId);
      if (!listing) {
        events.push({
          ...event,
          code: 'unknown_listing',
          detail: 'No listing has that id.',
        });
        continue;
      }

      if (spent + listing.price > budget) {
        events.push({
          ...event,
          code: 'over_budget',
          detail: `${listing.id} costs ${listing.price} ${listing.currency}; the budget is ${budget}.`,
        });
        continue;
      }

      const pay = options.unguardedPay ?? createUnguardedPayClient();
      const paid = await pay.pay(listing).catch(() => ({
        status: 'SIMULATED' as const,
        reference: undefined,
      }));

      spent += listing.price;
      events.push({
        ...event,
        accepted: true,
        status: paid.status,
        detail:
          paid.status === 'SIMULATED'
            ? 'SIMULATED payment: no money moved.'
            : 'Unchecked payment completed.',
      });

      return result({
        status: paid.status === 'SIMULATED' ? 'SIMULATED' : 'CAPTURED',
        listingId: listing.id,
        captureId: paid.reference,
        spent,
        reason:
          paid.status === 'SIMULATED'
            ? 'Simulated unchecked payment.'
            : 'Unchecked payment completed.',
      });
    }

    if (action.action === 'investigate') {
      const listing = listingById(marketplace.listings, action.listingId);
      if (!listing) {
        events.push({
          ...event,
          code: 'unknown_listing',
          detail: 'No listing has that id.',
        });
        continue;
      }

      if (options.guardianMode !== 'on' || !options.guardian) {
        events.push({
          ...event,
          code: 'guardian_off',
          detail: 'Investigation is only available while the guardian is on.',
        });
        continue;
      }

      try {
        const verdict = await options.guardian.investigate(listing);
        investigations.set(listing.id, verdict);
        events.push({
          ...event,
          accepted: true,
          verdict,
          detail: verdict.summary ?? `${verdict.decision} at ${verdict.score}/100.`,
        });
      } catch (error) {
        events.push({
          ...event,
          code: 'guardian_error',
          detail: messageOf(error),
        });
      }
      continue;
    }

    if (action.action === 'start_checkout') {
      const listing = listingById(marketplace.listings, action.listingId);
      if (!listing) {
        events.push({
          ...event,
          code: 'unknown_listing',
          detail: 'No listing has that id.',
        });
        continue;
      }

      if (spent + listing.price > budget) {
        events.push({
          ...event,
          code: 'over_budget',
          detail: `${listing.id} costs ${listing.price} ${listing.currency}; the budget is ${budget}.`,
        });
        continue;
      }

      if (options.guardianMode !== 'on' || !options.guardian) {
        events.push({
          ...event,
          code: 'guardian_off',
          detail: 'Start checkout is only available while the guardian is on.',
        });
        continue;
      }

      const verdict = investigations.get(listing.id);
      if (!verdict) {
        events.push({
          ...event,
          code: 'investigation_required',
          detail: 'Investigate the listing before starting checkout.',
        });
        continue;
      }

      if (verdict.decision === 'PAUSE') {
        events.push({
          ...event,
          accepted: false,
          code: 'guardian_paused',
          verdict,
          detail: 'A paused listing can never start checkout.',
        });
        continue;
      }

      if (checkoutByListing.has(listing.id)) {
        events.push({
          ...event,
          code: 'checkout_already_started',
          detail: 'A held order already exists for this listing.',
        });
        continue;
      }

      if (verdict.decision === 'WARN') {
        const approved = await ask({
          kind: 'warn',
          listingId: listing.id,
          title: listing.title,
          amount: listing.price,
          currency: listing.currency,
          verdict,
        });

        if (!approved) {
          events.push({
            ...event,
            code: 'human_declined',
            verdict,
            detail: 'A warning needs a human yes before checkout can start.',
          });
          continue;
        }
      }

      try {
        const handle = await options.guardian.startCheckout(listing);
        if (!handle.checkoutId) {
          events.push({
            ...event,
            code: 'guardian_error',
            detail: 'The guardian returned no checkout id.',
          });
          continue;
        }

        openCheckouts.set(handle.checkoutId, {
          listingId: listing.id,
          verdict,
          price: listing.price,
          currency: listing.currency,
        });
        checkoutByListing.set(listing.id, handle.checkoutId);
        events.push({
          ...event,
          accepted: true,
          status: handle.status,
          verdict,
          detail: `Held order ${handle.checkoutId} created; no money moved.`,
        });
      } catch (error) {
        events.push({
          ...event,
          code: 'guardian_error',
          detail: messageOf(error),
        });
      }
      continue;
    }

    if (action.action === 'finalize_checkout') {
      if (options.guardianMode !== 'on' || !options.guardian) {
        events.push({
          ...event,
          code: 'guardian_off',
          detail: 'Finalize is only available while the guardian is on.',
        });
        continue;
      }

      const checkoutId =
        action.checkoutId ??
        (action.listingId !== undefined
          ? checkoutByListing.get(action.listingId)
          : undefined);

      if (!checkoutId) {
        events.push({
          ...event,
          code: 'unknown_checkout',
          detail: 'No held order matches that checkout or listing.',
        });
        continue;
      }

      const open = openCheckouts.get(checkoutId);
      if (!open) {
        events.push({
          ...event,
          code: 'unknown_checkout',
          detail: 'No held order matches that checkout id.',
        });
        continue;
      }

      event.listingId = open.listingId;

      const approved = await ask({
        kind: 'proceed',
        listingId: open.listingId,
        amount: open.price,
        currency: open.currency,
        verdict: open.verdict,
      });

      if (!approved) {
        events.push({
          ...event,
          code: 'human_declined',
          verdict: open.verdict,
          detail: 'The human did not authorize the final payment.',
        });
        continue;
      }

      try {
        const finalized = await options.guardian.finalizeCheckout(checkoutId, {
          humanDecision: 'proceed',
          approvedByHuman: true,
        });

        const captured = finalized.status === 'CAPTURED';
        events.push({
          ...event,
          accepted: captured,
          status: finalized.status,
          verdict: finalized.verdict ?? open.verdict,
          detail: captured
            ? 'The guarded checkout was captured.'
            : `The guardian returned ${finalized.status}.`,
        });

        if (captured) {
          spent += open.price;
          return result({
            status: 'CAPTURED',
            listingId: open.listingId,
            captureId: finalized.captureId,
            spent,
            reason: 'The guarded checkout was captured.',
          });
        }
      } catch (error) {
        events.push({
          ...event,
          code: 'guardian_error',
          detail: messageOf(error),
        });
      }
      continue;
    }
  }

  return result({
    status: 'STEP_LIMIT',
    spent,
    reason: `Stopped after ${maxSteps} steps.`,
  });
}
