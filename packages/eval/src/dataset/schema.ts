/**
 * @file schema.ts
 * @description Zod schema and TypeScript types for Checkout Guardian benchmark dataset cases.
 */

import { z } from 'zod';

export const EvaluationCaseSchema = z
  .object({
    /** Unique case identifier (e.g., "case-001") */
    id: z.string().min(1),
    /** Full URL of the storefront checkout page */
    merchantUrl: z.string().url(),
    /** Brand or merchant claimed on the storefront */
    claimedBrand: z.string().min(1),
    /** Age of the storefront domain in days */
    domainAgeDays: z.number().int().nonnegative(),
    /** Price listed on the storefront */
    listedPrice: z.number().positive(),
    /** Market/MSRP reference price */
    referencePrice: z.number().positive(),
    /** Email of the payee account configured on PayPal */
    payeeEmail: z.string().email(),
    /** Observed PayPal merchant ID */
    payeeMerchantId: z.string().min(1),
    /** Whether payeeEmail/payeeMerchantId matches the storefront domain */
    payeeMatchesDomain: z.boolean(),
    /** Whether storefront claimed identity matches observed technical identity */
    merchantIdentityClaimsConsistent: z.boolean(),
    /** Ground truth classification */
    label: z.enum(['fraud', 'legit']),
    /** Dataset origin */
    source: z.enum(['synthetic', 'verified']),
  })
  .strict();

export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationDatasetSchema = z.array(EvaluationCaseSchema);
export type EvaluationDataset = EvaluationCase[];

