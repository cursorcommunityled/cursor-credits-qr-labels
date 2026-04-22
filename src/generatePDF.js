// Build the output PDF: page 1 = printing instructions, pages 2+ = sticker sheets.
//
// The input `template` comes from detectTemplate() and gives us pageWidth,
// pageHeight, colLefts, rowTops, labelWidth and labelHeight in PDF points.
// We paint one QR + text per label cell, paginating at labelsPerPage.

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import QRCode from 'qrcode';

const QR_ERROR_LEVEL = 'H';           // allows ~30% damage; robust in print
const QR_PIXELS = 480;                // rasterized QR side, pre-embed
const LABEL_MARGIN_PT = 3;            // inner padding inside each label cell
const TEXT_GAP_PT = 6;                // gap between QR and text
const TEXT_FONT = StandardFonts.HelveticaBold;

/**
 * @param {object} opts
 * @param {object} opts.template        detectTemplate() output
 * @param {string[]} opts.urls          URLs, one per sticker
 * @param {string} opts.labelText       text that appears on every sticker
 * @param {(message: string, ratio: number) => void} [opts.onProgress]
 * @returns {Promise<Uint8Array>}        bytes of the output PDF
 */
export async function generateLabelPdf({ template, urls, labelText, onProgress }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`QR labels (${urls.length})`);
  pdfDoc.setCreator('QR Label Studio');

  const font = await pdfDoc.embedFont(TEXT_FONT);

  // ---- Page 1: Instructions ----
  drawInstructionsPage(pdfDoc, font, {
    urlCount: urls.length,
    template,
    labelText,
  });

  // ---- Labels ----
  const labelsPerPage = template.labelsPerPage;
  const totalPages = Math.max(1, Math.ceil(urls.length / labelsPerPage));

  // Pre-generate the single text size that fits in every label.
  const qrSize = computeQrSize(template);
  const textMaxWidth =
    template.labelWidth - LABEL_MARGIN_PT - qrSize - TEXT_GAP_PT - LABEL_MARGIN_PT;
  const textSize = fitFontSize(font, labelText, textMaxWidth, template.labelHeight);

  for (let p = 0; p < totalPages; p++) {
    onProgress?.(`Rendering page ${p + 2} of ${totalPages + 1}…`, (p + 1) / (totalPages + 1));
    const page = pdfDoc.addPage([template.pageWidth, template.pageHeight]);
    const pageUrls = urls.slice(p * labelsPerPage, (p + 1) * labelsPerPage);

    for (let i = 0; i < pageUrls.length; i++) {
      const url = pageUrls[i];
      const row = Math.floor(i / template.cols);
      const col = i % template.cols;
      const labelLeft = template.colLefts[col];
      const labelTop = template.rowTops[row];

      const qrPng = await renderQrPng(url);
      const qrImage = await pdfDoc.embedPng(qrPng);

      drawLabel(page, {
        qrImage, qrSize,
        labelLeft, labelTop,
        labelWidth: template.labelWidth,
        labelHeight: template.labelHeight,
        font, labelText, textSize,
      });
    }
  }

  onProgress?.('Finalizing PDF…', 1);
  return pdfDoc.save();
}

/* ------------------------- layout helpers ------------------------------- */

function computeQrSize(t) {
  // Largest square that fits the label height with inner padding, capped at
  // half the label width so the text column gets real estate too.
  const maxByHeight = t.labelHeight - 2 * LABEL_MARGIN_PT;
  const maxByWidth = t.labelWidth * 0.5;
  return Math.max(10, Math.min(maxByHeight, maxByWidth));
}

function fitFontSize(font, text, maxWidth, labelHeight, minSize = 5, maxSize = 14) {
  const vCap = Math.min(maxSize, labelHeight * 0.6);
  let size = vCap;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  return size;
}

function drawLabel(page, {
  qrImage, qrSize, labelLeft, labelTop, labelWidth, labelHeight,
  font, labelText, textSize,
}) {
  const labelBottom = labelTop - labelHeight;

  // QR on the left, vertically centered.
  const qrX = labelLeft + LABEL_MARGIN_PT;
  const qrY = labelBottom + (labelHeight - qrSize) / 2;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // Text right of the QR, vertically centered.
  const textX = qrX + qrSize + TEXT_GAP_PT;
  const textWidth = font.widthOfTextAtSize(labelText, textSize);
  const textSpace =
    labelWidth - LABEL_MARGIN_PT - qrSize - TEXT_GAP_PT - LABEL_MARGIN_PT;
  const remaining = Math.max(0, textSpace - textWidth);
  // Left-align within the text space (tight layouts), with a small inner nudge.
  const xOffset = Math.min(remaining / 2, 4);
  const textHeight = font.heightAtSize(textSize, { descender: false });
  const textY = labelBottom + (labelHeight - textHeight) / 2;

  page.drawText(labelText, {
    x: textX + xOffset,
    y: textY,
    size: textSize,
    font,
    color: rgb(0, 0, 0),
  });
}

/* ----------------------------- QR --------------------------------------- */

async function renderQrPng(url) {
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: QR_ERROR_LEVEL,
    margin: 1,
    width: QR_PIXELS,
    color: { dark: '#000000FF', light: '#FFFFFFFF' },
  });
  const base64 = dataUrl.split(',', 2)[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ------------------------- instructions --------------------------------- */

function drawInstructionsPage(pdfDoc, font, { urlCount, template, labelText }) {
  const [w, h] = PageSizes.Letter;
  const page = pdfDoc.addPage([w, h]);

  const title = 'QR Label Sheet — Printing Instructions';
  const titleSize = 22;
  const bodySize = 12;

  // Heading
  page.drawText(title, {
    x: 54,
    y: h - 72,
    size: titleSize,
    font,
    color: rgb(0.09, 0.09, 0.22),
  });

  // Separator rule.
  page.drawLine({
    start: { x: 54, y: h - 88 },
    end:   { x: w - 54, y: h - 88 },
    thickness: 0.75,
    color: rgb(0.75, 0.75, 0.8),
  });

  const totalPages = 1 + Math.max(1, Math.ceil(urlCount / template.labelsPerPage));
  const lines = [
    `This PDF contains ${urlCount} QR-code sticker${urlCount === 1 ? '' : 's'}, ` +
      `laid out for a ${template.rows}×${template.cols} label template (` +
      `${(template.labelWidth / 72).toFixed(2)}" × ${(template.labelHeight / 72).toFixed(2)}" per label).`,
    `Each sticker shows a scannable QR code and the text "${labelText}".`,
    '',
    'Before you print',
    '• Do a test print on plain paper first and line it up against an unused label sheet to verify alignment.',
    '• Load the label sheet into your printer exactly as your test-print oriented the paper.',
    '',
    'Printer / dialog settings',
    `• Print pages 2 through ${totalPages} only (page 1 is this instructions sheet).`,
    '• Set page scaling to "Actual Size" or 100%. Do NOT use "Fit to Page", "Shrink to Fit" or any automatic scaling.',
    '• Page orientation: Portrait.',
    '• Paper size: US Letter (8.5" × 11") — matches the template.',
    '• Two-sided printing: OFF (single-sided).',
    '',
    'If the stickers drift across the page',
    '• Minor drift usually means a "fit to page" setting is still enabled — double-check the scale is 100%.',
    '• Some printers have a non-printable margin that prevents labels near the very edge from aligning. Use the printer\'s "borderless" mode if it offers one.',
    '',
    'Generated by QR Label Studio — everything was produced locally in your browser.',
  ];

  let y = h - 120;
  for (const raw of lines) {
    if (raw === '') { y -= 8; continue; }
    const isHeader = !raw.startsWith('•') && !raw.startsWith('Generated') && !raw.startsWith('This PDF') && !raw.startsWith('Each sticker');
    const size = isHeader ? 13 : bodySize;
    const maxWidth = w - 108;
    const wrapped = wrapText(raw, font, size, maxWidth);
    for (const segment of wrapped) {
      page.drawText(segment, {
        x: 54, y, size, font,
        color: isHeader ? rgb(0.1, 0.1, 0.4) : rgb(0.15, 0.15, 0.18),
      });
      y -= size * 1.45;
    }
    if (isHeader) y -= 2;
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
