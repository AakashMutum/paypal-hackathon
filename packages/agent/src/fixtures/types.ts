import type { AgentPath, Decision, Evidence, HardRuleId, InvestigationRequest } from '../types.js';
import type { OfferSummary, PageClaims, RegistryRecord, SectionHint, SectionResult } from '../ports.js';

/** A recorded investigation, used by the fixture adapters and the scenario tests. */
export interface ScenarioFixture {
  name: 'A' | 'B' | 'C' | 'D2';
  request: InvestigationRequest;
  claims: PageClaims;
  signalsEvidence: Evidence[];
  registry: {
    byMerchantId: Record<string, RegistryRecord[]>;
    byName: Record<string, RegistryRecord[]>;
    byDomain: Record<string, RegistryRecord[]>;
  };
  sections?: Partial<Record<SectionHint, SectionResult>>;
  offers?: OfferSummary;
  memory?: { semanticHits: Evidence[]; exactHits: Evidence[] };
  expected: {
    decision: Decision;
    score: number;
    path: AgentPath;
    hardRules: HardRuleId[];
    confidence?: number;
    followUps?: number;
  };
}
