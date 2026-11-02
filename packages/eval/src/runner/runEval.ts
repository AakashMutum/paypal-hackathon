#!/usr/bin/env node
/**
 * @file runEval.ts
 * @description CLI script executed by `npm run test:eval`.
 */

import { runEvaluation } from './evalRunner.js';

runEvaluation().catch((err) => {
  console.error('Fatal error during evaluation run:', err);
  process.exit(1);
});
