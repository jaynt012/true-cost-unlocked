import { describe, expect, it } from "vitest";
import { applyCatalogAliases, editDistanceAtMostOne, normalizeDocument } from "@/lib/documentNormalization";
import { inspectLegalStructure, resolveLegalReference } from "@/lib/documentStructure";

describe("Round 5 source-mapped OCR normalization", () => {
  it("repairs spaced money, OCR digits, split currencies, and units without changing prose", () => {
    const text = "1. Definitions\nBorrower Olive will retain collateral.\nPrincipal: U S $ 15 , OOO\nTerm: 3 6 MONTHS\nAPR: l l . 5 %\nProcessing fee: R s . 2 5";
    const normalized = normalizeDocument(text);
    expect(normalized.text).toContain("1. Definitions\nBorrower Olive will retain collateral.");
    expect(normalized.text).toContain("US$15,000");
    expect(normalized.text).toContain("36 MONTHS");
    expect(normalized.text).toContain("11.5 %");
    expect(normalized.text).toContain("Rs.25");
  });

  it("repairs dot leaders and fuzzy catalog labels with exact original evidence", () => {
    const text = "LOAN AGREEMENT\n0rigination Fee .......... 3 %\nPRINCIPAL AMT: $ 15 , 000\nTERM: 3 6 MONTHS";
    const normalized = normalizeDocument(text);
    expect(normalized.text).toContain("origination Fee  3 %");
    const amountStart = normalized.text.indexOf("15,000");
    expect(normalized.originalEvidence(amountStart, amountStart + 6)).toBe("15 , 000");
    const start = normalized.text.indexOf("origination");
    const end = normalized.text.indexOf("\n", start);
    expect(normalized.originalEvidence(start, end)).toBe("0rigination Fee .......... 3 %");
    expect(normalized.spans).toHaveLength(normalized.text.length);
  });

  it("tracks repeated clauses through cumulative edits without substring restoration", () => {
    const clause = "0rigination Fee .......... $ 2 5";
    const text = `TITLE\n${clause}\n${clause}\nEnd.`;
    const normalized = normalizeDocument(text);
    const first = normalized.text.indexOf("origination");
    const second = normalized.text.indexOf("origination", first + 1);
    const end = normalized.text.indexOf("\n", second);
    expect(normalized.originalSpan(second, end)).toEqual([text.lastIndexOf(clause), text.lastIndexOf(clause) + clause.length]);
    expect(normalized.originalEvidence(second, end)).toBe(clause);
    expect(normalized.originalSpan(second, second)).toEqual([text.lastIndexOf(clause), text.lastIndexOf(clause)]);
  });

  it("limits aliases to one edit and accepts configured multiword labels", () => {
    expect(editDistanceAtMostOne("0rigination", "origination")).toBe(true);
    expect(editDistanceAtMostOne("originaton", "origination")).toBe(true);
    expect(editDistanceAtMostOne("originnation", "origination")).toBe(true);
    expect(editDistanceAtMostOne("0riginati0n", "origination")).toBe(false);
    const document = normalizeDocument("Facilty Amount: $1,000", { aliases: [] });
    const normalized = applyCatalogAliases(document, [{ canonical: "Facility Amount", aliases: [] }]);
    expect(normalized.text).toBe("Facility Amount: $1,000");
    expect(normalized.originalEvidence(0, "Facility Amount".length)).toBe("Facilty Amount");
  });

  it("does not join unrelated numbers or correct letters outside a numeric context", () => {
    const normalized = normalizeDocument("Sections 3 6 cover Loan obligations.\nO l I\nFee: lO\nRatio 1 , 000");
    expect(normalized.text).toContain("Sections 3 6");
    expect(normalized.text).toContain("O l I");
    expect(normalized.text).toContain("Fee: 10");
    expect(normalized.text).toContain("Ratio 1,000");
  });

  it("preserves currency-code word boundaries and composite fee punctuation", () => {
    const document = normalizeDocument("Loan amount: EUR 45 , 000\nPrincipal: INR 2 , 000\nProcessing fee: Rs. 199 + 18% GST");
    expect(document.text).toContain("EUR 45,000");
    expect(document.text).toContain("INR 2,000");
    expect(document.text).toContain("Rs.199 + 18% GST");
    const valueStart = document.text.indexOf("2,000");
    expect(document.originalEvidence(valueStart, valueStart + 5)).toBe("2 , 000");
  });

  it("prefers exact catalog aliases over fuzzy matches to nearby legitimate words", () => {
    const document = normalizeDocument("Prepayment penalty is waived. Repaymnt term: 36 months.", {
      aliases: [
        { canonical: "repayment", aliases: [] },
        { canonical: "prepayment", aliases: [] },
      ],
    });
    expect(document.text).toBe("Prepayment penalty is waived. repayment term: 36 months.");
    expect(document.originalEvidence(0, "Prepayment".length)).toBe("Prepayment");
  });

  it("repairs line-wrapped currency and units while retaining exact original spans", () => {
    const text = "Principal: $\n15 OOO\nTerm: 3 6\nMONTHS\nFee: EUR\n2 OOO";
    const document = normalizeDocument(text);
    expect(document.text).toBe("Principal: $15000\nTerm: 36\nMONTHS\nFee: EUR 2000");
    const amountStart = document.text.indexOf("$15000");
    expect(document.originalEvidence(amountStart, amountStart + 6)).toBe("$\n15 OOO");
    expect(document.originalSpan(amountStart, amountStart + 6)).toEqual([text.indexOf("$"), text.indexOf("\nTerm")]);
    const euroStart = document.text.indexOf("EUR 2000");
    expect(document.originalEvidence(euroStart, euroStart + 8)).toBe("EUR\n2 OOO");
  });
});

describe("Round 5 legal sections and defined references", () => {
  it("resolves arbitrary quoted terms and keeps their clause evidence", () => {
    const text = '1. DEFINITIONS\n"Facility Amount" means the principal sum of $15,000.\n2. REPAYMENT\nThe Borrower must repay the Facility Amount over 36 months.';
    const structure = inspectLegalStructure(text);
    expect(structure.sections.map(({ number, title }) => [number, title])).toEqual([["1", "DEFINITIONS"], ["2", "REPAYMENT"]]);
    const definition = resolveLegalReference("3% of the Facility Amount", structure);
    expect(definition?.amount).toBe(15000);
    expect(definition?.sectionNumber).toBe("1");
    expect(definition?.source).toBe('"Facility Amount" means the principal sum of $15,000.');
    expect(text.slice(...definition!.span)).toBe(definition?.source);
    expect(text.slice(...definition!.amountSpan!)).toBe("$15,000");
  });

  it("reads data-configured principal labels and parenthetical names", () => {
    const text = '1. ADVANCE\nPrincipal: $15,000\nThe Lender advances $15,000 (the "Loan") to the Borrower.\n2. FEES\nOrigination is 3% of the Loan.';
    const structure = inspectLegalStructure(text);
    expect(resolveLegalReference("Principal", structure)?.amount).toBe(15000);
    expect(resolveLegalReference("the Loan", structure)?.amount).toBe(15000);
    expect(resolveLegalReference("unrelated term", structure)).toBeNull();
    expect(structure.sections[0].end).toBe(text.indexOf("2. FEES"));
  });

  it("does not use duration or percentage numbers as a defined principal", () => {
    const structure = inspectLegalStructure('"Loan" means a repayment obligation of 36 months at 11.5% APR.');
    expect(resolveLegalReference("Loan", structure)?.amount).toBeNull();
  });

  it("stops definition evidence at a sentence ending after an amount", () => {
    const text = '"Loan" means $15,000. A separate fee is $25.';
    const definition = resolveLegalReference("Loan", inspectLegalStructure(text));
    expect(definition?.source).toBe('"Loan" means $15,000.');
    expect(definition?.amount).toBe(15000);
  });
});
