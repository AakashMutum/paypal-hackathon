/**
 * @file loader.ts
 * @description Typed loader for the 50-case benchmark dataset with Zod runtime validation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvaluationDatasetSchema,
  type EvaluationCase,
  type EvaluationDataset,
} from './schema.js';

export interface LoadDatasetOptions {
  /** Optional custom file path to load cases from */
  filePath?: string;
  /** Whether to bypass Zod validation (defaults to false) */
  skipValidation?: boolean;
}

/**
 * Resolves the default absolute path to cases.json.
 */
export function getDefaultDatasetPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.join(currentDir, 'cases.json');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const srcCandidate = path.resolve(currentDir, '../../src/dataset/cases.json');
  if (fs.existsSync(srcCandidate)) {
    return srcCandidate;
  }
  return candidate;
}

/**
 * Synchronously loads and validates the evaluation dataset.
 *
 * @param options Loader options
 * @returns Array of validated EvaluationCase objects
 */
export function loadEvaluationDataset(options: LoadDatasetOptions = {}): EvaluationDataset {
  const filePath = options.filePath || getDefaultDatasetPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evaluation dataset file not found at: ${filePath}`);
  }

  const rawText = fs.readFileSync(filePath, 'utf-8');
  const rawJson = JSON.parse(rawText);

  if (options.skipValidation) {
    return rawJson as EvaluationDataset;
  }

  return EvaluationDatasetSchema.parse(rawJson);
}

/**
 * Asynchronously loads and validates the evaluation dataset.
 *
 * @param options Loader options
 * @returns Promise resolving to an array of validated EvaluationCase objects
 */
export async function loadEvaluationDatasetAsync(
  options: LoadDatasetOptions = {}
): Promise<EvaluationDataset> {
  const filePath = options.filePath || getDefaultDatasetPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evaluation dataset file not found at: ${filePath}`);
  }

  const rawText = await fs.promises.readFile(filePath, 'utf-8');
  const rawJson = JSON.parse(rawText);

  if (options.skipValidation) {
    return rawJson as EvaluationDataset;
  }

  return EvaluationDatasetSchema.parse(rawJson);
}

/**
 * Helper to retrieve a single case by id.
 */
export function getEvaluationCaseById(
  id: string,
  options: LoadDatasetOptions = {}
): EvaluationCase | undefined {
  const dataset = loadEvaluationDataset(options);
  return dataset.find((item) => item.id === id);
}

