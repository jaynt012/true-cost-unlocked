import rules from "@/data/analysisRules.json";
import { calculateEMI, calculateFlatLoan } from "./financial";
import type { ExtractedCandidate, ExtractedField } from "./analysisContext";
import type { ParsedRateCandidate } from "./analysisEngine";
import type { PeriodCandidate } from "./periodRoles";

interface ConstraintConfig { paymentTolerance: number; maxCandidatesPerField: number }
const config = (rules as unknown as { constraintResolution: ConstraintConfig }).constraintResolution;

export interface ConstraintAssignment {
  principal: ExtractedCandidate | null;
  rate: ParsedRateCandidate | null;
  term: PeriodCandidate | null;
  expectedPayment: number | null;
  statedPayment: number | null;
  paymentDifferencePercent: number | null;
  matchedPayment: boolean | null;
  explanation: string | null;
}

/** Jointly rank labeled field candidates, awarding arithmetic consistency enough to resolve competing amounts. */
export function resolveConstrainedAssignment(input: {
  principals: ExtractedCandidate[];
  rates: ParsedRateCandidate[];
  periods: PeriodCandidate[];
  payments: ExtractedField<number>;
}): ConstraintAssignment {
  const principals = input.principals.filter((candidate) => candidate.score > 0).slice(0, config.maxCandidatesPerField);
  const rates = input.rates.filter((candidate) => candidate.role === "base" && candidate.value >= 0).slice(0, config.maxCandidatesPerField);
  const periods = input.periods.filter((candidate) => candidate.role === "term").slice(0, config.maxCandidatesPerField);
  const payment = input.payments.value;
  let best: { principal: ExtractedCandidate; rate: ParsedRateCandidate; term: PeriodCandidate; score: number; expected: number; difference: number } | null = null;

  for (const principal of principals) for (const rate of rates) for (const term of periods) {
    const paymentResult = rate.basis === "flat"
      ? calculateFlatLoan(principal.value, rate.value, term.months)
      : calculateEMI(principal.value, rate.value, term.months);
    if (!paymentResult) continue;
    const expected = paymentResult.emi;
    const difference = payment === null ? 0 : Math.abs(expected - payment) / Math.max(payment, 0.01);
    const arithmeticallyConsistent = payment !== null && difference <= config.paymentTolerance;
    const score = principal.score + (rate.role === "base" ? 75 : 30) + term.confidence * 20
      + (arithmeticallyConsistent ? 500 : payment === null ? 0 : -300 - difference * 500);
    if (!best || score > best.score) best = { principal, rate, term, score, expected, difference };
  }

  if (!best) return { principal: null, rate: null, term: null, expectedPayment: null, statedPayment: payment,
    paymentDifferencePercent: null, matchedPayment: null, explanation: null };
  const matchedPayment = payment === null ? null : best.difference <= config.paymentTolerance;
  return {
    principal: best.principal, rate: best.rate, term: best.term, expectedPayment: best.expected,
    statedPayment: payment, paymentDifferencePercent: payment === null ? null : best.difference * 100,
    matchedPayment,
    explanation: matchedPayment === false
      ? `Stated payment ${payment!.toFixed(2)} differs from calculated payment ${best.expected.toFixed(2)} by ${(best.difference * 100).toFixed(1)}%.`
      : best.principal.relatedItems?.length
        ? `Payment consistency supports ${best.principal.label}; the amount includes ${best.principal.relatedItems.join(", ")}.`
        : null,
  };
}

