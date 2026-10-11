import { AlertTriangle, Brain, DollarSign, FileWarning, Shield } from "lucide-react";
import { motion } from "framer-motion";
import TerminalCard from "./TerminalCard";
import { RiskMeter } from "./RiskMeter";
import { AICounterOfferEmail } from "./AICounterOfferEmail";
import { formatCurrency } from "@/lib/financial";
import { hasActionableFindings } from "@/lib/analyzeWithAI";
import type { AnalysisContext, AnalysisFinding, CostFinding } from "@/lib/analysisContext";
import rules from "@/data/analysisRules.json";

export type AnalysisResult = AnalysisContext;
interface Props {
  context: AnalysisContext;
  onPrincipalSelect?: (amount: number) => void;
  onEvidenceSelect?: (span: [number, number]) => void;
  aiEnhancementStatus?: "unconfigured" | "loading" | "ready" | "error";
}

export function AnalysisDashboard({ context, onPrincipalSelect }: Props) {
  const scored = context.riskBreakdown.filter((item) => item.points > 0);
  const combinedScore = scored[scored.length - 1]?.combinedScore ?? context.riskScore;
  const hasIssues = context.findings.some((finding) => finding.category !== "protection");
  const reason = hasIssues ? "Review the detected findings and their evidence below."
    : context.protections.length ? "Documented protections with no detected material flags." : "No configured material flags detected.";
  return <div className="space-y-4">
    <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.24 } } }} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
      <motion.div variants={{ hidden: { opacity: 0, y: 28, filter: "blur(5px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)" } }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
      <TerminalCard title="VERDICT" icon={Shield} className="h-full">
        <div className="flex justify-center py-2"><RiskMeter score={context.riskScore} band={context.riskBand} incomplete={context.analysisIncomplete} /></div>
        {scored.length > 0 && <details className="mt-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground">
          <summary className="cursor-pointer">Score breakdown</summary>
          <ul className="mt-2 space-y-1">{scored.map((item, index) => <li key={`${item.findingId ?? item.category}:${index}`}>{item.reasons[0] || item.category.replace(/_/g, " ")}: {Math.round((item.weight ?? item.points / 100) * 100)}% weight{item.reasons.filter((reason) => reason.startsWith("Minimum risk band:")).map((reason) => <span key={reason} className="block text-[10px]">{reason}</span>)}</li>)}</ul>
          <p className="mt-2">Combined result: 100 × (1 − product of (1 − weight)) = {combinedScore.toFixed(1)}/100.</p>
          <p className="mt-1">Final score: {Number(context.riskScore.toFixed(1))}/100{combinedScore < context.riskScore ? " (catalog minimum applied)" : ""}.</p>
        </details>}
      </TerminalCard>
      </motion.div>
      <motion.div variants={{ hidden: { opacity: 0, y: 28, filter: "blur(5px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)" } }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
      <TerminalCard title="PLAIN ENGLISH SUMMARY" icon={FileWarning} className="h-full">
        <p className="font-mono text-sm leading-relaxed text-foreground">{context.summary}</p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">Extraction confidence: {Math.round(context.confidence * 100)}% · {context.docType.label}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{reason}</p>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">Currency: {context.currency ?? "not detected"}{context.currency ? " (automatic)" : " (USD display fallback)"}</p>
        {!context.calculator.available && <p className="mt-3 font-mono text-xs text-muted-foreground">{context.calculator.unsupportedReason || `${context.calculator.label} needs: ${context.calculator.missingInputs.join(", ")}.`}</p>}
      </TerminalCard>
      </motion.div>
    </motion.div>
    {context.principalField.needsReview && context.principalField.alternatives.length > 0 && <TerminalCard title="SELECT PRINCIPAL AMOUNT" icon={AlertTriangle}>
      <p className="mb-3 font-mono text-xs text-muted-foreground">Choose the amount labeled as the financed principal.</p>
      <div className="flex flex-wrap gap-2">{context.principalField.alternatives.map((candidate) => <button type="button" key={`${candidate.position}:${candidate.value}`} onClick={() => onPrincipalSelect?.(candidate.value)} className="border border-border px-3 py-2 text-left font-mono text-xs hover:border-primary/50">
        <span className="block text-foreground">{candidate.label}: {formatCurrency(candidate.value, context.currencyCode)}</span><span className="block text-muted-foreground">{candidate.source}</span>
      </button>)}</div>
    </TerminalCard>}
  </div>;
}

export function AnalysisNumbers({ context }: Props) {
  const money = (value: number) => formatCurrency(value, context.currencyCode);
  const metrics = [
    { label: "Principal", value: context.principal === null ? null : `${money(context.principal)}${context.principalField.needsReview ? " (unverified)" : ""}` },
    { label: "Monthly payment", value: context.emi === null ? null : money(context.emi) },
    { label: "Scheduled payments", value: context.totalPayment === null ? null : money(context.totalPayment) },
    { label: context.rateField.rateType === "deferred" ? "Conditional deferred APR" : context.rateField.rateRole === "penalty" ? "Penalty APR" : context.rateField.rateRole === "promotional" ? "Promotional rate" : "Annual rate", value: context.rateField.value === null ? null : `${context.rateField.value}%` },
    { label: "Rate type", value: context.rateField.value === null ? null : context.rateField.type },
    { label: "Calculation basis", value: context.rateField.value === null ? null : context.rateField.basis },
    { label: "Term", value: context.termField.value === null ? null : `${Number.isInteger(context.termField.value) ? "" : "≈ "}${Number(context.termField.value.toFixed(2))} months` },
    { label: "Effective APR", value: context.effectiveAPR === null ? null : `${context.effectiveAPR.toFixed(2)}%` },
  ].filter((metric) => metric.value !== null);
  const costRows = [
    { label: "Interest", amount: context.costBreakdown.interest },
    { label: "Taxes", amount: context.costBreakdown.taxes },
    { label: "Fees", amount: context.costBreakdown.fees },
    { label: "Offsets", amount: context.costBreakdown.offsets, offset: true },
    { label: "Financing cost", amount: context.costBreakdown.financingCost },
    { label: "Optional products (separate)", amount: context.costBreakdown.optionalProducts },
  ].filter((row) => row.amount > 0);
  return <TerminalCard title="NUMBERS" icon={DollarSign}><div className="space-y-4 font-mono">
    {!!context.plausibilityConflicts?.length && <div role="alert" className="border border-destructive/40 p-3 text-xs"><h3 className="font-semibold text-foreground">Principal needs review</h3><p className="mt-1 text-muted-foreground">Principal confidence: {Math.round(context.principalField.confidence * 100)}%. Confirm these conflicting amounts before relying on calculations.</p><ul className="mt-2 space-y-2">{context.plausibilityConflicts.map((conflict, index) => <li key={`${conflict.kind}:${conflict.conflictingValue}:${index}`}><p>Principal: {money(conflict.principal)} · {conflict.label}: {money(conflict.conflictingValue)}</p><blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground">{conflict.source}</blockquote></li>)}</ul></div>}
    {metrics.length > 0 && <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">{metrics.map((metric) => <div key={metric.label}><dt className="text-[10px] text-muted-foreground uppercase">{metric.label}</dt><dd className="mt-1 text-lg font-bold text-foreground">{metric.value}</dd></div>)}</dl>}
    {context.installmentSchedule && <div className="border-t border-border pt-3 text-sm">{context.installmentSchedule.count} × {money(context.installmentSchedule.amount)} every {context.installmentSchedule.interval} {context.installmentSchedule.intervalUnit}{context.installmentSchedule.interval === 1 ? "" : "s"}<p className="mt-1 text-xs text-muted-foreground">Scheduled total: {money(context.installmentSchedule.total)}</p></div>}
    {costRows.length > 0 && <div className="border-t border-border pt-3"><h3 className="mb-2 text-xs font-bold">Cost breakdown · computed</h3><dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">{costRows.map((row) => <div key={row.label}><dt className="text-muted-foreground">{row.label}</dt><dd className="mt-1">{row.offset ? "−" : ""}{money(row.amount)}</dd></div>)}</dl>{context.netDisbursed !== null && context.netDisbursed > 0 && <p className="mt-3 text-xs text-muted-foreground">Net proceeds: {money(context.netDisbursed)}</p>}</div>}
    {context.cashPriceAnalysis && <div className="border-t border-border pt-3 text-xs space-y-1"><p>Cash price: {money(context.cashPriceAnalysis.cashPrice)} · Total paid: {money(context.cashPriceAnalysis.totalPaid)} · {context.cashPriceAnalysis.multiple.toFixed(2)}× cash price</p>{context.cashPriceAnalysis.extraCost > 0 && <p>Extra cost: {money(context.cashPriceAnalysis.extraCost)}</p>}{context.cashPriceAnalysis.impliedNominalAPR !== null && <p>Implied nominal APR: {context.cashPriceAnalysis.impliedNominalAPR.toFixed(1)}% (computed; first payment one period after agreement)</p>}</div>}
    {context.itemGroups.filter((group) => group.aggregate > 0).map((group) => <details key={group.id} className="border-t border-border pt-3 text-xs"><summary className="cursor-pointer">{group.label}: {money(group.aggregate)}</summary><ul className="mt-2 space-y-1">{group.items.filter((item) => item.amount > 0).map((item, index) => <li key={index} className="flex justify-between gap-3"><span>{item.label || "Unclassified item"}</span><span>{money(item.amount)}</span></li>)}</ul></details>)}
    {context.reconciliations.length > 0 && <details className="border-t border-border pt-3 text-xs"><summary className="cursor-pointer">Amount reconciliation</summary><ul className="mt-2 space-y-1">{context.reconciliations.map((check) => <li key={check.id}>{check.expression} · {check.matched ? "matches" : "does not match"}</li>)}</ul></details>}
    {context.addOnImpact && context.addOnImpact.amount > 0 && <p className="text-xs text-muted-foreground">Listed add-ons add about {money(context.addOnImpact.paymentIncrease)} per month and {money(context.addOnImpact.totalPaymentIncrease)} over the term (computed).</p>}
    {context.fairMarketComparison && <details className="border-t border-border pt-3 text-xs"><summary className="cursor-pointer">Market benchmark: {context.fairMarketComparison.marketAverage}% APR</summary><p className="mt-2">{context.fairMarketComparison.assessment}</p><p className="mt-1 text-muted-foreground">{[context.fairMarketComparison.source, context.fairMarketComparison.asOf].filter(Boolean).join(" · ")}</p></details>}
  </div></TerminalCard>;
}

function distinctFindings(findings: AnalysisFinding[]): AnalysisFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => { const key = `${finding.id}:${finding.clauseSpan.join(":")}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => b.severity - a.severity || a.position - b.position);
}

function FindingAmounts({ finding, context }: { finding: AnalysisFinding; context: AnalysisContext }) {
  const amounts = new Map<string, CostFinding>();
  for (const component of finding.components ?? [finding]) {
    if (component.amount === null && component.percent === null) continue;
    const key = [component.topicId ?? component.id, component.amount, component.percent, component.basis, component.frequency].join(":");
    if (!amounts.has(key)) amounts.set(key, component);
  }
  if (!amounts.size) return null;
  return <div className="mt-1 space-y-1 text-foreground">{[...amounts.entries()].map(([key, component]) => <p key={key}>
    {finding.components && <span>{component.label}: </span>}
    {component.qualifier && <span className="capitalize">{component.qualifier} </span>}
    {component.amount !== null ? formatCurrency(component.amount, context.currencyCode) : `${component.percent}%`}
    {component.amount !== null && component.percent !== null && <span> ({component.percent}%)</span>}
    {component.amount === null && component.percent !== null && component.totalImpact !== null && <span> = {formatCurrency(component.totalImpact, context.currencyCode)} (computed)</span>}
    {component.frequency ? ` · ${component.frequency}` : ""}
  </p>)}</div>;
}

function FindingList({ findings, context, positive = false, onEvidenceSelect }: { findings: AnalysisFinding[]; context: AnalysisContext; positive?: boolean; onEvidenceSelect?: (span: [number, number]) => void }) {
  if (positive) return <ul className="space-y-2">{distinctFindings(findings).map((finding) => <li key={`${finding.id}:${finding.position}`} className="font-mono text-xs"><details><summary className="cursor-pointer font-semibold text-foreground">{finding.label}{finding.conditions.length > 0 && <span className="ml-2 font-normal text-muted-foreground">· {finding.conditions.join("; ")}</span>}</summary>{finding.evidence && <blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground">{finding.evidence}</blockquote>}{finding.sourceLocation && <button type="button" onClick={() => onEvidenceSelect?.(finding.clauseSpan)} className="mt-1 text-[10px] text-primary underline">Page {finding.sourceLocation.page} · highlight extracted text</button>}</details></li>)}</ul>;
  return <ul className="space-y-4">{distinctFindings(findings).map((finding) => <li key={`${finding.id}:${finding.position}`} className="font-mono text-xs">
    <div className="flex items-start justify-between gap-3"><span className="font-semibold text-foreground">{finding.label}</span>{!positive && <span className="shrink-0 text-[10px] text-muted-foreground">{finding.severity >= 5 ? "CRITICAL" : finding.severity >= 4 ? "HIGH" : finding.severity >= 2 ? "MEDIUM" : "LOW"}</span>}</div>
    <FindingAmounts finding={finding} context={context} />
    {finding.explanation && <p className="mt-1 text-muted-foreground">{finding.explanation}</p>}
    {finding.evidence && <blockquote className="mt-2 border-l-2 border-border pl-3 text-muted-foreground">{finding.evidence}</blockquote>}
    {finding.sourceLocation && <button type="button" onClick={() => onEvidenceSelect?.(finding.clauseSpan)} className="mt-1 font-mono text-[10px] text-primary underline">Page {finding.sourceLocation.page} · highlight extracted text</button>}
    {finding.conditions.length > 0 && <p className="mt-1 text-muted-foreground">Applies: {finding.conditions.join("; ")}</p>}
    <p className="mt-1 text-[10px] text-muted-foreground">{finding.provenance.replace(/-/g, " ")}</p>
  </li>)}</ul>;
}

export function AnalysisFindings({ context, onEvidenceSelect }: Props) {
  const issues = context.findings.filter((finding) => finding.category !== "protection" && finding.category !== "conditional_term");
  return <TerminalCard title="FINDINGS" icon={FileWarning} tag={issues.length ? `${issues.length} TO REVIEW` : undefined}>
    {issues.length > 0 && <FindingList findings={issues} context={context} onEvidenceSelect={onEvidenceSelect} />}
    {context.conditionalTerms && context.conditionalTerms.length > 0 && <div className={issues.length ? "mt-5 border-t border-border pt-4" : ""}><h3 className="mb-2 font-mono text-sm font-semibold text-amber-500">Conditional terms</h3><FindingList findings={context.conditionalTerms} context={context} positive onEvidenceSelect={onEvidenceSelect} /></div>}
    {context.protections.length > 0 && <div className={issues.length || (context.conditionalTerms?.length ?? 0) > 0 ? "mt-5 border-t border-border pt-4" : ""}><h3 className="mb-2 font-mono text-sm font-semibold text-primary">Positive terms</h3><p className="mb-3 font-mono text-xs text-muted-foreground">{(rules as unknown as { findingsUI: { protectionExplanation: string } }).findingsUI.protectionExplanation}</p><FindingList findings={context.protections} context={context} positive onEvidenceSelect={onEvidenceSelect} /></div>}
  </TerminalCard>;
}

export function AnalysisExplain({ context }: Props) {
  return <TerminalCard title="EXPLAIN" icon={Brain}>
    {context.insights.length > 0 && <div><h3 className="mb-2 font-mono text-xs font-semibold">Pattern insights · computed facts</h3><ul className="space-y-2 font-mono text-xs text-muted-foreground">{Array.from(new Set(context.insights)).map((insight) => <li key={insight}>{insight}</li>)}</ul></div>}
    {context.glossary.length > 0 && <div className={context.insights.length ? "mt-4 border-t border-border pt-4" : ""}><h3 className="mb-2 font-mono text-xs font-semibold">Glossary</h3><dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">{context.glossary.map((item) => <div key={item.term}><dt className="font-semibold text-primary">{item.term}</dt><dd className="mt-1 text-muted-foreground">{item.definition}</dd></div>)}</dl></div>}
  </TerminalCard>;
}

export function AnalysisAIAssistant({ context, aiEnhancementStatus = "unconfigured" }: Props) {
  const actionable = hasActionableFindings(context);
  return <details className="terminal-card">
    <summary className="cursor-pointer px-4 py-3 font-mono"><span className="text-sm font-semibold">AI assistant</span><span className="ml-3 text-[10px] text-muted-foreground">AI-generated, not used in score</span>{!actionable && <p className="mt-2 text-xs text-muted-foreground">No issues to negotiate. Optional: compare rates with other lenders</p>}{aiEnhancementStatus === "loading" && <span className="ml-3 text-[10px] text-muted-foreground">Generating…</span>}</summary>
    <div className="border-t border-border p-4 space-y-4 font-mono text-xs">
      {aiEnhancementStatus === "unconfigured" && <p className="text-muted-foreground">AI insights are unavailable in this build.</p>}
      {aiEnhancementStatus === "error" && <p className="text-muted-foreground">AI insights could not be loaded. Your analysis is available above.</p>}
      {!!context.aiInsights?.length && <div><h3 className="mb-2 font-semibold">Additional observations</h3><ul className="space-y-2 text-muted-foreground">{context.aiInsights.map((insight) => <li key={insight}>{insight}</li>)}</ul></div>}
      {actionable && !!context.aiNegotiationStrategies?.length && <div><h3 className="mb-2 font-semibold">Negotiation playbook</h3><ul className="space-y-2 text-muted-foreground">{context.aiNegotiationStrategies.map((strategy) => <li key={strategy}>{strategy}</li>)}</ul></div>}
      {actionable && !!context.aiClausesToReview?.length && <div><h3 className="mb-2 font-semibold">Clauses to review</h3><ul className="space-y-2 text-muted-foreground">{context.aiClausesToReview.map((clause) => <li key={clause}>{clause}</li>)}</ul></div>}
      {actionable && context.aiCounterOfferEmail && <AICounterOfferEmail key={`ai-email:${context.id}`} context={context} />}
      {aiEnhancementStatus === "ready" && !context.aiInsights?.length && <p className="text-muted-foreground">No additional observations.</p>}
    </div>
  </details>;
}
