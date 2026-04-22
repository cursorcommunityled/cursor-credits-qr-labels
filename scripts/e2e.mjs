// End-to-end smoke test: run detectTemplate + generateLabelPdf against the
// reference template and CSV, write the PDF to disk, and spot-check it.
//
// Run: node scripts/e2e.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REFERENCE = path.resolve(ROOT, 'reference');

// Minimal DOM stubs so pdfjs-dist's non-legacy build can load in Node.
class DOMMatrixStub {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  multiplySelf(other) { return this; }
  translateSelf() { return this; }
  scaleSelf() { return this; }
  invertSelf() { return this; }
}
globalThis.DOMMatrix = globalThis.DOMMatrix ?? DOMMatrixStub;
globalThis.Path2D = globalThis.Path2D ?? class { addPath() {} closePath() {} };
globalThis.ImageData = globalThis.ImageData ?? class {};

// Configure pdfjs worker before we import the detector.
const { configurePdfWorker, detectTemplate } = await import(
  pathToFileURL(path.join(ROOT, 'src/detectTemplate.js')).href
);
configurePdfWorker(
  pathToFileURL(
    path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  ).href
);

const { parseUrlsFromCsv } = await import(
  pathToFileURL(path.join(ROOT, 'src/parseCSV.js')).href
);
const { generateLabelPdf } = await import(
  pathToFileURL(path.join(ROOT, 'src/generatePDF.js')).href
);

const templatePath = path.join(REFERENCE, '8.5x11in-30up.pdf');
const csvPath      = path.join(REFERENCE, 'input.csv');
const outPath      = path.join(ROOT, 'e2e-output.pdf');

console.log('Loading', templatePath);
const templateBytes = await readFile(templatePath);
const template = await detectTemplate(templateBytes.buffer.slice(
  templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength
));
console.log('Template detected:', {
  pageSize: [template.pageWidth, template.pageHeight],
  label: [template.labelWidth, template.labelHeight],
  grid: `${template.rows} × ${template.cols}`,
  perPage: template.labelsPerPage,
});

const csvText = await readFile(csvPath, 'utf8');
const urls = parseUrlsFromCsv(csvText);
console.log(`Parsed ${urls.length} URLs; sample:`, urls.slice(0, 3));

const t0 = Date.now();
const bytes = await generateLabelPdf({
  template,
  urls: urls.slice(0, 30), // one full page for speed
  labelText: 'Cursor credits',
  onProgress: (msg, r) => console.log(`  ${msg} (${Math.round(r * 100)}%)`),
});
console.log(`Generated ${bytes.length.toLocaleString()} bytes in ${Date.now() - t0}ms`);

await writeFile(outPath, bytes);
console.log('Wrote:', outPath);
