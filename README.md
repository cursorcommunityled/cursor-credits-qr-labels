# QR Label Studio

A static web app that turns a CSV of URLs into a printable QR-code sticker sheet,
aligned to **your** label template. Upload a PDF template, a CSV, and a label
text — get back a ready-to-print PDF.

Everything runs in the browser. No server, no backend, no uploads leave your
machine.

## How it works

1. **Template detection** (`src/detectTemplate.js`): parses the uploaded PDF,
   walks the drawing-operator list, tracks the CTM, and extracts every path's
   bounding box. Clusters boxes by size, picks the dominant size (= label
   cell), and derives the column-lefts and row-tops.
2. **CSV parsing** (`src/parseCSV.js`): reads one URL per row; tolerates
   headers, blanks, BOMs and full CSV grammar via PapaParse.
3. **PDF generation** (`src/generatePDF.js`): rasterizes QR codes with
   error-correction H, composes them with the label text using `pdf-lib`, and
   prepends an instructions page.

## Run locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build to dist/
npm run preview        # serve the built app
npm test               # Node end-to-end smoke test (uses reference/)
npm run detect         # Sanity-check template detection on reference/
```

## Repository layout

```
/
├── index.html                  # app shell
├── src/
│   ├── main.js                 # UI glue
│   ├── detectTemplate.js       # ** template grid detection **
│   ├── parseCSV.js             # CSV → URL[]
│   ├── generatePDF.js          # QR + PDF composition
│   └── style.css
├── scripts/
│   ├── e2e.mjs                 # node-run full pipeline test
│   └── test-detect.mjs         # detector-only sanity check
├── reference/                  # original Python script kept for reference
│   ├── generate_qr_labels.py
│   ├── 8.5x11in-30up.pdf       # sample template
│   ├── input.csv               # sample URL list
│   └── logo.svg
├── package.json
├── vite.config.js
└── README.md
```

Nothing in `reference/` is shipped to production; `dist/` and `node_modules/`
are gitignored.

## Deploying to Cloudflare Pages (free)

The app is 100% static — Cloudflare Pages' free tier is a perfect fit.

### One-time setup in the Cloudflare dashboard

1. Push this repo to GitHub (see below).
2. Open <https://dash.cloudflare.com/?to=/:account/pages> → **Create a project**
   → **Connect to Git**.
3. Select this repository.
4. Build configuration:
   - **Framework preset:** *Vite*
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** leave blank (repo root)
   - **Node version:** 20 (or 22)
5. Click **Save and deploy**. You're live. Future `git push` rebuilds
   automatically; preview URLs are generated for every branch/PR.

No API tokens, no secrets, no workflows to maintain — CF Pages' native Git
integration handles it.

## License

MIT.
