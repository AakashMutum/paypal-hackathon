import { z } from 'zod';

/**
 * The only tools the model may choose from (spec §8.3). None of them can pay,
 * capture, void, write, or fetch an arbitrary URL.
 */

export const SECTION_HINTS = ['about', 'contact', 'returns', 'terms', 'privacy', 'shipping'] as const;
export const LOOKUP_BY = ['name', 'domain', 'merchantId'] as const;

export const LookupRegistryInputSchema = z
  .object({
    by: z.enum(LOOKUP_BY),
    query: z.string().min(2).max(120),
  })
  .strict();

export const FetchPageSectionInputSchema = z
  .object({
    hint: z.enum(SECTION_HINTS),
  })
  .strict();

export const CompareOffersInputSchema = z
  .object({
    productQuery: z.string().min(3).max(120),
    maxPrice: z.number().positive().optional(),
  })
  .strict();

export const GetDomainReportInputSchema = z
  .object({
    domain: z.string().min(3).max(120),
  })
  .strict();

export type FollowUpToolName =
  | 'lookup_registry'
  | 'fetch_page_section'
  | 'compare_offers'
  | 'get_domain_report';

export interface FollowUpTool {
  name: FollowUpToolName;
  description: string;
  inputShape: string;
  inputSchema: z.ZodTypeAny;
  /** Hard cap per investigation; compare_offers is capped at 2. */
  maxUsesPerInvestigation: number;
  readOnly: true;
}

export const FOLLOW_UP_TOOLS: readonly FollowUpTool[] = [
  {
    name: 'lookup_registry',
    description: 'Look up merchants in the Merchant Trust Registry by name, domain or merchant ID.',
    inputShape: '{"by":"name"|"domain"|"merchantId","query":"string 2-120 chars"}',
    inputSchema: LookupRegistryInputSchema,
    maxUsesPerInvestigation: 5,
    readOnly: true,
  },
  {
    name: 'fetch_page_section',
    description:
      'Read one standard section of the same website (about, contact, returns, terms, privacy, shipping).',
    inputShape: '{"hint":"about"|"contact"|"returns"|"terms"|"privacy"|"shipping"}',
    inputSchema: FetchPageSectionInputSchema,
    maxUsesPerInvestigation: 5,
    readOnly: true,
  },
  {
    name: 'compare_offers',
    description: 'Compare the asking price with offers for the same product. Maximum two uses.',
    inputShape: '{"productQuery":"string 3-120 chars","maxPrice":number?}',
    inputSchema: CompareOffersInputSchema,
    maxUsesPerInvestigation: 2,
    readOnly: true,
  },
  {
    name: 'get_domain_report',
    description:
      'Check a domain that the page itself links to. Only domains already visible on the page are accepted.',
    inputShape: '{"domain":"string 3-120 chars"}',
    inputSchema: GetDomainReportInputSchema,
    maxUsesPerInvestigation: 5,
    readOnly: true,
  },
];

export function findFollowUpTool(name: string): FollowUpTool | undefined {
  return FOLLOW_UP_TOOLS.find((tool) => tool.name === name);
}

export function describeFollowUpTools(): string {
  return FOLLOW_UP_TOOLS.map(
    (tool) => `- ${tool.name}: ${tool.description}\n  input: ${tool.inputShape}`
  ).join('\n');
}
