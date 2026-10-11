import rules from "@/data/analysisRules.json";

export interface CatalogAlias {
  canonical: string;
  aliases: string[];
}

export interface TextNormalizationConfig {
  currencyJoins?: Array<{ pattern: string; replacement: string }>;
  numericContext?: { unitPattern?: string; labelPattern?: string; currencyPattern?: string };
  unitPattern?: string;
  aliases?: CatalogAlias[];
}

export interface NormalizedDocument {
  text: string;
  originalText: string;
  /** A half-open source span for each normalized UTF-16 character. */
  spans: Array<[number, number]>;
  originalSpan(start: number, end: number): [number, number];
  originalEvidence(start: number, end: number): string;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
  sourceIndices?: number[];
}

function makeDocument(text: string, originalText: string, spans: Array<[number, number]>): NormalizedDocument {
  const originalSpan = (start: number, end: number): [number, number] => {
    const left = Math.max(0, Math.min(text.length, start));
    const right = Math.max(left, Math.min(text.length, end));
    if (left === right) {
      const position = spans[left]?.[0] ?? spans[left - 1]?.[1] ?? 0;
      return [position, position];
    }
    let sourceStart = originalText.length;
    let sourceEnd = 0;
    for (let index = left; index < right; index++) {
      sourceStart = Math.min(sourceStart, spans[index][0]);
      sourceEnd = Math.max(sourceEnd, spans[index][1]);
    }
    return [sourceStart, sourceEnd];
  };
  return {
    text,
    originalText,
    spans,
    originalSpan,
    originalEvidence: (start, end) => {
      const [sourceStart, sourceEnd] = originalSpan(start, end);
      return originalText.slice(sourceStart, sourceEnd);
    },
  };
}

function applyEdits(document: NormalizedDocument, edits: Edit[]): NormalizedDocument {
  let cursor = 0;
  let text = "";
  const spans: Array<[number, number]> = [];
  for (const edit of edits.sort((left, right) => left.start - right.start)) {
    if (edit.start < cursor) continue;
    text += document.text.slice(cursor, edit.start) + edit.replacement;
    for (let index = cursor; index < edit.start; index++) spans.push(document.spans[index]);
    const replacementSpan = document.originalSpan(edit.start, edit.end);
    for (let index = 0; index < edit.replacement.length; index++) {
      spans.push(edit.sourceIndices?.[index] !== undefined
        ? document.spans[edit.sourceIndices[index]] : replacementSpan);
    }
    cursor = edit.end;
  }
  text += document.text.slice(cursor);
  for (let index = cursor; index < document.spans.length; index++) spans.push(document.spans[index]);
  return makeDocument(text, document.originalText, spans);
}

function replaceMatches(document: NormalizedDocument, pattern: RegExp, replacement: (match: RegExpMatchArray) => string): NormalizedDocument {
  const edits = Array.from(document.text.matchAll(pattern), (match): Edit => ({
    start: match.index!, end: match.index! + match[0].length, replacement: replacement(match),
  }));
  return applyEdits(document, edits);
}

/** Compare aliases without accepting several OCR errors in a single alias. */
export function editDistanceAtMostOne(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

export interface CatalogAliasMatch {
  start: number;
  end: number;
  canonical: string;
  alias: string;
  matched: string;
}

export function catalogAliasMatches(text: string, aliases: CatalogAlias[]): CatalogAliasMatch[] {
  const tokens = Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu));
  const matches: CatalogAliasMatch[] = [];
  for (const entry of aliases) {
    for (const alias of new Set([entry.canonical, ...entry.aliases])) {
      const words = alias.trim().split(/\s+/).length;
      for (let index = 0; index + words <= tokens.length; index++) {
        const start = tokens[index].index!;
        const last = tokens[index + words - 1];
        const end = last.index! + last[0].length;
        const matched = text.slice(start, end);
        if (editDistanceAtMostOne(matched.replace(/\s+/g, " "), alias)) {
          matches.push({ start, end, canonical: entry.canonical, alias, matched });
        }
      }
    }
  }
  const accepted: CatalogAliasMatch[] = [];
  const isExact = (match: CatalogAliasMatch) => match.matched.replace(/\s+/g, " ").toLowerCase() === match.alias.toLowerCase();
  for (const match of matches.sort((left, right) => Number(isExact(right)) - Number(isExact(left))
    || right.end - right.start - (left.end - left.start))) {
    if (!accepted.some((existing) => match.start < existing.end && match.end > existing.start)) accepted.push(match);
  }
  return accepted.sort((left, right) => left.start - right.start);
}

export function applyCatalogAliases(document: NormalizedDocument, aliases: CatalogAlias[]): NormalizedDocument {
  return applyEdits(document, catalogAliasMatches(document.text, aliases)
    .filter((match) => match.matched.toLowerCase() !== match.canonical.toLowerCase())
    .map((match) => ({ ...match, replacement: match.canonical })));
}

/** Repair OCR only where currency, labels, or units establish a numeric context. */
export function normalizeDocument(originalText: string, options?: TextNormalizationConfig): NormalizedDocument {
  const config = options ?? (rules as { textNormalization?: TextNormalizationConfig }).textNormalization ?? {};
  let document = makeDocument(originalText, originalText, Array.from({ length: originalText.length }, (_, index) => [index, index + 1]));
  document = replaceMatches(document, /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, () => " ");
  for (const join of config.currencyJoins ?? []) {
    document = replaceMatches(document, new RegExp(join.pattern, "gi"), (match) => match[0].replace(new RegExp(join.pattern, "i"), join.replacement));
  }
  document = replaceMatches(document, /(?:\.[ \t]*){2,}|…+/g, () => " ");
  const currencyPattern = config.numericContext?.currencyPattern ?? String.raw`US\$|C\$|A\$|S\$|\$|₹|€|£|¥|\b(?:USD|INR|EUR|GBP|JPY|CAD|AUD|SGD|AED|Rs\.?)`;
  const unitPattern = config.numericContext?.unitPattern ?? config.unitPattern ?? String.raw`%|years?\b|yrs?\b|months?\b|mos?\b|weeks?\b|days?\b|hours?\b|fortnights?\b|thousand\b|million\b|lakh\b|crore\b|APR\b`;
  const labelPattern = config.numericContext?.labelPattern;
  const currencyBefore = new RegExp(`(?:${currencyPattern})\\s*$`, "i");
  const unitAfter = new RegExp(`^\\s*(?:${unitPattern})`, "i");
  const labelBefore = labelPattern ? new RegExp(`\\b(?:${labelPattern})\\b(?:[ \\t]*(?:is|of))?[ \\t:=$-]*$`, "i") : null;
  const edits: Edit[] = [];
  const numericToken = /(?<![\p{L}\p{N}])[\dOlI]+(?:[ \t]*[,.][ \t]*[\dOlI]+|[ \t]+[\dOlI]+)*(?![\p{L}\p{N}])/gu;
  for (const match of document.text.matchAll(numericToken)) {
    const start = match.index!;
    const end = start + match[0].length;
    const beforeWindow = document.text.slice(Math.max(0, start - 90), start);
    const before = beforeWindow.split(/\r?\n/).pop() ?? "";
    const after = document.text.slice(end, end + 45);
    const hasContext = currencyBefore.test(beforeWindow) || unitAfter.test(after) || Boolean(labelBefore?.test(before));
    const hasDigits = /\d/.test(match[0]);
    // Punctuation spacing between ordinary digits is unambiguous even without a label.
    const onlyPunctuationSpacing = hasDigits && !/[OlI]/.test(match[0]) && /[,.]/.test(match[0])
      && !/\d[ \t]+\d/.test(match[0]);
    if (!hasContext && !onlyPunctuationSpacing) continue;
    const sourceIndices: number[] = [];
    let replacement = "";
    for (let index = 0; index < match[0].length; index++) {
      const character = match[0][index];
      if (/[ \t]/.test(character)) continue;
      replacement += hasContext ? character.replace(/O/g, "0").replace(/[lI]/g, "1") : character;
      sourceIndices.push(start + index);
    }
    if (replacement !== match[0]) edits.push({ start, end, replacement, sourceIndices });
  }
  document = applyEdits(document, edits);
  // Keeping symbol and number together also repairs line wrapping after a currency token.
  document = replaceMatches(document, new RegExp(`(${currencyPattern})\\s+(?=\\d)`, "gi"), (match) =>
    /\p{L}$/u.test(match[1]) ? `${match[1]} ` : match[1]);
  return applyCatalogAliases(document, config.aliases ?? []);
}
