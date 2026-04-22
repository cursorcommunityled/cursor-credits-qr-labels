// Node harness for detectTemplate against the reference template PDF.
// Run: node scripts/test-detect.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// pdfjs-dist's worker uses `?url` in the app, but in Node we can skip it by
// pointing workerSrc at the worker file on disk before the module tries to
// spawn one. Easiest: set `GlobalWorkerOptions.workerSrc = ''` and run on the
// main thread (pdfjs falls back when workerSrc is falsy in Node).
globalThis.DOMMatrix = class { constructor() {} }; // stub if needed
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);

// Reimplement the detector inline to avoid the Vite-specific `?url` import
// in detectTemplate.js. We mirror its logic exactly.

const EPSILON = 0.5;

function multiplyMatrix(m1, m2) {
  const [a1,b1,c1,d1,e1,f1] = m1; const [a2,b2,c2,d2,e2,f2] = m2;
  return [a1*a2+c1*b2, b1*a2+d1*b2, a1*c2+c1*d2, b1*c2+d1*d2,
          a1*e2+c1*f2+e1, b1*e2+d1*f2+f1];
}
function applyMatrix(m, x, y) { const [a,b,c,d,e,f]=m; return [a*x+c*y+e, b*x+d*y+f]; }

function uniqueClustered(values) {
  const sorted = values.slice().sort((a,b)=>a-b);
  const out = []; let cluster = [];
  for (const v of sorted) {
    if (cluster.length === 0 || Math.abs(v - cluster[cluster.length-1]) <= EPSILON) cluster.push(v);
    else { out.push(cluster.reduce((s,x)=>s+x,0)/cluster.length); cluster = [v]; }
  }
  if (cluster.length) out.push(cluster.reduce((s,x)=>s+x,0)/cluster.length);
  return out;
}

function pickDominant(boxes) {
  const clusters = [];
  for (const b of boxes) {
    let found = clusters.find(c => Math.abs(c.w - b.w) <= EPSILON && Math.abs(c.h - b.h) <= EPSILON);
    if (found) found.members.push(b); else clusters.push({ w: b.w, h: b.h, members: [b] });
  }
  clusters.sort((a,b) => b.members.length - a.members.length);
  return clusters[0];
}

async function detect(filePath) {
  const bytes = await readFile(filePath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(1);
  const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;

  const boxes = [];
  let ctm = [1,0,0,1,0,0];
  const stack = [];
  let reMin = null, reMax = null;

  const pushBox = (minX, minY, maxX, maxY) => {
    if (![minX,minY,maxX,maxY].every(Number.isFinite)) return;
    const pts = [[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY]].map(([x,y])=>applyMatrix(ctm,x,y));
    const xs = pts.map(p=>p[0]); const ys = pts.map(p=>p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = x1-x0, h = y1-y0;
    if (w < 0.1 || h < 0.1) return;
    boxes.push({ x0, y0, x1, y1, w, h });
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push(ctm.slice()); break;
      case OPS.restore: if (stack.length) ctm = stack.pop(); break;
      case OPS.transform: ctm = multiplyMatrix(ctm, args); break;
      case OPS.rectangle: {
        const [x,y,w,h] = args;
        const mnx = Math.min(x,x+w), mxx = Math.max(x,x+w);
        const mny = Math.min(y,y+h), mxy = Math.max(y,y+h);
        if (reMin === null) { reMin = [mnx,mny]; reMax = [mxx,mxy]; }
        else {
          reMin[0] = Math.min(reMin[0],mnx); reMin[1] = Math.min(reMin[1],mny);
          reMax[0] = Math.max(reMax[0],mxx); reMax[1] = Math.max(reMax[1],mxy);
        }
        break;
      }
      case OPS.constructPath: {
        const minMax = args[2];
        if (minMax && typeof minMax.length === 'number' && minMax.length >= 4) {
          pushBox(minMax[0], minMax[1], minMax[2], minMax[3]);
        }
        break;
      }
      case OPS.stroke: case OPS.closeStroke:
      case OPS.fill: case OPS.eoFill:
      case OPS.fillStroke: case OPS.eoFillStroke:
      case OPS.closeFillStroke: case OPS.closeEOFillStroke:
      case OPS.endPath:
        if (reMin !== null) { pushBox(reMin[0], reMin[1], reMax[0], reMax[1]); reMin = reMax = null; }
        break;
      default: break;
    }
  }

  const plausible = boxes.filter(b => b.w > 20 && b.h > 20 && b.w < pageWidth - 2 && b.h < pageHeight - 2);
  const dom = pickDominant(plausible);
  const colLefts = uniqueClustered(dom.members.map(b => b.x0)).sort((a,b)=>a-b);
  const rowTops  = uniqueClustered(dom.members.map(b => b.y1)).sort((a,b)=>b-a);

  return { pageWidth, pageHeight, labelWidth: dom.w, labelHeight: dom.h,
           colLefts, rowTops, totalBoxes: boxes.length, matched: dom.members.length };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.resolve(__dirname, '../reference/8.5x11in-30up.pdf');
console.log(`Detecting: ${file}`);
const result = await detect(file);
console.log(JSON.stringify(result, (k, v) => typeof v === 'number' ? Number(v.toFixed(4)) : v, 2));
