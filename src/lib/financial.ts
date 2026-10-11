import scheduleRules from "@/data/scheduleRules.json";
import { normalizeNumericLiteral } from "./documentNormalization";
import { countedSchedules, NUMBER_PATTERN, parseWrittenNumber, UNIT_PATTERN, unitSpec } from "./scheduleParsing";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// ---------------------------------------------------------------------------
// Time units + rate normalization
// ---------------------------------------------------------------------------

export type TimeUnit = "day" | "week" | "fortnight" | "month" | "year";

const MONTHS_PER_UNIT: Record<TimeUnit, number> = {
  day: 12 / 365,
  week: 12 / 52,
  fortnight: 12 / 26,
  month: 1,
  year: 12,
};

const PERIODS_PER_YEAR: Record<TimeUnit, number> = {
  day: 365,
  week: 52,
  fortnight: 26,
  month: 12,
  year: 1,
};

export function parseTimeUnit(raw: string): TimeUnit | null {
  return unitSpec(raw)?.unit as TimeUnit | undefined ?? null;
}

/** Convert a duration (e.g. 14 days, 3 years) to months. */
export function toMonths(value: number, unit: TimeUnit): number | null {
  if (!isNum(value) || value <= 0) return null;
  return value * MONTHS_PER_UNIT[unit];
}

/** Convert a periodic nominal rate (e.g. 1.5% per month) to an annual nominal rate (%). */
export function toAnnualRate(value: number, per: TimeUnit): number | null {
  if (!isNum(value) || value < 0) return null;
  return value * PERIODS_PER_YEAR[per];
}

export interface ParsedDuration {
  months: number;
  /** "high" = explicitly labeled term/tenure/installment schedule; "low" = guessed from context */
  confidence: "high" | "low";
  /** The text that produced the match (for highlighting / explainability) */
  source: string;
}

/**
 * Extract the loan duration from free text and return it in months.
 * Handles: "Term: 60 months", "Tenure: 3 years", "14 days",
 * "4 installments ... every 2 weeks", "12 monthly installments", "for one year".
 * Returns null if nothing usable is found (never defaults to 0).
 */
export function normalizeDuration(text: string): ParsedDuration | null {
  if (!text) return null;
  const explicit = new RegExp(`\\b(?:${scheduleRules.explicitTermPattern})\\s*(?:of|:|is|=|[-–—])?\\s*(${NUMBER_PATTERN})(?:\\s*\\((\\d+)\\))?\\s*[- ]?\\s*(${UNIT_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(explicit)) {
    const prefix = text.slice(Math.max(0, match.index! - 45), match.index!).split(/[.;\n]/).pop() ?? "";
    if (new RegExp(`\\b(?:${scheduleRules.nonTermPattern})\\b`, "i").test(prefix)) continue;
    const value = parseWrittenNumber(match[1]);
    if (value && (!match[2] || Number(match[2]) === value)) {
      const unit = unitSpec(match[3]);
      if (unit) return { months: value * unit.months, confidence: "high", source: match[0] };
    }
  }
  const schedules = countedSchedules(text).filter((entry) => entry.months !== null);
  if (schedules.length && schedules.every((entry) => Math.abs(entry.months! - schedules[0].months!) < 0.01)) {
    return { months: schedules[0].months!, confidence: "high", source: schedules[0].source };
  }
  const inferred = new RegExp(`\\b(?:${scheduleRules.termConnectorPattern})\\s+(${NUMBER_PATTERN})\\s*[- ]?\\s*(${UNIT_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(inferred)) {
    const prefix = text.slice(Math.max(0, match.index! - 70), match.index!).split(/[.;\n]/).pop() ?? "";
    if (new RegExp(`\\b(?:${scheduleRules.nonTermPattern})\\b`, "i").test(prefix)) continue;
    const value = parseWrittenNumber(match[1]);
    const unit = unitSpec(match[2]);
    if (value && unit) return { months: value * unit.months, confidence: "low", source: match[0] };
  }
  return null;
}

/** "Rs. 5,00,000" / "$1,200.50" / "₹ 25,000" -> number (null if unparseable). */
export function parseAmount(raw: string): number | null {
  const matches = Array.from(raw.matchAll(/[+-]?\d(?:[\d.,'’ \u00a0\u202f]*\d)?/g));
  if (matches.length !== 1) return null;
  const sign = matches[0][0].startsWith("-") ? -1 : 1;
  let token = matches[0][0].replace(/^[+-]/, "").replace(/[\u00a0\u202f]/g, " ");
  token = token.replace(new RegExp(scheduleRules.numericFormatting.apostropheGroupingPattern, "g"), "");
  if (/\s/.test(token)) {
    if (!new RegExp(scheduleRules.numericFormatting.groupedSpacePattern).test(token)) return null;
    token = token.replace(/ /g, "");
  }
  const cleaned = normalizeNumericLiteral(token, { money: true, decimalCurrency: new RegExp(scheduleRules.numericFormatting.decimalCurrencyPattern, "i").test(raw) });
  if (cleaned === null) return null;
  const n = sign * Number(cleaned.replace(/,/g, ""));
  return isNum(n) ? n : null;
}

// ---------------------------------------------------------------------------
// EMI (reducing balance) and flat-rate loans
// ---------------------------------------------------------------------------

export interface EMIResult {
  emi: number;
  totalPayment: number;
  totalInterest: number;
}

// EMI = (P * r * (1+r)^n) / ((1+r)^n - 1), r = annualRate / 12 / 100
// Returns null on invalid input instead of fake zeros.
export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): EMIResult | null {
  if (!isNum(principal) || !isNum(annualRate) || !isNum(tenureMonths)) return null;
  if (principal <= 0 || tenureMonths <= 0 || annualRate < 0) return null;

  if (annualRate === 0) {
    return { emi: principal / tenureMonths, totalPayment: principal, totalInterest: 0 };
  }

  const r = annualRate / 12 / 100;
  const factor = Math.pow(1 + r, tenureMonths);
  if (!Number.isFinite(factor) || factor === 1) return null;

  const emi = (principal * r * factor) / (factor - 1);
  const totalPayment = emi * tenureMonths;
  return { emi, totalPayment, totalInterest: totalPayment - principal };
}

/**
 * Flat-rate loan: interest = principal * rate * years, charged on the ORIGINAL principal.
 * (This is why "1.5% per month flat" is far costlier than it sounds.)
 */
export function calculateFlatLoan(principal: number, flatAnnualRate: number, tenureMonths: number): EMIResult | null {
  if (!isNum(principal) || !isNum(flatAnnualRate) || !isNum(tenureMonths)) return null;
  if (principal <= 0 || tenureMonths <= 0 || flatAnnualRate < 0) return null;

  const totalInterest = principal * (flatAnnualRate / 100) * (tenureMonths / 12);
  const totalPayment = principal + totalInterest;
  return { emi: totalPayment / tenureMonths, totalPayment, totalInterest };
}

// ---------------------------------------------------------------------------
// Effective APR (IRR) - the "true cost" engine
// ---------------------------------------------------------------------------

export interface EffectiveRate {
  /** Rate per period solving NPV = 0 (decimal, e.g. 0.02 = 2%) */
  periodicRate: number;
  /** Nominal APR = periodicRate * periodsPerYear (decimal) */
  apr: number;
  /** Effective annual rate with compounding (decimal), null if it overflows */
  ear: number | null;
}

/**
 * Solve for the periodic rate where NPV of the cash flows is zero.
 * cashFlows[0] = money the borrower actually RECEIVES (positive, after upfront fees),
 * cashFlows[1..] = payments made (negative).
 * Returns null if inputs are invalid or the borrower repays less than received.
 */
export function calculateEffectiveAPR(cashFlows: number[], periodsPerYear = 12): EffectiveRate | null {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) return null;
  if (!cashFlows.every(isNum) || !isNum(periodsPerYear) || periodsPerYear <= 0) return null;
  if (cashFlows[0] <= 0) return null;

  const total = cashFlows.reduce((a, b) => a + b, 0);
  if (total > 0) return null; // pays back less than received: not a loan cost
  if (total === 0) return { periodicRate: 0, apr: 0, ear: 0 };

  // NPV is increasing in i: negative at i = 0, tends to cashFlows[0] > 0 as i -> infinity.
  const npv = (i: number) => cashFlows.reduce((s, cf, k) => s + cf / Math.pow(1 + i, k), 0);

  let lo = 0;
  let hi = 1;
  let guard = 0;
  while (npv(hi) < 0 && guard++ < 200) hi *= 2;
  if (npv(hi) < 0) return null;

  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) < 0) lo = mid;
    else hi = mid;
  }

  const periodicRate = (lo + hi) / 2;
  const ear = Math.pow(1 + periodicRate, periodsPerYear) - 1;
  return {
    periodicRate,
    apr: periodicRate * periodsPerYear,
    ear: Number.isFinite(ear) ? ear : null,
  };
}

/**
 * Short-term / single-repayment loans (payday, cash advance).
 * netReceived = principal - upfront fees; totalRepay = what you pay back on day `days`.
 * Returns nominal APR in percent (e.g. 548.9), or null on invalid input.
 */
export function calculateShortTermAPR(netReceived: number, totalRepay: number, days: number): number | null {
  if (!isNum(netReceived) || !isNum(totalRepay) || !isNum(days)) return null;
  if (netReceived <= 0 || days <= 0 || totalRepay < netReceived) return null;
  return ((totalRepay - netReceived) / netReceived) * (365 / days) * 100;
}

// ---------------------------------------------------------------------------
// Full loan analysis (stated rate vs true cost)
// ---------------------------------------------------------------------------

export interface LoanInput {
  principal: number;
  /** Stated nominal annual rate in percent */
  annualRate: number;
  tenureMonths: number;
  /** "reducing" (default) or "flat" */
  rateType?: "reducing" | "flat";
  /** Fees deducted from the loan proceeds (origination, processing, financed insurance...) */
  upfrontFees?: number;
  /** Fees added to every monthly payment (mandatory insurance, convenience fees...) */
  monthlyFees?: number;
}

export interface LoanAnalysis {
  emi: number;
  /** emi + monthly fees */
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  totalFees: number;
  /** principal - upfront fees: the cash the borrower actually gets */
  netDisbursed: number;
  /** totalPayment - netDisbursed: the all-in cost of credit */
  totalCost: number;
  statedRate: number;
  /** True annual cost in percent (null if it can't be solved) */
  effectiveAPR: number | null;
}

export function analyzeLoan(input: LoanInput): LoanAnalysis | null {
  const { principal, annualRate, rateType = "reducing" } = input;
  const upfront = input.upfrontFees ?? 0;
  const monthly = input.monthlyFees ?? 0;

  if (!isNum(input.tenureMonths) || !isNum(upfront) || !isNum(monthly)) return null;
  if (upfront < 0 || monthly < 0) return null;

  const n = Math.round(input.tenureMonths);
  if (n < 1) return null;

  const base = rateType === "flat" ? calculateFlatLoan(principal, annualRate, n) : calculateEMI(principal, annualRate, n);
  if (!base) return null;

  const netDisbursed = principal - upfront;
  if (netDisbursed <= 0) return null;

  const monthlyPayment = base.emi + monthly;
  const totalPayment = monthlyPayment * n;
  const flows = [netDisbursed, ...Array<number>(n).fill(-monthlyPayment)];
  const eff = calculateEffectiveAPR(flows, 12);

  return {
    emi: base.emi,
    monthlyPayment,
    totalPayment,
    totalInterest: base.totalInterest,
    totalFees: upfront + monthly * n,
    netDisbursed,
    totalCost: totalPayment - netDisbursed,
    statedRate: annualRate,
    effectiveAPR: eff ? eff.apr * 100 : null,
  };
}

/** Compare two scenarios (e.g. paid on time vs. penalty/deferred interest). */
export function compareScenarios(best: LoanInput, worst: LoanInput) {
  const a = analyzeLoan(best);
  const b = analyzeLoan(worst);
  if (!a || !b) return null;
  return { best: a, worst: b, extraCost: b.totalCost - a.totalCost };
}

// ---------------------------------------------------------------------------
// Revolving credit (credit cards): minimum-payment payoff
// ---------------------------------------------------------------------------

export interface MinPaymentResult {
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** true if the payoff hit the safety cap (100 years) */
  capped: boolean;
}

/**
 * Simulates paying only the minimum each month.
 * Minimum = max(floor, percentOfBalance% of balance + that month's interest).
 */
export function minimumPaymentPayoff(
  balance: number,
  annualRate: number,
  opts: { floor?: number; percentOfBalance?: number } = {},
): MinPaymentResult | null {
  const floor = opts.floor ?? 25;
  const pct = opts.percentOfBalance ?? 1;
  if (!isNum(balance) || !isNum(annualRate) || balance <= 0 || annualRate < 0) return null;
  if (!isNum(floor) || !isNum(pct) || floor < 0 || pct < 0) return null;

  const r = annualRate / 12 / 100;
  const MAX_MONTHS = 1200;
  let bal = balance;
  let months = 0;
  let totalInterest = 0;
  let totalPaid = 0;

  while (bal > 0.005 && months < MAX_MONTHS) {
    const interest = bal * r;
    const due = Math.max(floor, (pct / 100) * bal + interest);
    const payment = Math.min(due, bal + interest);
    bal = bal + interest - payment;
    totalInterest += interest;
    totalPaid += payment;
    months++;
  }

  if (months === 0) return null;
  return { months, totalInterest, totalPaid, capped: bal > 0.005 };
}

// ---------------------------------------------------------------------------
// Amortization schedule (reducing balance)
// ---------------------------------------------------------------------------

export interface AmortizationRow {
  month: number;
  emi: number;
  principalPaid: number;
  interestPaid: number;
  remainingBalance: number;
}

export function generateAmortizationSchedule(principal: number, annualRate: number, tenureMonths: number): AmortizationRow[] {
  if (!isNum(tenureMonths)) return [];
  const n = Math.round(tenureMonths);
  const result = calculateEMI(principal, annualRate, n);
  if (!result) return [];

  const { emi } = result;
  const r = annualRate / 12 / 100;
  let balance = principal;
  const rows: AmortizationRow[] = [];

  for (let month = 1; month <= n; month++) {
    const interestPaid = balance * r;
    // Final month clears the balance exactly (avoids floating-point residue)
    const principalPaid = month === n ? balance : Math.min(emi - interestPaid, balance);
    balance = Math.max(balance - principalPaid, 0);
    rows.push({ month, emi, principalPaid, interestPaid, remainingBalance: balance });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export type SupportedCurrency = "USD" | "INR" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD" | "SGD" | "AED";

const DEFAULT_CURRENCY: SupportedCurrency = "USD";

const CURRENCY_LOCALE: Record<SupportedCurrency, string> = {
  USD: "en-US",
  INR: "en-IN", // lakh/crore grouping: 5,00,000
  EUR: "en-IE",
  GBP: "en-GB",
  JPY: "en-US", // en-US renders the standard ¥ (ja-JP uses a fullwidth yen sign)
  CAD: "en-CA",
  AUD: "en-AU",
  SGD: "en-SG",
  AED: "en-AE",
};

export function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_LOCALE, currency);
}

/**
 * Detect the currency used in a document. Returns null when nothing recognizable is found,
 * so the caller can ask the user instead of silently assuming USD.
 * Note: a bare "$" is assumed to be USD unless prefixed (A$, C$, S$).
 */
export function detectCurrency(text: string): SupportedCurrency | null {
  if (!text) return null;
  if (/₹|\bRs\.?\s*\d|\bINR\b|\brupees?\b/i.test(text)) return "INR";
  if (/\bA\$|\bAUD\b/.test(text)) return "AUD";
  if (/\bC\$|\bCAD\b/.test(text)) return "CAD";
  if (/\bS\$|\bSGD\b/.test(text)) return "SGD";
  if (/\bAED\b|\bdirhams?\b/i.test(text)) return "AED";
  if (/€|\bEUR\b/.test(text)) return "EUR";
  if (/£|\bGBP\b/.test(text)) return "GBP";
  if (/\bJPY\b|\byen\b/i.test(text)) return "JPY";
  if (/\$|\bUSD\b/.test(text)) return "USD";
  return null;
}

export function formatCurrency(amount: number | null | undefined, currency: SupportedCurrency = DEFAULT_CURRENCY): string {
  if (amount === null || amount === undefined || !isNum(amount)) return "N/A";
  // Unknown currency: show the code instead of the wrong symbol.
  if (!isSupportedCurrency(currency)) return `${amount.toFixed(2)} ${String(currency)}`;
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency], {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !isNum(value)) return "N/A";
  if (value > 10000) return ">10,000%";
  return `${value.toFixed(digits)}%`;
}

export function getCurrencySymbol(currency: SupportedCurrency = DEFAULT_CURRENCY): string {
  const safe = isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY;
  return (
    new Intl.NumberFormat(CURRENCY_LOCALE[safe], {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? "$"
  );
}

export function getCurrencyLocale(currency: SupportedCurrency = DEFAULT_CURRENCY): string {
  return CURRENCY_LOCALE[isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY];
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

// Illustrative installment-loan figures used by the demo UI.
export const DEMO_LOAN = {
  amount: 25000,
  rate: 24.99,
  duration: 36,
};

export const DEMO_TEXT = `PERSONAL INSTALLMENT LOAN AGREEMENT

Principal Amount: $${DEMO_LOAN.amount.toLocaleString("en-US")}
Annual Percentage Rate (APR): ${DEMO_LOAN.rate}% fixed
Loan Term: ${DEMO_LOAN.duration} months
Payments: ${DEMO_LOAN.duration} monthly installments
Origination Fee: $500, deducted from the loan proceeds
Late Payment Fee: $25 if a payment is more than 10 days late

The borrower may prepay the loan at any time without a prepayment penalty.`;
