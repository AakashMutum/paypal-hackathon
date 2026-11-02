import { z } from 'zod';

const ConfigSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  port: z.coerce.number().int().min(1).max(65535).default(3333),
  bearerToken: z.string().min(1).optional(),
  guardianApiUrl: z.string().url().default('http://localhost:3000'),
  guardianApiKey: z.string().min(1).optional(),
  requestTimeoutMs: z.coerce.number().int().min(1).max(120_000).default(15_000),
  finalizeTimeoutMs: z.coerce.number().int().min(1).max(300_000).default(60_000),
});

export type McpConfig = z.infer<typeof ConfigSchema>;

export function loadMcpConfig(
  env: Record<string, string | undefined> = process.env
): McpConfig {
  return ConfigSchema.parse({
    transport: env.MCP_TRANSPORT,
    port: env.MCP_PORT,
    bearerToken: env.MCP_BEARER_TOKEN,
    guardianApiUrl: env.GUARDIAN_API_URL,
    guardianApiKey: env.GUARDIAN_API_KEY,
    requestTimeoutMs: env.GUARDIAN_REQUEST_TIMEOUT_MS,
    finalizeTimeoutMs: env.GUARDIAN_FINALIZE_TIMEOUT_MS,
  });
}
