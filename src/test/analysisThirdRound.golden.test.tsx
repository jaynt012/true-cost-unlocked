import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisPanels } from "@/components/AnalysisPanels";
import { analyzeLocally, extractValuesFromText } from "@/lib/analyzeLocally";

describe("TRUE COST third-round golden cases", () => {
  it("extracts BNPL deferred APR and total duration without treating the installment interval as the term", () => {
    const document = [
      "BUY NOW PAY LATER AGREEMENT - SHOPEASY PAY",
      "Purchase Amount: $1,200",
      "Pay in 4 interest-free installments of $300 every 2 weeks!",
      "NO INTEREST. NO FEES. 100% FREE!*",
      "*Deferred interest applies. If the balance is not paid in full by the end of the promotional period, interest will be charged retroactively from the purchase date at 36% APR.",
      "Convenience fee: $7.99 per installment.",
      "Missed installment fee: $35, plus a rescheduling fee of $15.",
      "Payment Protection Plan: $12/month, automatically added unless you opt out in writing within 24 hours.",
      "By accepting, you waive your right to join a class action and agree to binding arbitration.",
      "We may report missed payments to credit bureaus and share your data with partners.",
    ].join("\n");
    const extracted = extractValuesFromText(document);
    const result = analyzeLocally(document);

    expect(extracted.rateField.value).toBe(36);
    expect(extracted.rateField.rateType).toBe("deferred");
    expect(extracted.interestRateIsConditional).toBe(true);
    expect(extracted.termField.value).toBeCloseTo(8 * 12 / 52, 3);
    expect(result.installmentSchedule).toMatchObject({ count: 4, amount: 300, interval: 2, intervalUnit: "week", total: 1200 });
    expect(result.cashPriceAnalysis).toMatchObject({ cashPrice: 1200, totalPaid: 1200, multiple: 1, extraCost: 0, impliedNominalAPR: 0 });
    expect(result.rateField).toMatchObject({ value: 36, rateType: "deferred", rateRole: "promotional" });
    expect(result.warnings.some((warning) => /conditional deferred APR of 36%/i.test(warning))).toBe(true);
    expect(result.riskBand).not.toBe("low");
    expect(result.summary).not.toMatch(/undefined|NaN|null/i);
  });

  it("resolves a percent-derived processing fee and keeps a penal rate out of the base rate", () => {
    const document = [
      "GOLD LOAN AGREEMENT",
      "Loan amount: Rs. 2,00,000",
      "Interest: 1.8% per month flat",
      "Repayment term: 12 months",
      "Monthly EMI: Rs. 20,266.67",
      "Processing fee: 1% of loan amount (Rs. 2,000) deducted from disbursal.",
      "Penal interest: 24% p.a. on overdue balance.",
      "The lender may auction the pledged gold after two missed EMIs.",
    ].join("\n");
    const extracted = extractValuesFromText(document);
    const result = analyzeLocally(document);

    expect(result.principal).toBe(200000);
    expect(result.rateField).toMatchObject({ value: 21.6, rateType: "flat", rateRole: "base" });
    expect(result.termField.value).toBe(12);
    expect(extracted.paymentMatches).toBe(true);
    expect(result.financialMetricsAvailable).toBe(true);
    expect(result.totalInterest).toBeCloseTo(43200, 2);
    expect(result.totalPayment).toBeCloseTo(243200, 2);
    expect(result.fees.filter((finding) => finding.id === "processing")).toHaveLength(1);
    expect(result.fees.some((finding) => finding.id === "upfront_deduction")).toBe(false);
    expect(result.fees.find((finding) => finding.id === "processing")?.amount).toBe(2000);
    expect(result.amountRelationships.some((relationship) => relationship.type === "percent_of" && relationship.confirmed && relationship.derivedAmount === 2000)).toBe(true);
    expect(result.principalField.alternatives.some((candidate) => candidate.value === 2000)).toBe(false);
    expect(result.netDisbursed).toBe(198000);
    expect(result.effectiveAPR).toBeGreaterThan(35);
    expect(result.effectiveAPR).toBeLessThan(45);
    expect(result.simulator.penaltyAPR).toBe(24);
    expect(result.rateField.value).not.toBe(result.simulator.penaltyAPR);
    expect(result.fees.some((finding) => finding.id === "collateral_recovery")).toBe(true);
    expect(result.riskBand).toBe("critical");
  });

  it("diagnoses rent-to-own forfeiture, delayed ownership, repossession, and no-credit marketing", () => {
    const document = [
      "RENT-TO-OWN AGREEMENT",
      "Cash price: $900",
      "Payment: $45 weekly for 78 weeks",
      "If any payment is missed, all amounts already paid are forfeited and the equipment may be repossessed.",
      "Ownership of the equipment transfers only after all scheduled payments are completed.",
      "Own it today for just $45 per week.",
      "No credit check required.",
    ].join("\n");
    const result = analyzeLocally(document);

    expect(result.docType.type).toBe("rent_to_own");
    expect(result.installmentSchedule).toMatchObject({ count: 78, amount: 45, intervalUnit: "week", total: 3510 });
    expect(result.termField.value).toBeCloseTo(78 * 12 / 52, 3);
    expect(result.cashPriceAnalysis).toMatchObject({ cashPrice: 900, totalPaid: 3510, multiple: 3.9, extraCost: 2610 });
    expect(result.cashPriceAnalysis?.impliedNominalAPR).toBeGreaterThan(200);
    expect(result.fees.some((finding) => finding.id === "forfeiture")).toBe(true);
    expect(result.fees.some((finding) => finding.id === "collateral_recovery")).toBe(true);
    expect(result.fees.some((finding) => finding.id === "ownership_after_final_payment")).toBe(true);
    expect(result.claims.some((claim) => claim.id === "own_it_today" && claim.contradicted)).toBe(true);
    expect(result.claims.some((claim) => claim.id === "no_credit_needed" && Boolean(claim.signal))).toBe(true);
    expect(result.riskBand).toBe("critical");
    expect(result.confidenceIssues.join(" ")).not.toMatch(/rate/i);
  });

  it("sets a Critical risk floor for an advance fee required before funds are released", () => {
    const result = analyzeLocally([
      "ADVANCE CREDIT AGREEMENT",
      "Loan amount: $800",
      "APR: 12%",
      "Term: 12 months",
      "To release the credit, pay an advance fee of $100 before funds are released.",
    ].join("\n"));

    expect(result.fees.some((finding) => finding.id === "advance_fee_demand" && finding.amount === 100)).toBe(true);
    expect(result.riskBand).toBe("critical");
  });

  it("does not present short-term credit as a monthly EMI calculation without a supported payment model", () => {
    const result = analyzeLocally("Payday loan. Loan amount: $500. APR: 360%. Term: 14 days.");

    expect(result.docType.type).toBe("payday");
    expect(result.calculator.available).toBe(false);
    expect(result.calculator.unsupportedReason).toMatch(/not modeled as a monthly EMI/i);
    expect(result.financialMetricsAvailable).toBe(false);
    expect(result.riskBand).toBe("high");
    expect(result.analysisIncomplete).toBe(true);
    expect(result.confidenceIssues).toContain(result.calculator.unsupportedReason);
  });

  it("does not create a reconciliation or derived relationship for a plain A equals A amount", () => {
    const result = analyzeLocally([
      "Installment loan agreement",
      "Cash price: $1,000",
      "Amount financed: $1,000",
      "APR: 0%",
      "Term: 12 months",
    ].join("\n"));

    expect(result.reconciliations).toHaveLength(0);
    expect(result.amountRelationships.some((relationship) => relationship.type === "sum_of" || relationship.type === "difference_of")).toBe(false);
  });

  it("handles an unseen currency and daily schedule wording", () => {
    const result = analyzeLocally([
      "Retail installment agreement",
      "Cash price: C$400",
      "Pay C$15 daily for 30 days.",
      "The asset transfers to the customer once all scheduled payments are completed.",
    ].join("\n"));

    expect(result.currencyCode).toBe("CAD");
    expect(result.installmentSchedule).toMatchObject({ count: 30, amount: 15, interval: 1, intervalUnit: "day", total: 450 });
    expect(result.cashPriceAnalysis?.multiple).toBeCloseTo(1.125, 3);
    expect(result.fees.some((finding) => finding.id === "ownership_after_final_payment")).toBe(true);
  });

  it("uses configured severity floors and separates score bands from extraction completeness", () => {
    const document = [
      "Installment loan agreement",
      "Loan amount: $1,000",
      "APR: 12%",
      "Term: 12 months",
      "The provider may unilaterally change rates and fees without notice.",
    ].join("\n");
    const result = analyzeLocally(document);
    expect(result.fees.some((finding) => finding.id === "unilateral_term_change")).toBe(true);
    expect(result.riskBand, JSON.stringify({ confidence: result.confidence, breakdown: result.riskBreakdown })).toBe("high");
    expect(result.analysisIncomplete).toBe(false);
    expect(result.riskBreakdown[0].weight).toBeCloseTo(0.55);
    expect(result.riskBreakdown[0].combinedScore).toBeCloseTo(55);
  });

  it("keeps result panels isolated between analyses and registers each panel once", () => {
    const first = analyzeLocally("Installment agreement. Processing fee: ₹101.");
    const second = analyzeLocally("Installment agreement. Processing fee: USD 207.");
    const mounted = render(createElement(AnalysisPanels, { context: first }));

    const panelIds = Array.from(mounted.container.querySelectorAll("[data-analysis-panel]"))
      .map((panel) => panel.getAttribute("data-analysis-panel"));
    expect(new Set(panelIds).size).toBe(panelIds.length);
    expect(mounted.container.textContent).toContain("₹101");
    mounted.rerender(createElement(AnalysisPanels, { context: second, key: second.id }));
    expect(mounted.container.textContent).not.toContain("₹101");
    expect(mounted.container.textContent).toContain("$207.00");
    expect(mounted.container.querySelectorAll("[data-analysis-panel='analysis-dashboard']")).toHaveLength(1);
  });

  it("does not produce placeholder values in visible local diagnosis text", () => {
    const result = analyzeLocally("Installment agreement. Processing fee: €25.");
    const visibleText = [result.summary, ...result.warnings, ...result.hiddenFees, ...result.insights, ...result.advice.reasons].join(" ");

    expect(visibleText).not.toMatch(/\b(?:undefined|NaN|null)\b|\[object Object\]|\.{2,}/i);
  });
});
