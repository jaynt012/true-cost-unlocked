import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisContext } from "@/lib/analysisContext";
import Analyze from "@/pages/Analyze";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";

const mocked = vi.hoisted(() => ({ enhance: vi.fn() }));
vi.mock("@/lib/analyzeWithAI", () => ({
  isAIEnhancementConfigured: () => true,
  enhanceAnalysisWithAI: mocked.enhance,
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/AnalysisInput", () => ({
  AnalysisInput: ({ onAnalyze }: { onAnalyze: (text: string) => void }) => createElement("div", null,
    createElement("button", { onClick: () => onAnalyze(CLEAN_LOAN) }, "Analyze first"),
    createElement("button", { onClick: () => onAnalyze(CLEAN_LOAN.replace("$12,000", "$15,000")) }, "Analyze second")),
}));
vi.mock("@/components/AnalysisPanels", () => ({
  AnalysisPanels: ({ context, aiEnhancementStatus }: { context: AnalysisContext; aiEnhancementStatus: string }) =>
    createElement("output", { "data-testid": "analysis" }, JSON.stringify({
      principal: context.principal, score: context.riskScore, insights: context.aiInsights, aiEnhancementStatus,
    })),
}));

beforeEach(() => mocked.enhance.mockReset());
afterEach(cleanup);

describe("Round 4 optional AI state isolation", () => {
  it("ignores an older document response after a new analysis has rendered", async () => {
    let resolveFirst!: (value: object) => void;
    let resolveSecond!: (value: object) => void;
    mocked.enhance.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(Analyze)));
    fireEvent.click(screen.getByText("Analyze first"));
    expect(screen.getByTestId("analysis").textContent).toContain('"principal":12000');
    fireEvent.click(screen.getByText("Analyze second"));
    expect(screen.getByTestId("analysis").textContent).toContain('"principal":15000');
    await act(async () => { resolveSecond({ aiInsights: ["Current agreement insight"] }); });
    await act(async () => { resolveFirst({ aiInsights: ["Previous agreement insight"] }); });
    expect(screen.getByTestId("analysis").textContent).toContain("Current agreement insight");
    expect(screen.getByTestId("analysis").textContent).not.toContain("Previous agreement insight");
    expect(screen.getByTestId("analysis").textContent).toContain('"principal":15000');
  });

  it("keeps local results available when the API fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocked.enhance.mockRejectedValueOnce(new Error("OpenRouter request failed"));
    render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(Analyze)));
    fireEvent.click(screen.getByText("Analyze first"));
    await waitFor(() => expect(screen.getByTestId("analysis").textContent).toContain('"aiEnhancementStatus":"error"'));
    expect(screen.getByTestId("analysis").textContent).toContain('"principal":12000');
    expect(screen.getByTestId("analysis").textContent).not.toContain("could not be analyzed");
    warning.mockRestore();
  });
});
