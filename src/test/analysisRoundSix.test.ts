import { describe, expect, it } from "vitest";
import { analyzeLocally, extractValuesFromText } from "@/lib/analyzeLocally";
import { extractAmountCandidates } from "@/lib/analysisEngine";
import { inspectLegalStructure } from "@/lib/documentStructure";
import { scoreRiskFindings } from "@/lib/riskScoring";
import type { CostFinding } from "@/lib/analysisContext";
import { ROUND6_LEGAL_LOAN } from "./fixtures/round6LegalLoan";

const ADVANCE_FEE_EXAMPLE = `CONGRATULATIONS! YOU ARE PRE-APPROVED FOR A $15,000 LOAN!
No credit check. 100% guaranteed approval. No documents needed.
To release your funds, pay a refundable processing deposit of $350 via gift cards or cryptocurrency.
Offer expires in 2 hours! Contact our agent on WhatsApp only.
Do not discuss this offer with your bank.
LOAN AGREEMENT
Origination Fee: 3%
Principal: $15,000
APR: 11.5%
Term: 36 months
Late fee: $25`;

function finding(index: number, severity = 2): CostFinding {
  const source = `Clause ${index}: an independent term applies.`;
  return { id: `repeat_${index}`, label: "Repeated term", category: "legal", severity, amount: null, percent: null,
    basis: null, frequency: null, conditions: [], source, position: index * 50, explanation: "Configured finding.",
    totalImpact: null, negated: false, evidence: source, clauseSpan: [index * 50, index * 50 + source.length] };
}

describe("Round 6 amount and quantity separation", () => {
  it("keeps 36 monthly installments as a count, not a dollar amount", () => {
    const extracted = extractValuesFromText("36 monthly installments");
    expect(extracted.installmentCount).toBe(36);
    expect(extracted.amountCandidates).toEqual([]);
    expect(extractAmountCandidates("36 monthly installments")).toEqual([]);
    expect(inspectLegalStructure('The "Loan" means 36 monthly installments.').definitions[0]?.amount).toBeNull();
    expect(extracted.loanAmount).toBeNull();
  });

  it("uses a marked amount for a payment schedule", () => {
    const extracted = extractValuesFromText("Pay in 4 monthly installments of $300 every month.");
    expect(extracted.statedEMI.value).toBe(300);
    expect(extracted.installmentCount).toBe(4);
  });

  it("rejects a principal smaller than a stated payment", () => {
    const extracted = extractValuesFromText("Principal: $500. Monthly EMI: $600.");
    expect(extracted.principalField).toMatchObject({ value: null, needsReview: true });
    expect(extracted.plausibilityConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ principal: 500, conflictingValue: 600, kind: "payment" }),
    ]));
  });

  it("rejects a principal smaller than a plainly labeled fee even without a catalog-specific fee rule", () => {
    const extracted = extractValuesFromText("Principal: $500. Fee: $600.");
    expect(extracted.principalField).toMatchObject({ value: null, needsReview: true });
    expect(extracted.plausibilityConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ principal: 500, conflictingValue: 600, kind: "fee" }),
    ]));
  });
});

describe("Round 6 legal-loan golden analysis", () => {
  it("resolves the defined principal, fees, schedule, proceeds, and effective APR", () => {
    const result = analyzeLocally(ROUND6_LEGAL_LOAN);
    expect(result.principal).toBe(18000);
    expect(result.rateField.value).toBe(9.9);
    expect(result.termField.value).toBe(36);
    expect(result.rateField.type).toBe("variable");
    expect(result.emi).toBeCloseTo(579.96, 2);
    expect(result.totalPayment).toBeCloseTo(20878.73, 2);
    expect(result.totalInterest).toBeCloseTo(2878.73, 2);
    expect(result.netDisbursed).toBe(17280);
    expect(result.effectiveAPR).toBeCloseTo(12.73, 2);
    expect(result.fees.find((item) => item.id === "documentation_fee")).toMatchObject({ percent: 4, basis: "principal", totalImpact: 720 });
    expect(result.simulator).toMatchObject({ lateFeePercent: 8, lateFeeBasis: "emi", gracePeriodDays: 5 });
    expect(result.simulator.lateFeeAmount).toBeCloseTo(46.4, 1);
  });

  it("keeps each compound legal risk category and anchors evidence to its triggering clause", () => {
    const result = analyzeLocally(ROUND6_LEGAL_LOAN);
    const ids = new Set(result.findings.flatMap((item) => [item.id, item.topicId, ...(item.mergedRuleIds ?? [])]));
    for (const id of ["cross_default", "acceleration", "seizure_without_notice", "unilateral_rate_increase", "jury_trial_waiver", "class_action_waiver", "binding_arbitration", "after_acquired_property", "upfront_deduction", "late_payment"]) {
      expect(ids.has(id)).toBe(true);
    }
    const categories = result.findings.map((item) => item.category);
    expect(categories).toContain("cross_default");
    expect(categories).toContain("acceleration");
    expect(categories).toContain("default_event");
    for (const item of result.findings) expect(ROUND6_LEGAL_LOAN.slice(...item.clauseSpan)).toBe(item.evidence);
    expect(result.glossary.filter((item) => item.term === "Legal restrictions")).toHaveLength(1);
    expect(result.glossary).toHaveLength(new Set(result.findings.filter((item) => item.category !== "protection").map((item) => item.category)).size);
    expect(result.riskBand).toBe("critical");
    expect(result.riskScore).toBeLessThan(analyzeLocally(ADVANCE_FEE_EXAMPLE).riskScore);
  });

  it("emits a standalone rate-basis finding with only the rate clause as evidence", () => {
    const text = "Principal: $10,000.\nInterest: 9.9%.\nLate fee: $25.";
    const result = analyzeLocally(text);
    const finding = result.findings.find((item) => item.id === "rate_basis_unspecified");
    expect(finding?.evidence).toBe("Interest: 9.9%.");
    expect(finding?.evidence).not.toContain("Late fee");
  });
});

describe("Round 6 diminishing noisy-OR", () => {
  it("reduces the weight of repeated findings in a severity band", () => {
    const result = scoreRiskFindings([finding(1), finding(2), finding(3)]);
    expect(result.breakdown.map((item) => item.weight)).toEqual([0.25, 0.15, 0.09]);
    expect(result.score).toBeCloseTo(41.9875);
  });
});
