/**
 * @file schema.ts
 * @description Benchmark case schema. A case holds only raw observables about a store, the way a
 * collector would see them. It holds no judgment such as "the identity is consistent" or "the
 * payee matches the domain"; the systems under test must work that out. `label` is the author's
 * ground truth and is used only for scoring.
 */

import { z } from 'zod';

export const CATEGORIES = [
  'easy_legit',
  'easy_fraud',
  'lookalike_impersonator',
  'new_but_legit',
  'big_clearance_but_legit',
  'sole_proprietor_webmail',
  'aged_hijacked_domain',
  'injection_page',
] as const;
export type Category = (typeof CATEGORIES)[number];

const RegistryRecordSchema = z
  .object({
    legalName: z.string().min(1),
    brandNames: z.array(z.string().min(1)),
    city: z.string().optional(),
    country: z.string().optional(),
  })
  .strict();

const BrandOwnerSchema = z
  .object({
    merchantId: z.string().min(1),
    legalName: z.string().min(1),
    brandNames: z.array(z.string().min(1)).min(1),
    domain: z.string().min(1),
  })
  .strict();

export const EvaluationCaseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    /** Author's ground truth. Never an input to a classifier. */
    label: z.enum(['fraud', 'legit']),
    source: z.literal('synthetic'),

    merchantUrl: z.string().url(),
    claimedBrand: z.string().min(1),
    /** Legal name shown on the page, if any. */
    pageLegalName: z.string().nullable(),
    pageText: z.string(),
    /** Text hidden from shoppers (display:none, comments), if any. */
    hiddenText: z.string().optional(),

    domainAgeDays: z.number().int().nonnegative(),
    listedPrice: z.number().positive(),
    referencePrice: z.number().positive(),

    payeeEmail: z.string().email(),
    payeeMerchantId: z.string().min(1),
    /** Merchant id published by the site in its binding file, or null when the file is missing. */
    bindingMerchantId: z.string().nullable(),
    /** Registry record of the account that receives the payment, or null. */
    registryRecord: RegistryRecordSchema.nullable(),
    /** Registry record of the real owner of the claimed brand, or null when the brand is unknown. */
    brandOwner: BrandOwnerSchema.nullable(),
  })
  .strict();

export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export const EvaluationDatasetSchema = z.array(EvaluationCaseSchema);
export type EvaluationDataset = EvaluationCase[];

/** Fields that are judgments rather than observations. They must never appear in a case. */
export const FORBIDDEN_JUDGMENT_FIELDS = [
  'merchantIdentityClaimsConsistent',
  'payeeMatchesDomain',
  'isFraud',
  'expectedDecision',
  'identityConsistent',
  'payeeBindingOk',
] as const;
