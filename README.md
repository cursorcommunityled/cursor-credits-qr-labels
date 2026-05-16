# Cursor Credits QR Labels

A website which turns the Cursor credits CSV file into a ready-to-print QR label PDF.

Everything runs in the browser. The CSV is read from the user's device, the PDF is generated in memory, and neither file is saved on the server.

The layout matches the 30 labels per page sheet available on Amazon.
https://www.amazon.ca/dp/B0CFZWLH5T


## How it works

1. **CSV parsing** (`src/parseCSV.js`): reads one URL per row; tolerates headers, blanks, and full CSV grammar via PapaParse.
2. **PDF generation** (`src/generatePDF.js`): ports the fixed 30-up geometry from the Amazon item, rasterizes QR codes with error-correction H, adds the center logo in the browser, duplicates QR codes on the top/bottom two rows for print drift tolerance, and prepends a print instructions page.

Each individual label looks like [QR code label.jpg](QR code label.jpg).

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

## Deploying to Cloudflare Workers

The app is 100% static and can be served by Cloudflare Workers static assets.

Manual deploy, after Cloudflare login:

```bash
npm run deploy
```


## License

MIT.
