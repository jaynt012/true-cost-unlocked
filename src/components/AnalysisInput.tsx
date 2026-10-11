import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Sparkles, Play, RotateCcw, Cpu, Upload, LoaderCircle, AlertCircle } from "lucide-react";
import { DEMO_TEXT, detectCurrency, type SupportedCurrency } from "@/lib/financial";
import { extractValuesFromText } from "@/lib/analyzeLocally";
import { documentImportLimits, importDocument, type DocumentImportProgress, type DocumentImportResult } from "@/lib/documentImport";
import rules from "@/data/analysisRules.json";

interface AnalysisInputProps {
  onAnalyze: (text: string, amount: number | null, rate: number | null, duration: number | null, currency: SupportedCurrency | null, source?: DocumentImportResult | null) => void | Promise<void>;
  isLoading: boolean;
  evidenceSelection?: [number, number] | null;
  onInputChange?: () => void;
}

export function AnalysisInput({ onAnalyze, isLoading, evidenceSelection, onInputChange }: AnalysisInputProps) {
  const [text, setText] = useState("");
  const [extractionText, setExtractionText] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<SupportedCurrency | null>(null);
  const [source, setSource] = useState<DocumentImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DocumentImportProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const importVersion = useRef(0);
  useEffect(() => {
    const delay = (rules as unknown as { inputExtractionDebounceMs?: number }).inputExtractionDebounceMs ?? 180;
    const timer = setTimeout(() => setExtractionText(text), delay);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => () => { importVersion.current += 1; }, []);
  const extractedValues = useMemo(() => extractValuesFromText(extractionText), [extractionText]);
  const extracting = extractionText !== text;
  const detectedCurrency = useMemo(() => detectCurrency(text), [text]);
  const autoFilled = !extracting && ((amount === null && extractedValues.loanAmount !== null && !extractedValues.principalField.needsReview)
    || (rate === null && extractedValues.interestRate !== null && !extractedValues.rateField.needsReview)
    || (duration === null && extractedValues.tenureMonths !== null && !extractedValues.termField.needsReview));
  const invalidate = () => {
    importVersion.current += 1;
    setIsImporting(false);
    setProgress(null);
    setImportError(null);
    onInputChange?.();
  };
  const clearOverrides = () => { setAmount(null); setRate(null); setDuration(null); setCurrencyOverride(null); };
  const numericOverride = (value: string | null) => value === null || value.trim() === "" ? null : Number(value);
  const invalidOverrides = [amount, rate, duration].some((value, index) => value !== null && value.trim() !== "" && (!Number.isFinite(Number(value)) || (index === 1 ? Number(value) < 0 : Number(value) <= 0)));

  const loadDemo = () => {
    invalidate();
    setText(DEMO_TEXT);
    clearOverrides();
    setSource(null);
    setImportError(null);
  };

  const reset = () => {
    invalidate();
    setText("");
    clearOverrides();
    setSource(null);
    setImportError(null);
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    invalidate();
    const version = importVersion.current;
    setIsImporting(true);
    setImportError(null);
    setProgress(null);
    try {
      const imported = await importDocument(file, { onProgress: (next) => { if (version === importVersion.current) setProgress(next); } });
      if (version !== importVersion.current) return;
      setText(imported.text);
      clearOverrides();
      setSource(imported);
    } catch (error) {
      if (version !== importVersion.current) return;
      setImportError(error instanceof Error ? error.message : "The document could not be read in this browser.");
    } finally {
      if (version !== importVersion.current) return;
      setIsImporting(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // Only require text — fields are optional
  const canAnalyze = text.trim().length > 0 && !invalidOverrides && !isImporting;
  const calculatorType = (rules.calculatorRegistry.documentTypes as Record<string, string>)[extractedValues.docType.type];
  const revolving = !extracting && calculatorType === "revolving";

  useEffect(() => {
    if (!evidenceSelection || !textInput.current) return;
    textInput.current.focus();
    textInput.current.setSelectionRange(Math.min(evidenceSelection[0], text.length), Math.min(evidenceSelection[1], text.length));
  }, [evidenceSelection, text]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="terminal-card p-6"
    >
      <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
        <FileText className="w-5 h-5 text-primary" />
        <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">DOCUMENT INPUT</span>
      </div>

      <div className="space-y-5">
        <input ref={fileInput} aria-label="Upload PDF or image" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/tiff,image/bmp,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void loadFile(file); }} />
        <div onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => {
          event.preventDefault(); setDragActive(false); void loadFile(event.dataTransfer.files?.[0]);
        }} className={`border border-dashed p-4 transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3"><Upload className="mt-0.5 h-4 w-4 text-primary" /><div><p className="font-mono text-xs text-foreground">Drop a PDF or image to extract text locally</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">PDFs and scanned pages · up to 20 MB and 30 pages</p></div></div>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={isImporting} className="interactive-button border border-primary/30 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-primary disabled:opacity-50">Choose file</button>
          </div>
          {isImporting && <p role="status" className="mt-3 flex items-center gap-2 font-mono text-[10px] text-primary"><LoaderCircle className="h-3 w-3 animate-spin" />{progress?.phase === "ocr" ? "Running on-device OCR" : "Reading document"}{progress ? ` · page ${progress.page} of ${progress.pageCount}` : "…"}</p>}
          {importError && <p role="alert" className="mt-3 flex items-center gap-2 font-mono text-[10px] text-destructive"><AlertCircle className="h-3 w-3" />{importError}</p>}
          {source?.pages.some((page) => page.isOCR && page.confidence < documentImportLimits.lowConfidence) && <div role="status" className="mt-3 border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[10px] text-amber-600">Low OCR confidence on page(s) {source.pages.filter((page) => page.isOCR && page.confidence < documentImportLimits.lowConfidence).map((page) => `${page.page} (${Math.round(page.confidence)}%)`).join(", ")}. Check and edit the extracted text before analysis.</div>}
          <p className="mt-3 font-mono text-[9px] text-muted-foreground">Privacy: PDF/image bytes stay in this browser.</p>
        </div>
        <div>
          <label htmlFor="agreement-text" className="block font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2">
            Financial / Legal Text <span className="text-destructive">*</span>
          </label>
          <textarea
            id="agreement-text"
            ref={textInput}
            value={text}
            onChange={(e) => {
              invalidate();
              setText(e.target.value);
              clearOverrides();
              setSource((current) => current && e.target.value === current.text ? current : null);
            }}
            rows={6}
            placeholder="Paste loan agreement, credit card terms, BNPL contract... Values will be auto-extracted."
            className="w-full bg-background border border-border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none transition-colors"
          />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              OPTIONAL OVERRIDES
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/60">— leave empty to auto-extract</span>
            {autoFilled && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-primary border border-primary/30 px-2 py-0.5 ml-auto">
                <Cpu className="w-3 h-3" />
                AUTO-EXTRACTED FROM AGREEMENT
              </span>
            )}
            {extracting && <span role="status" className="font-mono text-[9px] text-muted-foreground ml-auto">Updating extracted fields…</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="agreement-currency" className="block font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2">Currency</label>
              <select
                id="agreement-currency"
                value={currencyOverride ?? "AUTO"}
                onChange={(e) => { onInputChange?.(); setCurrencyOverride(e.target.value === "AUTO" ? null : e.target.value as SupportedCurrency); }}
                className="w-full bg-background border border-border px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:border-primary/40 transition-colors appearance-none"
              >
                <option value="AUTO">AUTO ({detectedCurrency ?? "USD fallback"})</option>
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹ / Rs)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
                <option value="CAD">CAD (C$)</option>
                <option value="AUD">AUD (A$)</option>
                <option value="SGD">SGD (S$)</option>
                <option value="AED">AED (د.إ)</option>
              </select>
            </div>
            {[
              { id: "principal", label: "Loan Amount", override: amount, extracted: extractedValues.principalField, set: setAmount, hidden: revolving },
              { id: "rate", label: extractedValues.interestRateIsConditional ? "Conditional Deferred APR (%)" : "Interest Rate (%)", override: rate, extracted: extractedValues.rateField, set: setRate, hidden: false },
              { id: "term", label: "Duration (months)", override: duration, extracted: extractedValues.termField, set: setDuration, hidden: revolving },
            ].filter((field) => !field.hidden).map((field) => (
              <div key={field.id}>
                <label htmlFor={`agreement-${field.id}`} className="block font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-2">
                  {field.label}
                </label>
                <input
                  id={`agreement-${field.id}`}
                  type="number"
                  step="any"
                  min={field.id === "rate" ? 0 : Number.MIN_VALUE}
                  value={field.override ?? (!extracting && !field.extracted.needsReview ? field.extracted.value ?? "" : "")}
                  onChange={(e) => { onInputChange?.(); field.set(e.target.value); }}
                  placeholder={!extracting && field.extracted.needsReview ? "Unverified — check evidence" : "Auto-extract"}
                  className="w-full bg-background border border-border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-colors"
                />
                {field.override !== null ? <button type="button" className="mt-1 font-mono text-[9px] text-primary" onClick={() => { onInputChange?.(); field.set(null); }}>Use automatic extraction</button>
                  : !extracting && field.extracted.needsReview ? <p className="mt-1 font-mono text-[9px] text-amber-600">Unverified{field.extracted.alternatives.length ? ` · candidates: ${[...new Set(field.extracted.alternatives.map((candidate) => candidate.value))].slice(0, 4).join(", ")}` : " · check the document"}</p> : null}
              </div>
            ))}
          </div>
          {invalidOverrides && <p role="alert" className="mt-2 font-mono text-[10px] text-destructive">Enter a positive amount and duration, and a rate of zero or greater.</p>}
          {revolving && <p className="mt-2 font-mono text-[10px] text-muted-foreground">Revolving credit has no fixed loan principal or repayment term.</p>}
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={!canAnalyze || isLoading}
            onClick={() => { void onAnalyze(text, numericOverride(amount), numericOverride(rate), numericOverride(duration), currencyOverride, source); }}
            className="interactive-button flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-mono text-[11px] tracking-widest uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-all terminal-glow"
          >
            <Play className="w-4 h-4" />
            {isLoading ? "PROCESSING..." : "ANALYZE"}
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={loadDemo}
            className="interactive-button flex items-center gap-2 px-6 py-3 border border-primary/30 text-primary font-mono text-[11px] tracking-widest uppercase hover:bg-primary/5 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            LOAD DEMO
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={reset}
            className="interactive-button flex items-center gap-2 px-5 py-3 text-muted-foreground hover:text-foreground font-mono text-[11px] tracking-widest uppercase transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            RESET
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
