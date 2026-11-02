import type { LlmProvider, RawLlmRequest, RawLlmResponse } from './client.js';

/**
 * The only provider-specific file. Speaks the OpenAI chat-completions shape,
 * which is also served by Gemini, Groq, OpenRouter and DeepSeek, so switching
 * provider is a base URL and model-name change.
 */

export interface HttpProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: { fast: string; strong: string };
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createHttpProvider(config: HttpProviderConfig): LlmProvider {
  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async complete(request: RawLlmRequest): Promise<RawLlmResponse> {
      const model = request.tier === 'strong' ? config.models.strong : config.models.fast;

      const body: Record<string, unknown> = {
        model,
        temperature: 0,
        max_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      };

      let response = await send({ ...body, response_format: { type: 'json_object' } });

      if (response.status === 400 || response.status === 422) {
        const text = await safeText(response);
        if (/response_format|json_object|unsupported/i.test(text)) {
          response = await send(body);
        } else {
          throw new Error(`LLM provider error ${response.status}: ${truncate(text, 300)}`);
        }
      }

      if (!response.ok) {
        const text = await safeText(response);
        throw new Error(`LLM provider error ${response.status}: ${truncate(text, 300)}`);
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
      };

      async function send(payloadBody: Record<string, unknown>): Promise<Response> {
        return fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(payloadBody),
          signal: request.signal,
        });
      }
    },
  };
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
