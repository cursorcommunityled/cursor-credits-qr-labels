// Browser port of reference/generate_qr_labels_small.py.
// Build the output PDF entirely in memory: page 1 = printing instructions,
// pages 2+ = fixed 30-up letter-size QR sticker sheets.

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import QRCode from 'qrcode';

const [PAGE_W, PAGE_H] = PageSizes.Letter;

const LABEL_W = 189.0;
const LABEL_H = 72.0;
const COL_LEFTS = [14.0831, 211.5875, 409.0919];
const ROW_TOPS = [
  756.3043, 684.3043, 612.3043, 540.3043, 468.3043,
  396.3043, 324.3043, 252.3043, 180.3044, 108.3044,
];
const LABELS_PER_PAGE = COL_LEFTS.length * ROW_TOPS.length;

const QR_ERROR_LEVEL = 'H';
const QR_PIXELS = 720;
const QR_SIZE_PT = 0.70 * 72;
const EDGE_ROW_COUNT = 2;
const EDGE_QR_TOP_BOTTOM_PAD_PT = 3.0;
const DUPLICATE_QR_GAP_PT = 8.0;
const QR_LEFT_PAD_PT = 6.0;
const TEXT_GAP_PT = 6.0;
const SERIAL_SIZE = 6.5;
const TEXT_FONT = StandardFonts.HelveticaBold;
const BODY_FONT = StandardFonts.Helvetica;

/**
 * @param {object} opts
 * @param {string[]} opts.urls          URLs, one per sticker
 * @param {string} [opts.labelText]     text that appears on every sticker
 * @param {string | null} [opts.logoUrl] optional SVG logo URL for QR center
 * @param {(message: string, ratio: number) => void} [opts.onProgress]
 * @returns {Promise<Uint8Array>}        bytes of the output PDF
 */
export async function generateLabelPdf({
  urls,
  labelText = 'Cursor credits',
  logoUrl = '/logo.svg',
  onProgress,
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`QR code labels - small (${urls.length})`);
  pdfDoc.setCreator('Cursor Credits QR Label Generator');

  const font = await pdfDoc.embedFont(TEXT_FONT);
  const bodyFont = await pdfDoc.embedFont(BODY_FONT);
  const serialFont = bodyFont;

  drawInstructionsPage(pdfDoc, { font, bodyFont, urlCount: urls.length });

  const totalLabelPages = Math.max(1, Math.ceil(urls.length / LABELS_PER_PAGE));
  const textSpace = LABEL_W - QR_LEFT_PAD_PT - QR_SIZE_PT - TEXT_GAP_PT - 2.0;
  const textSize = fitFontSize(font, labelText, textSpace, 6.0, 11.0);

  for (let p = 0; p < totalLabelPages; p++) {
    onProgress?.(`Rendering label page ${p + 1} of ${totalLabelPages}`, (p + 1) / (totalLabelPages + 1));
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const pageUrls = urls.slice(p * LABELS_PER_PAGE, (p + 1) * LABELS_PER_PAGE);

    for (let i = 0; i < pageUrls.length; i++) {
      const url = pageUrls[i];
      const row = Math.floor(i / COL_LEFTS.length);
      const col = i % COL_LEFTS.length;
      const labelLeft = COL_LEFTS[col];
      const labelTop = ROW_TOPS[row];

      const qrPng = await renderQrPng(url, logoUrl);
      const qrImage = await pdfDoc.embedPng(qrPng);

      drawLabel(page, {
        qrImage,
        row,
        labelLeft,
        labelTop,
        font,
        serialFont,
        labelText,
        textSize,
        serialNumber: p * LABELS_PER_PAGE + i + 1,
      });
    }
  }

  onProgress?.('Finalizing PDF…', 1);
  return pdfDoc.save();
}

/* ------------------------- layout helpers ------------------------------- */

function fitFontSize(font, text, maxWidth, minSize = 6, maxSize = 11) {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  return size;
}

function drawLabel(page, {
  qrImage,
  row,
  labelLeft,
  labelTop,
  font,
  serialFont,
  labelText,
  textSize,
  serialNumber,
}) {
  const labelBottom = labelTop - LABEL_H;
  const qrX = labelLeft + QR_LEFT_PAD_PT;
  let textX;
  let effectiveTextSize = textSize;

  if (isEdgeRow(row)) {
    const secondQrX = qrX + QR_SIZE_PT + DUPLICATE_QR_GAP_PT;
    const highQrY = labelTop - EDGE_QR_TOP_BOTTOM_PAD_PT - QR_SIZE_PT;
    const lowQrY = labelBottom + EDGE_QR_TOP_BOTTOM_PAD_PT;
    page.drawImage(qrImage, { x: qrX, y: highQrY, width: QR_SIZE_PT, height: QR_SIZE_PT });
    page.drawImage(qrImage, { x: secondQrX, y: lowQrY, width: QR_SIZE_PT, height: QR_SIZE_PT });
    textX = secondQrX + QR_SIZE_PT + TEXT_GAP_PT;
    effectiveTextSize = fitFontSize(font, labelText, LABEL_W - (textX - labelLeft) - 2.0, 6.0, textSize);
  } else {
    const qrY = labelBottom + (LABEL_H - QR_SIZE_PT) / 2;
    page.drawImage(qrImage, { x: qrX, y: qrY, width: QR_SIZE_PT, height: QR_SIZE_PT });
    textX = qrX + QR_SIZE_PT + TEXT_GAP_PT;
  }

  const textY = labelBottom + LABEL_H / 2 - effectiveTextSize * 0.32;

  page.drawText(labelText, {
    x: textX,
    y: textY,
    size: effectiveTextSize,
    font,
    color: rgb(0, 0, 0),
  });

  drawSerial(page, serialFont, serialNumber, labelLeft, labelBottom);
}

function isEdgeRow(row) {
  return row < EDGE_ROW_COUNT || row >= ROW_TOPS.length - EDGE_ROW_COUNT;
}

function drawSerial(page, font, serialNumber, labelLeft, labelBottom) {
  const text = `#${serialNumber}`;
  const textW = font.widthOfTextAtSize(text, SERIAL_SIZE);
  page.drawText(text, {
    x: labelLeft + LABEL_W - textW - 4.0,
    y: labelBottom + 4.0,
    size: SERIAL_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

/* ----------------------------- QR --------------------------------------- */

async function renderQrPng(url, logoUrl) {
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: QR_ERROR_LEVEL,
    margin: 2,
    width: QR_PIXELS,
    color: { dark: '#000000FF', light: '#FFFFFFFF' },
  });

  const withLogo = await addLogoOverlay(dataUrl, logoUrl);
  const base64 = withLogo.split(',', 2)[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function addLogoOverlay(qrDataUrl, logoUrl) {
  if (!logoUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return qrDataUrl;
  }

  try {
    const [qrImg, logoImg] = await Promise.all([
      loadImage(qrDataUrl),
      loadImage(logoUrl),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = qrImg.naturalWidth || qrImg.width;
    canvas.height = qrImg.naturalHeight || qrImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(qrImg, 0, 0, canvas.width, canvas.height);

    const halo = Math.round(canvas.width * 0.36);
    const haloXY = Math.round((canvas.width - halo) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(haloXY, haloXY, halo, halo);

    const maxLogoSize = Math.round(canvas.width * 0.30);
    const logoWidth = logoImg.naturalWidth || logoImg.width || maxLogoSize;
    const logoHeight = logoImg.naturalHeight || logoImg.height || maxLogoSize;
    const logoScale = Math.min(maxLogoSize / logoWidth, maxLogoSize / logoHeight);
    const drawWidth = Math.round(logoWidth * logoScale);
    const drawHeight = Math.round(logoHeight * logoScale);
    const logoX = Math.round((canvas.width - drawWidth) / 2);
    const logoY = Math.round((canvas.height - drawHeight) / 2);
    ctx.drawImage(logoImg, logoX, logoY, drawWidth, drawHeight);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Logo overlay failed; generating plain QR codes.', err);
    return qrDataUrl;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

/* ------------------------- instructions --------------------------------- */

function drawInstructionsPage(pdfDoc, { font, bodyFont, urlCount }) {
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const titleSize = 24;
  const bodySize = 13;
  const margin = 72;
  let y = PAGE_H - margin;

  page.drawText('QR Label Printing Instructions', {
    x: margin,
    y,
    size: titleSize,
    font,
    color: rgb(0, 0, 0),
  });
  y -= 42;

  const lines = [
    'Use US Letter paper and the matching 30-label-per-page sticker sheet.',
    `This file contains ${urlCount} QR code label${urlCount === 1 ? '' : 's'}.`,
    'Print single-sided only.',
    'Set scale to 100% / Actual Size.',
    'Do not use Fit, Shrink oversized pages, Scale to fit, or borderless printing.',
    'Turn off automatic page rotation/centering options if your print dialog exposes them.',
    'Print page 2 first on plain paper and hold it against a label sheet to confirm alignment.',
    'After the test looks good, print pages 2 onward on the sticker sheets.',
    'Feed all label sheets in the same orientation between tests and final printing.',
  ];

  for (const item of lines) {
    page.drawText('-', { x: margin, y, size: bodySize, font: bodyFont, color: rgb(0, 0, 0) });
    const wrapped = wrapText(item, bodyFont, bodySize, PAGE_W - margin * 2 - 18);
    for (const segment of wrapped) {
      page.drawText(segment, {
        x: margin + 18,
        y,
        size: bodySize,
        font: bodyFont,
        color: rgb(0, 0, 0),
      });
      y -= 18;
    }
    y -= 8;
  }

  y -= 10;
  page.drawText('Note:', { x: margin, y, size: bodySize, font, color: rgb(0, 0, 0) });
  y -= 20;
  const notes = [
    'The top two and bottom two rows intentionally include two copies of the QR code: one high and one low. This gives extra tolerance if the printer feeds the sheet slightly high or low.',
    'Serial numbers like #1, #2, etc. are printed on each label for later audit/tracking.',
  ];
  for (const note of notes) {
    const wrapped = wrapText(note, bodyFont, bodySize, PAGE_W - margin * 2);
    for (const segment of wrapped) {
      page.drawText(segment, { x: margin, y, size: bodySize, font: bodyFont, color: rgb(0, 0, 0) });
      y -= 18;
    }
    y -= 16;
  }
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || cur === '') {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
