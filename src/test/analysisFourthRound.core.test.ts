import { describe, expect, it } from "vitest";
import { analyzeLocally, extractValuesFromText } from "@/lib/analyzeLocally";
import { classifyPolarity, detectCostsGeneric } from "@/lib/analysisEngine";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";

describe("Round 4 polarity and canonical findings", () => {
  it("reports clean-loan protections without charges, warnings, or fee glossary entries", () => {
    const result = analyzeLocally(CLEAN_LOAN);
    expect(result.fees).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.riskScore).toBeLessThanOrEqual(5);
    expect(result.protections).toHaveLength(7);
    expect(new Set(result.protections.map((finding) => finding.topicId))).toEqual(new Set([
      "origination", "prepayment", "annual", "general_fees", "late_payment", "fixed_rate", "cancellation_window",
    ]));
    expect(result.rateField).toMatchObject({ type: "fixed", basis: "reducing", basisAssumption: null });
    expect(result.simulator).toMatchObject({ lateFeeAmount: 0, gracePeriodDays: 30, isAssumption: false });
    expect(result.simulator.source).toContain("$0 during the first 30 days");
    expect(result.glossary.some((item) => /upfront|recurring|prepayment|foreclosure/i.test(item.term))).toBe(false);
    expect(result.findings.every((finding) => finding.polarity && finding.provenance && finding.clauseSpan && typeof finding.evidence === "string")).toBe(true);
  });

  it.each([
    "We don't charge a processing fee.",
    "Free of any processing fee.",
    "No fee of any kind.",
    "Fees: nil.",
    "Not subject to a foreclosure charge.",
    "There is no late fee.",
    "No origination fee or annual fee.",
    "Annual fee waived for the first year.",
  ])("recognizes scoped exclusion: %s", (text) => {
    const { findings } = detectCostsGeneric(text, 9000, null, 24);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.category === "protection" && finding.amount === 0 && !finding.amountNotStated)).toBe(true);
  });

  it("retains affirmative charges, double negatives, and contrast clauses", () => {
    const affirmative = detectCostsGeneric("We charge a prepayment penalty of 2% of principal.", 9000, null, 24).findings;
    expect(affirmative).toEqual(expect.arrayContaining([expect.objectContaining({ id: "prepayment", percent: 2, totalImpact: 180, polarity: "asserted" })]));
    expect(classifyPolarity("We do not waive the processing fee.")).toBe("asserted");
    expect(classifyPolarity("This loan is not without a processing fee.")).toBe("asserted");
    const contrast = detectCostsGeneric("No origination fee, only a processing fee of $25.", 9000, null, 24).findings;
    expect(contrast).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "protection", topicId: "origination" }),
      expect.objectContaining({ id: "processing", amount: 25, polarity: "asserted" }),
    ]));
  });

  it("excludes hypothetical charges and treats no arbitration as a protection", () => {
    expect(detectCostsGeneric("For example, a processing fee of $50 could apply.", null, null, null).findings).toEqual([]);
    const result = analyzeLocally(CLEAN_LOAN + "\nThere is no binding arbitration.");
    expect(result.protections.flatMap((finding) => finding.components ?? [finding]).some((finding) => finding.topicId === "arbitration")).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("keeps rate type independent of calculation basis", () => {
    expect(extractValuesFromText("Personal loan. Loan amount $9000. Fixed APR: 7%. Term 12 months.").rateField).toMatchObject({ type: "fixed", basis: "reducing", basisAssumption: null });
    expect(extractValuesFromText("Loan amount $9000. Variable interest rate: 1% per month. Term 12 months.").rateField).toMatchObject({ type: "variable", basis: "unspecified" });
    expect(extractValuesFromText("Loan amount $9000. Introductory APR: 4% for the first 6 months. Term 12 months.").rateField).toMatchObject({ type: "introductory", basis: "reducing" });
    expect(extractValuesFromText("The rate is not variable, fixed APR: 7%.").rateField).toMatchObject({ type: "fixed", value: 7 });
    expect(extractValuesFromText("APR: 7%. The rate will never change.").rateField).toMatchObject({ type: "fixed", value: 7 });
  });

  it("preserves post-grace charges and excludes denied marketing claims", () => {
    const result = analyzeLocally("Late fee is $0 during the first 30 days and $35 afterwards.");
    expect(result.protections).toEqual(expect.arrayContaining([expect.objectContaining({ topicId: "late_payment", amount: 0 })]));
    expect(result.fees).toEqual(expect.arrayContaining([expect.objectContaining({ id: "late_payment", amount: 35, polarity: "conditional" })]));
    expect(result.simulator).toMatchObject({ lateFeeAmount: 0, postGraceLateFeeAmount: 35, gracePeriodDays: 30 });
    expect(analyzeLocally("Personal loan. This loan is not interest-free. Loan amount: $1000. APR: 6%. Term: 12 months.").claims.some((claim) => claim.contradicted)).toBe(false);
  });
});
