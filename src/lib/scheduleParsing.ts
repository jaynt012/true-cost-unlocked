import config from "@/data/scheduleRules.json";

/** Shared count/frequency grammar. No analyzer imports: financial helpers can use it safely. */
export const NUMBER_PATTERN = `(?:\\d+(?:\\.\\d+)?|(?:${Object.keys(config.numberWords).concat(Object.keys(config.numberScales)).join("|")})(?:[- ]+(?:and[- ]+)?(?:${Object.keys(config.numberWords).concat(Object.keys(config.numberScales)).join("|")}))*)`;
export const UNIT_PATTERN = config.units.map((entry) => entry.pattern).join("|");

export function parseWrittenNumber(raw: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(raw.trim())) return Number(raw);
  const words = raw.toLowerCase().trim().split(/[ -]+/).filter((word) => word !== "and");
  let value = 0;
  let group = 0;
  for (const word of words) {
    const number = (config.numberWords as Record<string, number>)[word];
    const scale = (config.numberScales as Record<string, number>)[word];
    if (number !== undefined) group += number;
    else if (scale === 100) group = Math.max(1, group) * scale;
    else if (scale) { value += Math.max(1, group) * scale; group = 0; }
    else return null;
  }
  return words.length ? value + group : null;
}

export function unitSpec(raw: string) {
  return config.units.find((entry) => new RegExp(`^(?:${entry.pattern})$`, "i").test(raw.trim())) ?? null;
}

export interface ScheduleFrequency {
  unit: "day" | "week" | "fortnight" | "month" | "year";
  interval: number;
  months: number;
  position: number;
  source: string;
}

export function frequenciesIn(text: string): ScheduleFrequency[] {
  const found: ScheduleFrequency[] = [];
  const each = new RegExp(`\\b(?:every|per|each|a)\\s+(?:(${NUMBER_PATTERN})\\s+)?(${UNIT_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(each)) {
    const unit = unitSpec(match[2]);
    const interval = match[1] ? parseWrittenNumber(match[1]) : 1;
    if (unit && interval && interval > 0) found.push({ unit: unit.unit as ScheduleFrequency["unit"], interval, months: interval * unit.months, position: match.index!, source: match[0] });
  }
  for (const frequency of config.frequencies) {
    for (const match of text.matchAll(new RegExp(`\\b(?:${frequency.pattern})\\b`, "gi"))) {
      if (found.some((entry) => match.index! >= entry.position && match.index! < entry.position + entry.source.length)) continue;
      const unit = config.units.find((entry) => entry.unit === frequency.unit)!;
      found.push({ unit: unit.unit as ScheduleFrequency["unit"], interval: frequency.interval, months: frequency.interval * unit.months, position: match.index!, source: match[0] });
    }
  }
  return found.sort((a, b) => a.position - b.position);
}

export interface CountedSchedule { count: number; frequency: ScheduleFrequency | null; source: string; position: number; months: number | null }

export function countedSchedules(text: string): CountedSchedule[] {
  const countPattern = new RegExp(`\\b(${NUMBER_PATTERN})(?:\\s*\\((\\d+)\\))?\\s+(?:(?:${config.countModifierPattern})\\s+)*(?:${config.paymentNounPattern})\\b`, "gi");
  const matches: CountedSchedule[] = [];
  for (const match of text.matchAll(countPattern)) {
    const count = parseWrittenNumber(match[1]);
    if (!count || !Number.isInteger(count) || count > config.maximumCount || (match[2] && Number(match[2]) !== count)) continue;
    const start = match.index!;
    const left = Math.max(text.lastIndexOf("\n", start), text.lastIndexOf(";", start), text.lastIndexOf(". ", start)) + 1;
    const tail = text.slice(start, start + config.maximumFrequencyDistance);
    const boundary = tail.search(/[;\n]|[.!?](?=\s+[A-Z]|$)/);
    const end = start + (boundary < 0 ? tail.length : boundary);
    const source = text.slice(start, end);
    const frequencies = frequenciesIn(source);
    const frequency = frequencies.find((entry) => /^every\b/i.test(entry.source)) ?? frequencies[0] ?? null;
    const sourceLength = Math.max(match[0].length, frequency ? frequency.position + frequency.source.length : 0);
    matches.push({ count, frequency, source: source.slice(0, sourceLength).trim(), position: start, months: frequency ? count * frequency.months : null });
  }
  const labeled = new RegExp(`\\b(?:${config.countLabelPattern})\\s*[:=–—-]?\\s*(${NUMBER_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(labeled)) {
    const count = parseWrittenNumber(match[1]);
    if (!count || !Number.isInteger(count) || count > config.maximumCount) continue;
    const position = match.index!;
    const window = text.slice(position, position + config.maximumClauseCharacters);
    const frequencies = frequenciesIn(window).filter((entry) => {
      const lineStart = Math.max(window.lastIndexOf("\n", entry.position), window.lastIndexOf(";", entry.position), window.lastIndexOf(". ", entry.position)) + 1;
      const context = window.slice(lineStart, entry.position + entry.source.length + 35);
      return new RegExp(`\\b(?:${config.paymentTimingPattern})\\b`, "i").test(context)
        && !new RegExp(`\\b(?:${config.feeLabelPattern}|${config.nonTermPattern})\\b`, "i").test(context);
    });
    const frequency = frequencies[0] ?? null;
    const sourceEnd = frequency ? frequency.position + frequency.source.length : match[0].length;
    matches.push({ count, frequency, position, months: frequency ? count * frequency.months : null, source: window.slice(0, sourceEnd) });
  }
  return matches;
}
