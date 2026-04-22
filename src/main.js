// UI orchestration: wires the three inputs (template PDF, CSV, label text) to
// the detection / generation pipeline. All processing runs in the browser.

import { detectTemplate, configurePdfWorker } from './detectTemplate.js';
import { parseUrlsFromCsv } from './parseCSV.js';
import { generateLabelPdf } from './generatePDF.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

configurePdfWorker(pdfWorkerUrl);

const state = {
  template: null,     // result of detectTemplate()
  urls: null,         // string[]
  labelText: 'Cursor credits',
  lastDownloadUrl: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  templateInput: $('template-input'),
  templateResult: $('template-result'),
  csvInput: $('csv-input'),
  csvResult: $('csv-result'),
  textInput: $('text-input'),
  generateBtn: $('generate-btn'),
  progress: $('progress'),
  downloadLink: $('download-link'),
};

function setStatus(node, message, kind = '') {
  node.className = `result ${kind}`;
  node.textContent = message;
}

function refreshGenerateButton() {
  const ready = state.template && state.urls && state.urls.length > 0 && state.labelText.trim();
  els.generateBtn.disabled = !ready;
}

els.templateInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus(els.templateResult, 'Analyzing template…');
  try {
    const bytes = await file.arrayBuffer();
    const template = await detectTemplate(bytes);
    state.template = template;
    setStatus(
      els.templateResult,
      `Detected ${template.rows}×${template.cols} grid (${template.labelsPerPage} labels/page), ` +
      `each ${(template.labelWidth / 72).toFixed(2)}" × ${(template.labelHeight / 72).toFixed(2)}".`,
      'ok'
    );
  } catch (err) {
    console.error(err);
    state.template = null;
    setStatus(els.templateResult, err.message ?? String(err), 'err');
  }
  refreshGenerateButton();
});

els.csvInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus(els.csvResult, 'Reading URLs…');
  try {
    const text = await file.text();
    const urls = parseUrlsFromCsv(text);
    if (urls.length === 0) throw new Error('No URLs found in that file.');
    state.urls = urls;
    setStatus(els.csvResult, `Loaded ${urls.length} URL${urls.length === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    console.error(err);
    state.urls = null;
    setStatus(els.csvResult, err.message ?? String(err), 'err');
  }
  refreshGenerateButton();
});

els.textInput.addEventListener('input', (e) => {
  state.labelText = e.target.value;
  refreshGenerateButton();
});

els.generateBtn.addEventListener('click', async () => {
  if (!state.template || !state.urls) return;
  els.generateBtn.disabled = true;
  els.downloadLink.hidden = true;
  if (state.lastDownloadUrl) {
    URL.revokeObjectURL(state.lastDownloadUrl);
    state.lastDownloadUrl = null;
  }
  setStatus(els.progress, 'Generating QR codes…');
  try {
    const bytes = await generateLabelPdf({
      template: state.template,
      urls: state.urls,
      labelText: state.labelText.trim(),
      onProgress: (msg, ratio) => {
        setStatus(els.progress, `${msg} (${Math.round(ratio * 100)}%)`);
      },
    });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    state.lastDownloadUrl = url;
    els.downloadLink.href = url;
    els.downloadLink.download = 'qr_labels.pdf';
    els.downloadLink.hidden = false;
    setStatus(els.progress, `Done. ${state.urls.length} label${state.urls.length === 1 ? '' : 's'} ready.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(els.progress, err.message ?? String(err), 'err');
  } finally {
    refreshGenerateButton();
  }
});

refreshGenerateButton();
