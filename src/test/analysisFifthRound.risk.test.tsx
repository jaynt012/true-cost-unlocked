import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import rules from "@/data/analysisRules.json";
import { RiskMeter } from "@/components/RiskMeter";
import { AnalysisDashboard, AnalysisFindings, AnalysisNumbers } from "@/components/AnalysisSections";
import { analyzeLocally } from "@/lib/analyzeLocally";
import type { CostFinding } from "@/lib/analysisContext";
import { riskBandForScore, scoreRiskFindings, type RiskBand, type RiskScoringConfig } from "@/lib/riskScoring";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";

afterEach(cleanup);

const settings: RiskScoringConfig = {
  weights: { critical: 0.85, high: 0.55, medium: 0.25, low: 0.08 },
  bands: { low: 0, caution: 15, high: 40, critical: 70 },
  repeatedFindingFactor: 0.6,
};
function finding(index: number, severity = 2, extra: Partial<CostFinding> & { minimumRiskBand?: RiskBand } = {}): CostFinding & { minimumRiskBand?: RiskBand } {
  const source = `Clause ${index}: a documented charge applies.`;
  return {
    id: `test_finding_${index}`, label: `Charge ${index}`, category: "penalty", severity,
    amount: 25, percent: null, basis: null, frequency: null, conditions: [], source,
    position: index * 100, explanation: "A contingent charge.", totalImpact: 25, negated: false,
    polarity: "asserted", evidence: source, clauseSpan: [index * 100, index * 100 + source.length], ...extra,
  };
}

describe("Round 5 noisy-OR risk scoring", () => {
  it("uses the configured severity weights and the noisy-OR combined result", () => {
    expect(scoreRiskFindings([finding(1)], settings).score).toBeCloseTo(25);
    const result = scoreRiskFindings([finding(1), finding(2)], settings);
    expect(result.score).toBeCloseTo(36.25);
    expect(result.band).toBe("caution");
    expect(result.breakdown.map((entry) => entry.weight)).toEqual([0.25, 0.15]);
    expect(result.breakdown[1].combinedScore).toBeCloseTo(36.25);
    expect(result.breakdown[0].evidence).toBe(finding(1).source);
    expect(scoreRiskFindings([finding(1, 1)], settings).score).toBeCloseTo(8);
    expect(scoreRiskFindings([finding(1, 4)], settings).score).toBeCloseTo(55);
    expect(scoreRiskFindings([finding(1, 5)], settings).score).toBeCloseTo(85);
  });

  it("is monotonic and bounded as independent clauses accumulate", () => {
    let prior = 0;
    for (let count = 0; count <= 40; count++) {
      const result = scoreRiskFindings(Array.from({ length: count }, (_, index) => finding(index, index % 5 + 1)), settings);
      expect(result.score).toBeGreaterThanOrEqual(prior);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      prior = result.score;
    }
  });

  it.each([[0, "low"], [14.99, "low"], [15, "caution"], [39.99, "caution"], [40, "high"], [69.99, "high"], [70, "critical"], [100, "critical"]] as const)("maps %s to %s", (score, band) => {
    expect(riskBandForScore(score, settings)).toBe(band);
  });

  it("counts a clause once at its strongest severity and preserves its strongest floor", () => {
    const duplicate = finding(1, 4, { id: "other_catalog_match", label: "Another match" });
    const floor = finding(1, 1, { id: "floor_match", minimumRiskBand: "critical" });
    const result = scoreRiskFindings([finding(1, 2), duplicate, floor], settings);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].weight).toBe(0.55);
    expect(result.combinedScore).toBeCloseTo(55);
    expect(result.score).toBe(70);
    expect(result.band).toBe("critical");
    expect(result.floor).toBe("critical");
    expect(result.breakdown[0].reasons).toContain("Minimum risk band: critical.");
  });

  it("does not score protections, zero charges, negated clauses, or hypothetical examples", () => {
    const result = scoreRiskFindings([
      finding(0, 0), finding(1, 5, { category: "protection" }), finding(2, 5, { negated: true }),
      finding(3, 5, { polarity: "negated" }), finding(4, 5, { polarity: "waived/zero" }),
      finding(5, 5, { polarity: "hypothetical" }),
    ], settings);
    expect(result).toMatchObject({ score: 0, band: "low", combinedScore: 0, breakdown: [], floor: null });
    expect(analyzeLocally(CLEAN_LOAN).riskScore).toBe(0);
  });

  it("reads scoring settings from the catalog by default", () => {
    const configured = rules as unknown as { riskScoring: RiskScoringConfig };
    expect(configured.riskScoring).toMatchObject(settings);
    expect(scoreRiskFindings([finding(1, 5)]).score).toBeCloseTo(85);
  });

  it("preserves catalog floors when a clause has merged matching entry IDs", () => {
    const merged = { ...finding(1, 1), mergedRuleIds: ["advance_fee_demand"] };
    const result = scoreRiskFindings([merged], settings);
    expect(result.score).toBe(70);
    expect(result.band).toBe("critical");
    expect(result.breakdown).toHaveLength(1);
  });
});

describe("Round 5 risk and positive-term display", () => {
  it("preserves the detected risk band during partial analysis without a greater-than prefix", () => {
    const mounted = render(createElement(RiskMeter, { score: 55, band: "high", incomplete: true }));
    expect(mounted.container.textContent).toContain("HIGH RISK (partial analysis)");
    expect(mounted.container.textContent).toContain("55/100");
    expect(mounted.container.textContent).not.toMatch(/≥|INCOMPLETE ANALYSIS/);
  });

  it("shows each scoring weight and its combined result", () => {
    const context = analyzeLocally(CLEAN_LOAN + "\nProcessing fee: $175.\nLate payment fee: $25.");
    const mounted = render(createElement(AnalysisDashboard, { context }));
    expect(mounted.container.textContent).toContain("25% weight");
    expect(mounted.container.textContent).toContain("Combined result:");
    expect(mounted.container.textContent).toContain("Final score:");
    expect(mounted.container.textContent).not.toContain("Processing fee: $175.");
  });

  it("shows the shared protection explanation once with compact, inspectable evidence", () => {
    const context = analyzeLocally(CLEAN_LOAN);
    const mounted = render(createElement(AnalysisFindings, { context }));
    const explanation = (rules as unknown as { findingsUI: { protectionExplanation: string } }).findingsUI.protectionExplanation;
    expect(mounted.container.textContent?.split(explanation)).toHaveLength(2);
    expect(mounted.container.querySelectorAll("li details")).toHaveLength(context.protections.length);
    for (const details of mounted.container.querySelectorAll("li details")) expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("shows conflicting principal and charge values with original evidence", () => {
    const baseline = analyzeLocally(CLEAN_LOAN);
    const source = "Processing fee ... $ 2 5 0.";
    const context = {
      ...baseline,
      principalField: { ...baseline.principalField, confidence: 0.35, needsReview: true },
      plausibilityConflicts: [{ field: "principal" as const, principal: 100, conflictingValue: 250, label: "Processing fee", source, kind: "fee" as const }],
    };
    const mounted = render(createElement(AnalysisNumbers, { context }));
    const alert = mounted.getByRole("alert");
    expect(alert.textContent).toContain("Principal confidence: 35%");
    expect(alert.textContent).toContain("Principal: $100.00");
    expect(alert.textContent).toContain("Processing fee: $250.00");
    expect(alert.textContent).toContain(source);
  });
});
