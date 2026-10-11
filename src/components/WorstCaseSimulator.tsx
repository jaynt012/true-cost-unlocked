import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertOctagon } from "lucide-react";
import { calculateEMI, formatCurrency, type SupportedCurrency } from "@/lib/financial";
import type { AnalysisContext } from "@/lib/analysisContext";

interface Props { context: AnalysisContext }

export function WorstCaseSimulator({ context }: Props) {
  const percentBase = context.simulator.lateFeeBasis === "emi" ? (context.emi ?? 0) : (context.principal ?? 0);
  const initialDocumentLateFee = context.simulator.lateFeeAmount ?? (context.simulator.lateFeePercent !== null
    ? percentBase * context.simulator.lateFeePercent / 100
    : null);
  const [daysIntoWindow, setDaysIntoWindow] = useState(0);
  const outsideGrace = context.simulator.gracePeriodDays != null && daysIntoWindow > context.simulator.gracePeriodDays;
  const documentLateFee = outsideGrace ? context.simulator.postGraceLateFeeAmount ?? null : initialDocumentLateFee;
  const [lateFeeOverride, setLateFeeOverride] = useState<number | "">(initialDocumentLateFee ?? "");
  const [missedPayments, setMissedPayments] = useState(1);
  const currencyCode: SupportedCurrency = context.currencyCode;
  const principal = context.principal;
  const duration = context.termField.value;
  const baseTotal = context.totalPayment;

  useEffect(() => {
    setLateFeeOverride(initialDocumentLateFee ?? "");
    setMissedPayments(1);
    setDaysIntoWindow(0);
  }, [context.id, initialDocumentLateFee]);

  if (principal === null || duration === null || baseTotal === null || context.emi === null) return null;
  const penaltyLoan = context.simulator.penaltyAPR !== null
    ? calculateEMI(principal, context.simulator.penaltyAPR, duration)
    : null;
  const baseLoan = context.rateField.value !== null
    ? calculateEMI(principal, context.rateField.value, duration)
    : null;
  const penaltyIncrease = penaltyLoan && baseLoan ? Math.max(0, penaltyLoan.totalPayment - baseLoan.totalPayment) : 0;
  const lateFeeTotal = (lateFeeOverride === "" ? 0 : lateFeeOverride) * missedPayments;
  const worstCaseTotal = baseTotal + penaltyIncrease + lateFeeTotal;
  const increasePercent = baseTotal > 0 ? ((worstCaseTotal - baseTotal) / baseTotal) * 100 : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="terminal-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2"><AlertOctagon className="w-4 h-4 text-destructive" />
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">LATE-PAYMENT SCENARIO</span></div>
        <span className="font-mono text-[10px] font-semibold text-destructive">DOCUMENT TERMS + EDITABLE ASSUMPTIONS</span>
      </div>
      <div className="p-4 space-y-4">
        {context.simulator.penaltyAPR !== null && (
          <p className="font-mono text-xs text-muted-foreground">The document states a penalty APR of {context.simulator.penaltyAPR}%. The estimate applies it for the full remaining term as a scenario.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2">
              Late fee per missed payment ({documentLateFee === null ? "assumption" : "document amount"})
            </label>
            <input aria-label="Late fee per missed payment" type="number" min="0" step="any" value={lateFeeOverride}
              onChange={(event) => setLateFeeOverride(event.target.value === "" ? "" : Number(event.target.value))}
              placeholder="Enter an amount or leave blank" className="w-full bg-background border border-border px-3 py-2 font-mono text-sm text-foreground" />
            {documentLateFee === null && <p className="font-mono text-[10px] text-muted-foreground mt-1">{outsideGrace ? "The fee outside the documented grace period is not stated. Enter an assumption." : "No late-fee amount was extracted."}</p>}
            {context.simulator.source && <p className="font-mono text-[10px] text-muted-foreground mt-1">{outsideGrace ? "Grace-window source" : "Source"}: {context.simulator.source}</p>}
            {context.simulator.gracePeriodDays != null && <div className="mt-3">
              <label className="block font-mono text-[10px] text-muted-foreground">Days into the stated grace window (assumption): {daysIntoWindow}
                <input type="range" min="0" max={Math.max(1, context.simulator.gracePeriodDays * 2)} value={daysIntoWindow}
                  onChange={(event) => {
                    const days = Number(event.target.value);
                    setDaysIntoWindow(days);
                    setLateFeeOverride(days > context.simulator.gracePeriodDays! ? context.simulator.postGraceLateFeeAmount ?? "" : initialDocumentLateFee ?? "");
                  }} className="mt-2 block w-full accent-primary" />
              </label>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">Documented grace period: {context.simulator.gracePeriodDays} days. {outsideGrace ? "Scenario is outside this window." : "Scenario is within this window."} The extracted fee applies only under its stated conditions.</p>
            </div>}
            {!!context.simulator.conditions?.length && <p className="font-mono text-[10px] text-muted-foreground mt-1">{context.simulator.conditions.join("; ")}</p>}
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2">Missed payments (scenario)</label>
            <input type="range" min={1} max={Math.max(1, Math.floor(duration))} value={missedPayments}
              onChange={(event) => setMissedPayments(Number(event.target.value))} className="w-full accent-destructive" />
            <span className="font-mono text-sm text-foreground">{missedPayments} payment{missedPayments === 1 ? "" : "s"} (assumption)</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {lateFeeOverride !== "" && <div className="bg-background border border-border p-3"><p className="font-mono text-[10px] text-muted-foreground uppercase">Late Fees</p>
            <p className="font-mono text-lg font-bold text-destructive">{formatCurrency(lateFeeTotal, currencyCode)}</p></div>}
          {penaltyIncrease > 0 && <div className="bg-background border border-border p-3"><p className="font-mono text-[10px] text-muted-foreground uppercase">Penalty APR Increase</p>
            <p className="font-mono text-lg font-bold text-destructive">{formatCurrency(penaltyIncrease, currencyCode)}</p></div>}
          <div className="bg-background border border-border p-3"><p className="font-mono text-[10px] text-muted-foreground uppercase">Scenario Total</p>
            <p className="font-mono text-lg font-bold text-destructive">{formatCurrency(worstCaseTotal, currencyCode)}</p>
            <p className="font-mono text-[10px] text-destructive/70">+{increasePercent.toFixed(1)}% over extracted total</p>
            {lateFeeOverride === "" && <p className="font-mono text-[10px] text-muted-foreground">Late fees excluded until an amount is entered.</p>}</div>
        </div>
      </div>
    </motion.div>
  );
}
