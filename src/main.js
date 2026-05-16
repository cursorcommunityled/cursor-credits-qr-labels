// UI orchestration: reads a one-column CSV and generates the PDF locally.
// No files are uploaded or written to a server.

import { parseUrlsFromCsv } from './parseCSV.js';
import { generateLabelPdf } from './generatePDF.js';

const DEFAULT_LABEL_TEXT = 'Cursor credits';
const DEFAULT_LOGO_URL = '/logo.svg';
const MAX_LABEL_TEXT_LENGTH = 28;
const MAX_LOGO_BYTES = 512 * 1024;
const ALLOWED_LOGO_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const ALLOWED_LOGO_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);

const state = {
  urls: null,
  lastDownloadUrl: null,
  logoObjectUrl: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  csvInput: $('csv-input'),
  labelTextInput: $('label-text-input'),
  logoInput: $('logo-input'),
  customizeResult: $('customize-result'),
  csvResult: $('csv-result'),
  generateBtn: $('generate-btn'),
  progress: $('progress'),
  downloadLink: $('download-link'),
};

function setStatus(node, message, kind = '') {
  node.className = `result ${kind}`;
  node.textContent = message;
}

function refreshGenerateButton() {
  els.generateBtn.disabled = !(state.urls && state.urls.length > 0);
}

function resetGeneratedPdf() {
  els.downloadLink.hidden = true;
  if (state.lastDownloadUrl) {
    URL.revokeObjectURL(state.lastDownloadUrl);
    state.lastDownloadUrl = null;
  }
}

function revokeLogoObjectUrl() {
  if (state.logoObjectUrl) {
    URL.revokeObjectURL(state.logoObjectUrl);
    state.logoObjectUrl = null;
  }
}

function getLabelText() {
  const text = els.labelTextInput.value.trim();
  if (!text) {
    throw new Error('Label text is required.');
  }
  if (text.length > MAX_LABEL_TEXT_LENGTH) {
    throw new Error(`Label text must be ${MAX_LABEL_TEXT_LENGTH} characters or fewer.`);
  }
  return text;
}

function isAllowedLogoFile(file) {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return ALLOWED_LOGO_TYPES.has(file.type) || ALLOWED_LOGO_EXTENSIONS.has(extension);
}

els.csvInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  resetGeneratedPdf();
  setStatus(els.progress, '');
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

els.labelTextInput.addEventListener('input', () => {
  resetGeneratedPdf();
  setStatus(els.customizeResult, '');
});

els.logoInput.addEventListener('change', (e) => {
  resetGeneratedPdf();
  setStatus(els.customizeResult, '');

  const file = e.target.files?.[0];
  revokeLogoObjectUrl();
  if (!file) {
    setStatus(els.customizeResult, 'Using the default Cursor logo.');
    return;
  }

  if (!isAllowedLogoFile(file)) {
    els.logoInput.value = '';
    setStatus(els.customizeResult, 'Logo must be an SVG, PNG, JPG, or WebP image.', 'err');
    return;
  }

  if (file.size > MAX_LOGO_BYTES) {
    els.logoInput.value = '';
    setStatus(els.customizeResult, 'Logo file must be 512 KB or smaller.', 'err');
    return;
  }

  state.logoObjectUrl = URL.createObjectURL(file);
  setStatus(els.customizeResult, `Using custom logo: ${file.name}`, 'ok');
});

els.generateBtn.addEventListener('click', async () => {
  if (!state.urls) return;
  els.generateBtn.disabled = true;
  resetGeneratedPdf();
  setStatus(els.progress, 'Generating QR codes…');
  try {
    const bytes = await generateLabelPdf({
      urls: state.urls,
      labelText: getLabelText(),
      logoUrl: state.logoObjectUrl ?? DEFAULT_LOGO_URL,
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
    setStatus(
      els.progress,
      `Done. ${state.urls.length} QR code label${state.urls.length === 1 ? '' : 's'} ready.`,
      'ok'
    );
  } catch (err) {
    console.error(err);
    setStatus(els.progress, err.message ?? String(err), 'err');
  } finally {
    refreshGenerateButton();
  }
});

els.labelTextInput.maxLength = MAX_LABEL_TEXT_LENGTH;
els.labelTextInput.value = DEFAULT_LABEL_TEXT;
window.addEventListener('beforeunload', revokeLogoObjectUrl);
refreshGenerateButton();
