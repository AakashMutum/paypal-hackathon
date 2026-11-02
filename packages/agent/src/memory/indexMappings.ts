/**
 * Elasticsearch mapping for the scam memory index.
 * `semantic_text` lets Elastic build the embeddings, so the agent needs no
 * second AI provider.
 */
export function scamMemoryMapping(options: { inferenceId?: string } = {}): Record<string, unknown> {
  return {
    properties: {
      pattern: {
        type: 'semantic_text',
        ...(options.inferenceId ? { inference_id: options.inferenceId } : {}),
      },
      patternText: { type: 'text' },
      domain: { type: 'keyword' },
      registrableDomain: { type: 'keyword' },
      payeeMerchantId: { type: 'keyword' },
      decision: { type: 'keyword' },
      riskScore: { type: 'float' },
      evidenceTypes: { type: 'keyword' },
      domainAgeBucket: { type: 'keyword' },
      discountBucket: { type: 'keyword' },
      seed: { type: 'boolean' },
      seenCount: { type: 'integer' },
      createdAt: { type: 'date' },
      lastSeenAt: { type: 'date' },
    },
  };
}
