import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisPanels } from "@/components/AnalysisPanels";
import { analyzeLocally } from "@/lib/analyzeLocally";
import { calculateEMI, formatCurrency } from "@/lib/financial";
import { CLEAN_LOAN } from "./fixtures/cleanLoan";

afterEach(cleanup);

describe("Round 4 page projections", () => {
  it("orders the page once, hides zero costs, and collapses AI and tools", () => {
    const context = analyzeLocally(CLEAN_LOAN);
    const mounted = render(createElement(AnalysisPanels, { context, aiEnhancementStatus: "ready" }));
    const panels = Array.from(mounted.container.querySelectorAll("[data-analysis-panel]"))
      .map((element) => element.getAttribute("data-analysis-panel"));
    expect(panels).toEqual(["analysis-dashboard", "numbers", "findings", "explain", "ai-assistant", "tools"]);
    expect(new Set(panels).size).toBe(panels.length);
    expect(mounted.container.textContent).not.toMatch(/-\$0\.00|−\$0\.00|undefined|NaN|\.{2,}/);
    const numbers = mounted.container.querySelector("[data-analysis-panel='numbers']")!;
    expect(numbers.textContent).not.toMatch(/Offsets|Optional products/);
    expect(mounted.container.textContent).toContain("Positive terms");
    const assistant = mounted.container.querySelector("[data-analysis-panel='ai-assistant']")!;
    expect(assistant.querySelector("details")?.open).toBe(false);
    expect(assistant.textContent).toContain("AI-generated, not used in score");
    expect(assistant.textContent).toContain("No issues to negotiate. Optional: compare rates with other lenders");
    expect(assistant.textContent).not.toMatch(/NEGOTIATION PLAYBOOK|COUNTER-OFFER EMAIL|CLAUSES TO REVIEW/);
  });

  it("renders a risky clause only in Findings and keeps positive evidence distinct", () => {
    const clause = "Processing fee: $175.";
    const context = analyzeLocally(CLEAN_LOAN + "\n" + clause);
    const mounted = render(createElement(AnalysisPanels, { context }));
    const findings = mounted.container.querySelector("[data-analysis-panel='findings']")!;
    expect(findings.textContent).toContain(clause);
    const others = Array.from(mounted.container.querySelectorAll("[data-analysis-panel]"))
      .filter((element) => element !== findings)
      .map((element) => element.textContent).join(" ");
    expect(others).not.toContain(clause);
  });

  it("prefills the documented zero late fee and labels its limited grace period", () => {
    const context = analyzeLocally(CLEAN_LOAN);
    const mounted = render(createElement(AnalysisPanels, { context }));
    const tools = mounted.container.querySelector("[data-analysis-panel='tools']") as HTMLElement;
    fireEvent.mouseDown(within(tools).getByRole("tab", { name: /late.payment/i }), { button: 0, ctrlKey: false });
    expect(tools.textContent).toContain("Late fee is $0 during the first 30 days.");
    expect(tools.textContent).not.toContain("No late-fee amount was extracted");
    expect(within(tools).getByRole("spinbutton")).toHaveValue(0);
  });

  it("keeps an edited scenario when supplemental AI results arrive for the same analysis", () => {
    const context = analyzeLocally(CLEAN_LOAN);
    const mounted = render(createElement(AnalysisPanels, { context, aiEnhancementStatus: "loading" }));
    const tools = mounted.container.querySelector("[data-analysis-panel='tools']") as HTMLElement;
    fireEvent.mouseDown(within(tools).getByRole("tab", { name: /late.payment/i }), { button: 0, ctrlKey: false });
    fireEvent.change(within(tools).getByRole("spinbutton"), { target: { value: "25" } });
    mounted.rerender(createElement(AnalysisPanels, {
      context: { ...context, aiInsights: ["The agreement includes documented fee protections."] },
      aiEnhancementStatus: "ready",
    }));
    expect(within(tools).getByRole("spinbutton")).toHaveValue(25);
  });

  it("offers a rate-change scenario for a variable rate without inventing a future rate", () => {
    const context = analyzeLocally("Personal loan agreement. Loan amount: $9000. Variable APR: 7%. Repayment term: 24 months.");
    const mounted = render(createElement(AnalysisPanels, { context }));
    const tools = mounted.container.querySelector("[data-analysis-panel='tools']") as HTMLElement;
    fireEvent.mouseDown(within(tools).getByRole("tab", { name: /rate change/i }), { button: 0, ctrlKey: false });
    const futureRate = within(tools).getByRole("spinbutton");
    expect(futureRate).toHaveValue(null);
    fireEvent.change(futureRate, { target: { value: "11" } });
    expect(tools.textContent).toContain(formatCurrency(calculateEMI(9000, 11, 24)!.emi, "USD"));
    expect(tools.textContent).toContain("your assumption");
  });

  it("requires an assumption once an unpriced grace period ends", () => {
    const context = analyzeLocally(CLEAN_LOAN);
    const mounted = render(createElement(AnalysisPanels, { context }));
    const tools = mounted.container.querySelector("[data-analysis-panel='tools']") as HTMLElement;
    fireEvent.mouseDown(within(tools).getByRole("tab", { name: /late.payment/i }), { button: 0, ctrlKey: false });
    fireEvent.change(within(tools).getByRole("slider", { name: /days into/i }), { target: { value: "31" } });
    expect(within(tools).getByRole("spinbutton")).toHaveValue(null);
    expect(tools.textContent).toContain("outside the documented grace period is not stated");
  });
});
