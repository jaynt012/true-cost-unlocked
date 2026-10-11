import { analyzeLoan, calculateEffectiveAPR, calculateEMI, calculateFlatLoan, detectCurrency, formatCurrency, minimumPaymentPayoff, type SupportedCurrency } from "./financial";
import { calculateRisk, canonicalFinding, classifyDocument, classifyPolarity, collectRuleFindings, computeTaxImpacts, detectClaims, detectClaimsGeneric, detectCosts, detectCostsGeneric, extractAmountCandidates, extractRateCandidates, extractRateType, extractStatedEMI, mergeClauseFindings, parseMonetaryValues, resolveDerivedAmountCandidates, scorePrincipalCandidates, segmentClauses, type ParsedRateCandidate } from "./analysisEngine";
import { freezeAnalysisContext, type AdviceResult, type AddOnImpact, type AlternativeFunding, type AnalysisContext, type AnalysisFinding, type AIExtractedFields, type AmountRelationship, type CashPriceAnalysis, type CostBreakdown, type CostFinding, type DeceptionResult, type ExtractedField, type FairMarketBenchmark, type GlossaryItem, type InstallmentSchedule, type ReconciliationCheck } from "./analysisContext";
import rules from "@/data/analysisRules.json";
import { normalizeDocument } from "./documentNormalization";
import { inspectLegalStructure, resolveLegalReference } from "./documentStructure";
import { classifyPeriodRoles, selectLoanTerm, type PeriodCandidate } from "./periodRoles";
import { extractNumericCandidates, type NumericCandidate } from "./numericCandidates";
import { resolveConstrainedAssignment, type ConstraintAssignment } from "./constraintResolver";

const CURRENCY_AMOUNT_SOURCE = String.raw`(?:\$|₹|€|£|¥|US\$|C\$|A\$|S\$|usd|inr|eur|gbp|jpy|cad|aud|sgd|aed|rs\.?)`;
const PRICE_COMPARISON_PATTERN = new RegExp(
  String.raw`(?:was|mrp)\s*${CURRENCY_AMOUNT_SOURCE}\s*[\d,]+.*(?:now|offer)\s*${CURRENCY_AMOUNT_SOURCE}\s*[\d,]+`,
  "i"
);
let analysisSequence = 0;

function createAnalysisId(): string {
  analysisSequence += 1;
  return "analysis-" + Date.now().toString(36) + "-" + analysisSequence.toString(36);
}

function normalizedEvidence(source: string): string {
  const compact = source.replace(/\s+/g, " ").trim().replace(/[.!?;]+$/, "");
  return compact ? compact + "." : "Evidence unavailable.";
}

function compactSnippet(value: string, maxLength = Number.MAX_SAFE_INTEGER): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function cloneRegex(pattern: RegExp, forceGlobal = false): RegExp {
  const flagSet = new Set(pattern.flags.split(""));
  if (forceGlobal) flagSet.add("g");
  return new RegExp(pattern.source, Array.from(flagSet).join(""));
}

function findFirstEvidence(text: string, pattern: RegExp): string | null {
  const match = cloneRegex(pattern).exec(text);
  if (!match || match.index === undefined) return null;
  return segmentClauses(text).find((clause) => clause.start <= match.index! && match.index! < clause.end)?.text ?? compactSnippet(match[0]);
}

export interface ExtractedValues {
  loanAmount: number | null;
  interestRate: number | null;
  interestRateIsConditional?: boolean;
  rateCandidates: ParsedRateCandidate[];
  amountRelationships: AmountRelationship[];
  tenureMonths: number | null;
  principalField: ExtractedField<number>;
  rateField: AnalysisContext["rateField"];
  termField: ExtractedField<number>;
  statedEMI: ExtractedField<number>;
  amountCandidates: ReturnType<typeof extractAmountCandidates>;
  numericCandidates: NumericCandidate[];
  constraintAssignment: ConstraintAssignment;
  constraintMismatches: Array<{ id: string; label: string; evidence: string; position: number; message: string }>;
  paymentMatches: boolean;
  installmentCount: number | null;
  docType: AnalysisContext["docType"];
  extracted: boolean;
  periodCandidates: PeriodCandidate[];
  plausibilityConflicts: PrincipalPlausibilityConflict[];
}

export interface PrincipalPlausibilityConflict {
  field: "principal";
  principal: number;
  conflictingValue: number;
  label: string;
  source: string;
  kind: "fee" | "payment" | "fee_percent";
}

/** Preserve original document offsets after OCR repair, including nested field alternatives. */
function restoreOriginalEvidence<T>(value: T, document: ReturnType<typeof normalizeDocument>): T {
  const replacements = new Map<string, string>();
  const originalSource = (source: string, anchor?: number, span?: [number, number]) => {
    if (!source) return source;
    const insideSpan = span ? document.text.indexOf(source, span[0]) : -1;
    const near = anchor === undefined ? -1 : document.text.lastIndexOf(source, anchor);
    const start = insideSpan >= 0 && insideSpan < span![1] ? insideSpan : near >= 0 ? near : document.text.indexOf(source);
    if (start < 0) return source;
    const original = document.originalEvidence(start, start + source.length);
    if (source !== original) replacements.set(source, original);
    return original;
  };
  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (!entry || typeof entry !== "object") return entry;
    const object = entry as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    const span = (Array.isArray(object.clauseSpan) ? object.clauseSpan : Array.isArray(object.span) ? object.span : undefined) as [number, number] | undefined;
    const selectedCandidate = Array.isArray(object.alternatives) ? (object.alternatives as Array<Record<string, unknown>>).find((candidate) => candidate.value === object.value && candidate.source === object.source) : undefined;
    const anchor = typeof object.position === "number" ? object.position : typeof object.start === "number" ? object.start
      : span?.[0] ?? (typeof selectedCandidate?.position === "number" ? selectedCandidate.position : undefined);
    for (const [key, item] of Object.entries(object)) {
      if ((key === "source" || key === "evidence") && typeof item === "string") mapped[key] = originalSource(item, anchor, span);
      else if (["span", "clauseSpan", "amountSpan"].includes(key) && Array.isArray(item) && item.length === 2) mapped[key] = document.originalSpan(item[0], item[1]);
      else if (["position", "start", "bodyStart"].includes(key) && typeof item === "number") mapped[key] = document.originalSpan(item, item)[0];
      else if (key === "end" && typeof item === "number") mapped[key] = document.originalSpan(Math.max(0, item - 1), item)[1];
      else mapped[key] = visit(item);
    }
    return mapped;
  };
  const result = visit(value);
  const substitutions = [...replacements].sort((a, b) => b[0].length - a[0].length);
  const restoreEmbedded = (entry: unknown): unknown => {
    if (typeof entry === "string") {
      let restored = entry;
      for (const [normalized, original] of substitutions) restored = restored.split(normalized).join(original);
      return restored;
    }
    if (Array.isArray(entry)) return entry.map(restoreEmbedded);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, key === "rawText" ? document.originalText : ["source", "evidence"].includes(key) ? item : restoreEmbedded(item)]));
  };
  return restoreEmbedded(result) as T;
}

export function checkPrincipalPlausibility(text: string, principal: number | null, candidates = extractAmountCandidates(text)): PrincipalPlausibilityConflict[] {
  if (principal === null || principal <= 0) return [];
  const policy = (rules as unknown as { plausibility: { feePattern: string; paymentPattern: string; principalPercentBasisPattern: string } }).plausibility;
  if (!policy) return [];
  const conflicts: PrincipalPlausibilityConflict[] = [];
  const add = (kind: PrincipalPlausibilityConflict["kind"], value: number, label: string, source: string) => {
    if (value <= principal || conflicts.some((conflict) => conflict.kind === kind && conflict.conflictingValue === value && conflict.source === source)) return;
    conflicts.push({ field: "principal", principal, conflictingValue: value, label, source, kind });
  };
  for (const finding of resolveDefinedPercentageBases(text, detectCostsGeneric(text, principal, null, null).findings)) {
    if (finding.negated || finding.category === "protection" || finding.polarity === "hypothetical") continue;
    if (new RegExp(policy.feePattern, "i").test(finding.source)) {
      if (finding.amount !== null) add("fee", finding.amount, finding.label, finding.source);
      if (finding.percent !== null && finding.totalImpact !== null) {
        add("fee_percent", finding.totalImpact, finding.label + " (" + finding.percent + "% of " + (finding.basis ?? "the stated basis") + ")", finding.source);
      }
    }
  }
  for (const candidate of candidates) {
    if (["negated", "waived/zero", "hypothetical"].includes(classifyPolarity(candidate.source))) continue;
    const paymentLabel = new RegExp(policy.paymentPattern, "i").test(candidate.label);
    const feeLabel = new RegExp(policy.feePattern, "i").test(candidate.label);
    if (feeLabel || (!paymentLabel && new RegExp(policy.feePattern, "i").test(candidate.source))) {
      add("fee", candidate.value, candidate.label, candidate.source);
    }
    if (paymentLabel && !feeLabel) add("payment", candidate.value, candidate.label, candidate.source);
  }
  return conflicts;
}

/** Resolve percentage bases against declared terms while retaining any separately stated amount. */
function resolveDefinedPercentageBases(text: string, findings: CostFinding[]): CostFinding[] {
  const referencePattern = (rules as unknown as { legalStructure?: { amountReferencePattern?: string } }).legalStructure?.amountReferencePattern;
  if (!referencePattern) return findings;
  const structure = inspectLegalStructure(text);
  return findings.map((finding) => {
    if (finding.negated || finding.percent === null || finding.basis === "outstanding") return finding;
    for (const reference of finding.source.matchAll(new RegExp(referencePattern, "gi"))) {
      const label = reference.groups?.reference;
      if (!label) continue;
      const definition = resolveLegalReference(label, structure);
      if (definition?.amount === null || !definition) continue;
      const escaped = definition.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`^\\s*["“'‘]?${escaped}\\b`, "i").test(label)) continue;
      const amount = definition.amount * finding.percent / 100;
      const taxedAmount = amount * (1 + (finding.taxPercent ?? 0) / 100);
      return { ...finding, basis: definition.term, totalImpact: finding.category === "offset" ? -Math.abs(taxedAmount) : taxedAmount,
        amountNotStated: false, provenance: "computed" };
    }
    return finding;
  });
}

function applyPlausibility(field: ExtractedField<number>, conflicts: PrincipalPlausibilityConflict[]): ExtractedField<number> {
  const cap = (rules as unknown as { plausibility?: { confidenceCap?: number } }).plausibility?.confidenceCap ?? 0.35;
  return conflicts.length ? { ...field, value: null, source: null, confidence: Math.min(field.confidence, cap), needsReview: true } : field;
}

export function extractValuesFromText(originalText: string): ExtractedValues {
  const document = normalizeDocument(originalText);
  return restoreOriginalEvidence(extractValuesNormalized(document.text), document);
}

function locateFallbackEvidence(text: string, evidence: string | null): { source: string; position: number } | null {
  if (!evidence?.trim()) return null;
  const policy = (rules as unknown as { aiExtraction?: { evidenceMinimumCharacters?: number } }).aiExtraction;
  const normalizedEvidence = normalizeDocument(evidence).text.replace(/\s+/g, " ").trim();
  const minimumLength = policy?.evidenceMinimumCharacters ?? 8;
  if (normalizedEvidence.length < minimumLength) return null;
  const escaped = normalizedEvidence.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(escaped, "i").exec(text);
  if (!match || match.index === undefined) return null;
  return { source: match[0], position: match.index };
}

function extractValuesNormalized(text: string, aiFallback?: AIExtractedFields): ExtractedValues {
  const numericCandidates = extractNumericCandidates(text);
  const amountCandidates = extractAmountCandidates(text);
  const structure = inspectLegalStructure(text);
  const principalPattern = (rules as unknown as { legalStructure?: { principalTermPattern?: string } }).legalStructure?.principalTermPattern;
  for (const definition of structure.definitions) {
    if (definition.amount === null || !principalPattern || !new RegExp(principalPattern, "i").test(definition.term)) continue;
    const candidate = amountCandidates.find((item) => item.value === definition.amount && item.position >= definition.span[0] && item.position <= definition.span[1]);
    if (candidate) Object.assign(candidate, { label: definition.term, score: Math.max(candidate.score, 140), confidence: 0.98 });
  }
  const resolvedAmounts = resolveDerivedAmountCandidates(text, amountCandidates);
  const rateCandidates = extractRateCandidates(text);
  const docType = classifyDocument(text);
  const principalCandidates = docType.type === "merchant_cash_advance"
    ? resolvedAmounts.candidates.filter((candidate) => /net\s+proceeds|advance\s+amount|amount\s+(?:financed|advanced|funded)|principal/i.test(candidate.label))
    : resolvedAmounts.candidates;
  const resolutionConfig = (rules as unknown as { constraintResolution?: { financedAddOnPattern?: string; financedAddOnLabelPattern?: string } }).constraintResolution;
  const financedPattern = resolutionConfig?.financedAddOnPattern;
  const addOnPattern = resolutionConfig?.financedAddOnLabelPattern;
  const financedAddOns = amountCandidates.filter((candidate) => candidate.value > 0
    && addOnPattern && new RegExp(addOnPattern, "i").test(candidate.label + " " + candidate.source)
    && financedPattern && new RegExp(financedPattern, "i").test(candidate.source));
  const combinedPrincipalCandidates = principalCandidates.filter((candidate) => candidate.score > 0).flatMap((principal) => financedAddOns.map((addOn) => ({
    ...principal,
    value: principal.value + addOn.value,
    label: `${principal.label} including financed ${addOn.label}`,
    score: principal.score - 5,
    confidence: Math.max(0.75, principal.confidence - 0.05),
    relatedItems: [`${addOn.label} ${formatCurrency(addOn.value, detectCurrency(text) ?? "USD")}`],
  })));
  const assignmentCandidates = [...principalCandidates, ...combinedPrincipalCandidates];
  const aiConfig = (rules as unknown as { aiExtraction?: { valueTolerance?: number; fallbackConfidence?: number; roleCandidateScore?: number; baseRateEvidencePattern?: string; paymentEvidencePattern?: string } }).aiExtraction;
  const valueTolerance = aiConfig?.valueTolerance ?? 0.005;
  const fallbackConfidence = aiConfig?.fallbackConfidence ?? 0.78;
  const roleCandidateScore = aiConfig?.roleCandidateScore ?? 75;
  const principalFact = aiFallback?.principal;
  const principalEvidence = locateFallbackEvidence(text, principalFact?.evidence ?? null);
  if (principalFact?.value !== null && principalFact?.value !== undefined && principalEvidence && docType.type !== "credit_card") {
    const parsed = extractAmountCandidates(principalEvidence.source).find((candidate) => Math.abs(candidate.value - principalFact.value!) < valueTolerance && candidate.score > 0);
    const roleCandidate = extractNumericCandidates(principalEvidence.source).find((candidate) => Math.abs(candidate.value - principalFact.value!) < valueTolerance
      && candidate.roleScores.money !== undefined && candidate.roleScores.count === undefined && candidate.roleScores.time === undefined);
    if (parsed || roleCandidate) {
      assignmentCandidates.push({ value: principalFact.value, source: principalEvidence.source, position: principalEvidence.position,
        label: `AI-identified principal amount`, confidence: fallbackConfidence,
        score: Math.max(roleCandidateScore, parsed?.score ?? 0) });
    }
  }
  const annualAPRFact = aiFallback?.annualAPR;
  const annualEvidence = locateFallbackEvidence(text, annualAPRFact?.evidence ?? null);
  if (annualAPRFact?.value !== null && annualAPRFact?.value !== undefined && annualEvidence) {
    const matched = extractRateCandidates(annualEvidence.source).find((candidate) => candidate.role === "base" && Math.abs(candidate.value - annualAPRFact.value!) < valueTolerance);
    if (matched && !rateCandidates.some((candidate) => candidate.role === "base" && Math.abs(candidate.value - matched.value) < valueTolerance
      && candidate.source === annualEvidence.source)) {
      rateCandidates.push({ ...matched, start: annualEvidence.position, end: annualEvidence.position + annualEvidence.source.length, source: annualEvidence.source });
    } else if (!matched
      && aiConfig?.baseRateEvidencePattern && new RegExp(aiConfig.baseRateEvidencePattern, "i").test(annualEvidence.source)) {
      const rateRoleCandidate = extractNumericCandidates(annualEvidence.source).find((candidate) => Math.abs(candidate.value - annualAPRFact.value!) < valueTolerance
        && candidate.roleScores.rate !== undefined && candidate.roleScores.margin === undefined
        && candidate.roleScores.promotional === undefined && candidate.roleScores.penalty === undefined);
      if (rateRoleCandidate) rateCandidates.push({ value: annualAPRFact.value, statedValue: annualAPRFact.value, period: "year",
        basis: /\bflat\b/i.test(annualEvidence.source) ? "flat" : "unspecified", type: extractRateType(annualEvidence.source), role: "base",
        start: annualEvidence.position, end: annualEvidence.position + annualEvidence.source.length, source: annualEvidence.source, assumption: null });
    }
  }
  const statedEMI = extractStatedEMI(text, amountCandidates);
  let resolvedStatedEMI = statedEMI;
  const paymentFact = aiFallback?.payment;
  const paymentEvidence = locateFallbackEvidence(text, paymentFact?.evidence ?? null);
  if (statedEMI.value === null && paymentFact?.value !== null && paymentFact?.value !== undefined && paymentEvidence) {
    const matched = extractStatedEMI(paymentEvidence.source);
    if (matched.value !== null && Math.abs(matched.value - paymentFact.value) < valueTolerance) resolvedStatedEMI = { ...matched, confidence: fallbackConfidence };
    else if (aiConfig?.paymentEvidencePattern && new RegExp(aiConfig.paymentEvidencePattern, "i").test(paymentEvidence.source)) {
      const roleCandidate = extractNumericCandidates(paymentEvidence.source).find((candidate) => Math.abs(candidate.value - paymentFact.value!) < valueTolerance
        && candidate.roleScores.money !== undefined && candidate.roleScores.count === undefined && candidate.roleScores.time === undefined
        && candidate.roleScores.fee === undefined && candidate.roleScores.penalty === undefined);
      if (roleCandidate) resolvedStatedEMI = { value: paymentFact.value, source: paymentEvidence.source, confidence: fallbackConfidence,
        alternatives: [{ value: paymentFact.value, label: "AI-identified installment amount", source: paymentEvidence.source,
          position: paymentEvidence.position, confidence: fallbackConfidence, score: roleCandidateScore }], needsReview: false };
    }
  }
  const periodCandidates = classifyPeriodRoles(text);
  const termFact = aiFallback?.termMonths;
  const termEvidence = locateFallbackEvidence(text, termFact?.evidence ?? null);
  if (termFact?.value !== null && termFact?.value !== undefined && termEvidence) {
    const matched = classifyPeriodRoles(termEvidence.source).find((candidate) => candidate.role === "term" && Math.abs(candidate.months - termFact.value!) < valueTolerance);
    if (matched) {
      const position = termEvidence.position;
      if (!periodCandidates.some((candidate) => candidate.role === "term" && Math.abs(candidate.months - matched.months) < 0.01)) {
        periodCandidates.push({ ...matched, source: termEvidence.source, span: [position, position + termEvidence.source.length], confidence: fallbackConfidence });
      }
    }
  }
  let parsedTerm = selectLoanTerm(text, periodCandidates);
  let termField: ExtractedField<number> = parsedTerm
    ? { value: parsedTerm.months, source: parsedTerm.source, confidence: parsedTerm.confidence === "high" ? 0.95 : 0.65,
      alternatives: periodCandidates.filter((candidate) => candidate.role === "term").map((candidate) => ({ value: candidate.months, label: `${candidate.value} ${candidate.unit}`, source: candidate.source, position: candidate.span[0], confidence: candidate.confidence, score: candidate.confidence * 100 })), needsReview: false }
    : { value: null, source: null, confidence: 0, alternatives: periodCandidates.filter((candidate) => candidate.role === "term").map((candidate) => ({ value: candidate.months, label: `${candidate.value} ${candidate.unit}`, source: candidate.source, position: candidate.span[0], confidence: candidate.confidence, score: candidate.confidence * 100 })), needsReview: false };

  const constraintAssignment = resolveConstrainedAssignment({ principals: assignmentCandidates, rates: rateCandidates,
    periods: periodCandidates, payments: resolvedStatedEMI });
  if (constraintAssignment.matchedPayment && constraintAssignment.principal && constraintAssignment.rate && constraintAssignment.term) {
    parsedTerm = { months: constraintAssignment.term.months, source: constraintAssignment.term.source, confidence: "high" };
  }
  const baseRate = constraintAssignment.matchedPayment && constraintAssignment.rate
    ? constraintAssignment.rate : rateCandidates.find((candidate) => candidate.role === "base") ?? null;
  const promotionalRate = rateCandidates.find((candidate) => candidate.role === "promotional") ?? null;
  const deferredRate = rateCandidates.find((candidate) => candidate.role === "promotional"
    && /deferred|retroactiv|conditional/i.test(candidate.source)) ?? null;
  const selectedRate = baseRate ?? (promotionalRate === deferredRate ? null : promotionalRate);
  const conditionalRate = baseRate ? null : deferredRate;
  const interestRateIsConditional = conditionalRate !== null;
  let interestRate = selectedRate?.value ?? conditionalRate?.value ?? null;
  let rateSource = selectedRate?.source ?? conditionalRate?.source ?? null;
  let rateType: AnalysisContext["rateField"]["rateType"] = interestRateIsConditional ? "deferred"
    : selectedRate?.basis === "flat" ? "flat" : docType.type === "credit_card" ? "revolving" : selectedRate ? "reducing" : "unknown";
  let rateConfidence = selectedRate ? (selectedRate.assumption ? 0.82 : 0.95) : conditionalRate ? 0.92 : 0;
  if (interestRate === null && /\b(?:interest[- ]free|no\s+interest|0%\s+interest)\b/i.test(text)) {
    interestRate = 0;
    rateSource = segmentClauses(text).find((clause) => /interest[- ]free|no\s+interest|0%\s+interest/i.test(clause.text))?.text ?? null;
    rateType = "reducing";
    rateConfidence = 0.8;
  }
  const rateRole: AnalysisContext["rateField"]["rateRole"] = selectedRate?.role === "base" ? "base"
    : selectedRate ? "promotional" : conditionalRate ? "promotional" : interestRate === 0 ? "promotional" : "unknown";
  const basisAssumption = selectedRate?.assumption ?? conditionalRate?.assumption ?? null;
  let rateField: AnalysisContext["rateField"] = {
    value: interestRate,
    source: rateSource,
    confidence: rateConfidence,
    alternatives: rateCandidates.map((candidate) => ({ value: candidate.value, label: candidate.role + " rate", source: candidate.source, position: candidate.start, confidence: candidate.assumption ? 0.82 : 0.9, score: 0 })),
    needsReview: false,
    rateType,
    type: (selectedRate?.type ?? conditionalRate?.type ?? "unspecified") !== "unspecified"
      ? (selectedRate?.type ?? conditionalRate?.type ?? "unspecified") : extractRateType(text),
    basis: selectedRate?.basis ?? conditionalRate?.basis ?? "unspecified",
    rateRole,
    basisAssumption,
  };
  const paymentSchedule = extractInstallmentSchedule(text);
  const crossCheckEMI = paymentSchedule && paymentSchedule.intervalUnit !== "month" ? null : resolvedStatedEMI.value;
  let principalField = scorePrincipalCandidates(assignmentCandidates, interestRateIsConditional ? null : interestRate, parsedTerm, crossCheckEMI, docType.type);
  if (docType.type !== "credit_card" && constraintAssignment.matchedPayment && constraintAssignment.principal) {
    const selected = constraintAssignment.principal;
    principalField = { value: selected.value, source: selected.source, confidence: 0.99,
      alternatives: assignmentCandidates.slice(0, 8), needsReview: false };
  }
  if (principalField.value !== null && resolvedAmounts.relationships.some((relationship) => relationship.confirmed
    && /loan|principal|financed|borrowed|credit/i.test(relationship.baseLabel))) {
    principalField = { ...principalField, confidence: Math.max(principalField.confidence, 0.98), needsReview: false };
  }
  const crossCheck = principalField.value !== null && interestRate !== null && !interestRateIsConditional && termField.value !== null
    ? (rateType === "flat" ? calculateFlatLoan(principalField.value, interestRate, termField.value) : calculateEMI(principalField.value, interestRate, termField.value))
    : null;
  const paymentMatches = crossCheck !== null && crossCheckEMI !== null
    && Math.abs(crossCheck.emi - crossCheckEMI) / Math.max(crossCheckEMI, 0.01) <= 0.01;
  if (paymentMatches) {
    principalField = { ...principalField, confidence: Math.max(principalField.confidence, 0.99) };
    rateField = { ...rateField, confidence: Math.max(rateField.confidence, 0.99) };
    termField = { ...termField, confidence: Math.max(termField.confidence, 0.99) };
  }
  const plausiblePrincipal = principalField.value ?? (principalField.needsReview ? principalField.alternatives[0]?.value ?? null : null);
  const plausibilityConflicts = checkPrincipalPlausibility(text, plausiblePrincipal, amountCandidates);
  principalField = applyPlausibility(principalField, plausibilityConflicts);
  let loanAmount = principalField.value;
  const constraintMismatches: ExtractedValues["constraintMismatches"] = [];
  const addConstraintMismatch = (id: string, label: string, evidence: string, position: number, message: string) => {
    if (!constraintMismatches.some((item) => item.id === id && item.evidence === evidence)) constraintMismatches.push({ id, label, evidence, position, message });
  };
  if (constraintAssignment.matchedPayment === false && constraintAssignment.principal && constraintAssignment.rate && constraintAssignment.term
    && constraintAssignment.statedPayment !== null && constraintAssignment.expectedPayment !== null) {
    const selectedPrincipal = constraintAssignment.principal.value;
    const calculatedAPR = calculateEffectiveAPR([selectedPrincipal, ...Array<number>(Math.max(1, Math.round(constraintAssignment.term.months))).fill(-constraintAssignment.statedPayment)], 12);
    const statedAPR = constraintAssignment.rate.value;
    const impliedLabel = calculatedAPR ? `payment-implied APR ${(calculatedAPR.apr * 100).toFixed(2)}%` : `calculated payment ${constraintAssignment.expectedPayment.toFixed(2)}`;
    const evidence = statedEMI.source ?? constraintAssignment.rate.source;
    const position = Math.max(0, text.indexOf(evidence));
    addConstraintMismatch("emi_apr", "Stated APR / payment mismatch", evidence, position,
      `Stated APR ${statedAPR}% and principal ${selectedPrincipal} imply a payment of ${constraintAssignment.expectedPayment.toFixed(2)}, but the document states ${constraintAssignment.statedPayment.toFixed(2)} (${impliedLabel}). Competing candidates: principal ${selectedPrincipal}, APR ${statedAPR}%, term ${constraintAssignment.term.months} months.`);
    const cap = (rules as unknown as { plausibility?: { confidenceCap?: number } }).plausibility?.confidenceCap ?? 0.35;
    principalField = { ...principalField, value: null, source: null, confidence: Math.min(cap, principalField.confidence), needsReview: true };
    rateField = { ...rateField, value: null, source: null, confidence: Math.min(cap, rateField.confidence), needsReview: true };
    termField = { ...termField, value: null, source: null, confidence: Math.min(cap, termField.confidence), needsReview: true };
    interestRate = null;
    loanAmount = null;
  }
  const tolerance = (rules as unknown as { constraintResolution?: { totalTolerance?: number } }).constraintResolution?.totalTolerance ?? 0.01;
  const statedPaymentTotal = amountCandidates.find((candidate) => /total of payments|total repayment|total payable/i.test(candidate.label));
  if (paymentSchedule && statedPaymentTotal && Math.abs(paymentSchedule.total - statedPaymentTotal.value) / Math.max(statedPaymentTotal.value, 0.01) > tolerance) {
    const position = text.indexOf(statedPaymentTotal.source);
    addConstraintMismatch("payment_total", "Schedule / stated total mismatch", statedPaymentTotal.source, Math.max(0, position),
      `${paymentSchedule.count} payments × ${paymentSchedule.amount.toFixed(2)} = ${paymentSchedule.total.toFixed(2)}, while the stated total is ${statedPaymentTotal.value.toFixed(2)}.`);
  }
  for (const relationship of resolvedAmounts.relationships.filter((item) => item.expectedAmount !== null && !item.confirmed)) {
    const position = text.indexOf(relationship.source);
    addConstraintMismatch("fee_percent_" + position, "Percentage fee / stated amount mismatch", relationship.source, Math.max(0, position),
      `${relationship.baseLabel} at the stated percentage implies ${relationship.expectedAmount!.toFixed(2)}, but the clause gives ${relationship.derivedAmount.toFixed(2)}.`);
  }
  const statedFinanceCharge = amountCandidates.find((candidate) => /finance charge|interest charge|total interest/i.test(candidate.label));
  const financeBase = constraintAssignment.principal?.value ?? principalField.value;
  if (statedPaymentTotal && statedFinanceCharge && financeBase !== null) {
    const expectedTotal = financeBase + statedFinanceCharge.value;
    if (Math.abs(expectedTotal - statedPaymentTotal.value) / Math.max(statedPaymentTotal.value, 0.01) > tolerance) {
      addConstraintMismatch("principal_finance_total", "Principal + finance charge / total mismatch", statedPaymentTotal.source,
        Math.max(0, text.indexOf(statedPaymentTotal.source)),
        `${financeBase.toFixed(2)} principal + ${statedFinanceCharge.value.toFixed(2)} finance charge = ${expectedTotal.toFixed(2)}, while the stated total is ${statedPaymentTotal.value.toFixed(2)}.`);
    }
  }
  const installmentCountMatch = text.match(/\b(?:pay\s+in\s+)?(\d+)\s+(?:(?:interest[- ]free|equal|fixed|monthly|weekly|biweekly|fortnightly|scheduled)\s+){0,2}installments?\b/i);
  const installmentCount = installmentCountMatch ? Number(installmentCountMatch[1]) : null;

  return {
    loanAmount,
    interestRate,
    interestRateIsConditional,
    rateCandidates,
    amountRelationships: resolvedAmounts.relationships,
    tenureMonths: termField.value,
    principalField,
    rateField,
    termField,
    statedEMI: resolvedStatedEMI,
    amountCandidates,
    numericCandidates,
    constraintAssignment,
    constraintMismatches,
    paymentMatches,
    installmentCount,
    docType,
    extracted: loanAmount !== null || interestRate !== null || termField.value !== null,
    periodCandidates,
    plausibilityConflicts,
  };
}

export function detectDeception(text: string): DeceptionResult {
  const urgencyTactics: string[] = [];
  const fakeDiscounts: string[] = [];
  const emotionalManipulation: string[] = [];

  const urgencyRules: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /\bact\s*now\b/i, message: '"Act now" pressure language detected.' },
    { pattern: /\blimited\s*time\b/i, message: '"Limited time" framing may pressure hasty decisions.' },
    { pattern: /\bwon'?t\s*last\b/i, message: '"Won\'t last" scarcity tactic detected.' },
    { pattern: /\bhurry\b/i, message: '"Hurry" urgency language found.' },
    { pattern: /\bexpire(?:s|d)?\b[\s\S]{0,20}\bsoon\b/i, message: "Expiry pressure implies you must act immediately." },
  ];

  const fakeDiscountRules: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /\bsave\s*up\s*to\s*\d+%/i, message: '"Save up to" claim may be calculated against an inflated baseline.' },
    {
      pattern: /\bcompared\s*to\b[\s\S]{0,40}\b(?:tier|rate|plan)\b/i,
      message: "Discount compared to an internal tier may not reflect market reality.",
    },
  ];

  const emotionalRules: Array<{ pattern: RegExp; message: string }> = [
    {
      pattern: /\bonce[\s-]*in[\s-]*a[\s-]*lifetime\b/i,
      message: '"Once in a lifetime" exaggeration detected.',
    },
    { pattern: /\bdon'?t\s*miss\s*out\b/i, message: '"Don\'t miss out" FOMO tactic detected.' },
    {
      pattern: /\bexclusive\b[\s\S]{0,24}\b(?:offer|rate|deal|access)\b/i,
      message: '"Exclusive" framing detected in promotional context.',
    },
    { pattern: /\byou\s*deserve\b/i, message: '"You deserve" emotional appeal detected.' },
  ];

  for (const rule of urgencyRules) {
    const evidence = findFirstEvidence(text, rule.pattern);
    if (evidence) urgencyTactics.push(`${rule.message} Evidence: ${evidence}.`);
  }

  for (const rule of fakeDiscountRules) {
    const evidence = findFirstEvidence(text, rule.pattern);
    if (evidence) fakeDiscounts.push(`${rule.message} Evidence: ${evidence}.`);
  }

  const crossedOutEvidence = findFirstEvidence(text, PRICE_COMPARISON_PATTERN);
  if (crossedOutEvidence) {
    fakeDiscounts.push(`Crossed-out price pattern found. Evidence: ${crossedOutEvidence}.`);
  }

  for (const rule of emotionalRules) {
    const evidence = findFirstEvidence(text, rule.pattern);
    if (evidence) emotionalManipulation.push(`${rule.message} Evidence: ${evidence}.`);
  }

  return { urgencyTactics, fakeDiscounts, emotionalManipulation };
}

export function generateAdvice(riskScore: number, confidence: number, contradictedClaims: boolean, riskBreakdown: AnalysisContext["riskBreakdown"], confidenceIssues: string[] = [], confidenceThreshold = 0.7): AdviceResult {
  const reasons = riskBreakdown.flatMap((item) => item.reasons);
  if (contradictedClaims) reasons.unshift("A marketing claim conflicts with terms listed in the document.");
  if (confidence < confidenceThreshold) reasons.unshift(confidenceIssues.length
    ? "Required fields to verify: " + confidenceIssues.join(" ")
    : "Resolved inputs remain below the configured extraction-confidence threshold.");
  if (!reasons.length) reasons.push("No configured risk patterns were found in the extracted text.");
  return {
    recommendation: confidence < confidenceThreshold ? "insufficient_confidence" : riskScore >= rules.riskScoring.bands.caution || contradictedClaims ? "review_required" : "no_material_flags",
    reasons: Array.from(new Set(reasons)),
  };
}

export function generateLocalGlossary(input: string | CostFinding[]): GlossaryItem[] {
  const findings = typeof input === "string" ? detectCostsGeneric(input, null, null, null).findings : input;
  const active = findings.filter((finding) => finding.category !== "protection" && !finding.negated && finding.polarity !== "hypothetical");
  const glossary: GlossaryItem[] = [];
  for (const category of new Set(active.map((finding) => finding.category))) {
    const item = rules.categoryGlossary.find((entry) => entry.category === category);
    if (item) glossary.push({ term: item.term, definition: item.definition });
  }
  if (findings.some((finding) => finding.category === "protection")) glossary.push({ term: "Consumer protections", definition: "Documented exclusions, waivers, fixed rates, and cancellation windows limit the specified charges or obligations under their stated conditions." });
  return glossary;
}

export function generateLocalFairMarket(rate: number, currency: SupportedCurrency, docType: string, region: string | null): FairMarketBenchmark | undefined {
  const entries = (rules as { benchmarks?: Array<{ currency: string; docType: string; region: string | null; marketAverage: number; source: string; asOf: string }> }).benchmarks ?? [];
  const match = entries.find((entry) => entry.currency === currency && entry.docType === docType && entry.region === region);
  if (!match || rate <= 0 || !match.source || !match.asOf) return undefined;
  const differencePercent = Math.round(((rate - match.marketAverage) / match.marketAverage) * 100);
  return { marketAverage: match.marketAverage, differencePercent, source: match.source, asOf: match.asOf, assessment: rate + "% is " + (differencePercent >= 0 ? differencePercent + "% above" : Math.abs(differencePercent) + "% below") + " the matched " + match.docType + " benchmark." };
}

export function generateLocalAlternativeFunding(rate: number, amount: number, currencyCode: SupportedCurrency, docType: string, maximumSavings: number): AlternativeFunding[] {
  const entries = (rules as { alternatives?: Array<AlternativeFunding & { docTypes?: string[]; currencies?: string[]; maximumAPR?: number; savingsPercent?: number }> }).alternatives ?? [];
  return entries.flatMap((entry) => {
    if (entry.docTypes?.length && !entry.docTypes.includes(docType)) return [];
    if (entry.currencies?.length && !entry.currencies.includes(currencyCode)) return [];
    if (entry.maximumAPR !== undefined && rate > entry.maximumAPR) return [];
    if (entry.savingsPercent !== undefined && maximumSavings > 0) {
      const savings = Math.min(maximumSavings, Math.max(0, amount * entry.savingsPercent / 100));
      return [{ ...entry, estimatedSavings: "Up to " + formatCurrency(savings, currencyCode) + " (estimate)" }];
    }
    return [{ title: entry.title, description: entry.description, estimatedSavings: entry.estimatedSavings }];
  });
}

function extractInstallmentSchedule(text: string): InstallmentSchedule | null {
  const unitSpec = (raw: string): { unit: InstallmentSchedule["intervalUnit"]; months: number; periodsPerYear: number } | null => {
    const normalized = raw.toLowerCase().replace(/s$/, "");
    if (normalized === "day") return { unit: "day", months: 12 / 365, periodsPerYear: 365 };
    if (normalized === "week") return { unit: "week", months: 12 / 52, periodsPerYear: 52 };
    if (normalized === "fortnight") return { unit: "fortnight", months: 12 / 26, periodsPerYear: 26 };
    if (normalized === "month") return { unit: "month", months: 1, periodsPerYear: 12 };
    if (normalized === "year") return { unit: "year", months: 12, periodsPerYear: 1 };
    return null;
  };
  const termMonths = selectLoanTerm(text)?.months ?? null;
  const explicit = text.match(/\b(?:pay\s+in\s+)?(?<count>\d+)\s+(?:(?:interest[- ]free|equal|fixed|monthly|weekly|biweekly|fortnightly|scheduled)\s+){0,2}(?:installments?|instalments?|payments?)\s+of\s+(?<currency>US\$|C\$|A\$|S\$|\$|₹|€|£|¥|INR\s*|USD\s*|EUR\s*|GBP\s*|Rs\.?\s*)(?<amount>\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(?<decimal>\d+))?[\s\S]{0,100}?\bevery\s+(?<interval>\d+)?\s*(?<unit>days?|weeks?|fortnights?|months?|years?)/i);
  if (explicit?.groups) {
    const count = Number(explicit.groups.count);
    const amount = Number(explicit.groups.amount.replace(/,/g, "") + (explicit.groups.decimal ? "." + explicit.groups.decimal : ""));
    const interval = Number(explicit.groups.interval ?? 1);
    const spec = unitSpec(explicit.groups.unit);
    if (spec && [count, amount, interval].every(Number.isFinite) && count > 0 && amount > 0 && interval > 0) {
      return { count, amount, interval, intervalUnit: spec.unit, total: count * amount, totalWithKnownFees: null, source: compactSnippet(explicit[0]), firstPaymentTiming: "one period after agreement" };
    }
  }

  for (const clause of segmentClauses(text)) {
    const amounts = parseMonetaryValues(clause.text, clause.start).filter((value) => value.amount !== null);
    if (amounts.length === 0) continue;
    const frequency = /\b(daily|weekly|fortnightly|biweekly|monthly|quarterly|annually|yearly)\b/i.exec(clause.text);
    const explicitCount = /\b(?<count>\d+)\s+(?:(?:equal|monthly|weekly|biweekly|fortnightly|scheduled)\s+){0,2}(?:installments?|instalments?|payments?)\s+of\b/i.exec(clause.text);
    const intervalMatch = /\b(?:every|per|a|\/)\s*(?<interval>\d+)?\s*(?<unit>days?|weeks?|fortnights?|months?|years?)\b/i.exec(clause.text);
    const hasPaymentContext = /\b(?:payment|installment|instalment|emi|pay(?:ment)?)\b/i.test(clause.text);
    const frequencyUnit: Record<string, string> = {
      daily: "day",
      weekly: "week",
      fortnightly: "fortnight",
      biweekly: "fortnight",
      monthly: "month",
      quarterly: "month",
      annually: "year",
      yearly: "year",
    };
    const unitText = hasPaymentContext
      ? intervalMatch?.groups?.unit ?? frequencyUnit[(frequency?.[1] ?? "").toLowerCase()] ?? null
      : null;
    let spec = unitText ? unitSpec(unitText) : null;
    let interval = Number(intervalMatch?.groups?.interval ?? 1);
    if (/^quarterly$/i.test(frequency?.[1] ?? "")) interval = 3;
    if (!spec && explicitCount && termMonths !== null) {
      const amountCount = Number(explicitCount.groups?.count);
      if (amountCount > 0) {
        const frequencyMonths = termMonths / amountCount;
        const possible = [
          { unit: "day", months: 12 / 365, periodsPerYear: 365 },
          { unit: "week", months: 12 / 52, periodsPerYear: 52 },
          { unit: "fortnight", months: 12 / 26, periodsPerYear: 26 },
          { unit: "month", months: 1, periodsPerYear: 12 },
          { unit: "year", months: 12, periodsPerYear: 1 },
        ] as const;
        const closest = [...possible].sort((a, b) => Math.abs(a.months - frequencyMonths) - Math.abs(b.months - frequencyMonths))[0];
        if (closest && Math.abs(closest.months - frequencyMonths) < Math.max(0.02, closest.months * 0.03)) spec = closest;
      }
    }
    if (!spec || interval <= 0) continue;
    const termCount = termMonths !== null ? Math.round(termMonths / (spec.months * interval)) : null;
    const count = explicitCount ? Number(explicitCount.groups?.count) : termCount;
    const amount = amounts[0].amount;
    if (count && count > 0 && amount !== null && amount > 0) {
      return {
        count,
        amount,
        interval,
        intervalUnit: spec.unit,
        total: count * amount,
        totalWithKnownFees: null,
        source: clause.text,
        firstPaymentTiming: "one period after agreement",
      };
    }
  }
  if (classifyDocument(text).type === "merchant_cash_advance") {
    const remittanceClause = segmentClauses(text).find((clause) => /\b(?:daily|weekly|monthly|per\s+day|per\s+week)\b[^.;]{0,50}\b(?:remittance|remit|withhold|debit)\b|\b(?:remittance|remit|withhold|debit)\b[^.;]{0,50}\b(?:daily|weekly|monthly|per\s+day|per\s+week)\b/i.test(clause.text));
    const remittance = remittanceClause && parseMonetaryValues(remittanceClause.text, remittanceClause.start).find((value) => value.amount !== null);
    const purchased = extractAmountCandidates(text).filter((candidate) => /purchased amount|receivables purchased|total repayment|total of payments/i.test(candidate.label + " " + candidate.source))
      .sort((left, right) => right.score - left.score)[0];
    const frequency = remittanceClause?.text.match(/\b(daily|weekly|monthly)\b|\bper\s+(day|week)\b/i)?.[0]?.toLowerCase();
    const unit: InstallmentSchedule["intervalUnit"] = frequency?.includes("week") ? "week" : frequency?.includes("month") ? "month" : "day";
    if (remittance?.amount && purchased && purchased.value >= remittance.amount) {
      const count = Math.round(purchased.value / remittance.amount);
      if (count > 0 && Math.abs(count * remittance.amount - purchased.value) <= Math.max(1, purchased.value * 0.01)) {
        return { count, amount: remittance.amount, interval: 1, intervalUnit: unit, total: count * remittance.amount,
          totalWithKnownFees: null, source: remittanceClause!.text, firstPaymentTiming: "one period after agreement" };
      }
    }
  }
  return null;
}

function confidenceForAnalysis(context: Pick<AnalysisContext, "docType" | "principalField" | "rateField" | "termField" | "installmentSchedule">): number {
  const type = context.docType.type;
  const scores = [context.docType.confidence];
  if (["installment_loan", "personal_loan_kfs", "student_loan", "merchant_cash_advance", "auto_loan", "mortgage", "bnpl", "payday", "rent_to_own", "gold_loan"].includes(type)) {
    scores.push(context.principalField.confidence);
    if (type === "bnpl") scores.push(context.installmentSchedule ? 0.9 : context.termField.confidence);
    else if (type === "merchant_cash_advance") {
      scores.push(context.installmentSchedule ? 0.9 : 0.35);
      if (context.rateField.rateRole === "implied") scores.push(context.rateField.confidence);
    }
    else scores.push(context.termField.confidence, context.rateField.confidence);
  }
  if (type === "unknown") scores.push(context.principalField.confidence, context.rateField.confidence, context.termField.confidence);
  return scores.length ? Math.min(...scores) : context.docType.confidence;
}

function analyzeLocallyLegacy(
  text: string,
  amountOverride: number | null = null,
  rateOverride: number | null = null,
  durationOverride: number | null = null,
  currencyOverride: SupportedCurrency | null = null,
): AnalysisContext {
  const extracted = extractValuesFromText(text);
  const principalField: AnalysisContext["principalField"] = amountOverride && amountOverride > 0
    ? { value: amountOverride, source: "User override", confidence: 1, alternatives: extracted.principalField.alternatives, needsReview: false }
    : extracted.principalField;
  const termField: AnalysisContext["termField"] = durationOverride && durationOverride > 0
    ? { value: durationOverride, source: "User override", confidence: 1, alternatives: extracted.termField.alternatives, needsReview: false }
    : extracted.termField;
  const useRateOverride = rateOverride !== null && rateOverride >= 0 && rateOverride !== extracted.rateField.value;
  const rateType: AnalysisContext["rateField"]["rateType"] = useRateOverride
    ? extracted.rateField.rateType === "deferred" ? "deferred" : "reducing"
    : extracted.rateField.rateType;
  const rateField: AnalysisContext["rateField"] = useRateOverride
    ? { value: rateOverride, source: "User override", confidence: 1, alternatives: extracted.rateField.alternatives, needsReview: false, rateType, type: "unspecified", basis: "unspecified", rateRole: "base", basisAssumption: null }
    : { ...extracted.rateField, rateType };
  const currency = currencyOverride ?? detectCurrency(text);
  const currencyCode = currency ?? "USD";
  const principal = principalField.value;
  const duration = termField.value;
  const schedule = extractInstallmentSchedule(text);
  const installmentCount = schedule?.count ?? extracted.installmentCount;
  const findings = detectCosts(text, principal, installmentCount, duration);
  const fees = findings.filter((finding) => finding.category !== "financed_addon" && finding.category !== "tax");
  const addOns = findings.filter((finding) => finding.category === "financed_addon");
  const taxes = findings.filter((finding) => finding.category === "tax");
  const claims = detectClaims(text, findings, rateField.rateType === "deferred" ? null : rateField.value);
  const confidence = confidenceForAnalysis({ docType: extracted.docType, principalField, rateField, termField, installmentSchedule: schedule });
  const risk = calculateRisk(text, extracted.docType.type, findings, claims, confidence);
  const warnings: string[] = [];
  for (const claim of claims.filter((item) => item.contradicted)) warnings.push(claim.label + ": " + claim.contradiction + " Evidence: " + claim.source + ".");
  for (const finding of findings.filter((item) => !item.negated)) warnings.push(finding.label + " detected. " + finding.explanation + " Evidence: " + finding.source + ".");
  for (const rule of rules.riskRules) {
    if (!rule.pattern) continue;
    const evidence = findFirstEvidence(text, new RegExp(rule.pattern, "i"));
    if (evidence) warnings.push(rule.id.replace(/_/g, " ") + " term detected. Evidence: " + evidence + ".");
  }
  if (extracted.interestRateIsConditional && rateField.value !== null) {
    warnings.push("Conditional deferred APR of " + extracted.interestRate + "% is stated; it is not used as the standard payment rate. Evidence: " + (rateField.source ?? "deferred-interest clause") + ".");
  }
  if (principalField.needsReview) warnings.push("The principal amount is ambiguous or conflicts with the stated installment; choose a source amount before relying on payment calculations.");
  if (currency === null) warnings.push("Currency was not identified in the text; amounts are displayed using the USD fallback until you select a currency.");

  if (schedule) {
    const knownFees = findings.filter((finding) => !finding.negated && (
      finding.frequency === "per_installment" ||
      (finding.frequency === "monthly" && finding.category === "financed_addon" && /automatically added|automatically enrolled/i.test(finding.source))
    )).reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
    schedule.totalWithKnownFees = schedule.total + knownFees;
    if (principal !== null && Math.abs(schedule.total - principal) > 0.01) {
      warnings.push("The stated installments total " + formatCurrency(schedule.total, currencyCode) + ", which differs from the purchase or principal amount " + formatCurrency(principal, currencyCode) + ".");
    }
    if (knownFees > 0) warnings.push("Scheduled payments plus identified recurring charges total at least " + formatCurrency(schedule.totalWithKnownFees, currencyCode) + "; conditional missed-payment charges are excluded.");
  }

  const hiddenFees = findings.filter((finding) => !finding.negated).map((finding) => {
    const impact = finding.totalImpact !== null ? " Estimated impact: " + formatCurrency(finding.totalImpact, currencyCode) + "." : " Total impact could not be determined from the text.";
    return finding.label + ": " + finding.source + "." + impact;
  });
  const standardRateAvailable = rateField.value !== null && rateField.rateType !== "deferred" && rateField.rateType !== "revolving";
  const financeCalculationAllowed = !["bnpl", "credit_card", "subscription", "advance_fee_scam"].includes(extracted.docType.type);
  const financialMetricsAvailable = Boolean(principal && principal > 0 && duration && duration > 0 && standardRateAvailable && financeCalculationAllowed);
  const upfrontFees = findings.filter((finding) => !finding.negated && finding.category === "upfront_fee" && finding.totalImpact !== null).reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const monthlyCost = findings.filter((finding) => !finding.negated && finding.frequency === "monthly" && finding.category !== "tax" && finding.amount !== null).reduce((sum, finding) => sum + (finding.amount ?? 0), 0);
  const annualCost = findings.filter((finding) => !finding.negated && finding.frequency === "annual" && finding.totalImpact !== null).reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const monthlyFees = monthlyCost + (duration && duration > 0 ? annualCost / duration : 0);
  let emi: number | null = null;
  let totalPayment: number | null = null;
  let totalInterest: number | null = null;
  let totalCost: number | null = null;
  let effectiveAPR: number | null = null;
  let netDisbursed: number | null = null;
  if (financialMetricsAvailable && principal !== null && duration !== null && rateField.value !== null) {
    const base = rateField.rateType === "flat"
      ? calculateFlatLoan(principal, rateField.value, duration)
      : calculateEMI(principal, rateField.value, duration);
    const analysis = analyzeLoan({ principal, annualRate: rateField.value, tenureMonths: duration, rateType: rateField.rateType === "flat" ? "flat" : "reducing", upfrontFees, monthlyFees });
    if (base && analysis) {
      emi = base.emi + monthlyFees;
      totalPayment = analysis.totalPayment;
      totalInterest = base.totalInterest;
      netDisbursed = analysis.netDisbursed;
      totalCost = analysis.totalCost;
      effectiveAPR = analysis.effectiveAPR;
    }
  }

  const advice = generateAdvice(risk.score, confidence, claims.some((claim) => claim.contradicted), risk.breakdown);
  const conditionalText = extracted.interestRateIsConditional && rateField.value !== null
    ? " A conditional deferred APR of " + extracted.interestRate + "% may be charged retroactively; it is not modeled as the standard installment rate."
    : "";
  const feeText = hiddenFees.length ? hiddenFees.length + " cost clause(s) were identified." : "No configured fee clauses were identified in the text.";
  const summary = schedule
    ? "The document schedules " + schedule.count + " payments of " + formatCurrency(schedule.amount, currencyCode) + " every " + schedule.interval + " " + schedule.intervalUnit + (schedule.interval === 1 ? "" : "s") + ", totaling " + formatCurrency(schedule.total, currencyCode) + " before fees. " + feeText + conditionalText
    : financialMetricsAvailable && emi !== null && totalPayment !== null && totalInterest !== null && principal !== null && duration !== null
      ? "The agreement states " + formatCurrency(principal, currencyCode) + " at " + rateField.value + "% " + (rateField.rateType === "flat" ? "flat " : "") + "annual rate over " + duration + " months. Estimated monthly payment including identified monthly fees is " + formatCurrency(emi, currencyCode) + "; scheduled payments total " + formatCurrency(totalPayment, currencyCode) + ", with an estimated total finance cost of " + formatCurrency(totalCost, currencyCode) + " including " + formatCurrency(totalInterest, currencyCode) + " interest and modeled fees." + (effectiveAPR !== null ? " Estimated effective APR after modeled fees is " + effectiveAPR.toFixed(2) + "%." : "") + " " + feeText
      : "Document scan classified this as " + extracted.docType.label.toLowerCase() + ". " + feeText + conditionalText + " Payment calculations are partial until the required amount, applicable rate, and term are supported.";

  const insights: string[] = [];
  if (schedule) insights.push("Installment arithmetic: " + schedule.count + " × " + formatCurrency(schedule.amount, currencyCode) + " = " + formatCurrency(schedule.total, currencyCode) + " before fees.");
  if (schedule?.totalWithKnownFees !== null && schedule?.totalWithKnownFees !== undefined && schedule.totalWithKnownFees > schedule.total) {
    insights.push("Identified fees raise scheduled cost to at least " + formatCurrency(schedule.totalWithKnownFees, currencyCode) + "; missed-payment and rescheduling costs are conditional.");
  }
  if (principalField.needsReview) insights.push("More than one amount could be the principal. Select the labeled amount that matches the contract's amount financed.");
  if (effectiveAPR !== null && rateField.value !== null && effectiveAPR > rateField.value + 0.01) {
    insights.push("Modeled fees raise the estimated effective APR from " + rateField.value + "% to " + effectiveAPR.toFixed(2) + "%.");
  }

  const simulatorLateFee = findings.find((finding) => finding.id === "late_payment" && !finding.negated);
  const penaltyMatch = text.match(/\bpenalty\s*apr\b[^\d]{0,25}(\d+(?:\.\d+)?)\s*%/i);
  const maximumSavings = (totalInterest ?? 0) + findings.filter((finding) => !finding.negated).reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const context: AnalysisContext = {
    id: createAnalysisId(),
    docType: extracted.docType,
    region: null,
    currency,
    currencyCode,
    principalField,
    rateField,
    termField,
    statedEMI: extracted.statedEMI,
    installmentSchedule: schedule,
    principal,
    findings: findings.map(canonicalFinding),
    protections: findings.filter((finding) => finding.category === "protection").map(canonicalFinding),
    fees,
    addOns,
    taxes,
    offsets: findings.filter((finding) => finding.category === "offset"),
    itemGroups: [],
    amountRelationships: [],
    reconciliations: [],
    calculator: { calculator: "legacy", label: "Legacy calculation", available: financialMetricsAvailable, missingInputs: [] },
    ranCalculators: financialMetricsAvailable ? ["legacy"] : [],
    cashPriceAnalysis: null,
    costBreakdown: { interest: totalInterest ?? 0, taxes: 0, fees: upfrontFees, optionalProducts: 0, offsets: 0, financingCost: totalCost ?? 0 },
    confidenceIssues: [],
    addOnImpact: null,
    netExtraCost: null,
    netExtraCostPercent: null,
    claims,
    confidence,
    warnings: Array.from(new Set(warnings)),
    riskScore: risk.score,
    riskBand: risk.band,
    analysisIncomplete: confidence < rules.analysisConfidenceThreshold,
    riskBreakdown: risk.breakdown,
    summary,
    hiddenFees,
    insights,
    emi,
    totalPayment,
    totalInterest,
    totalCost,
    financialMetricsAvailable: financialMetricsAvailable && emi !== null,
    effectiveAPR,
    netDisbursed,
    deception: detectDeception(text),
    advice,
    glossary: generateLocalGlossary(text),
    fairMarketComparison: standardRateAvailable && rateField.value !== null
      ? generateLocalFairMarket(rateField.value, currencyCode, extracted.docType.type, null)
      : undefined,
    alternativeFunding: standardRateAvailable && rateField.value !== null && principal !== null
      ? generateLocalAlternativeFunding(rateField.value, principal, currencyCode, extracted.docType.type, maximumSavings)
      : [],
    simulator: {
      lateFeeAmount: simulatorLateFee?.amount ?? null,
      lateFeePercent: simulatorLateFee?.percent ?? null,
      lateFeeBasis: simulatorLateFee?.basis ?? null,
      penaltyAPR: penaltyMatch ? Number(penaltyMatch[1]) : null,
      isAssumption: !simulatorLateFee && !penaltyMatch,
    },
    rawText: text,
  };
  return freezeAnalysisContext(context) as AnalysisContext;
}

export function analyzeLocally(
  originalText: string,
  amountOverride: number | null = null,
  rateOverride: number | null = null,
  durationOverride: number | null = null,
  currencyOverride: SupportedCurrency | null = null,
  aiFallback?: AIExtractedFields,
): AnalysisContext {
  const document = normalizeDocument(originalText);
  const text = document.text;
  const extracted = extractValuesNormalized(text, aiFallback);
  let principalField: AnalysisContext["principalField"] = amountOverride !== null && amountOverride > 0
    ? { value: amountOverride, source: "User override", confidence: 1, alternatives: extracted.principalField.alternatives, needsReview: false }
    : extracted.principalField;
  const termField: AnalysisContext["termField"] = durationOverride !== null && durationOverride > 0
    ? { value: durationOverride, source: "User override", confidence: 1, alternatives: extracted.termField.alternatives, needsReview: false }
    : extracted.termField;
  const useRateOverride = rateOverride !== null && rateOverride >= 0 && rateOverride !== extracted.rateField.value;
  const rateType: AnalysisContext["rateField"]["rateType"] = useRateOverride
    ? extracted.rateField.rateType === "deferred" ? "deferred" : "reducing"
    : extracted.rateField.rateType;
  let rateField: AnalysisContext["rateField"] = useRateOverride
    ? { value: rateOverride, source: "User override", confidence: 1, alternatives: extracted.rateField.alternatives, needsReview: false, rateType, type: "unspecified", basis: "unspecified", rateRole: "base", basisAssumption: null }
    : { ...extracted.rateField, rateType };
  const currency = currencyOverride ?? detectCurrency(text);
  const currencyCode = currency ?? "USD";
  let principal = principalField.value;
  const duration = termField.value;
  const schedule = extractInstallmentSchedule(text);
  const installmentCount = schedule?.count ?? extracted.installmentCount;
  const mca = extracted.docType.type === "merchant_cash_advance";
  const priceCandidate = extracted.amountCandidates
    .filter((candidate) => candidate.score > 0 && (mca
      ? /net\s+proceeds|advance\s+amount|amount\s+(?:financed|advanced|funded)/i.test(candidate.label)
      : /net\s+proceeds|amount\s+(?:advanced|funded)|purchased\s+amount|receivables\s+purchased|purchase\s+(?:amount|price)|(?:vehicle|cash|sale)\s+price/i.test(candidate.label + " " + candidate.source)))
    .sort((a, b) => b.score - a.score || a.position - b.position)[0];
  const cashPrice = mca ? priceCandidate?.value ?? null : priceCandidate?.value ?? principal;
  const periodsPerYear: Record<InstallmentSchedule["intervalUnit"], number> = { day: 365, week: 52, fortnight: 26, month: 12, year: 1 };
  let cashPriceAnalysis: CashPriceAnalysis | null = null;
  if (cashPrice !== null && cashPrice > 0 && schedule) {
    const periods = periodsPerYear[schedule.intervalUnit] / schedule.interval;
    const implied = calculateEffectiveAPR([cashPrice, ...Array<number>(schedule.count).fill(-schedule.amount)], periods);
    cashPriceAnalysis = {
      cashPrice,
      totalPaid: schedule.total,
      multiple: schedule.total / cashPrice,
      extraCost: schedule.total - cashPrice,
      impliedNominalAPR: implied ? implied.apr * 100 : null,
      periodsPerYear: periods,
      firstPaymentTiming: "one period after agreement",
    };
    if (rateField.value === null && cashPriceAnalysis.impliedNominalAPR !== null) {
      rateField = { ...rateField, value: cashPriceAnalysis.impliedNominalAPR, source: "Implied from cash price and payment schedule", confidence: 0.85, rateRole: "implied", rateType: "unknown", basisAssumption: "IRR assumes the first payment is one payment period after agreement." };
    }
  }
  let detected = detectCostsGeneric(text, principal, installmentCount, duration, extracted.statedEMI.value);
  detected = { ...detected, findings: resolveDefinedPercentageBases(text, detected.findings) };
  let reconciliationResolution: string | null = null;
  if (principal === null && priceCandidate && principalField.alternatives.length > 0) {
    const initialAddOns = detected.findings.filter((finding) => finding.category === "financed_addon" && finding.amount !== null)
      .reduce((sum, finding) => sum + (finding.amount ?? 0), 0);
    const initialFees = detected.findings.filter((finding) => finding.category === "upfront_fee" && !finding.negated)
      .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
    const initialDiscount = detected.findings.filter((finding) => finding.category === "offset" && !/interest|finance charge/i.test(finding.source))
      .reduce((sum, finding) => sum + Math.abs(finding.totalImpact ?? finding.amount ?? 0), 0);
    const downPayment = extracted.amountCandidates.find((candidate) => /down\s+payment|deposit|trade[- ]in\s+credit/i.test(candidate.label))?.value ?? 0;
    const partsTotal = priceCandidate.value + initialAddOns + initialFees - downPayment - initialDiscount;
    const reconciled = principalField.alternatives.filter((candidate) => Math.abs(candidate.value - partsTotal) <= Math.max(1, partsTotal * 0.005));
    if (reconciled.length === 1) {
      const selected = reconciled[0];
      const otherCandidates = principalField.alternatives.filter((candidate) => candidate.value !== selected.value)
        .slice(0, 3).map((candidate) => formatCurrency(candidate.value, currencyCode));
      principalField = { value: selected.value, source: selected.source, confidence: 0.92, alternatives: principalField.alternatives, needsReview: false };
      principal = selected.value;
      reconciliationResolution = "Principal candidates " + [formatCurrency(selected.value, currencyCode), ...otherCandidates].join(" vs ")
        + " were checked against price plus financed items; the sum matched " + formatCurrency(partsTotal, currencyCode) + ".";
      detected = detectCostsGeneric(text, principal, installmentCount, duration, extracted.statedEMI.value);
      detected = { ...detected, findings: resolveDefinedPercentageBases(text, detected.findings) };
    }
  }
  const plausiblePrincipal = principal ?? (principalField.needsReview ? principalField.alternatives[0]?.value ?? null : null);
  const plausibilityConflicts = checkPrincipalPlausibility(text, plausiblePrincipal, extracted.amountCandidates);
  principalField = applyPlausibility(principalField, plausibilityConflicts);
  principal = principalField.value;
  if (principalField.needsReview && cashPrice === principal) {
    cashPriceAnalysis = null;
    if (rateField.rateRole === "implied") rateField = { ...extracted.rateField };
  }
  const allFindings = Array.from(new Map(detected.findings.map((finding) => [
    finding.position + ":" + finding.id + ":" + finding.category + ":" + finding.source.replace(/\s+/g, " ").trim().toLowerCase(),
    finding,
  ])).values());
  const fees = allFindings.filter((finding) => !["financed_addon", "tax", "offset", "protection", "conditional_term"].includes(finding.category));
  const addOns = allFindings.filter((finding) => finding.category === "financed_addon");
  const offsets = allFindings.filter((finding) => finding.category === "offset");
  const registry = (rules as { calculatorRegistry?: { default?: string; documentTypes?: Record<string, string> }; calculatorInputs?: Record<string, string[]> }).calculatorRegistry;
  const requirements = (rules as { calculatorInputs?: Record<string, string[]> }).calculatorInputs ?? {};
  const selectedCalculator = rateField.rateType === "flat" ? "flat"
    : registry?.documentTypes?.[extracted.docType.type] ?? registry?.default ?? "reducing_balance";
  const calculatorLabel = selectedCalculator.replace(/_/g, " ");
  const minimumPaymentClause = segmentClauses(text).find((clause) => /\bminimum\s+payment\b/i.test(clause.text))?.text ?? "";
  const minimumPaymentFloorMatch = minimumPaymentClause.match(/(?:[$€£₹]|Rs\.?)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?/);
  const minimumPaymentPercentMatch = minimumPaymentClause.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(?:outstanding|balance)\b/i);
  const minimumPaymentFloor = minimumPaymentFloorMatch ? Number(minimumPaymentFloorMatch[1].replace(/,/g, "")) : null;
  const minimumPaymentPercent = minimumPaymentPercentMatch ? Number(minimumPaymentPercentMatch[1]) : null;
  const hasPaymentRule = minimumPaymentFloor !== null && minimumPaymentPercent !== null;
  const inputValue: Record<string, boolean> = {
    principal: principal !== null && principal > 0,
    rate: rateField.value !== null && rateField.rateRole !== "implied" && rateField.rateRole !== "penalty" && rateField.rateType !== "deferred" && (rateField.rateType !== "revolving" || selectedCalculator === "revolving"),
    term: duration !== null && duration > 0,
    payment_rule: hasPaymentRule,
    cash_price: cashPrice !== null && cashPrice > 0,
    scheduled_total: schedule !== null,
  };
  const required = requirements[selectedCalculator] ?? requirements.reducing_balance ?? ["principal", "rate", "term"];
  const unresolvedInput: Record<string, boolean> = {
    principal: principalField.needsReview,
    cash_price: principalField.needsReview && cashPrice === principal,
    rate: rateField.needsReview,
    term: termField.needsReview,
  };
  const inputConfidence: Record<string, number> = {
    principal: principalField.value === null ? 0 : principalField.confidence,
    rate: rateField.value === null || rateField.rateRole === "implied" || rateField.rateRole === "penalty" ? 0 : rateField.confidence,
    term: termField.value === null ? 0 : termField.confidence,
    payment_rule: hasPaymentRule ? 0.9 : 0,
    cash_price: priceCandidate?.confidence ?? (cashPrice !== null ? principalField.confidence : 0),
    scheduled_total: schedule ? 0.95 : 0,
  };
  const requiredMissing = required.filter((input) => !inputValue[input] || unresolvedInput[input]);
  const missingInputs = requiredMissing.map((input) => {
    const labels: Record<string, string> = {
      principal: "principal / amount financed",
      rate: "applicable interest rate",
      term: "repayment term",
      payment_rule: "minimum-payment rule",
      cash_price: "cash price",
      scheduled_total: "stated payment schedule",
    };
    return labels[input] ?? input;
  });
  const calculator = {
    calculator: selectedCalculator,
    label: calculatorLabel,
    available: missingInputs.length === 0 && selectedCalculator !== "short_term",
    missingInputs,
    unsupportedReason: selectedCalculator === "short_term"
      ? "This short-term repayment pattern is not modeled as a monthly EMI; the stated schedule and cash-price comparison are shown where available."
      : null,
  };
  const threshold = rules.analysisConfidenceThreshold;
  let confidence = required.length
    ? Math.min(...required.map((input) => inputConfidence[input] ?? 0))
    : extracted.docType.confidence;
  const unresolvedRequired = required.some((input) => unresolvedInput[input]);
  const incompleteAnalysis = missingInputs.length > 0 || unresolvedRequired || confidence < threshold || Boolean(calculator.unsupportedReason);
  const confidenceIssues: string[] = [...extracted.constraintMismatches.map((mismatch) => mismatch.message), ...plausibilityConflicts.map((conflict) => "Principal " + formatCurrency(conflict.principal, currencyCode)
    + " is smaller than " + conflict.label + " " + formatCurrency(conflict.conflictingValue, currencyCode) + ". Evidence: " + conflict.source)];
  const alternativesText = (field: ExtractedField<number>) => field.alternatives.slice(0, 5)
    .map((candidate) => candidate.label + " " + formatCurrency(candidate.value, currencyCode))
    .join("; ");
  const issueFor: Record<string, string> = {
    principal: "principal: " + (alternativesText(principalField) || "no labeled amount candidates") + "; excluded derived amounts and checked payment/reconciliation evidence.",
    rate: "base rate: " + (extracted.rateCandidates.length
      ? "considered " + extracted.rateCandidates.map((candidate) => candidate.role + " " + candidate.statedValue + "% per " + candidate.period + (candidate.role === "penalty" ? " (excluded from base pricing)" : "")).join("; ")
      : "no base or promotional rate candidate was found") + ".",
    term: "repayment term: " + (termField.value !== null ? termField.value + " months" : "no labeled repayment duration candidate was found") + ".",
    payment_rule: "minimum-payment rule: the percentage and floor required by this calculator were not both found.",
    cash_price: "cash price: " + (priceCandidate ? priceCandidate.label + " " + formatCurrency(priceCandidate.value, currencyCode) : "no labeled cash or purchase price candidate was found") + ".",
    scheduled_total: "payment schedule: " + (schedule ? schedule.count + " payments were parsed" : "no complete amount, frequency, count, or term schedule was found") + ".",
  };
  for (const input of required) {
    if (!inputValue[input] || unresolvedInput[input]) confidenceIssues.push(issueFor[input] ?? input + ": no resolved candidate was found.");
    else if ((inputConfidence[input] ?? 0) < threshold) {
      confidenceIssues.push((issueFor[input] ?? input + ": extracted value") + " Confidence is " + Math.round((inputConfidence[input] ?? 0) * 100) + "%, below the " + Math.round(threshold * 100) + "% threshold.");
    }
  }
  if (calculator.unsupportedReason) confidenceIssues.push(calculator.unsupportedReason);
  const supportsAmortizingCalculation = ["reducing_balance", "reducing_balance_with_offsets_and_tax", "flat"].includes(selectedCalculator);
  const financialMetricsAvailable = calculator.available && (supportsAmortizingCalculation || selectedCalculator === "revolving");
  const upfrontFees = fees.filter((finding) => finding.category === "upfront_fee" && !finding.negated && finding.totalImpact !== null)
    .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const monthlyCharges = allFindings.filter((finding) => !finding.negated
    && finding.frequency === "monthly"
    && !["tax", "offset", "penalty"].includes(finding.category)
    && finding.amount !== null
    && !/included in (?:the )?amount financed|financed into (?:the )?(?:loan|agreement)/i.test(finding.source))
    .reduce((sum, finding) => sum + (finding.amount ?? 0), 0);
  const annualCharges = fees.filter((finding) => !finding.negated && finding.frequency === "annual" && finding.totalImpact !== null)
    .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const monthlyFees = monthlyCharges + (duration && duration > 0 ? annualCharges / duration : 0);
  let emi: number | null = null;
  let totalPayment: number | null = null;
  let totalInterest: number | null = null;
  let totalCost: number | null = null;
  let effectiveAPR: number | null = null;
  let netDisbursed: number | null = null;
  let baseResult: ReturnType<typeof calculateEMI> = null;
  let loanResult: ReturnType<typeof analyzeLoan> = null;
  if (cashPriceAnalysis && selectedCalculator === "cash_price_vs_total") effectiveAPR = cashPriceAnalysis.impliedNominalAPR;
  if (financialMetricsAvailable && principal !== null && duration !== null && rateField.value !== null) {
    baseResult = rateField.rateType === "flat"
      ? calculateFlatLoan(principal, rateField.value, duration)
      : calculateEMI(principal, rateField.value, duration);
    loanResult = analyzeLoan({
      principal,
      annualRate: rateField.value,
      tenureMonths: duration,
      rateType: rateField.rateType === "flat" ? "flat" : "reducing",
      upfrontFees,
      monthlyFees,
    });
    if (baseResult && loanResult) {
      emi = baseResult.emi + monthlyFees;
      totalPayment = loanResult.totalPayment;
      totalInterest = baseResult.totalInterest;
      totalCost = loanResult.totalCost;
      netDisbursed = loanResult.netDisbursed;
      effectiveAPR = loanResult.effectiveAPR;
    }
  }
  if (selectedCalculator === "revolving" && calculator.available && principal !== null && rateField.value !== null
    && minimumPaymentFloor !== null && minimumPaymentPercent !== null) {
    const payoff = minimumPaymentPayoff(principal, rateField.value, { floor: minimumPaymentFloor, percentOfBalance: minimumPaymentPercent });
    if (payoff) {
      totalPayment = payoff.totalPaid;
      totalInterest = payoff.totalInterest;
      emi = payoff.totalPaid / payoff.months;
      totalCost = payoff.totalInterest;
      effectiveAPR = rateField.value;
      netDisbursed = principal;
    }
  }

  const taxes = computeTaxImpacts(allFindings.filter((finding) => finding.category === "tax"), totalInterest, principal);
  const embeddedTax = allFindings.reduce((sum, finding) => sum + (finding.taxAmount ?? 0), 0);
  const standaloneTax = taxes.reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  if (totalCost !== null) totalCost += standaloneTax;
  const costModel = (rules as unknown as { costModel?: { financingCostCategories?: string[]; includeRecurringFeesInFinancingCost?: boolean } }).costModel;
  const financingCategories = new Set(costModel?.financingCostCategories ?? ["upfront_fee"]);
  if (costModel?.includeRecurringFeesInFinancingCost) financingCategories.add("recurring_fee");
  const financeFeeCost = fees.filter((finding) => !finding.negated && finding.totalImpact !== null
      && financingCategories.has(finding.category))
    .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const amountOfOffsets = offsets.reduce((sum, finding) => sum + Math.abs(finding.totalImpact ?? finding.amount ?? 0), 0);
  const addOnTotal = detected.itemGroups.length
    ? detected.itemGroups.reduce((sum, group) => sum + group.items.filter((item) => item.category === "financed_addon").reduce((part, item) => part + item.amount, 0), 0)
    : addOns.filter((finding) => finding.amount !== null).reduce((sum, finding) => sum + (finding.amount ?? 0), 0);
  const financingCost = Math.max(0, (totalInterest ?? 0) + financeFeeCost + standaloneTax - amountOfOffsets);
  const hasFinancingCostInputs = totalInterest !== null || financeFeeCost > 0 || standaloneTax > 0 || amountOfOffsets > 0;
  const netExtraCost = hasFinancingCostInputs ? financingCost : null;
  const netExtraCostPercent = cashPrice !== null && cashPrice > 0 && netExtraCost !== null ? netExtraCost / cashPrice * 100 : null;
  const costBreakdown: CostBreakdown = {
    interest: totalInterest ?? 0,
    taxes: standaloneTax,
    fees: financeFeeCost,
    optionalProducts: addOnTotal,
    offsets: amountOfOffsets,
    financingCost,
  };
  const claims = detectClaimsGeneric(text, allFindings, rateField.rateType === "deferred" ? null : rateField.value, netExtraCost);
  const rateConfirmed = rateField.value !== null && rateField.confidence >= threshold && ["base", "promotional"].includes(rateField.rateRole) && rateField.rateType !== "deferred";
  const canonicalFindings = collectRuleFindings(text, allFindings, extracted.docType.type, claims, rateConfirmed);
  for (const mismatch of extracted.constraintMismatches) {
    canonicalFindings.push(canonicalFinding({ id: mismatch.id, label: mismatch.label, category: "mismatch", severity: 3,
      amount: null, percent: null, basis: null, frequency: null, conditions: [], source: mismatch.evidence,
      position: mismatch.position, explanation: mismatch.message, totalImpact: null, negated: false,
      evidence: mismatch.evidence, clauseSpan: [mismatch.position, mismatch.position + mismatch.evidence.length], provenance: "computed" }));
  }
  const rateBasisRule = (rules as unknown as { rateBasisFinding?: { id: string; label: string; category: string; severity: number; explanation: string } }).rateBasisFinding;
  if (rateField.basisAssumption && rateField.source && rateBasisRule) {
    const position = Math.max(0, text.indexOf(rateField.source));
    canonicalFindings.push(canonicalFinding({ id: rateBasisRule.id, label: rateBasisRule.label, category: rateBasisRule.category,
      severity: rateBasisRule.severity, amount: null, percent: null, basis: null, frequency: null, conditions: [],
      source: rateField.source, position, explanation: rateBasisRule.explanation, totalImpact: null, negated: false,
      evidence: rateField.source, clauseSpan: [position, position + rateField.source.length], provenance: "assumed" }));
  }
  const risk = calculateRisk(text, extracted.docType.type, canonicalFindings, claims, confidence, rateConfirmed, incompleteAnalysis, true);
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  const addWarning = (message: string) => {
    const key = message.replace(/\s+/g, " ").trim().toLowerCase();
    if (seenWarnings.has(key)) return;
    seenWarnings.add(key);
    warnings.push(message);
  };
  for (const claim of claims.filter((item) => item.contradicted)) {
    addWarning(claim.label + ": " + claim.contradiction + " Evidence: " + normalizedEvidence(claim.source));
  }
  for (const claim of claims.filter((item) => item.signal)) addWarning(claim.signal + " Evidence: " + normalizedEvidence(claim.source));
  for (const finding of allFindings.filter((item) => !item.negated)) {
    const amountText = finding.amountNotStated
      ? " Amount not stated."
      : finding.percent !== null
        ? " Rate: " + finding.percent + "% of " + (finding.basis ?? "an unstated basis") + "."
        : finding.totalImpact !== null
          ? " Estimated impact: " + formatCurrency(finding.totalImpact, currencyCode) + "."
          : "";
    addWarning(finding.label + " detected." + amountText + " Evidence: " + normalizedEvidence(finding.source));
  }
  for (const finding of canonicalFindings.filter((item) => item.ruleOnly)) {
    addWarning(finding.label + " term detected. Evidence: " + normalizedEvidence(finding.evidence));
  }
  if (extracted.interestRateIsConditional && extracted.interestRate !== null && rateField.value !== null) {
    addWarning("Conditional deferred APR of " + extracted.interestRate + "% is stated; it is not used as the standard payment rate. Evidence: " + normalizedEvidence(rateField.source ?? "deferred-interest clause"));
  }
  if (rateField.basisAssumption) addWarning(rateField.basisAssumption + " Evidence: " + normalizedEvidence(rateField.source ?? "rate disclosure"));
  if (principalField.needsReview) {
    const candidates = principalField.alternatives.slice(0, 4).map((candidate) => formatCurrency(candidate.value, currencyCode)).join(" vs ");
    addWarning("Principal is uncertain: " + (candidates || "conflicting amount candidates") + ". The label and stated-payment cross-check did not resolve the candidates.");
  }
  for (const mismatch of extracted.constraintMismatches) addWarning(mismatch.message + " Evidence: " + normalizedEvidence(mismatch.evidence));
  if (extracted.constraintAssignment.explanation && extracted.constraintAssignment.matchedPayment) addWarning(extracted.constraintAssignment.explanation);
  for (const conflict of plausibilityConflicts) addWarning("Principal plausibility conflict: " + formatCurrency(conflict.principal, currencyCode)
    + " principal versus " + conflict.label + " " + formatCurrency(conflict.conflictingValue, currencyCode) + ". Verify these values before relying on calculations. Evidence: " + conflict.source);
  if (currency === null) addWarning("Currency was not identified in the text; amounts are displayed using the USD fallback until you select a currency.");

  if (schedule) {
    const knownRecurring = allFindings.filter((finding) => !finding.negated
      && (finding.frequency === "per_installment" || (finding.frequency === "monthly" && finding.category === "financed_addon")))
      .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
    schedule.totalWithKnownFees = schedule.total + knownRecurring;
    if (principal !== null && Math.abs(schedule.total - principal) > Math.max(1, principal * 0.005)) {
      addWarning("Stated installment total " + formatCurrency(schedule.total, currencyCode) + " differs from the selected amount financed " + formatCurrency(principal, currencyCode) + ".");
    }
    if (knownRecurring > 0) addWarning("Scheduled payments plus identified recurring charges total " + formatCurrency(schedule.totalWithKnownFees, currencyCode) + "; conditional penalties are excluded.");
  }

  const downPaymentCandidate = extracted.amountCandidates
    .filter((candidate) => /down\s+payment|deposit|trade[- ]in\s+credit/i.test(candidate.label))
    .sort((a, b) => b.score - a.score)[0];
  const financingAddOnAmount = addOnTotal;
  const financeFeeParts = fees.filter((finding) => finding.category === "upfront_fee" && !finding.negated)
    .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
  const purchaseOffsets = offsets.filter((finding) => !/interest|finance charge/i.test(finding.source))
    .reduce((sum, finding) => sum + Math.abs(finding.totalImpact ?? finding.amount ?? 0), 0);
  const reconciliations: ReconciliationCheck[] = [];
  if (priceCandidate && principal !== null && principalField.source !== priceCandidate.source
    && (Math.abs(priceCandidate.value - principal) > 0.01 || financingAddOnAmount > 0 || financeFeeParts > 0 || (downPaymentCandidate?.value ?? 0) > 0 || purchaseOffsets > 0)) {
    const parts = priceCandidate.value + financingAddOnAmount + financeFeeParts - (downPaymentCandidate?.value ?? 0) - purchaseOffsets;
    const difference = parts - principal;
    const undisclosedItems = allFindings.filter((finding) => finding.amountNotStated).map((finding) => finding.label);
    const matched = Math.abs(difference) <= Math.max(1, principal * 0.005);
    const expression = formatCurrency(priceCandidate.value, currencyCode)
      + (financingAddOnAmount ? " + " + formatCurrency(financingAddOnAmount, currencyCode) : "")
      + (financeFeeParts ? " + " + formatCurrency(financeFeeParts, currencyCode) : "")
      + (downPaymentCandidate?.value ? " - " + formatCurrency(downPaymentCandidate.value, currencyCode) : "")
      + (purchaseOffsets ? " - " + formatCurrency(purchaseOffsets, currencyCode) : "")
      + " = " + formatCurrency(principal, currencyCode);
    reconciliations.push({
      id: "amount_financed_reconciliation",
      label: matched ? "Amount financed reconciles" : "Amount financed gap",
      expression,
      calculated: parts,
      expected: principal,
      difference,
      matched,
      source: normalizedEvidence((priceCandidate.source ?? "") + " " + (principalField.source ?? "")),
      undisclosedItems: matched ? undisclosedItems : [],
    });
    if (!matched) addWarning("Amount-financed reconciliation leaves a gap of " + formatCurrency(Math.abs(difference), currencyCode) + " (" + (difference > 0 ? "parts exceed amount financed" : "amount financed exceeds disclosed parts") + ").");
    for (const item of matched ? undisclosedItems : []) addWarning(item + " is stated but unquantified; the disclosed arithmetic leaves no room for another amount.");
  }
  for (const group of detected.itemGroups) {
    const sum = group.items.reduce((total, item) => total + item.amount, 0);
    if (Math.abs(sum - group.aggregate) < 0.01) {
      reconciliations.push({
        id: "item_group_" + group.id,
        label: group.label + " total",
        expression: group.items.map((item) => formatCurrency(item.amount, currencyCode)).join(" + ") + " = " + formatCurrency(group.aggregate, currencyCode),
        calculated: sum,
        expected: group.aggregate,
        difference: sum - group.aggregate,
        matched: true,
        source: group.source,
        undisclosedItems: [],
      });
    }
  }
  const amountRelationships: AmountRelationship[] = [...extracted.amountRelationships];
  if (schedule) amountRelationships.push({
    type: "product_of_schedule",
    source: schedule.source,
    derivedAmount: schedule.total,
    baseLabel: "payment amount multiplied by payment count",
    expectedAmount: schedule.total,
    confirmed: true,
  });
  for (const check of reconciliations.filter((item) => item.id === "amount_financed_reconciliation")) {
    amountRelationships.push({
      type: check.expression.includes(" - ") ? "difference_of" : "sum_of",
      source: check.source,
      derivedAmount: check.calculated,
      baseLabel: "cash price plus disclosed financed items and fees",
      expectedAmount: check.expected,
      confirmed: check.matched,
    });
  }
  if (principalField.value !== null && !principalField.needsReview && reconciliations.some((check) => check.id === "amount_financed_reconciliation" && check.matched)) {
    principalField = { ...principalField, confidence: Math.max(principalField.confidence, 0.92) };
    confidence = required.length ? Math.min(...required.map((input) => input === "principal" ? principalField.confidence : inputConfidence[input] ?? 0)) : confidence;
  }

  let addOnImpact: AddOnImpact | null = null;
  if (!principalField.needsReview && addOnTotal > 0 && principal !== null && duration !== null && rateField.value !== null && rateField.rateType !== "deferred") {
    const withAddOns = rateField.rateType === "flat"
      ? calculateFlatLoan(principal, rateField.value, duration)
      : calculateEMI(principal, rateField.value, duration);
    const withoutAmount = principal - addOnTotal;
    const withoutAddOns = withoutAmount > 0
      ? (rateField.rateType === "flat" ? calculateFlatLoan(withoutAmount, rateField.value, duration) : calculateEMI(withoutAmount, rateField.value, duration))
      : null;
    if (withAddOns && withoutAddOns) {
      addOnImpact = {
        amount: addOnTotal,
        paymentIncrease: withAddOns.emi - withoutAddOns.emi,
        totalPaymentIncrease: withAddOns.totalPayment - withoutAddOns.totalPayment,
        interestIncrease: withAddOns.totalInterest - withoutAddOns.totalInterest,
      };
    }
  }

  const hiddenFees = allFindings.filter((finding) => !finding.negated && !["offset", "protection"].includes(finding.category)).map((finding) => {
    if (finding.amountNotStated) return finding.label + ": amount not stated. Evidence: " + finding.source;
    if (finding.basis === "outstanding" && finding.percent !== null) {
      const startAmount = principal !== null ? principal * finding.percent / 100 : null;
      const qualifier = /\bup to\b/i.test(finding.source) || finding.amount !== null ? "Up to " : "";
      const estimate = financialMetricsAvailable && startAmount !== null
        ? qualifier + formatCurrency(finding.amount !== null ? Math.min(startAmount, finding.amount) : startAmount, currencyCode) + " (at start), declining as principal is repaid"
        : finding.percent + "% of outstanding balance";
      return finding.label + ": " + estimate + ". Evidence: " + finding.source;
    }
    if (finding.totalImpact !== null) return finding.label + ": " + formatCurrency(finding.totalImpact, currencyCode) + (finding.taxPercent !== null ? " including " + finding.taxPercent + "% tax" : "") + ". Evidence: " + finding.source;
    if (finding.percent !== null) return finding.label + ": " + finding.percent + "% of " + (finding.basis ?? "an unstated basis") + ". Evidence: " + finding.source;
    return finding.label + ": amount not stated. Evidence: " + finding.source;
  });
  const insights: string[] = [];
  if (extracted.constraintAssignment.explanation && extracted.constraintAssignment.matchedPayment) insights.push(extracted.constraintAssignment.explanation);
  if (reconciliationResolution) insights.push(reconciliationResolution);
  if (extracted.paymentMatches) insights.push("The stated monthly payment matches the computed payment within 1%.");
  if (schedule) insights.push("Payment schedule: " + schedule.count + " × " + formatCurrency(schedule.amount, currencyCode) + " = " + formatCurrency(schedule.total, currencyCode) + ".");
  for (const relationship of amountRelationships.filter((item) => item.confirmed && item.type === "percent_of")) {
    insights.push(formatCurrency(relationship.derivedAmount, currencyCode) + " was confirmed as a derived amount from " + relationship.baseLabel + ".");
  }
  if (cashPriceAnalysis) {
    insights.push("Cash-price comparison: total payable is " + formatCurrency(cashPriceAnalysis.totalPaid, currencyCode) + " (" + cashPriceAnalysis.multiple.toFixed(2) + "× cash price), or " + formatCurrency(cashPriceAnalysis.extraCost, currencyCode) + " above cash price.");
    if (cashPriceAnalysis.impliedNominalAPR !== null) {
      insights.push("Implied nominal APR is " + cashPriceAnalysis.impliedNominalAPR.toFixed(1) + "%; IRR assumes " + cashPriceAnalysis.periodsPerYear + " equal periods per year and the first payment is one " + schedule?.intervalUnit + " period after agreement.");
    }
  }
  if (addOnImpact) {
    insights.push("Financed add-ons total " + formatCurrency(addOnImpact.amount, currencyCode) + " and add " + formatCurrency(addOnImpact.paymentIncrease, currencyCode) + " per month, including " + formatCurrency(addOnImpact.interestIncrease, currencyCode) + " additional interest.");
  }
  for (const tax of taxes.filter((finding) => finding.totalImpact !== null && finding.totalImpact > 0)) {
    const taxBasis = tax.basis === "interest" && totalInterest !== null && tax.percent !== null
      ? " (" + tax.percent + "% of " + formatCurrency(totalInterest, currencyCode) + " interest)" : "";
    insights.push(tax.label + " adds " + formatCurrency(tax.totalImpact, currencyCode) + taxBasis + ".");
  }
  for (const check of reconciliations) insights.push(check.expression + (check.matched ? " matches." : " leaves a " + formatCurrency(Math.abs(check.difference), currencyCode) + " gap."));
  if (effectiveAPR !== null && rateField.value !== null && effectiveAPR > rateField.value + 0.01) {
    insights.push("Modeled charges raise effective APR from " + rateField.value + "% to " + effectiveAPR.toFixed(2) + "%.");
  }

  if (schedule) {
    const knownFeeTotal = allFindings.filter((finding) => !finding.negated && (
      finding.frequency === "per_installment"
      || (finding.frequency === "monthly" && finding.category === "financed_addon" && /automatically added|automatically enrolled/i.test(finding.source))
    ))
      .reduce((sum, finding) => sum + (finding.totalImpact ?? 0), 0);
    schedule.totalWithKnownFees = schedule.total + knownFeeTotal;
  }
  const advice = generateAdvice(risk.score, confidence, claims.some((claim) => claim.contradicted), risk.breakdown, confidenceIssues, threshold);
  const standardRateAvailable = rateField.value !== null && ["base", "promotional"].includes(rateField.rateRole) && rateField.rateType !== "deferred" && rateField.rateType !== "revolving";
  const lateFeeFinding = allFindings.find((finding) => finding.id === "late_payment" || finding.topicId === "late_payment");
  const penaltyRate = extracted.rateCandidates.find((candidate) => candidate.role === "penalty") ?? null;
  const amountCandidates = extracted.amountCandidates;
  const summary = selectedCalculator === "revolving" && emi !== null && totalPayment !== null && totalInterest !== null
    ? "Using the stated minimum-payment rule, the estimated average monthly payment is " + formatCurrency(emi, currencyCode) + " over an estimated " + Math.ceil(totalPayment / Math.max(emi, 0.01)) + " payments, with " + formatCurrency(totalInterest, currencyCode) + " in interest."
    : financialMetricsAvailable && emi !== null && totalPayment !== null && totalInterest !== null && principal !== null && duration !== null
      ? "The agreement states " + formatCurrency(principal, currencyCode) + " at " + rateField.value + "% " + (rateField.rateType === "flat" ? "flat " : "") + "annual rate over " + duration + " months. Estimated monthly payment is " + formatCurrency(emi, currencyCode) + "; scheduled payments total " + formatCurrency(totalPayment, currencyCode) + ", with modeled interest and charges of " + formatCurrency(totalCost, currencyCode) + "."
    : cashPriceAnalysis
      ? "The agreement schedules " + schedule.count + " payments of " + formatCurrency(schedule.amount, currencyCode) + " totaling " + formatCurrency(cashPriceAnalysis.totalPaid, currencyCode) + ", or " + cashPriceAnalysis.multiple.toFixed(2) + "× the cash price. The implied nominal APR is " + (cashPriceAnalysis.impliedNominalAPR === null ? "not solvable from the stated schedule" : cashPriceAnalysis.impliedNominalAPR.toFixed(1) + "%") + " assuming " + cashPriceAnalysis.periodsPerYear + " equal periods per year and the first payment one " + schedule.intervalUnit + " period after agreement."
    : schedule
      ? "The document schedules " + schedule.count + " payments of " + formatCurrency(schedule.amount, currencyCode) + " every " + schedule.interval + " " + schedule.intervalUnit + (schedule.interval === 1 ? "" : "s") + ", totaling " + formatCurrency(schedule.total, currencyCode) + " before identified charges."
    : calculator.unsupportedReason
      ? "Document scan classified this as " + extracted.docType.label.toLowerCase() + ". " + calculator.unsupportedReason
      : "Document scan classified this as " + extracted.docType.label.toLowerCase() + ". Payment calculations are partial; missing inputs: " + (missingInputs.length ? missingInputs.join(", ") : "a supported payment model") + ".";
  const addFinding = (id: string, label: string, category: string, severity: number, evidence: string, explanation: string, provenance: AnalysisFinding["provenance"] = "stated-in-document") => {
    const position = text.indexOf(evidence);
    if (canonicalFindings.some((finding) => finding.id === id && finding.evidence === evidence)) return;
    canonicalFindings.push(canonicalFinding({ id, label, category, severity, amount: null, percent: null, basis: null,
      frequency: null, conditions: [], source: evidence, position: Math.max(0, position), explanation,
      totalImpact: null, negated: false, provenance, polarity: position >= 0 ? classifyPolarity(evidence) : "asserted" }));
  };
  for (const claim of claims.filter((item) => item.contradicted || item.signal)) {
    addFinding("claim_contradiction_" + claim.id, claim.label, claim.contradicted ? "contradiction" : "pricing_access_signal", 3,
      claim.source, claim.contradiction ?? claim.signal ?? "", claim.contradicted ? "computed" : "stated-in-document");
  }
  for (const check of reconciliations.filter((item) => !item.matched)) {
    addFinding("reconciliation_mismatch_" + check.id, check.label, "mismatch", 2, check.source,
      check.expression + " leaves a " + formatCurrency(Math.abs(check.difference), currencyCode) + " gap.", "computed");
  }
  canonicalFindings.splice(0, canonicalFindings.length, ...mergeClauseFindings(canonicalFindings).sort((a, b) => b.severity - a.severity || a.position - b.position));
  const context: AnalysisContext = {
    id: createAnalysisId(),
    docType: extracted.docType,
    region: null,
    currency,
    currencyCode,
    principalField,
    rateField,
    termField,
    statedEMI: extracted.statedEMI,
    installmentSchedule: schedule,
    principal,
    findings: canonicalFindings,
    protections: canonicalFindings.filter((finding) => finding.category === "protection"),
    conditionalTerms: canonicalFindings.filter((finding) => finding.category === "conditional_term"),
    rateScenarios: extracted.rateCandidates.filter((candidate) => candidate.type === "variable" || candidate.type === "introductory" || candidate.role === "penalty").map((candidate) => ({
      type: candidate.role === "penalty" ? "penalty" : candidate.type as "variable" | "introductory",
      annualRate: candidate.value, source: candidate.source,
      conditions: candidate.source.match(new RegExp(rules.polarity.conditionPattern, "gi")) ?? [],
      provenance: candidate.period === "year" ? "stated-in-document" : "computed",
    })),
    fees,
    addOns,
    taxes,
    offsets,
    itemGroups: detected.itemGroups,
    amountRelationships,
    reconciliations,
    calculator,
    ranCalculators: [
      ...(financialMetricsAvailable && emi !== null ? [selectedCalculator, ...(rateField.rateType === "reducing" ? ["amortization", "worst_case", "early_repayment", "loan_comparison"] : [])] : []),
      ...(selectedCalculator === "cash_price_vs_total" && calculator.available && cashPriceAnalysis ? ["cash_price_vs_total"] : []),
    ],
    cashPriceAnalysis,
    costBreakdown,
    confidenceIssues,
    addOnImpact,
    netExtraCost,
    netExtraCostPercent,
    claims,
    confidence,
    warnings: Array.from(new Set(warnings)),
    riskScore: risk.score,
    riskBand: risk.band,
    analysisIncomplete: incompleteAnalysis,
    riskBreakdown: risk.breakdown,
    summary,
    hiddenFees,
    insights,
    emi,
    totalPayment,
    totalInterest,
    totalCost,
    financialMetricsAvailable: financialMetricsAvailable && emi !== null,
    effectiveAPR,
    netDisbursed,
    deception: detectDeception(text),
    advice,
    glossary: generateLocalGlossary(canonicalFindings),
    fairMarketComparison: standardRateAvailable && rateField.value !== null
      ? generateLocalFairMarket(rateField.value, currencyCode, extracted.docType.type, null)
      : undefined,
    alternativeFunding: standardRateAvailable && rateField.value !== null && principal !== null
      ? generateLocalAlternativeFunding(rateField.value, principal, currencyCode, extracted.docType.type, (totalInterest ?? 0) + financeFeeCost + standaloneTax)
      : [],
    simulator: {
      lateFeeAmount: lateFeeFinding?.amount ?? null,
      lateFeePercent: lateFeeFinding?.percent ?? null,
      lateFeeBasis: lateFeeFinding?.basis ?? null,
      postGraceLateFeeAmount: allFindings.find((finding) => finding.id === "late_payment" && !finding.negated)?.amount ?? null,
      penaltyAPR: penaltyRate?.value ?? null,
      isAssumption: !lateFeeFinding && !penaltyRate,
      source: lateFeeFinding?.evidence ?? lateFeeFinding?.source ?? penaltyRate?.source ?? null,
      gracePeriodDays: (() => {
        const source = lateFeeFinding?.evidence ?? lateFeeFinding?.source;
        const match = source?.match(new RegExp(rules.scenarioPeriods.gracePattern, "i"));
        const unit = match?.groups?.unit?.replace(/s$/, "").toLowerCase() as keyof typeof rules.scenarioPeriods.daysPerUnit;
        return match?.groups?.count && unit ? Number(match.groups.count) * rules.scenarioPeriods.daysPerUnit[unit] : null;
      })(),
      conditions: lateFeeFinding?.conditions ?? [],
    },
    periodCandidates: extracted.periodCandidates,
    plausibilityConflicts,
    documentStructure: inspectLegalStructure(text),
    rawText: originalText,
  };
  return freezeAnalysisContext(restoreOriginalEvidence(context, document)) as AnalysisContext;
}
