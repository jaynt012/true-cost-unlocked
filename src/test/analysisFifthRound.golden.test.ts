import { describe, expect, it } from "vitest";
import { analyzeLocally } from "@/lib/analyzeLocally";
import { detectCostsGeneric } from "@/lib/analysisEngine";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";

const TEST_11 = `CONGRATULATIONS! YOU ARE PRE-APPROVED FOR A $15,000 LOAN!

No credit check. 100% guaranteed approval. No documents needed.
To release your funds, pay a refundable processing deposit of $350 via gift cards or cryptocurrency.
Offer expires in 2 hours! Contact our agent on WhatsApp only.
Do not discuss this offer with your bank.`;

const TEST_14 = `LOAN   AGREEMENT
0rigination  Fee .......... 3 %
PRINCIPAL AMT:   $ 15 , 000
INTEREST ( APR )  :  11.5  %
TERM  :  3 6  MONTHS
LATE FEE: $ 25`;

describe("Round 5 exact golden documents", () => {
  it("Test 11 identifies the principal and Critical fraud clauses without inventing a term", () => {
    const result = analyzeLocally(TEST_11);
    expect(result.principal).toBe(15000);
    expect(result.termField.value).toBeNull();
    expect(result.riskBand).toBe("critical");
    expect(result.analysisIncomplete).toBe(true);
    const ids = result.findings.flatMap((finding) => [finding.id, ...(finding.mergedRuleIds ?? [])]);
    expect(ids).toEqual(expect.arrayContaining(["advance_fee_demand", "alternative_payment_demand", "urgency_deadline", "unofficial_contact_only", "secrecy_demand", "guaranteed_approval"]));
    expect(result.findings.filter((finding) => finding.provenance === "stated-in-document").every((finding) =>
      finding.evidence !== TEST_11.split("\n")[0])).toBe(true);
  });

  it("Test 14 repairs PDF noise and computes a percent origination fee", () => {
    const result = analyzeLocally(TEST_14);
    expect(result.principal).toBe(15000);
    expect(result.rateField.value).toBe(11.5);
    expect(result.termField.value).toBe(36);
    expect(result.fees.find((finding) => finding.id === "origination")).toMatchObject({ percent: 3, basis: "principal", totalImpact: 450 });
    expect(result.fees.find((finding) => finding.id === "late_payment")).toMatchObject({ amount: 25 });
    expect(result.financialMetricsAvailable).toBe(true);
    for (const finding of result.findings.filter((finding) => finding.evidence)) {
      expect(TEST_14.slice(...finding.clauseSpan)).toBe(finding.evidence);
    }
    expect(result.findings.find((finding) => finding.id === "origination")?.evidence).toContain("0rigination  Fee .......... 3 %");
  });

  it("Test 12 clean loan retains a zero score", () => {
    const result = analyzeLocally(CLEAN_LOAN);
    expect(result.riskScore).toBe(0);
    expect(result.riskBand).toBe("low");
  });
});

describe("Round 5 generic legal catalog", () => {
  it.each([
    ["alternative_payment_demand", "Borrower must pay the release charge by wire transfer."],
    ["urgency_deadline", "The offer expires in one hour."],
    ["secrecy_demand", "Do not tell your family about this offer."],
    ["unofficial_contact_only", "Contact our representative on Telegram only."],
    ["guaranteed_approval", "Approval is guaranteed."],
    ["unilateral_term_change", "The creditor may modify the payment terms at its discretion."],
    ["unilateral_rate_increase", "The Lender may increase the interest rate at its discretion."],
    ["cross_default", "Any default under another agreement is a cross-default here."],
    ["seizure_without_notice", "The Lender may repossess the vehicle without prior notice."],
    ["jury_trial_waiver", "I waive my right to a jury-trial."],
    ["class_action_waiver", "The Borrower waives the right to join a class action."],
    ["binding_arbitration", "The parties agree to binding arbitration."],
    ["confession_of_judgment", "A confession of judgment is required."],
    ["after_acquired_property", "Security extends to after-acquired property."],
    ["upfront_deduction", "A release charge of $40 is deducted from the proceeds."],
  ])("detects catalog entry %s from its own clause", (id, text) => {
    expect(detectCostsGeneric(text, 8000, null, 24).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, negated: false, evidence: text, clauseSpan: [0, text.length] }),
    ]));
  });

  it.each(["The jury-trial right is not waived.", "The class action rights are not waived.", "We do not waive our right to a jury-trial."])("preserves denied rights waivers: %s", (text) => {
    const findings = detectCostsGeneric(text, null, null, null).findings;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.category === "protection")).toBe(true);
  });

  it("excludes hypothetical secrecy requests", () => {
    expect(detectCostsGeneric("For example, do not tell your bank about an offer.", null, null, null).findings).toEqual([]);
  });

  it("merges several matches in one clause, preserving component amounts", () => {
    const text = "Loan amount: $8000\nAPR: 9%\nTerm: 24 months\nLate fee: $35, plus a rescheduling fee of $15.\nBorrower waives jury trial and class-action rights and agrees to binding arbitration.";
    const result = analyzeLocally(text);
    const late = result.findings.filter((finding) => finding.evidence.includes("rescheduling"));
    expect(late).toHaveLength(1);
    expect(late[0].components?.map((finding) => finding.amount)).toEqual(expect.arrayContaining([35, 15]));
    const legal = result.findings.filter((finding) => finding.evidence.startsWith("Borrower waives"));
    expect(legal).toHaveLength(1);
    expect(legal[0].mergedRuleIds).toEqual(expect.arrayContaining(["jury_trial_waiver", "class_action_waiver", "binding_arbitration"]));
    expect(result.riskBreakdown.filter((item) => item.evidence === legal[0].evidence)).toHaveLength(1);
  });

  it("applies generic detectors to an unclassified document and attaches actual clauses", () => {
    const text = "SERVICE TERMS\n1. Enforcement\nProvider may seize property without prior notice.\n2. Security\nThe obligation includes after-acquired property.\nA confession of judgment is required.";
    const result = analyzeLocally(text);
    expect(result.docType.type).toBe("unknown");
    expect(result.riskBand).toBe("critical");
    const ids = result.findings.flatMap((finding) => [finding.id, ...(finding.mergedRuleIds ?? [])]);
    expect(ids).toEqual(expect.arrayContaining(["seizure_without_notice", "after_acquired_property", "confession_of_judgment"]));
    const seizure = result.findings.find((finding) => finding.mergedRuleIds?.includes("seizure_without_notice") || finding.id === "seizure_without_notice");
    expect(seizure?.evidence).toBe("Provider may seize property without prior notice.");
  });
});
