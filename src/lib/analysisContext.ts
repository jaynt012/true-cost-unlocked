import type { SupportedCurrency } from "./financial";

export interface GlossaryItem { term: string; definition: string }
export interface FairMarketBenchmark { marketAverage: number; differencePercent: number; assessment: string; source?: string; asOf?: string }
export interface AlternativeFunding { title: string; description: string; estimatedSavings?: string }
export interface DeceptionResult { urgencyTactics: string[]; fakeDiscounts: string[]; emotionalManipulation: string[] }
export interface AdviceResult {
  recommendation: "review_required" | "no_material_flags" | "insufficient_confidence";
  reasons: string[];
}

export interface InstallmentSchedule {
  count: number;
  amount: number;
  interval: number;
  intervalUnit: "day" | "week" | "fortnight" | "month" | "year";
  total: number;
  totalWithKnownFees: number | null;
  source: string;
  firstPaymentTiming: "one period after agreement";
}

export interface CashPriceAnalysis {
  cashPrice: number;
  totalPaid: number;
  multiple: number;
  extraCost: number;
  impliedNominalAPR: number | null;
  periodsPerYear: number;
  firstPaymentTiming: "one period after agreement";
}

export interface CostBreakdown {
  interest: number;
  taxes: number;
  fees: number;
  optionalProducts: number;
  offsets: number;
  financingCost: number;
}

export interface AmountRelationship {
  type: "percent_of" | "sum_of" | "difference_of" | "product_of_schedule";
  source: string;
  derivedAmount: number;
  baseLabel: string;
  expectedAmount: number | null;
  confirmed: boolean;
}

export type DocumentType =
  | "installment_loan" | "bnpl" | "auto_loan" | "mortgage" | "credit_card"
  | "payday" | "rent_to_own" | "gold_loan" | "subscription" | "advance_fee_scam"
  | "merchant_cash_advance" | "personal_loan_kfs" | "student_loan" | "unknown";

export interface SourceBoundingBox { x: number; y: number; width: number; height: number }
export interface SourceTextSpan { start: number; end: number; page: number; box: SourceBoundingBox }
export interface ImportedSourcePage { page: number; confidence: number; isOCR: boolean }

export interface ExtractedCandidate<T = number> {
  value: T;
  label: string;
  source: string;
  position: number;
  confidence: number;
  score: number;
  relatedItems?: string[];
}

export interface ExtractedField<T = number> {
  value: T | null;
  source: string | null;
  confidence: number;
  alternatives: ExtractedCandidate<T>[];
  needsReview: boolean;
}

export interface AIExtractedFact { value: number | null; evidence: string | null }
export interface AIExtractedFields { principal: AIExtractedFact; annualAPR: AIExtractedFact; termMonths: AIExtractedFact; payment: AIExtractedFact }

export type FindingPolarity = "asserted" | "negated" | "waived/zero" | "conditional" | "hypothetical";
export type FactProvenance = "stated-in-document" | "computed" | "derived" | "assumed";
export type RiskBand = "low" | "caution" | "high" | "critical";

export interface CostFinding {
  id: string;
  label: string;
  category: string;
  severity: number;
  amount: number | null;
  percent: number | null;
  basis: string | null;
  frequency: string | null;
  conditions: string[];
  source: string;
  position: number;
  explanation: string;
  totalImpact: number | null;
  negated: boolean;
  /** True when the clause names a charge but does not quantify it. */
  amountNotStated?: boolean;
  gracePeriodDays?: number | null;
  qualifier?: string | null;
  /** Tax embedded in a composite expression such as "$100 + 18% GST". */
  taxAmount?: number | null;
  taxPercent?: number | null;
  taxBasis?: string | null;
  groupId?: string;
  polarity?: FindingPolarity;
  clauseSpan?: [number, number];
  evidence?: string;
  provenance?: FactProvenance;
  topicId?: string;
  riskRuleIds?: string[];
  mergedRuleIds?: string[];
  minimumRiskBand?: RiskBand;
  /** Individual monetary facts retained when several detectors describe one clause. */
  components?: CostFinding[];
  ruleOnly?: boolean;
  sourceLocation?: { page: number; box: SourceBoundingBox };
}

export interface AnalysisFinding extends CostFinding {
  polarity: FindingPolarity;
  clauseSpan: [number, number];
  evidence: string;
  provenance: FactProvenance;
}

export interface LineItemGroup {
  id: string;
  label: string;
  items: Array<{ label: string; amount: number; source: string; position: number; category: string }>;
  aggregate: number;
  source: string;
  position: number;
}

export interface ReconciliationCheck {
  id: string;
  label: string;
  expression: string;
  calculated: number;
  expected: number;
  difference: number;
  matched: boolean;
  source: string;
  undisclosedItems: string[];
}

export interface CalculatorStatus {
  calculator: string;
  label: string;
  available: boolean;
  missingInputs: string[];
  unsupportedReason?: string | null;
}

export interface AddOnImpact {
  amount: number;
  paymentIncrease: number;
  totalPaymentIncrease: number;
  interestIncrease: number;
}

export interface DetectedClaim {
  id: string;
  label: string;
  source: string;
  contradicted: boolean;
  contradiction: string | null;
  signal?: string | null;
}

export interface RiskBreakdownItem {
  category: string;
  points: number;
  reasons: string[];
  weight?: number;
  baseWeight?: number;
  repeatFactor?: number;
  findingId?: string;
  evidence?: string;
  combinedScore?: number;
}

export interface AnalysisContext {
  readonly id: string;
  readonly docType: { type: DocumentType; label: string; confidence: number; signals: string[] };
  readonly region: string | null;
  readonly currency: SupportedCurrency | null;
  readonly currencyCode: SupportedCurrency;
  readonly principalField: ExtractedField<number>;
  readonly rateField: ExtractedField<number> & {
    type: "fixed" | "variable" | "introductory" | "unspecified";
    basis: "flat" | "reducing" | "unspecified";
    rateType: "reducing" | "flat" | "deferred" | "revolving" | "unknown";
    rateRole: "base" | "promotional" | "penalty" | "implied" | "unknown";
    basisAssumption: string | null;
  };
  readonly termField: ExtractedField<number>;
  readonly periodCandidates?: import("./periodRoles").PeriodCandidate[];
  readonly plausibilityConflicts?: Array<{ field: "principal"; principal: number; conflictingValue: number; label: string; source: string; kind: "fee" | "payment" | "fee_percent" }>;
  readonly documentStructure?: ReturnType<typeof import("./documentStructure").inspectLegalStructure>;
  readonly statedEMI: ExtractedField<number>;
  readonly installmentSchedule: InstallmentSchedule | null;
  readonly principal: number | null;
  readonly findings: AnalysisFinding[];
  readonly protections: AnalysisFinding[];
  readonly conditionalTerms?: AnalysisFinding[];
  readonly rateScenarios?: Array<{ type: "variable" | "introductory" | "penalty"; annualRate: number; source: string; conditions: string[]; provenance: FactProvenance }>;
  readonly fees: CostFinding[];
  readonly addOns: CostFinding[];
  readonly taxes: CostFinding[];
  readonly offsets: CostFinding[];
  readonly itemGroups: LineItemGroup[];
  readonly amountRelationships: AmountRelationship[];
  readonly reconciliations: ReconciliationCheck[];
  readonly calculator: CalculatorStatus;
  readonly ranCalculators: string[];
  readonly cashPriceAnalysis: CashPriceAnalysis | null;
  readonly costBreakdown: CostBreakdown;
  readonly confidenceIssues: string[];
  readonly addOnImpact: AddOnImpact | null;
  readonly netExtraCost: number | null;
  readonly netExtraCostPercent: number | null;
  readonly claims: DetectedClaim[];
  readonly confidence: number;
  readonly warnings: string[];
  readonly riskScore: number;
  readonly riskBand: RiskBand;
  readonly analysisIncomplete: boolean;
  readonly riskBreakdown: RiskBreakdownItem[];
  readonly summary: string;
  readonly hiddenFees: string[];
  readonly insights: string[];
  readonly aiInsights?: string[];
  readonly aiNegotiationStrategies?: string[];
  readonly aiClausesToReview?: string[];
  readonly aiCounterOfferEmail?: string;
  readonly emi: number | null;
  readonly totalPayment: number | null;
  readonly totalInterest: number | null;
  readonly totalCost: number | null;
  readonly financialMetricsAvailable: boolean;
  readonly effectiveAPR: number | null;
  readonly netDisbursed: number | null;
  readonly deception: DeceptionResult;
  readonly advice: AdviceResult;
  readonly glossary: GlossaryItem[];
  readonly fairMarketComparison?: FairMarketBenchmark;
  readonly alternativeFunding: AlternativeFunding[];
  readonly simulator: {
    lateFeeAmount: number | null;
    lateFeePercent: number | null;
    lateFeeBasis: string | null;
    penaltyAPR: number | null;
    isAssumption: boolean;
    source?: string | null;
    gracePeriodDays?: number | null;
    postGraceLateFeeAmount?: number | null;
    conditions?: string[];
  };
  readonly rawText: string;
  readonly sourcePages?: ImportedSourcePage[];
  readonly sourceSpans?: SourceTextSpan[];
}

export type AnalysisResult = AnalysisContext;

export function freezeAnalysisContext<T extends object>(context: T): Readonly<T> {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  };
  freeze(context);
  return context;
}
