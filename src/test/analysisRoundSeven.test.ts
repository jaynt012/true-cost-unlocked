import { describe, expect, it } from "vitest";
import { analyzeLocally, extractValuesFromText } from "@/lib/analyzeLocally";
import { extractRateCandidates } from "@/lib/analysisEngine";
import { extractNumericCandidates } from "@/lib/numericCandidates";
import { documentImportLimits } from "@/lib/documentImport";
import { ROUND6_LEGAL_LOAN } from "./fixtures/round6LegalLoan";

describe("Round 7 candidate roles and joint assignment", () => {
  it("keeps all numeric values once per clause and separates installment count from money", () => {
    const candidates = extractNumericCandidates("36 monthly installments of $300, or 36 payments totaling $10,800.");
    expect(candidates.some((item) => item.value === 36 && item.roleScores.count !== undefined)).toBe(true);
    expect(candidates.filter((item) => item.value === 300)).toHaveLength(1);
    expect(candidates.filter((item) => item.value === 10800)).toHaveLength(1);
    expect(extractNumericCandidates("Fee is $100 and equals $100.").filter((item) => item.value === 100)).toHaveLength(1);
  });

  it("treats Prime + X% as an index margin and extracts only a separately stated current base rate", () => {
    expect(extractRateCandidates("The rate is Prime + 2.5%.")).toEqual([]);
    expect(extractRateCandidates("Prime + 2.5%; currently 7.25% APR.").map((item) => item.value)).toEqual([7.25]);
  });

  it("uses a financed add-on to resolve the principal when the payment schedule matches", () => {
    const text = "Loan principal: $10,000.\nFinanced credit insurance premium: $500 is included in the amount financed.\nAPR: 0%.\nTerm: 12 months.\nMonthly payment: $875.";
    const extracted = extractValuesFromText(text);
    expect(extracted.principalField.value).toBe(10500);
    expect(extracted.constraintAssignment.matchedPayment).toBe(true);
    expect(extracted.constraintAssignment.explanation).toContain("insurance");
    const analysis = analyzeLocally(text);
    expect(analysis.insights.some((insight) => insight.includes("insurance"))).toBe(true);
  });

  it("emits first-class mismatch evidence and withholds fields that fail the EMI constraint", () => {
    const text = "Personal loan agreement.\nPrincipal: $10,000.\nAPR: 9.9%.\nTerm: 36 months.\nMonthly EMI: $500.";
    const extracted = extractValuesFromText(text);
    expect(extracted.constraintMismatches).toEqual(expect.arrayContaining([expect.objectContaining({ id: "emi_apr" })]));
    expect(extracted.principalField).toMatchObject({ value: null, needsReview: true });
    expect(extracted.rateField).toMatchObject({ value: null, needsReview: true });
    expect(extracted.termField).toMatchObject({ value: null, needsReview: true });
    const finding = analyzeLocally(text).findings.find((item) => item.id === "emi_apr");
    expect(finding?.category).toBe("mismatch");
    expect(finding?.evidence).toBe("Monthly EMI: $500.");
    expect(finding?.explanation).toContain("payment-implied APR");
  });

  it("derives merchant cash advance APR from net proceeds and remittance cadence", () => {
    const text = "MERCHANT CASH ADVANCE AGREEMENT\nAdvance amount: $24,000.\nPurchased amount: $30,000.\nDaily remittance: $250 from future receivables until collected.";
    const analysis = analyzeLocally(text);
    expect(analysis.docType.type).toBe("merchant_cash_advance");
    expect(analysis.cashPriceAnalysis?.periodsPerYear).toBe(365);
    expect(analysis.effectiveAPR).not.toBeNull();
    expect(analysis.summary).toContain("365 equal periods per year");
  });

  it("rejects an AI fallback number whose quoted evidence does not support that value", () => {
    const text = "Personal loan agreement. Principal: $10,000. APR: 9.9%. Term: 36 months. Monthly payment: $320.";
    const analysis = analyzeLocally(text, null, null, null, null, {
      principal: { value: 99999, evidence: "Principal: $10,000." },
      annualAPR: { value: null, evidence: null },
      termMonths: { value: null, evidence: null },
      payment: { value: null, evidence: null },
    });
    expect(analysis.principalField.value).not.toBe(99999);
    expect(analysis.principalField.alternatives.some((candidate) => candidate.value === 99999)).toBe(false);
  });

  it("uses a role-checked AI fallback to fill a locally missing amount from exact evidence", () => {
    const text = "Funds will be transferred to your account in the amount of USD 10,000.";
    expect(analyzeLocally(text).principalField.value).toBeNull();
    const analysis = analyzeLocally(text, null, null, null, null, {
      principal: { value: 10000, evidence: text },
      annualAPR: { value: null, evidence: null },
      termMonths: { value: null, evidence: null },
      payment: { value: null, evidence: null },
    });
    expect(analysis.principalField).toMatchObject({ value: 10000, needsReview: false });
    expect(analysis.principalField.source).toContain("USD 10,000");
  });
});

describe("Round 7 type, qualified terms, and import limits", () => {
  it("does not infer a principal for revolving credit", () => {
    const analysis = analyzeLocally("CREDIT CARD AGREEMENT\nRevolving credit.\nAPR: 19.9% per year.");
    expect(analysis.docType.type).toBe("credit_card");
    expect(analysis.principalField.value).toBeNull();
    expect(analysis.riskBand).toBe("caution");
  });

  it("shows a later fee qualifier as a conditional term, not a clean protection", () => {
    const analysis = analyzeLocally("Agreement provides no annual fee; $99 annual fee thereafter.");
    expect(analysis.conditionalTerms?.some((item) => item.amount === 99)).toBe(true);
    expect(analysis.protections.some((item) => item.label === "No annual fee")).toBe(false);
  });

  it("keeps prior legal-loan calculations and enforces browser import limits", () => {
    const analysis = analyzeLocally(ROUND6_LEGAL_LOAN);
    expect(analysis).toMatchObject({ principal: 18000, termField: { value: 36 }, rateField: { value: 9.9 } });
    expect(documentImportLimits).toMatchObject({ maxBytes: 20 * 1024 * 1024, maxPages: 30, lowConfidence: 65 });
  });
});

