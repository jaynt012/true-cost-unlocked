import type { ImportedSourcePage, SourceBoundingBox, SourceTextSpan } from "./analysisContext";

export interface DocumentImportResult {
  text: string;
  pages: ImportedSourcePage[];
  spans: SourceTextSpan[];
}

export interface DocumentImportProgress { page: number; pageCount: number; phase: "reading" | "ocr" }
export interface DocumentImportOptions { onProgress?: (progress: DocumentImportProgress) => void }

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const LOW_CONFIDENCE = 65;
const SUPPORTED_IMAGE = /^image\/(?:png|jpeg|webp|tiff|bmp)$/i;

interface Fragment { text: string; x: number; y: number; width: number; height: number; confidence: number; box: SourceBoundingBox }

function validateFile(file: File): "pdf" | "image" {
  if (file.size > MAX_BYTES) throw new Error("File is larger than the 20 MB limit.");
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (SUPPORTED_IMAGE.test(file.type) || /\.(?:png|jpe?g|webp|tiff?|bmp)$/i.test(file.name)) return "image";
  throw new Error("Choose a PDF, PNG, JPEG, WebP, TIFF, or BMP file.");
}

function joinFragments(fragments: Fragment[], page: number, offset: number, gapThreshold: number): { text: string; spans: SourceTextSpan[] } {
  const rows: Fragment[][] = [];
  for (const fragment of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate[0].y - fragment.y) <= Math.max(3, Math.min(candidate[0].height, fragment.height) * 0.55));
    if (!row) { row = []; rows.push(row); }
    row.push(fragment);
  }
  rows.sort((a, b) => a[0].y - b[0].y);
  let text = "";
  const spans: SourceTextSpan[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let previous: Fragment | null = null;
    for (const fragment of row) {
      const gap = previous ? fragment.x - (previous.x + previous.width) : 0;
      const separator = previous ? gap > gapThreshold ? "\t" : " " : "";
      text += separator;
      const start = offset + text.length;
      text += fragment.text;
      spans.push({ start, end: offset + text.length, page, box: fragment.box });
      previous = fragment;
    }
    text += "\n";
  }
  return { text: text.trimEnd(), spans };
}

async function readImage(file: File, pageNumber = 1, onProgress?: DocumentImportOptions["onProgress"]): Promise<DocumentImportResult> {
  onProgress?.({ page: pageNumber, pageCount: 1, phase: "ocr" });
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the image for local OCR.");
  context.drawImage(image, 0, 0);
  image.close();
  const worker = await (await import("tesseract.js")).createWorker("eng");
  try {
    const recognized = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const words = (recognized.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)));
    const fragments: Fragment[] = words.map((word) => ({
      text: word.text,
      x: word.bbox.x0,
      y: word.bbox.y0,
      width: word.bbox.x1 - word.bbox.x0,
      height: word.bbox.y1 - word.bbox.y0,
      confidence: word.confidence,
      box: { x: word.bbox.x0 / canvas.width, y: word.bbox.y0 / canvas.height,
        width: (word.bbox.x1 - word.bbox.x0) / canvas.width, height: (word.bbox.y1 - word.bbox.y0) / canvas.height },
    }));
    const joined = joinFragments(fragments, pageNumber, 0, canvas.width * 0.012);
    const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : recognized.data.confidence;
    return { text: joined.text, pages: [{ page: pageNumber, confidence, isOCR: true }], spans: joined.spans };
  } finally {
    await worker.terminate();
  }
}

async function readPdf(file: File, options: DocumentImportOptions): Promise<DocumentImportResult> {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const pdfWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > MAX_PAGES) { await loadingTask.destroy(); throw new Error("PDF has more than the 30-page limit."); }
  let ocrWorker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
  let text = "";
  const pages: ImportedSourcePage[] = [];
  const spans: SourceTextSpan[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      options.onProgress?.({ page: pageNumber, pageCount: pdf.numPages, phase: "reading" });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item && Boolean(item.str.trim()));
      const fragments: Fragment[] = items.map((item) => {
        const x = item.transform[4];
        const y = viewport.height - item.transform[5];
        const height = Math.abs(item.height || item.transform[3] || 10);
        return { text: item.str, x, y, width: item.width, height, confidence: 100,
          box: { x: x / viewport.width, y: y / viewport.height, width: item.width / viewport.width, height: height / viewport.height } };
      });
      if (fragments.reduce((sum, item) => sum + item.text.length, 0) < 20) {
        options.onProgress?.({ page: pageNumber, pageCount: pdf.numPages, phase: "ocr" });
        const renderScale = 1.75;
        const renderViewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error(`Page ${pageNumber} could not be rendered for local OCR.`);
        await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
        ocrWorker ??= await (await import("tesseract.js")).createWorker("eng");
        const recognized = await ocrWorker.recognize(canvas, {}, { text: true, blocks: true });
        const words = (recognized.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)));
        const ocrFragments: Fragment[] = words.map((word) => ({ text: word.text, x: word.bbox.x0, y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0, confidence: word.confidence,
          box: { x: word.bbox.x0 / canvas.width, y: word.bbox.y0 / canvas.height,
            width: (word.bbox.x1 - word.bbox.x0) / canvas.width, height: (word.bbox.y1 - word.bbox.y0) / canvas.height } }));
        const joined = joinFragments(ocrFragments, pageNumber, text.length + (text ? 2 : 0), canvas.width * 0.012);
        text += (text ? "\n\n" : "") + joined.text;
        spans.push(...joined.spans);
        pages.push({ page: pageNumber, confidence: words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : recognized.data.confidence, isOCR: true });
      } else {
        const joined = joinFragments(fragments, pageNumber, text.length + (text ? 2 : 0), 24);
        text += (text ? "\n\n" : "") + joined.text;
        spans.push(...joined.spans);
        pages.push({ page: pageNumber, confidence: 100, isOCR: false });
      }
      page.cleanup();
    }
  } finally {
    await ocrWorker?.terminate();
    await loadingTask.destroy();
  }
  return { text, pages, spans };
}

export async function importDocument(file: File, options: DocumentImportOptions = {}): Promise<DocumentImportResult> {
  const kind = validateFile(file);
  const result = kind === "pdf" ? await readPdf(file, options) : await readImage(file, 1, options.onProgress);
  if (!result.text.trim()) throw new Error("No readable text was found. Try a clearer scan or paste the document text.");
  return result;
}

export const documentImportLimits = { maxBytes: MAX_BYTES, maxPages: MAX_PAGES, lowConfidence: LOW_CONFIDENCE } as const;

