// End-to-end smoke test: parse the reference CSV, generate one page of labels,
// write the PDF to disk, and spot-check it.
//
// Run: node scripts/e2e.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REFERENCE = path.resolve(ROOT, 'reference');

const { parseUrlsFromCsv } = await import(
  pathToFileURL(path.join(ROOT, 'src/parseCSV.js')).href
);
const { generateLabelPdf } = await import(
  pathToFileURL(path.join(ROOT, 'src/generatePDF.js')).href
);

const csvPath = path.join(REFERENCE, 'input.csv');
const outPath = path.join(ROOT, 'e2e-output.pdf');

const csvText = await readFile(csvPath, 'utf8');
const urls = parseUrlsFromCsv(csvText);
console.log(`Parsed ${urls.length} URLs; sample:`, urls.slice(0, 3));

const t0 = Date.now();
const bytes = await generateLabelPdf({
  urls: urls.slice(0, 30), // one full page for speed
  labelText: 'Cursor credits',
  logoUrl: null, // Node smoke test skips the browser-only logo overlay.
  onProgress: (msg, r) => console.log(`  ${msg} (${Math.round(r * 100)}%)`),
});
console.log(`Generated ${bytes.length.toLocaleString()} bytes in ${Date.now() - t0}ms`);

await writeFile(outPath, bytes);
console.log('Wrote:', outPath);
