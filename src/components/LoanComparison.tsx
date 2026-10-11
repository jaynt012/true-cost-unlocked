import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitCompareArrows, Play } from "lucide-react";
import { calculateEMI, formatCurrency } from "@/lib/financial";
import type { AnalysisContext } from "@/lib/analysisContext";

interface LoanParams { amount: number | ""; rate: number | ""; duration: number | "" }
interface Props { context: AnalysisContext }

export function LoanComparison({ context }: Props) {
  const analyzedAmount = context.principal ?? "";
  const analyzedRate = context.rateField.value !== null && context.rateField.rateType !== "deferred" ? context.rateField.value : "";
  const analyzedDuration = context.termField.value ?? "";
  const fromContext = (): LoanParams => ({
    amount: analyzedAmount,
    rate: analyzedRate,
    duration: analyzedDuration,
  });
  const [loanA, setLoanA] = useState<LoanParams>(fromContext);
  const [loanB, setLoanB] = useState<LoanParams>({ amount: "", rate: "", duration: "" });
  const [compared, setCompared] = useState(false);
  useEffect(() => {
    setLoanA({ amount: analyzedAmount, rate: analyzedRate, duration: analyzedDuration });
    setCompared(false);
  }, [context.id, analyzedAmount, analyzedRate, analyzedDuration]);

  const resultFor = (loan: LoanParams) => loan.amount !== "" && loan.rate !== "" && loan.duration !== ""
    ? calculateEMI(loan.amount, loan.rate, loan.duration)
    : null;
  const resultA = resultFor(loanA);
  const resultB = resultFor(loanB);
  const savings = resultA && resultB
    ? Math.min(context.totalCost ?? 0, Math.max(0, resultA.totalPayment - resultB.totalPayment))
    : null;
  const fields = [
    { label: "Amount (" + context.currencyCode + ")", key: "amount" as const },
    { label: "Annual rate (%)", key: "rate" as const },
    { label: "Months", key: "duration" as const },
  ];

  if (!context.financialMetricsAvailable || context.rateField.rateType !== "reducing") return null;
  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95 }} className="terminal-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2"><GitCompareArrows className="w-4 h-4 text-primary" />
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">LOAN COMPARISON</span></div>
      </div>
      <div className="p-4 space-y-4">
        <p className="font-mono text-[10px] text-muted-foreground">Loan A starts with the analyzed terms. Enter all Loan B fields to compare base payments; separate fees are excluded.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([{ loan: loanA, set: setLoanA, label: "LOAN A (ANALYZED)" }, { loan: loanB, set: setLoanB, label: "LOAN B (ENTER COMPARISON)" }]).map(({ loan, set, label }) => (
            <div key={label} className="space-y-3">
              <p className="font-mono text-[10px] tracking-widest text-primary uppercase">{label}</p>
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="block font-mono text-[9px] text-muted-foreground uppercase mb-1">{field.label}</label>
                  <input type="number" min="0" step="any" value={loan[field.key]}
                    onChange={(event) => { set({ ...loan, [field.key]: event.target.value === "" ? "" : Number(event.target.value) }); setCompared(false); }}
                    className="w-full bg-background border border-border px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:border-primary/40" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <button onClick={() => setCompared(true)} disabled={!resultA || !resultB}
          className="interactive-button flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground font-mono text-[10px] tracking-widest uppercase terminal-glow disabled:opacity-40">
          <Play className="w-3 h-3" /> COMPARE
        </button>
        {compared && resultA && resultB && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-background border border-border p-3 space-y-2"><p className="font-mono text-[10px] text-primary uppercase">LOAN A</p>
              <p className="font-mono text-sm">Payment: {formatCurrency(resultA.emi, context.currencyCode)}</p>
              <p className="font-mono text-sm">Total: {formatCurrency(resultA.totalPayment, context.currencyCode)}</p>
              <p className="font-mono text-sm">Interest: {formatCurrency(resultA.totalInterest, context.currencyCode)}</p></div>
            <div className="bg-background border border-primary/30 p-3 space-y-2"><p className="font-mono text-[10px] text-primary uppercase">LOAN B</p>
              <p className="font-mono text-sm">Payment: {formatCurrency(resultB.emi, context.currencyCode)}</p>
              <p className="font-mono text-sm">Total: {formatCurrency(resultB.totalPayment, context.currencyCode)}</p>
              <p className="font-mono text-sm">Interest: {formatCurrency(resultB.totalInterest, context.currencyCode)}</p></div>
            {savings !== null && savings > 0 && <div className="sm:col-span-2 bg-primary/10 border border-primary/30 p-3 text-center">
              <p className="font-mono text-[10px] text-primary uppercase">BASE PAYMENT DIFFERENCE</p>
              <p className="font-mono text-2xl font-bold text-primary">{formatCurrency(savings, context.currencyCode)}</p>
            </div>}
          </div>
        )}
      </div>
    </motion.div>
  );
}
