import rules from "@/data/analysisRules.json";
import extractionRules from "@/data/extractionRules.json";
import { extractAmountCandidates, extractRateCandidates, numericClauseAt, parseMonetaryValues, segmentClauses } from "./analysisEngine";

export type NumericRole = "money" | "count" | "time" | "rate" | "margin" | "penalty" | "promotional" | "feePercent" | "fee";
export type NumericRoleScores = Partial<Record<NumericRole, number>>;

export interface NumericCandidate {
  value: number;
  roleScores: NumericRoleScores;
  span: [number, number];
  clauseSpan: [number, number];
  raw: string;
  source: string;
}

interface NumericCandidateConfig {
  contextCharacters: number;
  moneyLabels: string[];
  feeLabels: string[];
  penaltyLabels: string[];
  countUnits: string;
  timeUnits: string;
  rateLabelPattern: string;
  marginPattern: string;
  roleWeights: Record<NumericRole, number>;
}

const config = (rules as unknown as { numericCandidateRoles: NumericCandidateConfig }).numericCandidateRoles;
const currency = String.raw`(?:US\$|C\$|A\$|S\$|\$|₹|€|£|¥|\b(?:USD|INR|EUR|GBP|JPY|CAD|AUD|SGD|AED|Rs\.?)\b)`;

function containsLabel(context: string, labels: string[]): boolean {
  return labels.some((label) => {
    const escaped = label.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    return new RegExp(`\\b${escaped}\\b`, "i").test(context);
  });
}

/** Extract every numeric token once per clause and retain its competing semantic roles. */
export function extractNumericCandidates(text: string): NumericCandidate[] {
  const clauses = segmentClauses(text);
  const amounts = extractAmountCandidates(text);
  const monetary = parseMonetaryValues(text);
  const rates = extractRateCandidates(text);
  const candidates: NumericCandidate[] = [];
  const seen = new Map<string, NumericCandidate>();
  const numbers = /(?<![\p{L}\p{N}])(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?(?![\p{L}\p{N}])/gu;

  for (const match of text.matchAll(numbers)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    const clause = clauses.find((item) => item.start <= start && start < item.end);
    if (!clause) continue;
    const numericClause = numericClauseAt(text, start);
    const before = text.slice(Math.max(numericClause.start, start - config.contextCharacters), start);
    const after = text.slice(end, Math.min(clause.end, end + config.contextCharacters));
    const context = `${before} ${match[0]} ${after}`;
    const monetaryMatch = monetary.find((item) => item.amount !== null && item.span[0] <= start && item.span[1] >= end);
    const number = monetaryMatch?.amount ?? Number(match[0].replace(/,/g, ""));
    const key = `${clause.start}:${number}`;
    const isPercent = new RegExp(extractionRules.percentSuffixPattern, "i").test(after);
    const hasCurrency = new RegExp(`${currency}\\s*$`, "i").test(before) || new RegExp(`^\\s*${currency}`, "i").test(after);
    const countModifiers = String.raw`(?:(?:monthly|weekly|daily|fortnightly|biweekly|equal|fixed|scheduled)\s+){0,2}`;
    const hasCount = new RegExp(`^\\s*${countModifiers}(?:${config.countUnits})\\b`, "i").test(after);
    const hasTime = new RegExp(`^\\s*(?:${config.timeUnits})\\b`, "i").test(after);
    const margin = isPercent && new RegExp(extractionRules.rateMarginPattern, "i").test(before);
    const rate = rates.find((item) => item.start === start);
    const amount = amounts.find((item) => item.position <= start && monetaryMatch && item.position >= monetaryMatch.span[0]);
    const labeledMoney = monetaryMatch !== undefined;
    const feeLabel = amount ? containsLabel(amount.label, config.feeLabels) : false;
    const localPrefix = before.split(/\d+(?:[,.]\d+)*/).slice(-1)[0];
    const penaltyLabel = containsLabel(localPrefix, config.penaltyLabels);
    const roleScores: NumericRoleScores = {};
    const put = (role: NumericRole, condition: boolean, increment = 0) => {
      if (condition) roleScores[role] = config.roleWeights[role] + increment;
    };
    put("count", hasCount);
    put("time", hasTime);
    put("money", (hasCurrency || labeledMoney) && !isPercent && !hasCount && !hasTime, hasCurrency ? 20 : 0);
    put("rate", rate?.role === "base" && !margin);
    put("margin", margin);
    put("penalty", rate?.role === "penalty" || penaltyLabel && hasCurrency);
    put("promotional", rate?.role === "promotional");
    put("feePercent", rate?.role === "fee_percent" || rate?.role === "tax");
    put("fee", hasCurrency && feeLabel, penaltyLabel ? 10 : 0);
    const duplicate = seen.get(key);
    if (duplicate) {
      for (const [role, score] of Object.entries(roleScores)) duplicate.roleScores[role as NumericRole] = Math.max(duplicate.roleScores[role as NumericRole] ?? 0, score);
    } else {
      const candidate: NumericCandidate = { value: number, roleScores, span: [start, end], clauseSpan: [numericClause.start, numericClause.end], raw: match[0], source: numericClause.text };
      candidates.push(candidate);
      seen.set(key, candidate);
    }
  }
  return candidates;
}

