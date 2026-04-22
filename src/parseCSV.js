// CSV parsing: extract one URL per logical row.
//
// We accept plain text (one URL per line) as well as CSV files; if the file
// is comma-delimited we take the first non-empty cell from each row. Header
// rows that don't look like URLs are skipped automatically.

import Papa from 'papaparse';

/**
 * @param {string} text  raw file contents (UTF-8 decoded)
 * @returns {string[]}    deduped, trimmed list of URLs in file order
 */
export function parseUrlsFromCsv(text) {
  if (!text) return [];

  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const parsed = Papa.parse(text, {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    header: false,
  });

  const urls = [];
  const seen = new Set();
  for (const row of parsed.data) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const value = String(cell ?? '').trim();
      if (!value) continue;
      if (!looksLikeUrl(value)) continue;
      if (seen.has(value)) break; // dedupe, don't add twice
      seen.add(value);
      urls.push(value);
      break; // first url-looking cell per row wins
    }
  }
  return urls;
}

function looksLikeUrl(s) {
  if (s.length > 2048) return false;
  // Accept full URLs and bare hostnames with a dot.
  if (/^(https?:\/\/|ftp:\/\/|mailto:|tel:)/i.test(s)) return true;
  if (/^[a-z0-9][\w.-]*\.[a-z]{2,}(\/.*)?$/i.test(s)) return true;
  return false;
}
