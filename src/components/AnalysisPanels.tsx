import { useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AnalysisDashboard, AnalysisNumbers, AnalysisFindings, AnalysisExplain, AnalysisAIAssistant } from "./AnalysisSections";
import { AmortizationTable } from "./AmortizationTable";
import { WorstCaseSimulator } from "./WorstCaseSimulator";
import { SavingsCalculator } from "./SavingsCalculator";
import { LoanComparison } from "./LoanComparison";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { calculateEMI, calculateFlatLoan, formatCurrency } from "@/lib/financial";
import { hasActionableFindings } from "@/lib/analyzeWithAI";
import type { AnalysisContext } from "@/lib/analysisContext";

export type AIEnhancementStatus = "unconfigured" | "loading" | "ready" | "error";
interface Props {
  context: AnalysisContext;
  onPrincipalSelect?: (amount: number) => void;
  onEvidenceSelect?: (span: [number, number]) => void;
  aiEnhancementStatus?: AIEnhancementStatus;
}
function RateChangeScenario({ context }: Props) {
  const [futureRate, setFutureRate] = useState<number | "">("");
  const calculatePayment = context.rateField.basis === "flat" ? calculateFlatLoan : calculateEMI;
  const estimate = futureRate !== "" && Number.isFinite(futureRate) && futureRate >= 0 && context.principal !== null && context.termField.value !== null
    ? calculatePayment(context.principal, futureRate, context.termField.value) : null;
  return <div className="terminal-card p-4 font-mono space-y-3">
    <h3 className="text-sm font-semibold">Rate-change scenario</h3>
    <p className="text-xs text-muted-foreground">The document identifies a {context.rateField.type} rate. This scenario assumes the entered annual rate applies for the full term on a {context.rateField.basis === "flat" ? "flat" : "reducing-balance"} basis; future changes and separate fees are excluded.</p>
    {context.rateField.source && <blockquote className="border-l-2 border-border pl-3 text-xs text-muted-foreground">{context.rateField.source}</blockquote>}
    <label className="block text-xs">Future annual rate (your assumption)<input type="number" min="0" step="any" value={futureRate} onChange={(event) => setFutureRate(event.target.value === "" ? "" : Number(event.target.value))} className="mt-2 block w-full border border-border bg-background px-3 py-2" /></label>
    {estimate && <p className="text-sm">Scenario monthly payment: {formatCurrency(estimate.emi, context.currencyCode)}{context.emi !== null ? " · Current modeled payment: " + formatCurrency(context.emi, context.currencyCode) : ""}</p>}
  </div>;
}
interface ToolDescriptor { id: string; label: string; render: (context: AnalysisContext) => ReactNode }
const TOOLS: ToolDescriptor[] = [
  { id: "amortization", label: "Amortization", render: (context) => <AmortizationTable context={context} /> },
  { id: "worst_case", label: "Late-payment", render: (context) => <WorstCaseSimulator context={context} /> },
  { id: "early_repayment", label: "Early repayment", render: (context) => <SavingsCalculator context={context} /> },
  { id: "loan_comparison", label: "Loan comparison", render: (context) => <LoanComparison context={context} /> },
  { id: "rate_change", label: "Rate change", render: (context) => <RateChangeScenario key={context.id} context={context} /> },
];
const availableTools = (context: AnalysisContext) => TOOLS.filter((tool) => tool.id === "rate_change"
  ? ["variable", "introductory"].includes(context.rateField.type) && context.principal !== null && context.termField.value !== null
  : context.ranCalculators.includes(tool.id));

function AnalysisTools({ context }: Props) {
  const tools = availableTools(context);
  return <div className="space-y-2"><h2 className="font-mono text-sm font-semibold">Tools</h2><Tabs key={context.id} defaultValue={tools[0]?.id}>
    <TabsList className="h-auto flex flex-wrap justify-start">{tools.map((tool) => <TabsTrigger key={tool.id} value={tool.id} className="font-mono text-xs">{tool.label}</TabsTrigger>)}</TabsList>
    {tools.map((tool) => <TabsContent key={tool.id} value={tool.id}>{tool.render(context)}</TabsContent>)}
  </Tabs></div>;
}

interface PanelDescriptor { id: string; available?: (props: Props) => boolean; render: (props: Props) => ReactNode }
function hasAnalysisNumbers(context: AnalysisContext): boolean {
  return context.principal !== null || context.rateField.value !== null || context.termField.value !== null
    || context.installmentSchedule !== null || Object.values(context.costBreakdown).some((value) => value > 0)
    || context.itemGroups.length > 0 || context.reconciliations.length > 0;
}
const PANEL_REGISTRY: PanelDescriptor[] = [
  { id: "analysis-dashboard", render: (props) => <AnalysisDashboard {...props} /> },
  { id: "numbers", available: ({ context }) => hasAnalysisNumbers(context), render: (props) => <AnalysisNumbers {...props} /> },
  { id: "findings", available: ({ context }) => context.findings.length > 0, render: (props) => <AnalysisFindings {...props} /> },
  { id: "explain", available: ({ context }) => context.insights.length > 0 || context.glossary.length > 0, render: (props) => <AnalysisExplain {...props} /> },
  { id: "ai-assistant", available: ({ context, aiEnhancementStatus }) => !hasActionableFindings(context) || aiEnhancementStatus !== "unconfigured" || !!context.aiInsights?.length || !!context.aiCounterOfferEmail, render: (props) => <AnalysisAIAssistant {...props} /> },
  { id: "tools", available: ({ context }) => availableTools(context).length > 0, render: (props) => <AnalysisTools {...props} /> },
];

export function AnalysisPanels({ context, onPrincipalSelect, onEvidenceSelect, aiEnhancementStatus = "unconfigured" }: Props) {
  const props = { context, onPrincipalSelect, onEvidenceSelect, aiEnhancementStatus };
  return <motion.section key={context.id} data-analysis-id={context.id} className="space-y-4" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.22 } } }}>
    {PANEL_REGISTRY.filter((panel) => !panel.available || panel.available(props)).map((panel) => <motion.div key={panel.id} data-analysis-panel={panel.id}
      variants={{ hidden: { opacity: 0, y: 32, scale: 0.985, filter: "blur(6px)" }, visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}>
      {panel.render(props)}
    </motion.div>)}
  </motion.section>;
}
