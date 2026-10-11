import { describe, expect, it } from "vitest";
import { analyzeLocally } from "@/lib/analyzeLocally";

describe("owner-provided contract edge cases", () => {
  it("keeps independently supported TILA fields and isolates a contradictory payment schedule", () => {
    const text = `CONSUMER LOAN AGREEMENT
ANNUAL PERCENTAGE RATE: 9.90%
FINANCE CHARGE: $1,919.15
AMOUNT FINANCED: $12,000.00
TOTAL OF PAYMENTS: $13,919.15
Number of Payments: 36   Amount of Each Payment: $520.00, due monthly
Amount paid to Borrower: $10,000.00
Origination Fee paid to Lender: $1,200.00
Loan Protection Plan premium paid to affiliate (required): $800.00
Lender may adjust the rate, fees, and payment amount at any time without notice.`;
    const result = analyzeLocally(text);
    expect(result.principalField.value).toBe(12000);
    expect(result.rateField.value).toBe(9.9);
    expect(result.rateField.type).toBe("variable");
    expect(result.termField.value).toBe(36);
    expect(result.statedEMI.value).toBe(520);
    expect(result.statedEMI.needsReview).toBe(true);
    expect(result.installmentSchedule?.total).toBe(18720);
    expect(result.findings.some((finding) => finding.id === "payment_total" || finding.id === "emi_apr")).toBe(true);
    expect(result.emi).toBeCloseTo(386.64, 1);
    expect(result.netDisbursed).toBe(10000);
  });

  it("uses the labeled payment count as the term and excludes delinquency and cure windows", () => {
    const text = `RETAIL INSTALLMENT SALE CONTRACT
ANNUAL PERCENTAGE RATE: 5.49% (fixed)
FINANCE CHARGE: $2,782.60
AMOUNT FINANCED: $19,085.00
TOTAL OF PAYMENTS: $21,867.60
Number of Payments: 60   Amount of Each Payment: $364.46, due monthly
If a payment is more than 10 days late, charge 5% of the late payment.
Default occurs after 30 days past due. Seller gives notice and 20 days to cure before repossession.`;
    const result = analyzeLocally(text);
    expect(result.docType.type).toBe("auto_loan");
    expect(result.principalField.value).toBe(19085);
    expect(result.rateField.value).toBe(5.49);
    expect(result.termField.value).toBe(60);
    expect(result.statedEMI.value).toBe(364.46);
    expect(result.installmentSchedule?.total).toBeCloseTo(21867.6, 2);
    expect(result.constraintMismatches ?? []).toEqual([]);
    expect(result.findings.some((finding) => finding.id === "seizure_without_notice")).toBe(false);
  });

  it("keeps clean personal-loan disclosures and treats fee waivers and rescission as protections", () => {
    const text = `PERSONAL LOAN AGREEMENT
ANNUAL PERCENTAGE RATE: 7.25% fixed
FINANCE CHARGE: $2,325.12
AMOUNT FINANCED: $15,000.00
TOTAL OF PAYMENTS: $17,325.12
Number of Payments: 48   Amount of Each Payment: $360.94, due monthly
There is no origination fee, application fee, or annual fee.
Borrower may cancel within three business days without cost.`;
    const result = analyzeLocally(text);
    expect(result.principalField.value).toBe(15000);
    expect(result.rateField.value).toBe(7.25);
    expect(result.termField.value).toBe(48);
    expect(result.statedEMI.value).toBe(360.94);
    expect(result.emi).toBeCloseTo(360.94, 1);
    expect(result.fees.some((finding) => finding.id === "annual" && !finding.negated)).toBe(false);
  });

  it("keeps an intermediary's advertised amount unverified and excludes release windows from loan fields", () => {
    const text = `LOAN FACILITATION SERVICES AGREEMENT
Company will arrange a personal loan of $50,000 from a lending partner. Company is not a lender. Approval is guaranteed.
The lender will determine the interest rate and repayment term after funds are released.
Funds will be released within 24 hours. This offer is valid for 48 hours.
Prior to disbursement, Client shall pay a $2,400 deposit by wire transfer, cryptocurrency, or gift cards.
Client shall not disclose this agreement to any bank or family member. All communications must be through the messaging application.`;
    const result = analyzeLocally(text);
    expect(result.docType.type).toBe("advance_fee_scam");
    expect(result.principalField.value).toBe(50000);
    expect(result.principalField.needsReview).toBe(true);
    expect(result.termField.value).toBeNull();
    expect(result.rateField.value).toBeNull();
    expect(result.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "advance_fee_demand", "secrecy_demand", "unofficial_contact_only", "urgency_deadline",
    ]));
  });
});
