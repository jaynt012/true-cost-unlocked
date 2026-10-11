import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisInput } from "@/components/AnalysisInput";
import Analyze from "@/pages/Analyze";
import { analyzeLocally } from "@/lib/analyzeLocally";
import type { AIExtractedFields, AnalysisContext } from "@/lib/analysisContext";
import type { DocumentImportResult } from "@/lib/documentImport";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";
import rules from "@/data/analysisRules.json";

const mocks = vi.hoisted(() => ({ import: vi.fn(), configured: vi.fn(), enhance: vi.fn(), extract: vi.fn() }));
vi.mock("@/lib/documentImport", async (original) => ({ ...await original<typeof import("@/lib/documentImport")>(), importDocument: mocks.import }));
vi.mock("@/lib/analyzeWithAI", async (original) => ({ ...await original<typeof import("@/lib/analyzeWithAI")>(),
  isAIEnhancementConfigured: mocks.configured, enhanceAnalysisWithAI: mocks.enhance, extractFieldsWithAI: mocks.extract,
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/AnalysisPanels", () => ({ AnalysisPanels: ({ context }: { context: AnalysisContext }) => createElement("output", { "data-testid": "analysis" }, context.rawText) }));

const emptyFields: AIExtractedFields = { principal: { value: null, evidence: null }, annualAPR: { value: null, evidence: null }, termMonths: { value: null, evidence: null }, payment: { value: null, evidence: null } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const mountPage = () => render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(Analyze)));
const paste = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: /Financial.*Legal Text/i }), { target: { value } });
const analyze = () => fireEvent.click(screen.getByRole("button", { name: /^analyze$/i }));

beforeEach(() => {
  mocks.import.mockReset(); mocks.configured.mockReset().mockReturnValue(false); mocks.enhance.mockReset(); mocks.extract.mockReset();
  mocks.enhance.mockResolvedValue({ aiInsights: [], aiNegotiationStrategies: [], aiClausesToReview: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("input extraction and document isolation", () => {
  it("shows extracted fields, lets a user replace or clear them, and submits only explicit overrides", async () => {
    const onAnalyze = vi.fn();
    render(createElement(AnalysisInput, { onAnalyze, isLoading: false }));
    paste(CLEAN_LOAN);
    const amount = screen.getByRole("spinbutton", { name: "Loan Amount" });
    await waitFor(() => expect(amount).toHaveValue(12000));
    analyze();
    expect(onAnalyze.mock.calls[0].slice(1, 5)).toEqual([null, null, null, null]);
    fireEvent.change(amount, { target: { value: "" } });
    expect(amount).toHaveValue(null);
    fireEvent.change(amount, { target: { value: "18500" } });
    analyze();
    expect(onAnalyze.mock.calls[1][1]).toBe(18500);
    fireEvent.click(screen.getByRole("button", { name: "Use automatic extraction" }));
    expect(amount).toHaveValue(12000);
  });

  it("does not show fixed principal and term inputs for revolving credit", async () => {
    render(createElement(AnalysisInput, { onAnalyze: vi.fn(), isLoading: false }));
    paste("CREDIT CARD AGREEMENT. Revolving credit. APR: 19.9% per year.");
    await waitFor(() => expect(screen.queryByRole("spinbutton", { name: "Loan Amount" })).toBeNull());
    expect(screen.queryByRole("spinbutton", { name: "Duration (months)" })).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Interest Rate (%)" })).toHaveValue(19.9);
  });

  it("withholds mismatched fields but leaves their candidates and the analysis action available", async () => {
    render(createElement(AnalysisInput, { onAnalyze: vi.fn(), isLoading: false }));
    paste("Loan principal: $10,000. APR: 9.9%. Term: 36 months. Monthly EMI: $500.");
    await waitFor(() => expect(screen.getAllByText(/Unverified · candidates:/).length).toBeGreaterThan(0));
    expect(screen.getByRole("spinbutton", { name: "Loan Amount" })).toHaveValue(null);
    expect(screen.getByRole("button", { name: /^analyze$/i })).toBeEnabled();
  });

  it("cannot overwrite edited input with an older file import", async () => {
    const imported = deferred<DocumentImportResult>();
    mocks.import.mockReturnValueOnce(imported.promise);
    render(createElement(AnalysisInput, { onAnalyze: vi.fn(), isLoading: false }));
    fireEvent.change(screen.getByLabelText("Upload PDF or image"), { target: { files: [new File(["pdf"], "loan.pdf", { type: "application/pdf" })] } });
    paste("My newer agreement text.");
    await act(async () => imported.resolve({ text: "Old PDF text", pages: [], spans: [] }));
    expect(screen.getByRole("textbox")).toHaveValue("My newer agreement text.");
    expect(screen.queryByText(/Reading document/)).toBeNull();
  });

  it("clears results immediately on edits and ignores an obsolete AI response", async () => {
    const enhancement = deferred<object>();
    mocks.configured.mockReturnValue(true);
    mocks.enhance.mockReturnValueOnce(enhancement.promise);
    mountPage(); paste(CLEAN_LOAN); analyze();
    expect(screen.getByTestId("analysis")).toBeInTheDocument();
    const signal = mocks.enhance.mock.calls[0][1].signal as AbortSignal;
    paste("Replacement agreement.");
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId("analysis")).toBeNull();
    await act(async () => enhancement.resolve({ aiInsights: ["Older insight"] }));
    expect(screen.queryByTestId("analysis")).toBeNull();
  });

  it("cancels fallback on reset and never restores the removed document", async () => {
    const extraction = deferred<AIExtractedFields>();
    mocks.configured.mockReturnValue(true); mocks.extract.mockReturnValueOnce(extraction.promise);
    mountPage(); paste("Agreement with incomplete financial fields."); analyze();
    expect(mocks.extract).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect((mocks.extract.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    await act(async () => extraction.resolve(emptyFields));
    expect(screen.queryByTestId("analysis")).toBeNull();
    expect(mocks.enhance).not.toHaveBeenCalled();
  });

  it("keeps local analysis usable and explains an optional fallback failure", async () => {
    mocks.configured.mockReturnValue(true); mocks.extract.mockRejectedValueOnce(new Error("Provider failed"));
    mountPage(); paste("Agreement with incomplete financial fields."); analyze();
    await waitFor(() => expect(screen.getByText(/AI field extraction is unavailable/)).toBeInTheDocument());
    expect(screen.getByTestId("analysis")).toBeInTheDocument();
    expect(mocks.enhance).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /^analyze$/i })).toBeEnabled();
  });
});

describe("bounded optional OpenRouter requests", () => {
  it("aborts a pending extraction request when its caller cancels", async () => {
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await vi.importActual<typeof import("@/lib/analyzeWithAI")>("@/lib/analyzeWithAI");
    const controller = new AbortController();
    const pending = api.extractFieldsWithAI("Principal: $4,000.", { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("times out an unresponsive request without discarding local analysis", async () => {
    vi.useFakeTimers(); vi.stubEnv("VITE_OPENROUTER_API_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    })));
    const api = await vi.importActual<typeof import("@/lib/analyzeWithAI")>("@/lib/analyzeWithAI");
    const pending = api.extractFieldsWithAI("Principal: $4,000.");
    const rejected = expect(pending).rejects.toThrow(/timed out; local analysis is still available/);
    const timeout = (rules as unknown as { aiExtraction: { request?: { timeoutMs?: number } } }).aiExtraction.request?.timeoutMs ?? 30000;
    await vi.advanceTimersByTimeAsync(timeout); await rejected;
  });

  it("does not send unverified field values as verified AI facts", async () => {
    const api = await vi.importActual<typeof import("@/lib/analyzeWithAI")>("@/lib/analyzeWithAI");
    const local = analyzeLocally(CLEAN_LOAN);
    const context = api.buildAIContext({ ...local, principalField: { ...local.principalField, needsReview: true } });
    expect(context.facts.some((fact) => fact.name === "principal loan amount")).toBe(false);
    expect(context.unresolvedFields).toContain("principal loan amount");
  });
});
