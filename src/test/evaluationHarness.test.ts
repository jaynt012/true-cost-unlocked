import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rules from "@/data/analysisRules.json";
import { analyzeLocally } from "@/lib/analyzeLocally";

type Field = "principal" | "rate" | "term" | "payment" | "docType" | "band";
interface EvaluationCase { name: string; text: string; expected: Partial<Record<Field, number | string | null>> }
interface Measurement { checked: number; correct: number; confidentlyWrong: number }
const FIELDS: Field[] = ["principal", "rate", "term", "payment", "docType", "band"];
const config = (rules as unknown as { evaluation: { confidentWrongThreshold: number; tolerances: Record<string, number> } }).evaluation;
const devCases = JSON.parse(readFileSync(join(process.cwd(), "tests/dev/regression.json"), "utf8")) as EvaluationCase[];

function loadHeldoutCases(): EvaluationCase[] {
  const directory = join(process.cwd(), "tests/heldout");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((filename) => filename.toLowerCase().endsWith(".json"))
    .flatMap((filename) => {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, filename), "utf8"));
      return Array.isArray(parsed) ? parsed as EvaluationCase[] : [parsed as EvaluationCase];
    });
}

function fieldValue(field: Field, context: ReturnType<typeof analyzeLocally>): number | string | null {
  if (field === "principal") return context.principalField.value;
  if (field === "rate") return context.rateField.value;
  if (field === "term") return context.termField.value;
  if (field === "payment") return context.statedEMI.value ?? context.installmentSchedule?.amount ?? null;
  if (field === "docType") return context.docType.type;
  return context.riskBand;
}

function fieldConfidence(field: Field, context: ReturnType<typeof analyzeLocally>): number {
  if (field === "principal") return context.principalField.confidence;
  if (field === "rate") return context.rateField.confidence;
  if (field === "term") return context.termField.confidence;
  if (field === "payment") return context.statedEMI.value !== null ? context.statedEMI.confidence : context.installmentSchedule ? 0.85 : 0;
  return context.docType.confidence;
}

function isMatch(field: Field, actual: number | string | null, expected: number | string | null): boolean {
  if (expected === null) return actual === null;
  if (typeof expected === "number") {
    return typeof actual === "number" && Math.abs(actual - expected) <= Math.max(config.tolerances[field] ?? 0, Math.abs(expected) * (config.tolerances[field] ?? 0));
  }
  return actual === expected;
}

function measure(cases: EvaluationCase[]) {
  const metrics = Object.fromEntries(FIELDS.map((field) => [field, { checked: 0, correct: 0, confidentlyWrong: 0 }])) as Record<Field, Measurement>;
  const mismatches: string[] = [];
  for (const sample of cases) {
    const result = analyzeLocally(sample.text);
    for (const field of FIELDS) {
      if (!(field in sample.expected)) continue;
      const actual = fieldValue(field, result);
      const expected = sample.expected[field] ?? null;
      const item = metrics[field];
      item.checked += 1;
      if (isMatch(field, actual, expected)) item.correct += 1;
      else {
        mismatches.push(`${sample.name} · ${field}: expected ${String(expected)}, got ${String(actual)} (${Math.round(fieldConfidence(field, result) * 100)}% confidence)`);
        if (fieldConfidence(field, result) >= config.confidentWrongThreshold) item.confidentlyWrong += 1;
      }
    }
  }
  return { metrics, mismatches, confidentlyWrong: Object.values(metrics).reduce((sum, item) => sum + item.confidentlyWrong, 0) };
}

function report(title: string, cases: EvaluationCase[]) {
  const result = measure(cases);
  console.log(`\n${title} evaluation (${cases.length} documents)`);
  for (const field of FIELDS) {
    const metric = result.metrics[field];
    if (!metric.checked) continue;
    const accuracy = metric.checked ? Math.round(metric.correct / metric.checked * 100) : 100;
    console.log(`${field.padEnd(8)} ${metric.correct}/${metric.checked} (${accuracy}%) · confidently wrong ${metric.confidentlyWrong}`);
  }
  console.log(`Confidently wrong total: ${result.confidentlyWrong}`);
  result.mismatches.forEach((message) => console.log(`  ${message}`));
  return result;
}

describe("Round 7 evaluation harness", () => {
  it("prints per-field dev and held-out accuracy and fails on dev regression or confidently-wrong fields", () => {
    const dev = report("DEV", devCases);
    const heldout = report("HELD-OUT", loadHeldoutCases());
    expect(dev.mismatches, "Dev regression detected").toEqual([]);
    expect(dev.confidentlyWrong + heldout.confidentlyWrong, "A confidently-wrong field was emitted").toBe(0);
  });

  it("keeps the calibrated ordering clean < card < unilateral loan < MCA < scam", () => {
    const calibration = [
      { name: "clean", text: "PERSONAL LOAN AGREEMENT\nPrincipal: $10,000.\nAPR: 8%.\nTerm: 36 months.\nNo fees." },
      { name: "card", text: "CREDIT CARD AGREEMENT\nRevolving credit. APR: 19.9% per year." },
      { name: "unilateral loan", text: "PERSONAL LOAN AGREEMENT\nPrincipal: $10,000.\nAPR: 9%.\nTerm: 36 months.\nThe lender may, in its sole discretion, increase the APR." },
      { name: "MCA", text: "MERCHANT CASH ADVANCE AGREEMENT\nAdvance amount: $24,000.\nPurchased amount: $30,000.\nDaily remittance: $250 from receivables." },
      { name: "scam", text: "100% guaranteed approval. Pay a $350 processing deposit by gift card to release the loan." },
    ].map((sample) => ({ ...sample, analysis: analyzeLocally(sample.text) }));
    console.log("\nCalibration scores: " + calibration.map((sample) => `${sample.name}=${sample.analysis.riskScore}`).join(" < "));
    for (let index = 1; index < calibration.length; index++) expect(calibration[index].analysis.riskScore).toBeGreaterThan(calibration[index - 1].analysis.riskScore);
    const highRiskStack = analyzeLocally("A confession of judgment is required. The borrower also provides a personal guaranty.");
    expect(highRiskStack.riskScore).toBeGreaterThanOrEqual(80);
    expect(highRiskStack.riskScore).toBeLessThanOrEqual(100);
  });
});

