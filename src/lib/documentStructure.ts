import rules from "@/data/analysisRules.json";

export interface LegalStructureConfig {
  referenceTerms?: string[];
  principalTermPattern?: string;
  sectionHeadingPattern?: string;
}

export interface LegalSection {
  number: string;
  title: string;
  start: number;
  bodyStart: number;
  end: number;
}

export interface LegalDefinition {
  term: string;
  valueText: string;
  amount: number | null;
  /** Full definition clause and its exact input positions. */
  span: [number, number];
  amountSpan: [number, number] | null;
  source: string;
  sectionNumber: string | null;
}

export interface LegalStructure {
  sections: LegalSection[];
  definitions: LegalDefinition[];
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const canonicalTerm = (value: string) => value.replace(/^[\s"“”'‘’]*(?:the\s+)?/i, "").replace(/[\s"“”'‘’]+$/, "").toLowerCase();

function clauseBounds(text: string, position: number): [number, number] {
  const boundary = (index: number) => {
    const character = text[index];
    if (/[\r\n;]/.test(character)) return true;
    if (!/[.!?]/.test(character)) return false;
    if (character === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) return false;
    if (character === "." && /\b(?:Rs|No|Inc|Ltd|approx)$/i.test(text.slice(Math.max(0, index - 10), index))) return false;
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    if (character === "." && /^[ \t]*(?:(?:section|article)[ \t]+)?\d+(?:\.\d+)*$/i.test(text.slice(lineStart, index))) return false;
    return true;
  };
  let start = position;
  let end = position;
  while (start > 0 && !boundary(start - 1)) start--;
  while (end < text.length && !boundary(end)) end++;
  if (end < text.length && /[.!?;]/.test(text[end])) end++;
  while (/\s/.test(text[start] ?? "") && start < end) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

function definedAmount(text: string, offset: number, allowUnmarkedMoney: boolean): { amount: number | null; amountSpan: [number, number] | null } {
  const pattern = /(?<currency>US\$|C\$|A\$|S\$|[$₹€£¥]|\b(?:USD|INR|EUR|GBP|JPY|CAD|AUD|SGD|AED|Rs\.?)\b)?[ \t]*(?<amount>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,])/gi;
  const candidates = Array.from(text.matchAll(pattern)).filter((match) => {
    const after = text.slice(match.index! + match[0].length);
    const quantity = /^[ \t]*(?:(?:monthly|weekly|daily|annual|yearly|equal|scheduled|consecutive|remaining|total)[ \t]+){0,3}(?:years?|yrs?|months?|mos?|weeks?|days?|hours?|fortnights?|times?|payments?|installments?|instalments?|emis?)\b/i.test(after);
    return !quantity && !/^[ \t]*%/i.test(after)
      && (Boolean(match.groups?.currency) || !/^\.[ \t]+[A-Za-z]/.test(after));
  });
  const match = candidates.find((candidate) => candidate.groups?.currency)
    ?? (allowUnmarkedMoney ? candidates[0] : undefined);
  return match ? {
    amount: Number(match.groups!.amount.replace(/,/g, "")),
    amountSpan: [offset + match.index!, offset + match.index! + match[0].length],
  } : { amount: null, amountSpan: null };
}

/** Parse legal structure without inventing amounts or rewriting the source. */
export function inspectLegalStructure(text: string, options?: LegalStructureConfig): LegalStructure {
  const config = options ?? (rules as { legalStructure?: LegalStructureConfig }).legalStructure ?? {};
  const sections: LegalSection[] = [];
  const headingPattern = new RegExp(config.sectionHeadingPattern
    ?? String.raw`^[ \t]*(?:(?:section|article)[ \t]+)?(?<number>\d+(?:\.\d+)*|[IVXLCDM]+)(?:[.)](?=[ \t])|[ \t]+[-–—])[ \t]*(?<title>[^\r\n]{2,160})`, "gim");
  for (const match of text.matchAll(headingPattern)) {
    const titleText = match.groups?.title ?? "";
    if (!/[A-Za-z]/.test(titleText)) continue;
    const delimiter = /[:;]|\.(?=\s+[A-Z“"'])/.exec(titleText);
    const title = (delimiter ? titleText.slice(0, delimiter.index) : titleText).trim();
    const titleStart = match.index! + match[0].lastIndexOf(titleText);
    sections.push({
      number: match.groups?.number ?? "",
      title,
      start: match.index!,
      bodyStart: delimiter ? titleStart + delimiter.index + 1 : match.index! + match[0].length,
      end: text.length,
    });
  }
  for (let index = 0; index + 1 < sections.length; index++) sections[index].end = sections[index + 1].start;

  const definitions: LegalDefinition[] = [];
  const addDefinition = (term: string, position: number, valueStart: number, valueEnd?: number) => {
    const span = clauseBounds(text, position);
    const end = valueEnd ?? span[1];
    const valueText = text.slice(valueStart, end).trim();
    const amount = definedAmount(text.slice(valueStart, end), valueStart,
      Boolean(config.principalTermPattern && new RegExp(config.principalTermPattern, "i").test(term)));
    const section = sections.find((candidate) => candidate.start <= position && position < candidate.end);
    if (definitions.some((existing) => canonicalTerm(existing.term) === canonicalTerm(term) && existing.span[0] === span[0])) return;
    definitions.push({ term: term.trim(), valueText, ...amount, span, source: text.slice(...span), sectionNumber: section?.number ?? null });
  };

  // Quoted defined terms can have any name; domain labels come from the catalog.
  const quoted = /["“'‘](?<term>[^"”'’\r\n]{1,70})["”'’][ \t]*(?:(?:shall[ \t]+)?mean(?:s)?|refers?[ \t]+to|is[ \t]+defined[ \t]+as|:)[ \t]*/gi;
  for (const match of text.matchAll(quoted)) addDefinition(match.groups!.term, match.index!, match.index! + match[0].length);

  const terms = config.referenceTerms ?? [];
  if (terms.length) {
    const labels = new RegExp(String.raw`\b(?<term>${terms.map(escapeRegex).sort((left, right) => right.length - left.length).join("|")})\b[ \t]*(?:[:=]|(?:(?:shall[ \t]+)?(?:be|mean(?:s)?)|is)[ \t]+|(?:in[ \t]+the[ \t]+amount[ \t]+of|of)[ \t]+)`, "gi");
    for (const match of text.matchAll(labels)) addDefinition(match.groups!.term, match.index!, match.index! + match[0].length);
  }

  const parenthetical = /\([ \t]*(?:hereinafter[ \t]+)?(?:the[ \t]+)?["“'‘](?<term>[^"”'’\r\n]{1,70})["”'’][ \t]*\)/gi;
  for (const match of text.matchAll(parenthetical)) {
    const [start] = clauseBounds(text, match.index!);
    addDefinition(match.groups!.term, match.index!, start, match.index!);
  }
  return { sections, definitions: definitions.sort((left, right) => left.span[0] - right.span[0]) };
}

/** Resolve references such as “the Loan” to their declared amount. */
export function resolveLegalReference(reference: string, structure: LegalStructure): LegalDefinition | null {
  const normalized = canonicalTerm(reference);
  const definitions = [...structure.definitions].sort((left, right) => right.term.length - left.term.length);
  return definitions.find((definition) => canonicalTerm(definition.term) === normalized)
    ?? definitions.find((definition) => new RegExp(`\\b${escapeRegex(canonicalTerm(definition.term))}\\b`, "i").test(normalized))
    ?? null;
}
