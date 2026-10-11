import { describe, expect, it } from "vitest";
import { analyzeLocally, checkPrincipalPlausibility, extractValuesFromText } from "@/lib/analyzeLocally";
import { classifyPeriodRoles, selectLoanTerm } from "@/lib/periodRoles";

describe("Round 5 duration roles", () => {
  it("classifies every contractual window independently and selects only the repayment term", () => {
    const text = [
      "Repayment term: 36 months.",
      "Promotional trial: 3 months.",
      "Grace period: 15 days.",
      "You may cancel within 7 days.",
      "Provide notice at least 30 days before renewal.",
      "Borrower has 10 days to cure a default.",
    ].join("\n");
    expect(classifyPeriodRoles(text).map((candidate) => candidate.role)).toEqual(["term", "trial_promo", "grace", "cancellation", "notice", "cure"]);
    expect(selectLoanTerm(text)?.months).toBe(36);
    expect(extractValuesFromText(text).tenureMonths).toBe(36);
  });

  it.each([
    "Promotional trial lasts for 3 months.",
    "Grace period lasts for 15 days.",
    "You may cancel within 7 days.",
    "Borrower must give notice within 30 days.",
    "Borrower has 10 days to cure a default.",
    "Offer expires in 2 hours!",
  ])("does not treat a non-term period as the loan term: %s", (text) => {
    expect(extractValuesFromText(text).tenureMonths).toBeNull();
  });

  it("retains an installment-derived term rather than selecting the recurring payment interval", () => {
    const text = "Pay in 4 interest-free installments of $300 every 2 weeks. You may cancel within 24 hours.";
    expect(extractValuesFromText(text).tenureMonths).toBeCloseTo(8 * 12 / 52, 4);
  });

  it("uses numbered section headings when a duration has no repeated label", () => {
    expect(extractValuesFromText("1. Promotional trial\n3 months\n2. Term\n36 months\n3. Cancellation\n14 days").tenureMonths).toBe(36);
  });

  it("prioritizes a labeled loan term over a promotional payment count", () => {
    expect(extractValuesFromText("Introductory period: 6 monthly payments at 0%. Repayment term: 36 months.").tenureMonths).toBe(36);
    expect(extractValuesFromText("Introductory period: 6 monthly payments at 0%.").tenureMonths).toBeNull();
    expect(extractValuesFromText("Promotional offer: 4 installments of $300 every 2 weeks.").tenureMonths).toBeNull();
    expect(extractValuesFromText("1. Payments\n6 monthly payments of $100.\n2. Term\n36 months.").tenureMonths).toBe(36);
  });

  it("does not suppress the repayment schedule because a separate grace window shares its clause", () => {
    expect(extractValuesFromText("30 monthly payments of $100, with a grace period of 10 days.").tenureMonths).toBe(30);
  });
});

describe("Round 5 principal plausibility", () => {
  it("lowers confidence, shows both values, and blocks calculations for a fee larger than principal", () => {
    const text = "Personal loan agreement.\nPrincipal: $100\nAPR: 8%\nTerm: 12 months\nProcessing fee: $250.";
    const extracted = extractValuesFromText(text);
    expect(extracted.principalField).toMatchObject({ value: null, needsReview: true });
    expect(extracted.principalField.confidence).toBeLessThan(0.7);
    expect(extracted.plausibilityConflicts).toEqual(expect.arrayContaining([expect.objectContaining({ principal: 100, conflictingValue: 250, kind: "fee" })]));
    const result = analyzeLocally(text);
    expect(result.financialMetricsAvailable).toBe(false);
    expect(result.emi).toBeNull();
    expect(result.confidenceIssues.some((issue) => issue.includes("$100") && issue.includes("$250"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("$100") && warning.includes("$250"))).toBe(true);
    expect(analyzeLocally(text, 50).principalField.needsReview).toBe(true);
    expect(analyzeLocally(text, 1000).principalField.needsReview).toBe(false);
  });

  it("flags principal-based percentage fees that exceed principal", () => {
    expect(checkPrincipalPlausibility("Origination fee: 150% of principal.", 100)).toEqual(expect.arrayContaining([
      expect.objectContaining({ principal: 100, conflictingValue: 150, kind: "fee_percent" }),
    ]));
  });

  it("reports conflicting stated payments even when the payment cross-check already rejected principal", () => {
    const text = "Personal loan agreement.\nPrincipal: $150\nAPR: 5%\nTerm: 12 months\nMonthly payment: $200.";
    const result = extractValuesFromText(text);
    expect(result.principalField.needsReview).toBe(true);
    expect(result.plausibilityConflicts).toEqual(expect.arrayContaining([expect.objectContaining({ principal: 150, conflictingValue: 200, kind: "payment" })]));
  });

  it("excludes hypothetical and waived charges from plausibility conflicts", () => {
    expect(checkPrincipalPlausibility("Processing fee: $250 is waived. For example, a late fee of $500 could apply.", 100)).toEqual([]);
  });
});

describe("Round 5 legal evidence integration", () => {
  it("restores OCR-repaired sources and offsets to the original agreement", () => {
    const text = "LOAN AGREEMENT\n0rigination Fee .......... 3 %\nPRINCIPAL AMT: $ 15 , 000\nINTEREST ( APR ): 11.5 %\nTERM: 3 6 MONTHS\nLATE FEE: $ 25";
    const extracted = extractValuesFromText(text);
    const result = analyzeLocally(text);
    expect(result.rawText).toBe(text);
    expect(extracted.loanAmount).toBe(15000);
    expect(extracted.tenureMonths).toBe(36);
    expect(result.principalField.source).toBe("PRINCIPAL AMT: $ 15 , 000");
    const origination = result.fees.find((finding) => finding.id === "origination");
    expect(origination).toMatchObject({ percent: 3, totalImpact: 450, source: "0rigination Fee .......... 3 %" });
    for (const finding of result.findings.filter((item) => item.evidence)) {
      expect(text.slice(...finding.clauseSpan)).toBe(finding.evidence);
      expect(finding.evidence).not.toBe("LOAN AGREEMENT");
    }
    const principal = result.principalField.alternatives.find((candidate) => candidate.value === 15000);
    expect(principal?.position).toBe(text.indexOf("$ 15"));
  });

  it("resolves a defined Loan amount in numbered legal sections", () => {
    const text = [
      "LOAN AGREEMENT",
      "1. Definitions",
      'The "Loan" means $15,000 advanced by the Lender to the Borrower.',
      "2. Repayment",
      "The repayment term is 36 months. The fixed APR is 11.5%.",
      "3. Charges",
      "The origination fee is 3% of the Loan. A late fee of $25 applies after default.",
    ].join("\n");
    const result = analyzeLocally(text);
    expect(result.principal).toBe(15000);
    expect(result.termField.value).toBe(36);
    expect(result.fees.find((finding) => finding.id === "origination")?.totalImpact).toBe(450);
    expect(result.documentStructure?.definitions.some((definition) => definition.term.toLowerCase() === "loan" && definition.amount === 15000)).toBe(true);
  });

  it("prices fees from the amount referenced by an arbitrary defined term", () => {
    const text = [
      "LOAN AGREEMENT",
      'The "Loan" means $15,000 advanced to the Borrower.',
      'The "Facility" means $5,000 of available supplemental credit.',
      "Repayment term: 36 months. APR: 11.5%.",
      "Processing fee: 3% of the Facility ($200).",
    ].join("\n");
    const result = analyzeLocally(text);
    expect(result.principal).toBe(15000);
    expect(result.fees.find((finding) => finding.id === "processing")).toMatchObject({ basis: "Facility", percent: 3, amount: 200, totalImpact: 150 });
  });

  it("anchors repeated normalized clauses to their distinct original spans", () => {
    const text = [
      "LOAN AGREEMENT",
      'The "Loan" means $ 15 , 000.',
      'The "Loan" means $15,000.',
      "APR: 8%. Term: 36 months.",
      "Processing fee: $ 25.",
      "Processing fee: $25.",
    ].join("\n");
    const result = analyzeLocally(text);
    expect(result.documentStructure?.definitions.map((definition) => definition.source)).toEqual([
      'The "Loan" means $ 15 , 000.',
      'The "Loan" means $15,000.',
    ]);
    expect(result.documentStructure?.definitions.map((definition) => text.slice(...definition.amountSpan!))).toEqual(["$ 15 , 000", "$15,000"]);
    expect(result.fees.filter((finding) => finding.id === "processing").map((finding) => finding.source)).toEqual([
      "Processing fee: $ 25.",
      "Processing fee: $25.",
    ]);
    for (const finding of result.findings.filter((item) => item.evidence)) expect(text.slice(...finding.clauseSpan)).toBe(finding.evidence);
  });
});
