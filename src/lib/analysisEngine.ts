import rules from "@/data/analysisRules.json";
import { calculateEMI, normalizeDuration, parseAmount, parseTimeUnit, toAnnualRate, type ParsedDuration, type TimeUnit } from "./financial";
import type { AnalysisFinding, AmountRelationship, CostFinding, DetectedClaim, DocumentType, ExtractedCandidate, ExtractedField, FindingPolarity, LineItemGroup, RiskBand, RiskBreakdownItem } from "./analysisContext";
import { scoreRiskFindings } from "./riskScoring";

type LabelRule = { id: string; pattern: string; score: number; kind: "principal" | "price" | "exclude"; position?: "before" | "after" };
type DocumentRule = { id: DocumentType; label: string; signals: Array<{ pattern: string; weight: number }> };
type FeeRule = { id: string; label: string; patterns: string[]; category: string; severity: number; explanation: string; suppressWhen?: string[]; polarityOverride?: FindingPolarity; fallbackOnly?: boolean; defaultBasis?: string; quantified?: boolean; minimumRiskBand?: RiskBand };
type Clause = { text: string; start: number; end: number };
export type RateRole = "base" | "promotional" | "penalty" | "tax" | "fee_percent" | "discount";
export interface ParsedRateCandidate {
  value: number;
  statedValue: number;
  period: TimeUnit;
  basis: "flat" | "reducing" | "unspecified";
  type: "fixed" | "variable" | "introductory" | "unspecified";
  role: RateRole;
  start: number;
  end: number;
  source: string;
  assumption: string | null;
}
export interface ParsedMonetaryValue {
  amount: number | null;
  percent: number | null;
  basis: string | null;
  frequency: string | null;
  qualifier: string | null;
  currency: string | null;
  span: [number, number];
  tax?: { percent: number; basis: string };
}
const config = rules as {
  polarity: { negators: string[]; zeroPatterns: string[]; scopeBreaks: string[]; nonNegatingPatterns: string[]; conditionalPatterns: string[]; hypotheticalPatterns: string[]; conditionPattern: string; laterAmountPattern: string };
  scenarioPeriods: { gracePattern: string; daysPerUnit: Record<string, number> };
  protectionCatalog: Array<{ id: string; label: string; pattern: string; explanation: string; acceptedPolarities: string[]; disallowedPatterns?: string[] }>;
  rateAttributes: { types: Array<{ type: ParsedRateCandidate["type"]; pattern: string; acceptedPolarities?: string[] }>; flatPattern: string; reducingPattern: string; aprPattern: string; flatPricingProducts: string[] };
  segmentation: { abbreviations: string[]; headingPatterns?: string[] };
  monetaryBases: Array<{ id: string; pattern: string }>;
  rateRoleRules?: Array<{ role: RateRole; pattern: string }>;
  quantityRelationships?: {
    percentOfPattern: string;
    references: Array<{ id: string; pattern: string; candidatePattern: string }>;
  };
  listCategories: Array<{ id: string; labelPattern: string; category: string }>;
  unquantifiedTerms: Array<{ id: string; label: string; pattern: string; category: string; severity: number }>;
  principalLabels: LabelRule[];
  documentTypes: DocumentRule[];
  feeCatalog: Array<FeeRule & { riskReason?: string }>;
  claimCatalog: Array<{ id: string; label: string; pattern: string; predicates?: string[] }>;
  riskRules: Array<{ id: string; category: string; weight: number; pattern: string; severity: number; threshold?: number; polarityOverride?: FindingPolarity }>;
  analysisConfidenceThreshold: number;
  glossary: Array<{ id: string; term: string; pattern: string; definition: string }>;
};

const CURRENCY_TOKEN = String.raw`US\$|C\$|A\$|S\$|\$|₹|€|£|¥|\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b|\bCAD\b|\bAUD\b|\bSGD\b|\bAED\b|\bRs\.?`;
const NUMBER_TOKEN = String.raw`(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?`;
const MONEY_TOKEN = String.raw`(?<currency>${CURRENCY_TOKEN})?\s*(?<amount>${NUMBER_TOKEN})(?:\s*(?<unit>thousand|million|billion|lakh|lac|crore|k)\b)?(?!\s*%)`;
const MULTIPLIERS: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, billion: 1e9, lakh: 1e5, lac: 1e5, crore: 1e7 };

const CURRENCY_CODES: Record<string, string> = { "₹": "INR", INR: "INR", "Rs": "INR", "Rs.": "INR", "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", "¥": "JPY", JPY: "JPY", "C$": "CAD", CAD: "CAD", "A$": "AUD", AUD: "AUD", "S$": "SGD", SGD: "SGD", AED: "AED", USD: "USD", "US$": "USD", "$": "USD" };

function isCompleteMoneyMatch(text: string, match: RegExpMatchArray): boolean {
  if (match.index === undefined || !match.groups?.amount) return false;
  const start = text.indexOf(match.groups.amount, match.index);
  const end = match.index + match[0].length;
  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  if (/\d/.test(before) || /\d/.test(after) || (after === "," && /\d/.test(text[end + 1] ?? ""))
    || (after === "." && /\d/.test(text[end + 1] ?? ""))) return false;
  if (/^\s*%/.test(text.slice(end, end + 4))) return false;
  // A number attached to a count/time noun stays a quantity even if the clause
  // also contains currency elsewhere (for example, "36 monthly installments").
  if (/^[ \t]*(?:(?:monthly|weekly|daily|annual|yearly|equal|scheduled|consecutive|remaining|total)[ \t]+){0,3}(?:years?|yrs?|months?|mos?|weeks?|days?|fortnights?|times?|payments?|installments?|instalments?|emis?)\b/i.test(text.slice(end, end + 60))) return false;
  if (match.groups.currency) return true;
  const clauseStart = Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf(";", start - 1), text.lastIndexOf(".", start - 1), text.lastIndexOf("!", start - 1), text.lastIndexOf("?", start - 1)) + 1;
  const prefix = text.slice(clauseStart, start);
  const hasMoneyLabel = /\b(?:principal|loan(?:\s+amount)?|amount\s+financed|amount\s+borrowed|advance|credit|(?:processing|origination|convenience|late|missed|rescheduling|document|doc|service|transaction|annual|prepayment)?\s*fees?|(?:processing|origination|convenience|late|missed|rescheduling|documentation|document|doc|service|transaction|annual|prepayment)(?:\s+(?:fee|charge))?|charges?|deposit|price|cost|payment\s+amount|monthly\s+payment|monthly\s+emi|emi)\b[^\d%]{0,45}$/i.test(prefix);
  if (!hasMoneyLabel) return false;
  return true;
}

function sentenceBoundary(text: string, index: number): boolean {
  const char = text[index];
  if (!/[.!?;]/.test(char ?? "")) return false;
  if (char === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) return false;
  if (char === ".") {
    if (/^\s*(?:(?:section|article)\s+)?\d+(?:\.\d+)*$/i.test(text.slice(0, index)) && /\s/.test(text[index + 1] ?? "")) return false;
    const prefix = text.slice(Math.max(0, index - 12), index + 1);
    for (const item of config.segmentation.abbreviations) {
      const dotPositions = Array.from(item.matchAll(/\./g)).map((match) => match.index ?? 0);
      for (const dotPosition of dotPositions) {
        const start = index - dotPosition;
        const candidate = text.slice(start, start + item.length);
        const before = text[start - 1] ?? "";
        const after = text[start + item.length] ?? "";
        if (start >= 0 && (!before || /[\s([{,:;]/.test(before)) && candidate.toLowerCase() === item.toLowerCase()
          && (!after || /[\s)\]},:;!?]/.test(after))) return false;
      }
    }
    const abbreviation = config.segmentation.abbreviations.find((item) => prefix.toLowerCase().endsWith(item.toLowerCase()));
    if (abbreviation) {
      const start = index - abbreviation.length + 1;
      const before = text[start - 1] ?? "";
      if (!before || /[\s([{,:;]/.test(before)) return false;
    }
  }
  return true;
}

/** Clause boundaries are shared by parsers, warnings, and evidence so snippets remain intact. */
export function segmentClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  const addLine = (line: string, offset: number) => {
    if (config.segmentation.headingPatterns?.some((pattern) => new RegExp(pattern).test(line.trim()))) return;
    const labelStarts: number[] = [];
    const labels = new RegExp(String.raw`(?:^|[\s,;])([A-Za-z][A-Za-z0-9 /()_-]{1,42}):(?=\s*(?:${CURRENCY_TOKEN}|[$₹€£¥]?\s*\d))`, "g");
    for (const match of line.matchAll(labels)) {
      const labelStart = (match.index ?? 0) + (match[0].length - match[1].length - 1);
      if (labelStart > 0) labelStarts.push(labelStart);
    }
    const sorted = [0, ...labelStarts].sort((a, b) => a - b);
    const chunks = sorted.map((start, index) => ({ start, end: sorted[index + 1] ?? line.length }));
    for (const chunk of chunks) {
      let start = chunk.start;
      for (let i = chunk.start; i < chunk.end; i++) {
        if (sentenceBoundary(line, i)) {
          const value = line.slice(start, i + 1).trim();
          if (value) {
            const leading = line.slice(start, i + 1).search(/\S/);
            clauses.push({ text: value, start: offset + start + Math.max(0, leading), end: offset + i + 1 });
          }
          start = i + 1;
        }
      }
      const value = line.slice(start, chunk.end).trim();
      if (value) {
        const leading = line.slice(start, chunk.end).search(/\S/);
        clauses.push({ text: value, start: offset + start + Math.max(0, leading), end: offset + chunk.end });
      }
    }
  };
  const lines = /[^\r\n•]+/g;
  for (const match of text.matchAll(lines)) if (match.index !== undefined) addLine(match[0], match.index);
  return clauses;
}

export function parseMonetaryValues(text: string, baseOffset = 0): ParsedMonetaryValue[] {
  const values: ParsedMonetaryValue[] = [];
  const percentRegex = /(?<percent>\d+(?:\.\d+)?)\s*%/g;
  const percentMatches = Array.from(text.matchAll(percentRegex));
  const moneyRegex = new RegExp(MONEY_TOKEN, "gi");
  const moneyMatches = Array.from(text.matchAll(moneyRegex)).filter((match) => isCompleteMoneyMatch(text, match));
  const frequency = /per\s+(?:installment|instalment|payment)/i.test(text) ? "per_installment"
    : /per\s+month|monthly/i.test(text) ? "monthly"
      : /per\s+year|annual|yearly/i.test(text) ? "annual"
        : /per\s+week|weekly/i.test(text) ? "weekly" : /per\s+day|daily/i.test(text) ? "daily" : null;
  const qualifier = /\b(up to|at least|at most|minimum|maximum|max(?:imum)?|min(?:imum)?|one[- ]time)\b/i.exec(text)?.[1]?.toLowerCase() ?? null;
  const basis = config.monetaryBases.find(({ pattern }) => new RegExp(pattern, "i").test(text))?.id ?? null;
  for (const match of moneyMatches) {
    const g = match.groups!;
    const amount = parseAmount(g.amount);
    if (amount === null) continue;
    const unit = g.unit?.toLowerCase();
    const parsed = amount * (unit ? MULTIPLIERS[unit] ?? 1 : 1);
    const token = g.currency?.trim() ?? "";
    const composite = /^\s*\+\s*(\d+(?:\.\d+)?)\s*%\s*(?:gst|vat|hst|pst|tax|sales\s+tax)\b/i.exec(text.slice(match.index! + match[0].length));
    values.push({
      amount: parsed,
      percent: null,
      basis: composite ? "fee" : basis,
      frequency,
      qualifier,
      currency: token ? CURRENCY_CODES[token] ?? Object.entries(CURRENCY_CODES).find(([key]) => key.toLowerCase() === token.toLowerCase())?.[1] ?? null : null,
      span: [baseOffset + match.index!, baseOffset + match.index! + match[0].length],
      tax: composite ? { percent: Number(composite[1]), basis: "fee" } : undefined,
    });
  }
  for (const match of percentMatches) {
    if (match.index === undefined) continue;
    values.push({ amount: null, percent: Number(match.groups?.percent), basis, frequency, qualifier, currency: null, span: [baseOffset + match.index, baseOffset + match.index + match[0].length] });
  }
  return values.sort((a, b) => a.span[0] - b.span[0]);
}

/** Extract rates by semantic role; only base and promotional rates can price the standard schedule. */
export function extractRateType(text: string): ParsedRateCandidate["type"] {
  for (const clause of segmentClauses(text)) {
    for (const item of config.rateAttributes.types) {
      const match = new RegExp(item.pattern, "i").exec(clause.text);
      if (match && (item.acceptedPolarities ?? ["asserted", "conditional"]).includes(classifyPolarity(clause.text, match.index, match.index + match[0].length))) return item.type;
    }
  }
  return "unspecified";
}

export function extractRateCandidates(text: string): ParsedRateCandidate[] {
  const clauses = segmentClauses(text);
  const matches = Array.from(text.matchAll(/(?<value>\d+(?:\.\d+)?)\s*%(?!\s*(?:gst|vat|hst|pst|tax)\b)/gi));
  const candidates: ParsedRateCandidate[] = [];
  const roleRules = config.rateRoleRules ?? [];
  for (const match of matches) {
    if (match.index === undefined || !match.groups?.value) continue;
    const start = match.index;
    const end = start + match[0].length;
    const clauseIndex = clauses.findIndex((clause) => clause.start <= start && start < clause.end);
    const clause = clauses[clauseIndex] ?? { text: text.slice(start), start, end: text.length };
    // Only denial preceding the numeric rate suppresses it; a promise that the
    // rate will not change after the number does not deny the stated rate.
    const ratePolarity = classifyPolarity(clause.text.slice(0, end - clause.start), start - clause.start, end - clause.start);
    if (ratePolarity === "negated" || ratePolarity === "hypothetical") continue;
    const neighboring = [clauses[clauseIndex - 1], clause, clauses[clauseIndex + 1]]
      .filter((item): item is Clause => Boolean(item) && (item!.start === clause.start || Math.abs(item!.start - clause.start) <= 2 || Math.abs(item!.end - clause.end) <= 2));
    const context = neighboring.map((item) => item.text).join(" ");
    const roleRule = roleRules.find((rule) => new RegExp(rule.pattern, "i").test(context));
    if (!roleRule) continue;

    const statedValue = Number(match.groups.value);
    if (!Number.isFinite(statedValue) || statedValue < 0) continue;
    const after = text.slice(end, Math.min(text.length, end + 45));
    const before = text.slice(Math.max(0, start - 45), start);
    const isAPR = new RegExp(config.rateAttributes.aprPattern, "i").test(clause.text);
    const periodMatch = isAPR ? null : /(?:per|each|\/)\s*(day|week|fortnight|month|year)s?\b|\b(daily|weekly|fortnightly|monthly|annually|yearly)\b|\bp\.?a\.?\b/i.exec(after)
      ?? /\b(daily|weekly|fortnightly|monthly|annually|yearly)\s+(?:rate|interest)\b/i.exec(before);
    const periodLabel = periodMatch?.[1] ?? periodMatch?.[2] ?? "year";
    const period = parseTimeUnit(periodLabel) ?? "year";
    const attributes = config.rateAttributes;
    const basis: ParsedRateCandidate["basis"] = new RegExp(attributes.flatPattern, "i").test(context)
      ? "flat"
      : isAPR || new RegExp(attributes.reducingPattern, "i").test(context)
        ? "reducing" : "unspecified";
    const type = extractRateType(context);
    const annualRate = toAnnualRate(statedValue, period);
    if (annualRate === null) continue;
    const assumption = period !== "year" && basis === "unspecified"
      ? `The ${period}-period rate is annualized nominally; flat versus reducing basis is not stated.`
      : basis === "unspecified"
        ? "Rate basis is not stated; reducing-balance calculation is assumed where a loan calculator requires a basis."
        : null;
    candidates.push({
      value: annualRate,
      statedValue,
      period,
      basis,
      type,
      role: roleRule.role,
      start,
      end,
      source: clause.text,
      assumption,
    });
  }
  return candidates;
}

export function resolveDerivedAmountCandidates(text: string, candidates: ExtractedCandidate[]): {
  candidates: ExtractedCandidate[];
  relationships: AmountRelationship[];
} {
  const relationConfig = config.quantityRelationships;
  if (!relationConfig) return { candidates, relationships: [] };
  const removed = new Set<number>();
  const relationships: AmountRelationship[] = [];
  const labelRules = relationConfig.references;
  for (const clause of segmentClauses(text)) {
    const relationPattern = new RegExp(relationConfig.percentOfPattern, "gi");
    for (const relation of clause.text.matchAll(relationPattern)) {
      if (relation.index === undefined || !relation.groups?.percent || !relation.groups?.baseLabel) continue;
      const percent = Number(relation.groups.percent);
      const baseLabel = relation.groups.baseLabel;
      const referenceRule = labelRules.find((rule) => new RegExp(rule.pattern, "i").test(baseLabel));
      if (!referenceRule) continue;
      const derivedText = relation.groups.derived;
      const derivedTextOffset = relation[0].indexOf(derivedText);
      if (derivedTextOffset < 0) continue;
      const derivedToken = parseMonetaryValues(derivedText, clause.start + relation.index + derivedTextOffset)
        .find((value) => value.amount !== null);
      if (!derivedToken || derivedToken.amount === null) continue;
      const derivedCandidate = candidates.find((candidate) => candidate.position >= derivedToken.span[0] && candidate.position < derivedToken.span[1]);
      if (derivedCandidate) removed.add(derivedCandidate.position);
      const baseCandidate = candidates.filter((candidate) => candidate.position < clause.start || candidate.position >= clause.end)
        .filter((candidate) => new RegExp(referenceRule.candidatePattern, "i").test(candidate.label))
        .sort((a, b) => Math.abs(clause.start - a.position) - Math.abs(clause.start - b.position))[0];
      const expectedAmount = baseCandidate ? baseCandidate.value * percent / 100 : null;
      const confirmed = expectedAmount !== null && Math.abs(expectedAmount - derivedToken.amount) <= Math.max(1, expectedAmount * 0.005);
      relationships.push({
        type: "percent_of",
        source: clause.text,
        derivedAmount: derivedToken.amount,
        baseLabel,
        expectedAmount,
        confirmed,
      });
    }
  }
  return { candidates: candidates.filter((candidate) => !removed.has(candidate.position)), relationships };
}

function clauseAt(text: string, position: number): Clause {
  return segmentClauses(text).find((clause) => clause.start <= position && position < clause.end)
    ?? { text: text.slice(position), start: position, end: text.length };
}

function snippet(text: string, start: number, end: number): string {
  return clauseAt(text, start).text || text.slice(Math.max(0, start), Math.min(text.length, end)).trim();
}

function matches(pattern: string, text: string): RegExpMatchArray[] {
  const regex = new RegExp(pattern, "gi");
  return Array.from(text.matchAll(regex));
}

function labelForCandidate(text: string, position: number, end: number): { rule: LabelRule | null; label: string; score: number } {
  const clause = clauseAt(text, position);
  const region = text.slice(clause.start, position);
  const found: Array<{ rule: LabelRule; at: number; label: string }> = [];
  for (const rule of config.principalLabels) {
    if (rule.position === "after") continue;
    const regex = new RegExp(rule.pattern, "gi");
    for (const match of region.matchAll(regex)) {
      found.push({ rule, at: match.index ?? 0, label: match[0] });
    }
  }
  found.sort((a, b) => b.at - a.at || b.rule.score - a.rule.score);
  const nearest = found[0] ?? config.principalLabels.filter((rule) => rule.position === "after")
    .map((rule) => ({ rule, at: 0, label: new RegExp(rule.pattern, "i").exec(text.slice(end, clause.end))?.[0]?.trim() ?? "" }))
    .filter((item) => item.label).sort((a, b) => b.rule.score - a.rule.score)[0];
  return nearest
    ? { rule: nearest.rule, label: nearest.label, score: nearest.rule.score }
    : { rule: null, label: "Unlabeled amount", score: 0 };
}

export function extractAmountCandidates(text: string): ExtractedCandidate[] {
  const regex = new RegExp(MONEY_TOKEN, "gi");
  const candidates: ExtractedCandidate[] = [];
  for (const match of text.matchAll(regex)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;
    if (!isCompleteMoneyMatch(text, match)) continue;
    const value = parseAmount(`${groups.amount}${groups.decimal ? `.${groups.decimal}` : ""}`);
    if (value === null || value <= 0) continue;
    const unit = groups.unit?.toLowerCase();
    const scaledValue = value * (unit ? MULTIPLIERS[unit] ?? 1 : 1);
    const position = match.index;
    const { rule, label, score } = labelForCandidate(text, position, position + match[0].length);
    candidates.push({
      value: scaledValue,
      label,
      source: clauseAt(text, position).text,
      position,
      confidence: score >= 120 ? 0.98 : score >= 60 ? 0.78 : score < 0 ? 0.05 : 0.25,
      score,
    });
  }
  return candidates;
}

export function classifyDocument(text: string): { type: DocumentType; label: string; confidence: number; signals: string[] } {
  const ranked = config.documentTypes.map((rule) => {
    const signals = rule.signals.filter(({ pattern }) => new RegExp(pattern, "i").test(text));
    return { rule, score: signals.reduce((sum, signal) => sum + signal.weight, 0), signals: signals.map((signal) => signal.pattern) };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1]?.score ?? 0;
  if (!best || best.score < 3) return { type: "unknown", label: "Unclassified financial document", confidence: 0.2, signals: [] };
  const confidence = Math.min(0.99, 0.55 + best.score * 0.03 + Math.max(0, best.score - runnerUp) * 0.025);
  return { type: best.rule.id, label: best.rule.label, confidence, signals: best.signals };
}

export function resolvePrincipal(
  candidates: ExtractedCandidate[],
  rate: number | null,
  durationMonths: number | null,
  statedEMI: number | null,
  docType: DocumentType,
): ExtractedField<number> {
  let ranked = candidates.filter((candidate) => candidate.score > 0);
  let emiMatched = false;
  if (statedEMI && rate !== null && durationMonths) {
    ranked = ranked.map((candidate) => {
      const calculated = calculateEMI(candidate.value, rate, durationMonths);
      const matchesEMI = calculated && Math.abs(calculated.emi - statedEMI) / statedEMI <= 0.1;
      if (matchesEMI) emiMatched = true;
      return matchesEMI ? { ...candidate, score: candidate.score + 120, confidence: 0.99 } : candidate;
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.position - b.position);
  const best = ranked[0];
  const next = ranked[1];
  const conflict = Boolean(best && next && Math.abs(best.value - next.value) / Math.max(best.value, next.value) > 0.05 && best.score - next.score <= 25);
  const emiMismatch = Boolean(statedEMI && rate !== null && durationMonths && !emiMatched);
  if (!best || conflict || emiMismatch) {
    return { value: null, source: null, confidence: 0, alternatives: ranked.slice(0, 8), needsReview: Boolean(conflict || emiMismatch) };
  }
  return { value: best.value, source: best.source, confidence: best.confidence, alternatives: ranked.slice(0, 8), needsReview: false };
}

export function extractStatedEMI(text: string, candidates = extractAmountCandidates(text)): ExtractedField<number> {
  const eligible = candidates.filter((candidate) => /\bemi\b|monthly\s+(?:payment|installment|instalment)|payment\s+amount/i.test(candidate.label + " " + candidate.source));
  const best = eligible[0];
  if (best) return { value: best.value, source: best.source, confidence: 0.9, alternatives: eligible, needsReview: false };
  const schedule = text.match(/\b(?:pay\s+in\s+)?\d+\s+(?:(?:interest[- ]free|equal|fixed)\s+)?installments?\s+of\s+(?<currency>US\$|C\$|A\$|S\$|\$|₹|€|£|¥|INR\s*|USD\s*|EUR\s*|GBP\s*|Rs\.?\s*)(?<amount>\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(?<decimal>\d+))?/i);
  if (schedule) {
    const value = parseAmount(`${schedule.groups?.amount}${schedule.groups?.decimal ? `.${schedule.groups.decimal}` : ""}`);
    if (value !== null) {
      const candidate = { value, label: "installment amount", source: schedule[0], position: schedule.index ?? 0, confidence: 0.85, score: 0 };
      return { value, source: schedule[0], confidence: 0.85, alternatives: [candidate], needsReview: false };
    }
  }
  return { value: null, source: null, confidence: 0, alternatives: [], needsReview: false };
}

/** Scope is shared by cost, risk, protection, and warning projections. */
export function classifyPolarity(clause: string, targetStart = 0, targetEnd = clause.length): FindingPolarity {
  const policy = config.polarity;
  if (policy.hypotheticalPatterns.some((pattern) => new RegExp(pattern, "i").test(clause))) return "hypothetical";
  const breaks = Array.from(clause.matchAll(new RegExp(policy.scopeBreaks.join("|"), "gi")));
  const preceding = breaks.filter((match) => match.index! < targetStart);
  const from = preceding[preceding.length - 1];
  const to = breaks.find((match) => match.index! >= targetEnd);
  let scoped = clause.slice(from ? from.index! + from[0].length : 0, to?.index ?? clause.length);
  for (const pattern of policy.nonNegatingPatterns) scoped = scoped.replace(new RegExp(pattern, "gi"), "");
  const negators = Array.from(scoped.matchAll(new RegExp(policy.negators.join("|"), "gi")));
  // Count a coordinated "neither ... nor" or "no ... nor" once.
  const count = negators.filter((match) => !/^nor$/i.test(match[0]) || !negators.some((item) => /^(?:no|neither)$/i.test(item[0]) && item.index! < match.index!)).length;
  if (count > 0 && count % 2 === 0) return "asserted";
  if (policy.zeroPatterns.some((pattern) => new RegExp(pattern, "i").test(scoped))) return "waived/zero";
  if (count % 2 === 1) return "negated";
  return policy.conditionalPatterns.some((pattern) => new RegExp(pattern, "i").test(scoped)) ? "conditional" : "asserted";
}

function isNegated(clause: string): boolean {
  return ["negated", "waived/zero", "hypothetical"].includes(classifyPolarity(clause));
}

export function canonicalFinding(finding: CostFinding): AnalysisFinding {
  return { ...finding, polarity: finding.polarity ?? (finding.negated ? "negated" : "asserted"),
    evidence: finding.evidence ?? finding.source,
    clauseSpan: finding.clauseSpan ?? [finding.position, finding.position + finding.source.length],
    provenance: finding.provenance ?? "stated-in-document" };
}

function withPolarity(finding: CostFinding, polarity: FindingPolarity, clause?: Clause): CostFinding {
  const protection = polarity === "negated" || polarity === "waived/zero";
  return { ...finding, polarity, evidence: clause?.text ?? finding.source, clauseSpan: clause ? [clause.start, clause.end] : [finding.position, finding.position + finding.source.length],
    provenance: finding.provenance ?? "stated-in-document", topicId: finding.id,
    ...(protection ? { id: "no_" + finding.id, label: "No " + finding.label.toLowerCase(), category: "protection", severity: 0,
      amount: 0, totalImpact: 0, negated: true, amountNotStated: false,
      explanation: "The stated exclusion or waiver protects you from this charge or obligation under the listed conditions." } : {}) };
}

function parseFindingAmount(clause: string, afterIndex: number): { amount: number | null; percent: number | null } {
  const localTerms = clause.slice(afterIndex);
  const percent = localTerms.match(/(\d+(?:\.\d+)?)\s*%/) ?? clause.match(/(\d+(?:\.\d+)?)\s*%/);
  const money = localTerms.match(new RegExp(MONEY_TOKEN, "i")) ?? clause.match(new RegExp(MONEY_TOKEN, "i"));
  const amount = money?.groups?.amount
    ? parseAmount(`${money.groups.amount}${money.groups.decimal ? `.${money.groups.decimal}` : ""}`)
    : null;
  const unit = money?.groups?.unit?.toLowerCase();
  return {
    amount: amount === null ? null : amount * (unit ? MULTIPLIERS[unit] ?? 1 : 1),
    percent: percent ? Number(percent[1]) : null,
  };
}

function detectCostsLegacy(text: string, principal: number | null, installmentCount: number | null, termMonths: number | null): CostFinding[] {
  const findings: CostFinding[] = [];
  const seen = new Set<string>();
  for (const item of config.feeCatalog) {
    for (const pattern of item.patterns) {
      const regex = new RegExp(pattern, "gi");
      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const { source, start } = findClause(text, match.index, match.index + match[0].length);
        const key = `${item.id}:${start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const negated = isNegated(source);
        const relativeMatchPosition = Math.max(0, match.index - start + match[0].length);
        const parsed = parseFindingAmount(source, relativeMatchPosition);
        const frequency = /per\s+(?:installment|instalment|payment)/i.test(source)
          ? "per_installment"
          : /\/\s*month|per\s+month|monthly/i.test(source)
            ? "monthly"
            : /annual|yearly|per\s+year/i.test(source)
              ? "annual"
              : "once";
        const basis = parsed.percent !== null
          ? /emi/i.test(source) ? "emi" : /balance/i.test(source) ? "balance" : /principal|amount financed/i.test(source) ? "principal" : null
          : null;
        const conditions = source.match(/\b(?:if|unless|when|provided that|only if|after|upon|following)\s+[^.;]+/gi)?.map((value) => value.trim()) ?? [];
        let totalImpact: number | null = parsed.amount;
        if (totalImpact !== null && frequency === "per_installment" && installmentCount) totalImpact *= installmentCount;
        if (totalImpact !== null && frequency === "monthly" && termMonths) totalImpact *= Math.ceil(termMonths);
        if (totalImpact !== null && frequency === "annual" && termMonths) {
          const annualCharges = Math.ceil(termMonths / 12);
          const waivedFirstYear = /waived\s+for\s+(?:the\s+)?first\s+year/i.test(source);
          totalImpact *= Math.max(0, annualCharges - (waivedFirstYear ? 1 : 0));
        }
        if (parsed.percent !== null && basis === "principal" && principal !== null) totalImpact = principal * parsed.percent / 100;
        if (parsed.percent !== null && basis === "emi") totalImpact = null;
        findings.push({
          id: item.id, label: item.label, category: item.category, severity: item.severity,
          amount: parsed.amount, percent: parsed.percent, basis, frequency, conditions,
          source, position: start, explanation: item.explanation, totalImpact: negated ? 0 : totalImpact, negated,
        });
      }
    }
  }
  return findings;
}

function findClause(text: string, start: number, end: number): { source: string; start: number } {
  const clause = clauseAt(text, start);
  return { source: clause.text, start: clause.start };
}

function findStructuredAmount(text: string, startAt = 0): { amount: number; start: number; end: number; token: string } | null {
  const scanText = text.slice(startAt);
  const matcher = new RegExp(MONEY_TOKEN, "gi");
  const match = Array.from(scanText.matchAll(matcher)).find((candidate) => isCompleteMoneyMatch(scanText, candidate));
  if (!match?.groups?.amount || match.index === undefined) return null;
  const value = parseAmount(match.groups.amount);
  if (value === null) return null;
  const unit = match.groups.unit?.toLowerCase();
  return {
    amount: value * (unit ? MULTIPLIERS[unit] ?? 1 : 1),
    start: startAt + match.index,
    end: startAt + match.index + match[0].length,
    token: match[0],
  };
}

function findStructuredPercent(text: string, startAt = 0): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(text.slice(startAt));
  return match ? Number(match[1]) : null;
}

function findFeeRule(source: string): FeeRule | undefined {
  return config.feeCatalog.find((item) => item.patterns.some((pattern) => new RegExp(pattern, "i").test(source)));
}

function expandConfiguredList(clause: Clause): { findings: CostFinding[]; group: LineItemGroup } | null {
  const labeled = /^\s*(?<label>[^:]{2,70}):(?<body>[\s\S]+)$/.exec(clause.text);
  if (!labeled?.groups) return null;
  const label = labeled.groups.label.trim();
  const listRule = config.listCategories.find((item) => new RegExp(item.labelPattern, "i").test(label));
  if (!listRule) return null;
  const body = labeled.groups.body;
  const bodyOffset = clause.text.indexOf(body);
  const tokens = Array.from(body.matchAll(new RegExp(MONEY_TOKEN, "gi")))
    .filter((match) => isCompleteMoneyMatch(body, match))
    .map((match) => {
      const value = parseAmount(match.groups!.amount);
      const unit = match.groups!.unit?.toLowerCase();
      return value === null ? null : { amount: value * (unit ? MULTIPLIERS[unit] ?? 1 : 1), start: match.index!, end: match.index! + match[0].length, token: match[0] };
    }).filter((token): token is { amount: number; start: number; end: number; token: string } => token !== null);
  if (tokens.length < 2) return null;
  const groupId = listRule.id + "_" + clause.start;
  const items: LineItemGroup["items"] = [];
  const findings: CostFinding[] = [];
  tokens.forEach((token, index) => {
    const from = index === 0 ? 0 : tokens[index - 1].end;
    const rawPrefix = body.slice(from, token.start);
    const name = rawPrefix.replace(/^[\s,;&]+/, "").replace(/\band\b\s*$/i, "").replace(/[,;]\s*$/, "").trim();
    const localStart = Math.max(0, from + Math.max(0, rawPrefix.search(/\S/)));
    const startInClause = bodyOffset + localStart;
    const evidence = clause.text.slice(startInClause, bodyOffset + token.end).replace(/^[\s,;&]+/, "").trim();
    const matchedRule = findFeeRule(name + " " + evidence);
    const category = matchedRule?.category ?? listRule.category;
    const itemLabel = matchedRule?.label ?? (category === "financed_addon" ? "Unclassified item: " + (name || "unnamed") : (name || "Unclassified item"));
    const position = clause.start + startInClause;
    items.push({ label: name || "Unclassified item", amount: token.amount, source: evidence || token.token, position, category });
    findings.push({
      id: matchedRule?.id ?? groupId + "_item_" + (index + 1),
      label: itemLabel,
      category,
      severity: matchedRule?.severity ?? 1,
      amount: token.amount,
      percent: null,
      basis: null,
      frequency: "once",
      conditions: [],
      source: evidence || token.token,
      position,
      explanation: matchedRule?.explanation ?? "This amount appears in a labeled list of financed items.",
      totalImpact: token.amount,
      negated: false,
      amountNotStated: false,
      groupId,
    });
  });
  return {
    findings,
    group: {
      id: groupId,
      label,
      items,
      aggregate: items.reduce((sum, item) => sum + item.amount, 0),
      source: clause.text,
      position: clause.start,
    },
  };
}

/** Configuration-driven clause, fee, tax, offset, and item-list extraction. */
export function detectCostsGeneric(text: string, principal: number | null, installmentCount: number | null, termMonths: number | null, installmentAmount: number | null = null): { findings: CostFinding[]; itemGroups: LineItemGroup[] } {
  const findings: CostFinding[] = [];
  const itemGroups: LineItemGroup[] = [];
  const clauses = segmentClauses(text).map((clause) => ({ ...clause, polarity: classifyPolarity(clause.text) }));
  const expandedStarts = new Set<number>();
  for (const clause of clauses) {
    const expanded = expandConfiguredList(clause);
    if (!expanded) continue;
    findings.push(...expanded.findings.map((finding) => withPolarity(finding, classifyPolarity(finding.source))));
    itemGroups.push(expanded.group);
    expandedStarts.add(clause.start);
  }
  const seen = new Set<string>();
  for (const clause of clauses) {
    if (expandedStarts.has(clause.start)) continue;
    for (const item of config.feeCatalog) {
      if (item.suppressWhen?.some((pattern) => new RegExp(pattern, "i").test(clause.text))) continue;
      if (item.fallbackOnly && config.feeCatalog.some((candidate) => !candidate.fallbackOnly && candidate.patterns.some((pattern) => new RegExp(pattern, "i").test(clause.text)))) continue;
      const match = item.patterns.map((pattern) => new RegExp(pattern, "i").exec(clause.text)).find(Boolean);
      if (!match || match.index === undefined) continue;
      const matchPositions = Array.from(new Set(config.feeCatalog.map((candidate) =>
        candidate.patterns.map((pattern) => new RegExp(pattern, "i").exec(clause.text)?.index)
          .find((position): position is number => position !== undefined))
        .filter((position): position is number => position !== undefined)));
      const hasMultipleFeeLabels = matchPositions.length > 1;
      const previousLabel = matchPositions.filter((position) => position < match.index!).sort((a, b) => b - a)[0];
      const nextLabel = matchPositions.filter((position) => position > match.index!).sort((a, b) => a - b)[0];
      const sourceOffset = hasMultipleFeeLabels && previousLabel !== undefined ? match.index : 0;
      let source = hasMultipleFeeLabels
        ? clause.text.slice(sourceOffset, nextLabel ?? clause.text.length).trim()
        : clause.text;
      if (hasMultipleFeeLabels && nextLabel !== undefined && previousLabel === undefined) {
        source = source.replace(/[,;]?\s*(?:(?:and|plus|as well as)\s+)?(?:a|an|the)?\s*$/i, "").trim();
      }
      const localMatchStart = match.index - sourceOffset;
      const findingPosition = clause.start + sourceOffset;
      const key = item.id + ":" + findingPosition;
      if (seen.has(key)) continue;
      seen.add(key);
      const amount = item.quantified === false ? null : findStructuredAmount(source, localMatchStart + match[0].length) ?? findStructuredAmount(source);
      // Embedded tax percentages price the fee itself, not the loan principal.
      const feeSource = source.replace(/\+\s*\d+(?:\.\d+)?\s*%\s*(?:gst|vat|hst|pst|tax|sales\s+tax)\b/gi, "");
      const pct = item.quantified === false ? null : findStructuredPercent(feeSource, localMatchStart + match[0].length) ?? findStructuredPercent(feeSource);
      const basis = pct === null ? null : config.monetaryBases.find((entry) => new RegExp(entry.pattern, "i").test(source))?.id ?? item.defaultBasis ?? null;
      const computedPercentAmount = pct !== null && basis === "emi" && installmentAmount !== null ? installmentAmount * pct / 100 : null;
      const resolvedAmount = amount?.amount ?? computedPercentAmount;
      const graceMatch = source.match(new RegExp(config.scenarioPeriods.gracePattern, "i"));
      const graceUnit = graceMatch?.groups?.unit?.replace(/s$/, "").toLowerCase();
      const graceDays = graceMatch?.groups?.count && graceUnit
        ? Number(graceMatch.groups.count) * (config.scenarioPeriods.daysPerUnit[graceUnit] ?? 0) || null
        : null;
      const frequency = /per\s+(?:installment|instalment|payment)/i.test(source) ? "per_installment"
        : /\/\s*fortnight|per\s+fortnight|fortnightly|biweekly/i.test(source) ? "fortnightly"
          : /\/\s*month|per\s+month|monthly/i.test(source) ? "monthly"
          : /annual|yearly|per\s+year/i.test(source) ? "annual"
            : /per\s+week|weekly/i.test(source) ? "weekly"
              : /per\s+day|daily/i.test(source) ? "daily" : "once";
      const classified = classifyPolarity(clause.text, match.index, match.index + match[0].length);
      const polarity = classified === "hypothetical" ? classified : item.polarityOverride ?? classified;
      if (polarity === "hypothetical") continue;
      const negated = polarity === "negated" || polarity === "waived/zero";
      const conditions = source.match(new RegExp(config.polarity.conditionPattern, "gi"))?.map((value) => value.trim()) ?? [];
      const composite = /\+\s*(\d+(?:\.\d+)?)\s*%\s*(?:gst|vat|hst|pst|tax|sales\s+tax)\b/i.exec(source);
      const taxPercent = composite ? Number(composite[1]) : null;
      const taxAmount = taxPercent !== null && amount ? amount.amount * taxPercent / 100 : null;
      let totalImpact: number | null = resolvedAmount;
      if (frequency === "per_installment" && totalImpact !== null && installmentCount) totalImpact *= installmentCount;
      if (frequency === "monthly" && totalImpact !== null && termMonths) totalImpact *= Math.ceil(termMonths);
      if (frequency === "annual" && totalImpact !== null && termMonths) {
        totalImpact *= Math.max(0, Math.ceil(termMonths / 12) - (/\bwaived\s+for\s+(?:the\s+)?first\s+year\b/i.test(source) ? 1 : 0));
      }
      if (pct !== null && basis === "principal" && principal !== null) totalImpact = principal * pct / 100;
      if (pct !== null && basis === "emi" && computedPercentAmount !== null) totalImpact = computedPercentAmount;
      if (pct !== null && basis === "outstanding" && principal !== null) {
        const atStart = principal * pct / 100;
        totalImpact = amount ? Math.min(atStart, amount.amount) : atStart;
      }
      if (item.category === "tax" && basis === "interest") totalImpact = null;
      if (item.category === "tax" && amount) totalImpact = amount.amount;
      if (taxAmount !== null && item.category !== "tax" && item.category !== "offset") totalImpact = (totalImpact ?? amount!.amount) + taxAmount;
      if (item.category === "offset" && totalImpact !== null) totalImpact = -Math.abs(totalImpact);
      const finding: CostFinding = {
        id: item.id,
        label: item.label,
        category: item.category,
        severity: item.severity,
        amount: resolvedAmount,
        percent: pct,
        basis,
        frequency,
        qualifier: /\b(up to|at least|at most|minimum|maximum|one[- ]time)\b/i.exec(source)?.[1]?.toLowerCase() ?? null,
        conditions,
        source,
        position: findingPosition,
        explanation: item.explanation,
        totalImpact: negated ? 0 : totalImpact,
        negated,
        amountNotStated: item.quantified !== false && amount === null && pct === null,
        gracePeriodDays: graceDays,
        minimumRiskBand: item.minimumRiskBand,
        taxAmount,
        taxPercent,
        taxBasis: taxPercent === null ? null : "fee",
      };
      findings.push(withPolarity(finding, polarity, clause));
      const laterAmount = amount ? findStructuredAmount(source, amount.end) : null;
      if (negated && amount?.amount === 0 && laterAmount && laterAmount.amount > 0 && new RegExp(config.polarity.laterAmountPattern, "i").test(source)) {
        findings.push(canonicalFinding({ ...finding, amount: laterAmount.amount,
          totalImpact: frequency === "monthly" && termMonths ? laterAmount.amount * Math.ceil(termMonths) : laterAmount.amount,
          negated: false, amountNotStated: false, polarity: "conditional", topicId: item.id,
          position: findingPosition + laterAmount.start, evidence: clause.text,
          clauseSpan: [clause.start, clause.end], conditions: [...conditions, "Applies after the documented waiver or grace period."] }));
      }
    }
    for (const item of config.unquantifiedTerms) {
      const match = new RegExp(item.pattern, "i").exec(clause.text);
      if (!match) continue;
      const polarity = classifyPolarity(clause.text, match.index, match.index + match[0].length);
      if (polarity === "hypothetical") continue;
      const key = item.id + ":" + clause.start;
      if (seen.has(key)) continue;
      const stated = findStructuredAmount(clause.text, match.index + match[0].length) ?? findStructuredAmount(clause.text);
      if (stated) continue;
      seen.add(key);
      findings.push(withPolarity({
        id: item.id,
        label: item.label,
        category: item.category,
        severity: item.severity,
        amount: null,
        percent: null,
        basis: null,
        frequency: "once",
        conditions: [],
        source: clause.text,
        position: clause.start,
        explanation: "The document names this amount but does not state a value.",
        totalImpact: null,
        negated: false,
        amountNotStated: true,
      }, polarity, clause));
    }
  }
  for (const clause of clauses) {
    for (const item of config.protectionCatalog) {
      const match = new RegExp(item.pattern, "i").exec(clause.text);
      if (!match) continue;
      if (item.disallowedPatterns?.some((pattern) => new RegExp(pattern, "i").test(clause.text))) continue;
      const polarity = classifyPolarity(clause.text, match.index, match.index + match[0].length);
      if (!item.acceptedPolarities.includes(polarity)) continue;
      if (findings.some((finding) => finding.category === "protection" && finding.id === item.id)) continue;
      findings.push(canonicalFinding({ id: item.id, topicId: item.id, label: item.label, category: "protection", severity: 0,
        polarity, amount: null, percent: null, basis: null, frequency: null,
        conditions: clause.text.match(new RegExp(config.polarity.conditionPattern, "gi")) ?? [],
        source: clause.text, position: clause.start, explanation: item.explanation, totalImpact: 0, negated: true, amountNotStated: false }));
    }
  }
  return { findings, itemGroups };
}

export function computeTaxImpacts(findings: CostFinding[], totalInterest: number | null, principal: number | null): CostFinding[] {
  return findings.map((finding) => {
    if (finding.category !== "tax" || finding.percent === null) return finding;
    const base = finding.basis === "interest" ? totalInterest
      : finding.basis === "principal" || finding.basis === "outstanding" ? principal : null;
    if (base === null) return finding;
    const amount = base * finding.percent / 100;
    return { ...finding, amount, totalImpact: amount, amountNotStated: false, provenance: "computed" };
  });
}

export function detectClaimsGeneric(text: string, findings: CostFinding[], rate: number | null, netExtraCost: number | null = null): DetectedClaim[] {
  const output: DetectedClaim[] = [];
  const seen = new Set<string>();
  const active = findings.filter((finding) => !finding.negated && finding.category !== "offset");
  for (const claim of config.claimCatalog) {
    const pattern = new RegExp(claim.pattern, "gi");
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const clause = clauseAt(text, match.index);
      const claimPolarity = classifyPolarity(clause.text);
      const prefixPolarity = classifyPolarity(clause.text.slice(0, match.index - clause.start));
      if (claimPolarity === "hypothetical" || prefixPolarity === "negated" || prefixPolarity === "waived/zero") continue;
      const key = claim.id + ":" + clause.start;
      if (seen.has(key)) continue;
      seen.add(key);
      let contradiction: string | null = null;
      let signal: string | null = null;
      for (const predicate of claim.predicates ?? []) {
        if (predicate === "positive_net_cost" && (netExtraCost ?? 0) > 0) {
          contradiction = "Modeled interest, taxes, and fees exceed offsets by " + netExtraCost.toFixed(2) + ".";
        } else if (predicate === "listed_charge" && active.some((finding) => (finding.totalImpact ?? 0) > 0 || finding.amountNotStated)) {
          contradiction = "The document lists a non-waived charge or add-on.";
        } else if (predicate === "positive_rate" && (rate ?? 0) > 0) {
          contradiction = "The document also states a positive interest rate.";
        } else if (predicate === "included_despite_optional" && /\b(?:included|added|financed|rolled\s+into)\b/i.test(clause.text)) {
          const hedged = /\b(?:may|might|could)\s+be\s+(?:included|added|financed)\b/i.test(clause.text);
          contradiction = hedged
            ? "The document says the optional item may be included in the payment."
            : "The document states that the optional item is included in the payment or financed amount.";
        } else if (predicate === "conditional_guarantee" && /\b(?:may|might|subject to|depending on)\b/i.test(clause.text)) {
          contradiction = "The guarantee is qualified by conditional wording in the same clause.";
        } else if (predicate === "hedge_word_present" && /\b(?:may|might|could)\b/i.test(clause.text)) {
          contradiction = null;
        } else if (predicate === "ownership_after_all_payments"
          && findings.some((finding) => finding.id === "ownership_after_final_payment" && !finding.negated)) {
          contradiction = "The terms say ownership transfers only after the final payment.";
        } else if (predicate === "predatory_pricing_signal") {
          signal = "No-credit-check marketing is a predatory-pricing signal; verify total payable, fees, and ownership conditions.";
        }
      }
      output.push({ id: claim.id, label: claim.label, source: clause.text, contradicted: contradiction !== null, contradiction, signal });
    }
  }
  const byClause = new Map<string, DetectedClaim>();
  for (const claim of output) {
    const key = claim.source.replace(/\s+/g, " ").trim().toLowerCase();
    const existing = byClause.get(key);
    if (!existing) {
      byClause.set(key, claim);
      continue;
    }
    const labels = Array.from(new Set((existing.label + " / " + claim.label).split(" / ")));
    const contradictions = Array.from(new Set([existing.contradiction, claim.contradiction].filter((value): value is string => Boolean(value))));
    byClause.set(key, {
      ...existing,
      label: labels.join(" / "),
      contradicted: contradictions.length > 0,
      contradiction: contradictions.length ? contradictions.join(" ") : null,
      signal: [existing.signal, claim.signal].filter((value): value is string => Boolean(value)).join(" ") || null,
    });
  }
  return Array.from(byClause.values());
}

export function detectClaims(text: string, findings: CostFinding[], rate: number | null): DetectedClaim[] {
  return detectClaimsGeneric(text, findings, rate);
}

export function detectCosts(text: string, principal: number | null, installmentCount: number | null, termMonths: number | null): CostFinding[] {
  return detectCostsGeneric(text, principal, installmentCount, termMonths).findings;
}

export function detectGlossary(text: string): Array<{ term: string; definition: string }> {
  const active = detectCostsGeneric(text, null, null, null).findings.filter((finding) => finding.category !== "protection" && !finding.negated);
  return config.glossary
    .filter((item) => active.some((finding) => new RegExp(item.pattern, "i").test(finding.source)))
    .map(({ term, definition }) => ({ term, definition }));
}

/** Merge detector overlap while retaining every distinct monetary fact for review. */
export function mergeClauseFindings(findings: readonly CostFinding[]): AnalysisFinding[] {
  const groups = new Map<string, AnalysisFinding[]>();
  for (const input of findings) {
    const finding = canonicalFinding(input);
    const span = finding.clauseSpan;
    const clauseKey = span[1] > span[0] ? span.join(":") : finding.position + ":" + finding.evidence.trim();
    // A waiver and a later conditional charge can coexist within the same clause.
    const key = clauseKey + ":" + (finding.category === "protection" || finding.negated ? "protection" : "finding");
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const strongest = [...group].sort((a, b) => b.severity - a.severity || Number(a.ruleOnly) - Number(b.ruleOnly))[0];
    const ids = [...new Set(group.flatMap((finding) => [finding.id, finding.topicId, ...(finding.mergedRuleIds ?? []), ...(finding.riskRuleIds ?? [])]).filter((id): id is string => Boolean(id)))];
    const bandThresholds = rules.riskScoring.bands;
    const minimumRiskBand = group.reduce<RiskBand | undefined>((floor, finding) =>
      finding.minimumRiskBand && (!floor || bandThresholds[finding.minimumRiskBand] > bandThresholds[floor]) ? finding.minimumRiskBand : floor, undefined);
    return { ...strongest,
      label: [...new Set(group.map((finding) => finding.label))].join(" / "),
      explanation: [...new Set(group.map((finding) => finding.explanation))].join(" "),
      conditions: [...new Set(group.flatMap((finding) => finding.conditions))],
      riskRuleIds: [...new Set(group.flatMap((finding) => finding.riskRuleIds ?? []))],
      mergedRuleIds: ids, minimumRiskBand,
      components: group.flatMap((finding) => finding.components ?? [finding]),
    };
  });
}

/** Build the evidence list once; scores and panels project the same objects. */
export function collectRuleFindings(text: string, findings: CostFinding[], docType: DocumentType, claims: DetectedClaim[], rateConfirmed = true): AnalysisFinding[] {
  const output = findings.map(canonicalFinding);
  const add = (rule: typeof config.riskRules[number], evidence: string, explanation: string, provenance: AnalysisFinding["provenance"] = "stated-in-document", suffix = "", polarity: FindingPolarity = "asserted") => {
    const existing = output.find((finding) => !finding.negated && finding.evidence === evidence && finding.category !== "protection");
    if (existing) {
      existing.riskRuleIds = Array.from(new Set([...(existing.riskRuleIds ?? []), rule.id]));
      existing.severity = Math.max(existing.severity, rule.severity);
      return;
    }
    const position = Math.max(0, text.indexOf(evidence));
    output.push(canonicalFinding({ id: rule.id + suffix, topicId: rule.id, label: rule.id.replace(/_/g, " "), category: rule.category,
      severity: rule.severity, amount: null, percent: null, basis: null, frequency: null,
      conditions: [], source: evidence, position, explanation, totalImpact: null, negated: false,
      provenance, polarity, riskRuleIds: [rule.id], ruleOnly: true }));
  };
  for (const rule of config.riskRules) {
    if (rule.id === "claim_contradiction") {
      for (const claim of claims.filter((item) => item.contradicted)) add(rule, claim.source, claim.contradiction ?? "The document marketing claim conflicts with the modeled terms.", "computed", "_" + claim.id);
    } else if (rule.id === "high_apr") {
      const candidate = rateConfirmed ? extractRateCandidates(text).find((item) => ["base", "promotional"].includes(item.role) && item.value >= (rule.threshold ?? Infinity)) : null;
      if (candidate) add(rule, candidate.source, "Confirmed " + candidate.role + " rate of " + candidate.value + "% annualized", candidate.period === "year" ? "stated-in-document" : "computed");
    } else if (rule.id === "advance_fee_scam") {
      const demand = output.find((finding) => finding.id === "advance_fee_demand" && !finding.negated);
      if (docType === "advance_fee_scam" && demand) add(rule, demand.evidence, demand.explanation);
    } else if (rule.pattern) {
      for (const match of text.matchAll(new RegExp(rule.pattern, "gi"))) {
        const clause = clauseAt(text, match.index!);
        const classified = classifyPolarity(clause.text, match.index! - clause.start, Math.min(clause.text.length, match.index! - clause.start + match[0].length));
        const polarity = classified === "hypothetical" ? classified : rule.polarityOverride ?? classified;
        if (["negated", "waived/zero", "hypothetical"].includes(polarity)) continue;
        add(rule, clause.text, "A configured contract risk pattern was found in this clause.", "stated-in-document", "", polarity);
        break;
      }
    }
  }
  return mergeClauseFindings(output);
}

export function calculateRisk(text: string, docType: DocumentType, findings: CostFinding[], claims: DetectedClaim[], confidence: number, rateConfirmed = true, incompleteAnalysis = false, rulesMaterialized = false): { score: number; band: RiskBand; breakdown: RiskBreakdownItem[]; analysisIncomplete: boolean } {
  const scored = rulesMaterialized ? findings : collectRuleFindings(text, findings, docType, claims, rateConfirmed);
  const risk = scoreRiskFindings(scored);
  return { score: risk.score, band: risk.band, breakdown: risk.breakdown,
    analysisIncomplete: incompleteAnalysis || confidence < config.analysisConfidenceThreshold };
}

export function scorePrincipalCandidates(
  candidates: ExtractedCandidate[], rate: number | null, term: ParsedDuration | null, statedEMI: number | null, docType: DocumentType,
): ExtractedField<number> {
  return resolvePrincipal(candidates, rate, term?.months ?? null, statedEMI, docType);
}
