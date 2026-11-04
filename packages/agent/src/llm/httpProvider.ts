import type { LlmProvider, RawLlmRequest, RawLlmResponse } from './client.js';

/**
 * The only provider-specific file. Speaks the OpenAI chat-completions shape,
 * which is also served by Gemini, Groq, OpenRouter and DeepSeek, so switching
 * provider is a base URL and model-name change.
 *
 * A tier may carry an ordered list of models. When a model is unavailable
 * (404), rate-limited (429) or temporarily failing (5xx), the next model in the
 * list is tried. A bad request, a rejected key or a timeout is never retried on
 * another model.
 */

export type ModelChoice = string | readonly string[];

export interface HttpProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: { fast: ModelChoice; strong: ModelChoice };
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const FALLBACK_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export function modelCandidates(choice: ModelChoice): string[] {
  const list = Array.isArray(choice) ? choice : [choice];
  return [...new Set(list.map((model) => String(model ?? '').trim()).filter((model) => model.length > 0))];
}

export function createHttpProvider(config: HttpProviderConfig): LlmProvider {
  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async complete(request: RawLlmRequest): Promise<RawLlmResponse> {
      const models = modelCandidates(request.tier === 'strong' ? config.models.strong : config.models.fast);
      if (models.length === 0) throw new Error('No model configured for this tier');

      const timeout = AbortSignal.timeout(Math.max(1, request.timeoutMs));
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

      let lastError: Error | undefined;
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        try {
          return await completeWithModel(model, request, signal);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const status = error instanceof ProviderHttpError ? error.status : undefined;
          const canFallback = index < models.length - 1 && status !== undefined && FALLBACK_STATUSES.has(status);
          if (!canFallback) throw error;
        }
      }
      throw lastError ?? new Error('LLM provider failed');
    },
  };

  async function completeWithModel(
    model: string,
    request: RawLlmRequest,
    signal: AbortSignal,
  ): Promise<RawLlmResponse> {
    const body: Record<string, unknown> = {
      model,
      temperature: 0,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    };

    let response = await send({ ...body, response_format: { type: 'json_object' } }, signal);

    if (response.status === 400 || response.status === 422) {
      const text = await safeText(response);
      if (/response_format|json_object|unsupported/i.test(text)) {
        response = await send(body, signal);
      } else {
        throw new ProviderHttpError(`LLM provider error ${response.status}: ${truncate(text, 300)}`, response.status);
      }
    }

    if (!response.ok) {
      const text = await safeText(response);
      throw new ProviderHttpError(`LLM provider error ${response.status}: ${truncate(text, 300)}`, response.status);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('LLM response did not contain text content');
    }

    return {
      text: content,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
      model,
    };
  }

  async function send(payloadBody: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payloadBody),
      signal,
    });
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
