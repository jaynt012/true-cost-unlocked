import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Shield, ArrowLeft, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { AnalysisInput } from "@/components/AnalysisInput";
import { AnalysisPanels } from "@/components/AnalysisPanels";
import { ThemeToggle } from "@/components/ThemeToggle";
import { analyzeLocally } from "@/lib/analyzeLocally";
import { freezeAnalysisContext, type AIExtractedFields, type AnalysisContext } from "@/lib/analysisContext";
import { enhanceAnalysisWithAI, extractFieldsWithAI, isAIEnhancementConfigured } from "@/lib/analyzeWithAI";
import type { AIEnhancementStatus } from "@/components/AnalysisPanels";
import type { SupportedCurrency } from "@/lib/financial";
import rules from "@/data/analysisRules.json";

export default function Analyze() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisContext | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [evidenceSelection, setEvidenceSelection] = useState<[number, number] | null>(null);
  const [aiEnhancementStatus, setAIEnhancementStatus] = useState<AIEnhancementStatus>("unconfigured");
  const aiRequestVersion = useRef(0);
  const analysisRequestVersion = useRef(0);
  const aiFallbackRef = useRef<AIExtractedFields | undefined>(undefined);
  const extractionRequest = useRef<AbortController | null>(null);
  const insightRequest = useRef<AbortController | null>(null);
  useEffect(() => () => {
    analysisRequestVersion.current += 1;
    aiRequestVersion.current += 1;
    extractionRequest.current?.abort();
    insightRequest.current?.abort();
  }, []);

  const invalidateAnalysis = () => {
    analysisRequestVersion.current += 1;
    aiRequestVersion.current += 1;
    extractionRequest.current?.abort();
    insightRequest.current?.abort();
    aiFallbackRef.current = undefined;
    setResult(null);
    setEvidenceSelection(null);
    setAnalysisError(null);
    setFallbackMessage(null);
    setIsLoading(false);
    setAIEnhancementStatus("unconfigured");
  };

  const requestAIEnhancement = (analysis: AnalysisContext) => {
    const requestVersion = ++aiRequestVersion.current;
    insightRequest.current?.abort();
    if (!isAIEnhancementConfigured()) {
      setAIEnhancementStatus("unconfigured");
      return;
    }

    setAIEnhancementStatus("loading");
    const controller = new AbortController();
    insightRequest.current = controller;
    void enhanceAnalysisWithAI(analysis, { signal: controller.signal })
      .then((enhancement) => {
        if (aiRequestVersion.current !== requestVersion) return;
        setResult((current) => current?.id === analysis.id
          ? freezeAnalysisContext({ ...current, ...enhancement }) as AnalysisContext
          : current);
        setAIEnhancementStatus("ready");
      })
      .catch(() => {
        if (aiRequestVersion.current !== requestVersion) return;
        setAIEnhancementStatus("error");
      });
  };

  const withSourceLocations = (analysis: AnalysisContext, source?: { pages: AnalysisContext["sourcePages"]; spans: AnalysisContext["sourceSpans"] } | null) => {
    if (!source?.pages || !source.spans) return analysis;
    const locate = <T extends AnalysisContext["findings"][number]>(finding: T): T => {
      const [start, end] = finding.clauseSpan;
      const overlaps = source.spans!.filter((span) => span.start < end && span.end > start);
      if (!overlaps.length) return finding;
      const byPage = new Map<number, typeof overlaps>();
      overlaps.forEach((span) => byPage.set(span.page, [...(byPage.get(span.page) ?? []), span]));
      const [page, matches] = [...byPage.entries()].sort((left, right) => right[1].length - left[1].length)[0];
      const x0 = Math.min(...matches.map((span) => span.box.x));
      const y0 = Math.min(...matches.map((span) => span.box.y));
      const x1 = Math.max(...matches.map((span) => span.box.x + span.box.width));
      const y1 = Math.max(...matches.map((span) => span.box.y + span.box.height));
      return { ...finding, sourceLocation: { page, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } } };
    };
    const findings = analysis.findings.map(locate);
    return freezeAnalysisContext({ ...analysis, findings,
      protections: findings.filter((finding) => finding.category === "protection"),
      conditionalTerms: findings.filter((finding) => finding.category === "conditional_term"),
      sourcePages: source.pages, sourceSpans: source.spans }) as AnalysisContext;
  };

  const handleAnalyze = async (text: string, amount: number | null, rate: number | null, duration: number | null, currency: SupportedCurrency | null, importedSource?: { pages: AnalysisContext["sourcePages"]; spans: AnalysisContext["sourceSpans"] } | null) => {
    invalidateAnalysis();
    const requestVersion = ++analysisRequestVersion.current;
    const controller = new AbortController();
    extractionRequest.current = controller;
    setIsLoading(true);
    setAnalysisError(null);
    setResult(null);
    try {
      let local = analyzeLocally(text, amount, rate, duration, currency);
      let analysis = withSourceLocations(local, importedSource);
      setResult(analysis);
      const fallbackFields = (rules as unknown as { aiExtraction?: { fallbackFieldsByDocumentType?: Record<string, Array<keyof AIExtractedFields>> } }).aiExtraction?.fallbackFieldsByDocumentType?.[local.docType.type] ?? [];
      const fieldMissing: Record<keyof AIExtractedFields, boolean> = {
        principal: amount == null && (local.principalField.value === null || local.principalField.needsReview),
        annualAPR: rate == null && (local.rateField.value === null || local.rateField.needsReview || local.rateField.rateRole !== "base"),
        termMonths: duration == null && (local.termField.value === null || local.termField.needsReview),
        payment: local.statedEMI.value === null && !local.installmentSchedule,
      };
      if (isAIEnhancementConfigured() && fallbackFields.some((field) => fieldMissing[field])) {
        setFallbackMessage("Checking unresolved fields with OpenRouter. Local analysis is available below.");
        try {
          const aiFallback = await extractFieldsWithAI(text, { signal: controller.signal });
          if (requestVersion !== analysisRequestVersion.current) return;
          aiFallbackRef.current = aiFallback;
          local = analyzeLocally(text, amount, rate, duration, currency, aiFallback);
          analysis = withSourceLocations(local, importedSource);
          setResult(analysis);
          setFallbackMessage("AI extraction checked the unresolved fields. Only values supported by document evidence and numeric checks were applied.");
        } catch {
          if (requestVersion !== analysisRequestVersion.current) return;
          setFallbackMessage("AI field extraction is unavailable. Local analysis is available; review the unresolved fields or enter overrides.");
        }
      }
      if (requestVersion !== analysisRequestVersion.current) return;
      setResult(analysis);
      requestAIEnhancement(analysis);
    } catch (error) {
      if (requestVersion !== analysisRequestVersion.current) return;
      setAnalysisError(error instanceof Error ? error.message : "The document could not be analyzed.");
    } finally {
      if (requestVersion !== analysisRequestVersion.current) return;
      setIsLoading(false);
    }
  };

  const selectPrincipal = (amount: number) => {
    if (!result) return;
    // A manual selection supersedes any still-running extraction fallback.
    analysisRequestVersion.current += 1;
    extractionRequest.current?.abort();
    setFallbackMessage(null);
    setEvidenceSelection(null);
    setIsLoading(false);
    const rateOverride = result.rateField.source === "User override" ? result.rateField.value : null;
    const durationOverride = result.termField.source === "User override" ? result.termField.value : null;
    const next = withSourceLocations(analyzeLocally(result.rawText, amount, rateOverride, durationOverride, result.currency, aiFallbackRef.current),
      result.sourcePages && result.sourceSpans ? { pages: result.sourcePages, spans: result.sourceSpans } : null);
    setResult(next);
    requestAIEnhancement(next);
  };

  return (
    <div className="page-enter min-h-screen bg-background grid-bg scanline">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <Link to="/" className="interactive-button flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="w-4 h-4" /> BACK
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary" />
              <span className="font-display text-lg font-bold text-foreground">TRUE COST</span>
              <span className="font-mono text-[10px] text-primary/60 border border-primary/20 px-2 py-0.5">ANALYZER</span>
            </div>
          </div>
          <div className="flex items-center gap-4"><ThemeToggle /><div className="flex items-center gap-2">
            <span className="status-dot animate-pulse-dot" /><span className="font-mono text-[10px] text-muted-foreground tracking-widest">ENGINE ACTIVE</span>
          </div></div>
        </motion.header>

        <AnalysisInput onAnalyze={handleAnalyze} onInputChange={invalidateAnalysis} isLoading={isLoading} evidenceSelection={evidenceSelection} />
        <div className="mt-8 space-y-4">
          {fallbackMessage && <p role="status" className="border border-primary/20 bg-primary/5 px-4 py-3 font-mono text-xs text-muted-foreground">{fallbackMessage}</p>}
          {analysisError && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 px-4 py-3 border border-destructive/30 bg-destructive/5">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" /><p className="font-mono text-xs text-destructive">{analysisError}</p>
          </motion.div>}
          {result && (
            <AnalysisPanels key={result.id} context={result} onPrincipalSelect={selectPrincipal} onEvidenceSelect={setEvidenceSelection} aiEnhancementStatus={aiEnhancementStatus} />
          )}
        </div>
      </div>
    </div>
  );
}
