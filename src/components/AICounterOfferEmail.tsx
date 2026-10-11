import { useState } from "react";
import { Check, Copy, Mail, RefreshCw, Send } from "lucide-react";
import TerminalCard from "./TerminalCard";
import { hasActionableFindings, regenerateCounterOfferEmail } from "@/lib/analyzeWithAI";
import type { AnalysisContext } from "@/lib/analysisContext";

interface Props {
  context: AnalysisContext;
}

export function AICounterOfferEmail({ context }: Props) {
  const [email, setEmail] = useState(context.aiCounterOfferEmail ?? "");
  const [isCopied, setIsCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasActionableFindings(context)) return null;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1800);
    } catch {
      setError("Could not copy the email. Select and copy the text manually.");
    }
  };

  const regenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const nextEmail = await regenerateCounterOfferEmail(context);
      if (!nextEmail) throw new Error("No email text was returned.");
      setEmail(nextEmail);
    } catch {
      setError("Could not generate another email. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <TerminalCard title="AI COUNTER-OFFER EMAIL" icon={Mail} delay={0.8} className="border-primary/40">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <p className="font-mono text-[10px] tracking-widest text-primary uppercase">Draft based on terms found in the agreement</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={regenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-border rounded hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
            {isGenerating ? "GENERATING" : "NEW DRAFT"}
          </button>
          <button
            type="button"
            onClick={copyEmail}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-primary/30 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {isCopied ? "COPIED" : "COPY EMAIL"}
          </button>
        </div>
      </div>
      <div className={`bg-background/50 border border-border/50 rounded-md p-4 font-mono text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed ${isGenerating ? "opacity-50" : ""}`}>
        {email}
      </div>
      {error && <p role="status" className="mt-2 font-mono text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground font-mono">
        <Send className="w-3.5 h-3.5 opacity-70" />
        <span>Review and personalize this draft before sending it.</span>
      </div>
    </TerminalCard>
  );
}
