import { describe, expect, it } from "vitest";
import { analyzeLocally } from "@/lib/analyzeLocally";

describe("Round 4 negation scope controls", () => {
  it.each([
    "If you do not pay on time, a late fee of $25 applies.",
    "When payment is not received, a late fee of $25 applies.",
  ])("preserves a charge conditional on a negative event: %s", (text) => {
    const result = analyzeLocally(text);
    expect(result.fees.find((finding) => finding.id === "late_payment")?.amount).toBe(25);
    expect(result.protections.some((finding) => finding.topicId === "late_payment")).toBe(false);
  });

  it("ends negation scope at an affirmative exception", () => {
    const result = analyzeLocally("No late fee, only a processing fee of $25.");
    expect(result.protections.some((finding) => finding.topicId === "late_payment")).toBe(true);
    expect(result.fees.find((finding) => finding.id === "processing")?.amount).toBe(25);
  });

  it("does not mistake a nonrefundable fee for an excluded fee", () => {
    const result = analyzeLocally("Processing fee: $25, not refundable.");
    expect(result.fees.find((finding) => finding.id === "processing")?.amount).toBe(25);
    expect(result.protections.some((finding) => finding.topicId === "processing")).toBe(false);
  });

  it("keeps an unannounced unilateral change as an adverse finding", () => {
    const result = analyzeLocally("The lender may unilaterally change rates and fees without notice.");
    expect(result.fees.some((finding) => finding.id === "unilateral_term_change")).toBe(true);
  });

  it("scopes coordinated exclusions across both catalog topics", () => {
    const result = analyzeLocally("No processing fee or annual fee applies.");
    expect(result.fees).toHaveLength(0);
    expect(result.protections.some((finding) => finding.topicId === "processing")).toBe(true);
    expect(result.protections.flatMap((finding) => finding.components ?? [finding]).some((finding) => finding.topicId === "annual")).toBe(true);
  });

  it("treats repeated coordinated negators as separate exclusions", () => {
    const result = analyzeLocally("No processing fee and no annual fee.");
    expect(result.fees).toHaveLength(0);
    expect(result.protections).toHaveLength(1);
    expect(result.protections.flatMap((finding) => finding.components ?? [finding]).map((finding) => finding.topicId)).toEqual(expect.arrayContaining(["processing", "annual"]));
  });

  it("does not claim a cancellation right when cancellation is prohibited", () => {
    const result = analyzeLocally("You cannot cancel within 14 days.");
    expect(result.protections.some((finding) => finding.topicId === "cancellation_window")).toBe(false);
  });

  it("keeps a passive waiver of consumer rights adverse", () => {
    const result = analyzeLocally("Binding arbitration applies and class-action rights are waived.");
    expect(result.protections.some((finding) => finding.topicId === "arbitration")).toBe(false);
    expect(result.findings.some((finding) => finding.category === "legal" && finding.severity > 0)).toBe(true);
  });

  it("does not select an expressly excluded rate", () => {
    const result = analyzeLocally("Personal loan. Loan amount: $1000. Term: 12 months. The APR is not 20%.");
    expect(result.rateField.value).not.toBe(20);
  });
});
