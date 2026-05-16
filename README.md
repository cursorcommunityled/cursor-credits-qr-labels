# Cursor Credits QR Labels

A Cloudflare-hostable static web app that turns a one-column CSV of Cursor
credits URLs into a ready-to-print QR label PDF.

Everything runs in the browser. The CSV is read from the user's device, the PDF
is generated in memory, and neither file is uploaded to or saved by a server.
The layout matches the 30 labels per page sheet used by
`reference/generate_qr_labels_small.py`.

## How it works

1. **CSV parsing** (`src/parseCSV.js`): reads one URL per row; tolerates
   headers, blanks, BOMs and full CSV grammar via PapaParse.
2. **PDF generation** (`src/generatePDF.js`): ports the fixed 30-up geometry
   from `reference/generate_qr_labels_small.py`, rasterizes QR codes with
   error-correction H, adds the center logo in the browser, duplicates QR codes
   on the top/bottom two rows for print drift tolerance, and prepends a print
   instructions page.

The supported label sheet is this Amazon item:
<https://www.amazon.ca/dp/B0CFZWLH5T?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1>

## Run locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build to dist/
npm run preview        # serve the built app
npm test               # Node end-to-end smoke test using reference/input.csv
```

## Repository layout

```
/
├── index.html                  # app shell
├── public/
│   └── logo.svg                # logo embedded into browser-generated QR codes
├── src/
│   ├── main.js                 # UI glue
│   ├── parseCSV.js             # CSV → URL[]
│   ├── generatePDF.js          # QR + PDF composition
│   └── style.css
├── scripts/
│   └── e2e.mjs                 # node-run full pipeline test
├── reference/                  # original Python script kept for reference
│   ├── input.csv               # sample URL list
│   ├── logo.svg
│   ├── generate_qr_labels.py
│   └── generate_qr_labels_small.py
├── package.json
├── vite.config.js
├── wrangler.jsonc              # Cloudflare Workers static asset config
└── README.md
```

Nothing in `reference/` is shipped to production; `dist/` and `node_modules/`
are gitignored.

## Deploying to Cloudflare Workers

The app is 100% static and can be served by Cloudflare Workers static assets.

Manual deploy, after Cloudflare login:

```bash
npm run deploy
```

For automatic deploys later, connect the GitHub repo in the Cloudflare dashboard
using Workers Builds, or add a GitHub Action that runs `npm ci`, `npm run build`,
and `npx wrangler deploy`. The source repo can remain private while the deployed
website is publicly reachable.

## Security note

This repo's `.gitignore` excludes `*.csv` and `*.pdf` at every depth. Keep it
that way — the whole point of the app is that *user data stays on the user's
machine*, so the repo itself should never contain real URL lists or generated
label PDFs.

## License

MIT.
