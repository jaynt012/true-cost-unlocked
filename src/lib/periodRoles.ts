import rules from "@/data/analysisRules.json";
import scheduleRules from "@/data/scheduleRules.json";
import { normalizeDuration, type ParsedDuration } from "./financial";
import { inspectLegalStructure } from "./documentStructure";
import { segmentClauses } from "./analysisEngine";
import { countedSchedules, frequenciesIn, NUMBER_PATTERN, parseWrittenNumber } from "./scheduleParsing";

export type PeriodRole = "term" | "trial_promo" | "grace" | "cancellation" | "notice" | "cure" | "unclassified";
export interface PeriodCandidate {
  value: number;
  unit: string;
  months: number;
  role: PeriodRole;
  source: string;
  span: [number, number];
  confidence: number;
}
interface PeriodRoleConfig {
  units: string;
  unitMonths: Record<string, number>;
  numberWords: Record<string, number>;
  contextCharacters: number;
  roles: Array<{ role: PeriodRole; pattern: string; priority: number }>;
  explicitTermPattern: string;
  genericTermContextPattern?: string;
  derivedSchedule: { suppressRoles: PeriodRole[] };
}

function policy(): PeriodRoleConfig {
  return (rules as unknown as { periodRoles: PeriodRoleConfig }).periodRoles;
}

/** Assign each stated duration its nearest contextual role before selecting a repayment term. */
export function classifyPeriodRoles(text: string): PeriodCandidate[] {
  const config = policy();
  if (!config) return [];
  const numberPattern = `(?:\\d+(?:\\.\\d+)?|${Object.keys(config.numberWords).join("|")})`;
  const duration = new RegExp(`\\b(${numberPattern})\\s*[- ]?\\s*(${config.units})\\b`, "gi");
  const candidates: PeriodCandidate[] = [];
  const sections = inspectLegalStructure(text).sections;
  const clauses = segmentClauses(text);
  for (const match of text.matchAll(duration)) {
    const start = match.index!;
    const end = start + match[0].length;
    const clause = clauses.find((entry) => entry.start <= start && start < entry.end) ?? { text: match[0], start, end };
    const leftBoundary = clause.start;
    const rightBoundary = clause.end;
    const from = Math.max(leftBoundary, start - config.contextCharacters);
    const to = Math.min(rightBoundary, end + config.contextCharacters);
    const context = text.slice(from, to);
    const nonTermRules = scheduleRules.nonTermDurationRoles as Array<{ role: PeriodRole; pattern: string; priority: number }>;
    const nonTerm = nonTermRules.flatMap((entry) => Array.from(context.matchAll(new RegExp(entry.pattern, "gi")), (roleMatch) => {
      const roleStart = from + roleMatch.index!;
      const roleEnd = roleStart + roleMatch[0].length;
      return { ...entry, distance: Math.max(start - roleEnd, roleStart - end, 0) };
    })).sort((a, b) => a.distance - b.distance || b.priority - a.priority)[0];
    const roles = config.roles.flatMap((entry) => Array.from(context.matchAll(new RegExp(entry.pattern, "gi")), (roleMatch) => {
      const roleStart = from + roleMatch.index!;
      const roleEnd = roleStart + roleMatch[0].length;
      const distance = Math.max(start - roleEnd, roleStart - end, 0);
      return { ...entry, distance };
    })).sort((a, b) => a.distance - b.distance || b.priority - a.priority);
    const value = /^\d/.test(match[1]) ? Number(match[1]) : config.numberWords[match[1].toLowerCase()];
    const unit = match[2].toLowerCase().replace(/s$/, "");
    const multiplier = config.unitMonths[unit];
    if (!Number.isFinite(value) || value <= 0 || multiplier === undefined) continue;
    const section = sections.find((entry) => entry.start <= start && start < entry.end);
    const sectionRole = section ? config.roles.filter((entry) => new RegExp(entry.pattern, "i").test(section.title)).sort((a, b) => b.priority - a.priority)[0]?.role : undefined;
    const hasGenericConnector = /\b(?:for|over)\b/i.test(context);
    const hasLoanContext = config.genericTermContextPattern ? new RegExp(config.genericTermContextPattern, "i").test(context) : false;
    const termRole = roles.find((entry) => entry.role === "term" && (!hasGenericConnector || hasLoanContext));
    const role = nonTerm?.role ?? termRole?.role ?? roles.find((entry) => entry.role !== "term")?.role ?? sectionRole ?? "unclassified";
    candidates.push({ value, unit, months: value * multiplier, role, source: clause.text, span: [start, end], confidence: role === "unclassified" ? 0.25 : 0.95 });
  }
  // A disclosed number of payments plus its cadence is a contractual term even
  // when the document never uses the word "term" (common in TILA disclosures).
  for (const schedule of countedSchedules(text)) {
    if (!schedule.frequency || schedule.months === null) continue;
    const duplicate = candidates.some((candidate) => candidate.role === "term" && Math.abs(candidate.months - schedule.months!) < 0.01);
    if (duplicate) continue;
    const span: [number, number] = [schedule.position, schedule.position + schedule.source.length];
    candidates.push({ value: schedule.count, unit: `${schedule.frequency.unit} payments`, months: schedule.months,
      role: "term", source: schedule.source, span, confidence: 0.96 });
  }
  const labeledCount = new RegExp(`\\b(?:${scheduleRules.countLabelPattern})\\s*[:=–—-]?\\s*(${NUMBER_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(labeledCount)) {
    const count = parseWrittenNumber(match[1]);
    if (!count || !Number.isInteger(count)) continue;
    const afterStart = match.index! + match[0].length;
    const tail = text.slice(afterStart, afterStart + scheduleRules.maximumFrequencyDistance);
    const lineBreak = tail.indexOf("\n");
    const window = lineBreak >= 0 ? tail.slice(0, lineBreak) : tail;
    const frequency = frequenciesIn(window).find((candidate) =>
      new RegExp(scheduleRules.paymentTimingPattern, "i").test(window.slice(Math.max(0, candidate.position - 85), candidate.position + candidate.source.length))
      && !new RegExp(scheduleRules.nonTermPattern, "i").test(window.slice(Math.max(0, candidate.position - 60), candidate.position + candidate.source.length + 20)));
    if (!frequency) continue;
    const months = count * frequency.months;
    if (candidates.some((candidate) => candidate.role === "term" && Math.abs(candidate.months - months) < 0.01)) continue;
    const span: [number, number] = [match.index!, afterStart + frequency.position + frequency.source.length];
    candidates.push({ value: count, unit: `${frequency.unit} payments`, months, role: "term",
      source: text.slice(...span).trim(), span, confidence: 0.96 });
  }
  return candidates;
}

export function selectLoanTerm(text: string, candidates = classifyPeriodRoles(text)): ParsedDuration | null {
  const config = policy();
  const stated = candidates.filter((candidate) => candidate.role === "term");
  const rank = (entries: PeriodCandidate[], termPattern: string) => {
    const ranked = [...entries].sort((a, b) => {
      const distance = (candidate: PeriodCandidate) => {
        const sourceStart = text.lastIndexOf(candidate.source, candidate.span[0]);
        const matches = Array.from(candidate.source.matchAll(new RegExp(termPattern, "gi")));
        return Math.min(...matches.map((match) => Math.abs(candidate.span[0] - (sourceStart + match.index! + match[0].length))), Number.MAX_SAFE_INTEGER);
      };
      return distance(a) - distance(b) || a.span[0] - b.span[0];
    });
    return { months: ranked[0].months, source: ranked[0].source, confidence: "high" };
  };
  const sections = inspectLegalStructure(text).sections;
  const explicit = stated.filter((candidate) => new RegExp(config.explicitTermPattern, "i").test(candidate.source)
    || sections.some((section) => section.start <= candidate.span[0] && candidate.span[0] < section.end && new RegExp(config.explicitTermPattern, "i").test(section.title)));
  if (explicit.length) return rank(explicit, config.explicitTermPattern) as ParsedDuration;

  const countDerived = stated.filter((candidate) => /\b(?:number|no\.?|count)\s+(?:of\s+)?(?:payments?|installments?|instalments?)\b/i.test(candidate.source)
    && /\b(?:monthly|weekly|fortnightly|biweekly|daily|quarterly|annually|yearly|every\s+\d+\s+(?:days?|weeks?|months?|years?))\b/i.test(candidate.source));
  if (countDerived.length) return rank(countDerived, String.raw`\b(?:number|no\.?|count)\s+(?:of\s+)?(?:payments?|installments?|instalments?)\b`) as ParsedDuration;

  const schedule = normalizeDuration(text);
  const scheduleStart = schedule ? text.indexOf(schedule.source) : -1;
  const scheduleEnd = scheduleStart + (schedule?.source.length ?? 0);
  const clause = segmentClauses(text).find((entry) => entry.start <= scheduleStart && scheduleStart < entry.end);
  const distance = (left: [number, number], right: [number, number]) => Math.max(left[0] - right[1], right[0] - left[1], 0);
  const countSpan: [number, number] = [scheduleStart, scheduleStart + (/^\d+/.exec(schedule?.source ?? "")?.[0].length ?? 0)];
  const suppressed = Boolean(clause && config.roles.filter((entry) => config.derivedSchedule.suppressRoles.includes(entry.role)).some((entry) =>
    Array.from(clause.text.matchAll(new RegExp(entry.pattern, "gi"))).some((match) => {
      const roleSpan: [number, number] = [clause.start + match.index!, clause.start + match.index! + match[0].length];
      // A nearby separate grace/cancellation window does not reclassify the payment count.
      const otherWindow = candidates.some((candidate) => (candidate.span[0] < scheduleStart || candidate.span[1] > scheduleEnd)
        && distance(roleSpan, candidate.span) < distance(roleSpan, countSpan));
      return !otherWindow;
    })));
  if (schedule && /\b(?:installments?|instalments?|payments?)\b/i.test(schedule.source) && !suppressed) return schedule;
  const remaining = suppressed ? stated.filter((candidate) => candidate.span[0] < scheduleStart || candidate.span[1] > scheduleEnd) : stated;
  const termPattern = config.roles.find((entry) => entry.role === "term")?.pattern;
  return remaining.length && termPattern ? rank(remaining, termPattern) as ParsedDuration : null;
}
