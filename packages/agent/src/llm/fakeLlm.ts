import type {
  LlmClient,
  LlmErrorCode,
  LlmProvider,
  LlmRequest,
  LlmResult,
  RawLlmRequest,
  RawLlmResponse,
} from './client.js';

/**
 * Scripted doubles for tests.
 *
 * `ScriptedProvider` returns raw text and is used to exercise JSON parsing,
 * repairs and timeouts. `FakeLlm` returns validated data directly and is what
 * the agent-level tests script.
 */

export interface RawTurn {
  match?: (request: RawLlmRequest) => boolean;
  text?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: Error;
  delayMs?: number;
}

export class ScriptedProvider implements LlmProvider {
  readonly calls: RawLlmRequest[] = [];
  private readonly turns: RawTurn[];

  constructor(turns: RawTurn[] = []) {
    this.turns = turns;
  }

  async complete(request: RawLlmRequest): Promise<RawLlmResponse> {
    this.calls.push({ ...request, signal: undefined });
    const turn = this.turns.find((candidate) => !candidate.match || candidate.match(request));
    if (!turn) throw new Error('no scripted reply');

    if (turn.delayMs && turn.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, turn.delayMs));
    }

    if (turn.error) throw turn.error;
    return { text: turn.text ?? '', usage: turn.usage };
  }
}

export interface FakeTurn {
  match?: (request: LlmRequest<unknown>) => boolean;
  data?: unknown;
  error?: LlmErrorCode;
  detail?: string;
  delayMs?: number;
  /** When true the turn is consumed after one use, so scripts can advance. */
  once?: boolean;
}

export class FakeLlm implements LlmClient {
  readonly calls: LlmRequest<unknown>[] = [];
  private readonly turns: FakeTurn[];
  private readonly used = new Set<number>();

  constructor(turns: FakeTurn[] = []) {
    this.turns = turns;
  }

  async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push(request as LlmRequest<unknown>);
    const index = this.turns.findIndex(
      (candidate, position) =>
        !(candidate.once && this.used.has(position)) &&
        (!candidate.match || candidate.match(request as LlmRequest<unknown>))
    );
    const turn = index >= 0 ? this.turns[index] : undefined;
    if (turn?.once) this.used.add(index);

    if (!turn) {
      return { ok: false, error: 'provider', detail: 'no_scripted_reply', latencyMs: 0 };
    }

    if (turn.delayMs && turn.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, turn.delayMs));
    }

    if (turn.error) {
      return { ok: false, error: turn.error, detail: turn.detail, latencyMs: turn.delayMs ?? 0 };
    }

    return { ok: true, data: turn.data as T, latencyMs: turn.delayMs ?? 0 };
  }
}
