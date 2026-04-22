// Template detection.
//
// Given a user-uploaded PDF whose first page contains a grid of outlined
// label cells (rectangles or rounded rectangles, typical for Avery-style
// sticker sheets), return the layout geometry the rest of the app needs:
//
//   {
//     pageWidth, pageHeight,      // points
//     labelWidth, labelHeight,    // points
//     colLefts: number[],         // left edges of each column (points, from left)
//     rowTops:  number[],         // top edges of each row (points, from BOTTOM - PDF coords)
//     rawBoxes: [...],            // for debugging / rendering guides
//     pageCount,
//   }
//
// Strategy:
//   1. Walk the first page's operator list.
//   2. Track the current transformation matrix (CTM).
//   3. Every time a path is constructed (rounded rect, rect, etc.), record its
//      axis-aligned bounding box in page-space.
//   4. Also record explicit rectangles from the `re` operator.
//   5. Cluster boxes by size; the most common non-trivial size is the label.
//   6. From those boxes extract unique column-lefts and row-tops.
//
// This module has no dependencies on anything except pdfjs-dist, so it can
// be tested/debugged in isolation.

import * as pdfjsLib from 'pdfjs-dist';

const EPSILON = 0.5; // points — tolerance for "same position / same size"

/** Must be called once before detectTemplate(). Call site supplies the worker URL
 *  (in Vite we use `?url` imports; in Node tests we set a file: path). */
export function configurePdfWorker(workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}

/**
 * @param {ArrayBuffer} pdfBytes
 * @returns {Promise<object>}  template info (see file header)
 */
export async function detectTemplate(pdfBytes) {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const page = await doc.getPage(1);
  const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });

  const boxes = await extractPathBoxes(page);

  if (boxes.length === 0) {
    throw new Error(
      'No rectangles or paths were found on page 1 of the template. ' +
      'Make sure each label cell is outlined (stroked or filled) in the PDF.'
    );
  }

  // Keep only "reasonable" boxes: not the full page, not slivers.
  const plausible = boxes.filter(
    (b) => b.w > 20 && b.h > 20 && b.w < pageWidth - 2 && b.h < pageHeight - 2
  );
  if (plausible.length === 0) {
    throw new Error(
      'Found shapes, but none looked like label cells (each must be > 20pt on a side).'
    );
  }

  const { w: labelWidth, h: labelHeight, members } = pickDominantSize(plausible);

  if (members.length < 2) {
    throw new Error(
      `Only ${members.length} cell of size ${labelWidth.toFixed(2)}×${labelHeight.toFixed(2)}pt ` +
      'was found — expected a grid of at least 2 cells.'
    );
  }

  // Unique lefts / tops (in PDF coords: y is measured from the bottom).
  const colLefts = uniqueClustered(members.map((b) => b.x0)).sort((a, b) => a - b);
  const rowTops  = uniqueClustered(members.map((b) => b.y1)).sort((a, b) => b - a);

  // Sanity: number of detected cells ~ rows * cols
  const expected = colLefts.length * rowTops.length;
  if (members.length < expected * 0.5) {
    throw new Error(
      `Detected a ${rowTops.length}×${colLefts.length} grid but only ${members.length}/${expected} ` +
      'cells matched — the template may have an irregular layout this tool can\'t handle.'
    );
  }

  return {
    pageWidth,
    pageHeight,
    labelWidth,
    labelHeight,
    colLefts,
    rowTops,
    labelsPerPage: colLefts.length * rowTops.length,
    rows: rowTops.length,
    cols: colLefts.length,
    pageCount,
    rawBoxes: members,
  };
}

/* ----------------------------- helpers ---------------------------------- */

/**
 * Walk the page's operator list, tracking the CTM, and return the axis-aligned
 * bounding box (in page-space, PDF coords with y-up origin at bottom-left) of
 * every stroked/filled path or rectangle.
 */
async function extractPathBoxes(page) {
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  const boxes = [];

  // CTM stack. Page content starts with the identity (pdfjs already accounts
  // for the page rotation / mediabox in the coordinate space returned here).
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];

  // For OPS.rectangle, args pile up until a path-paint operator; we track
  // the running min/max ourselves for those cases.
  let reMin = null;
  let reMax = null;

  const pushBox = (minX, minY, maxX, maxY) => {
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;
    const p0 = applyMatrix(ctm, minX, minY);
    const p1 = applyMatrix(ctm, maxX, minY);
    const p2 = applyMatrix(ctm, maxX, maxY);
    const p3 = applyMatrix(ctm, minX, maxY);
    const xs = [p0[0], p1[0], p2[0], p3[0]];
    const ys = [p0[1], p1[1], p2[1], p3[1]];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = x1 - x0, h = y1 - y0;
    if (w < 0.1 || h < 0.1) return; // skip near-zero (lines)
    boxes.push({ x0, y0, x1, y1, w, h });
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save:
        stack.push(ctm.slice());
        break;
      case OPS.restore:
        if (stack.length > 0) ctm = stack.pop();
        break;
      case OPS.transform: {
        // cm operator: multiply CTM on the right.
        const [a, b, c, d, e, f] = args;
        ctm = multiplyMatrix(ctm, [a, b, c, d, e, f]);
        break;
      }
      case OPS.rectangle: {
        // `re` operator: [x, y, w, h] — append to current path.
        const [x, y, w, h] = args;
        const minX = Math.min(x, x + w);
        const maxX = Math.max(x, x + w);
        const minY = Math.min(y, y + h);
        const maxY = Math.max(y, y + h);
        if (reMin === null) { reMin = [minX, minY]; reMax = [maxX, maxY]; }
        else {
          reMin[0] = Math.min(reMin[0], minX); reMin[1] = Math.min(reMin[1], minY);
          reMax[0] = Math.max(reMax[0], maxX); reMax[1] = Math.max(reMax[1], maxY);
        }
        break;
      }
      case OPS.constructPath: {
        // args: [opArray, data, minMax]  where minMax = [minX, minY, maxX, maxY]
        // The third arg (Float32Array) is the axis-aligned bbox of the path in
        // its own local coords (before the CTM is applied).
        const minMax = args[2];
        const isBBox = minMax && typeof minMax.length === 'number' && minMax.length >= 4;
        if (isBBox) {
          pushBox(minMax[0], minMax[1], minMax[2], minMax[3]);
        } else {
          // Fallback: compute from the raw path data.
          const bb = boundsFromPathData(args[0], args[1]);
          if (bb) pushBox(bb.minX, bb.minY, bb.maxX, bb.maxY);
        }
        break;
      }
      // Path paint operators: flush any accumulated `re` rect as one box.
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
      case OPS.endPath:
        if (reMin !== null) {
          pushBox(reMin[0], reMin[1], reMax[0], reMax[1]);
          reMin = reMax = null;
        }
        break;
      default:
        break;
    }
  }

  return boxes;
}

function multiplyMatrix(m1, m2) {
  // 2D affine (a,b,c,d,e,f) representing [[a,c,e],[b,d,f],[0,0,1]]
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMatrix(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function boundsFromPathData(ops, data) {
  // Ops are single bytes from pdfjs' draw ops encoding. We don't need to
  // interpret each one perfectly for a bbox — just min/max of every numeric
  // coord in `data` gives a sound (possibly slightly larger for beziers)
  // bounding box, which is fine for detecting label cells.
  if (!data || data.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < data.length; i += 2) {
    const x = data[i], y = data[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Cluster boxes by (w, h) and return the largest cluster (the "dominant" label
 * size). Boxes within EPSILON on each dimension are considered the same size.
 */
function pickDominantSize(boxes) {
  const clusters = [];
  for (const b of boxes) {
    let found = null;
    for (const c of clusters) {
      if (Math.abs(c.w - b.w) <= EPSILON && Math.abs(c.h - b.h) <= EPSILON) {
        found = c; break;
      }
    }
    if (found) found.members.push(b);
    else clusters.push({ w: b.w, h: b.h, members: [b] });
  }
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters[0];
}

/**
 * De-duplicate a list of numeric positions: values within EPSILON are averaged
 * to a single representative.
 */
function uniqueClustered(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const out = [];
  let cluster = [];
  for (const v of sorted) {
    if (cluster.length === 0 || Math.abs(v - cluster[cluster.length - 1]) <= EPSILON) {
      cluster.push(v);
    } else {
      out.push(cluster.reduce((s, x) => s + x, 0) / cluster.length);
      cluster = [v];
    }
  }
  if (cluster.length) out.push(cluster.reduce((s, x) => s + x, 0) / cluster.length);
  return out;
}
