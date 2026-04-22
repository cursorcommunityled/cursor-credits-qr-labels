"""Generate a printable PDF of QR-code stickers for the Avery 5160 (30-up) layout.

Reads URLs from a CSV/text file (one URL per line) and lays them out on an
8.5 x 11" PDF, 3 columns x 10 rows = 30 labels per page.

Each label is 2.625" wide x 1" tall; we place a square QR code on the left
with the Cursor logo composited in the middle, and the text "Cursor credits"
centered vertically to the right of the QR code.

Layout coordinates come from measuring the supplied template
``8.5x11in-30up.pdf`` so the print aligns with the purchased sticker sheet.

Usage:
    python generate_qr_labels.py                    # default: all URLs, output/qr_labels.pdf
    python generate_qr_labels.py --limit 30         # first 30 URLs
    python generate_qr_labels.py --draw-guides      # + alignment outlines
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_H
from reportlab.graphics import renderPM
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from svglib.svglib import svg2rlg


# ---- Label-sheet geometry (points; 1 in = 72 pt) ----
# Derived from the template PDF (8.5x11in-30up.pdf). The template draws rounded
# rectangles at these positions; we match them exactly.
PAGE_W, PAGE_H = letter  # (612, 792)

LABEL_W = 189.0          # 2.625"
LABEL_H = 72.0           # 1.000"

# Left edges of the three columns (in points, from the left page edge).
COL_LEFTS = [14.0831, 211.5875, 409.0919]

# Top edges of the ten rows (in points, from the bottom page edge; PDF coords).
# Row 1 is at the top of the page; row 10 at the bottom.
ROW_TOPS = [
    756.3043, 684.3043, 612.3043, 540.3043, 468.3043,
    396.3043, 324.3043, 252.3043, 180.3044, 108.3044,
]

LABELS_PER_PAGE = len(COL_LEFTS) * len(ROW_TOPS)  # 30

# QR size: as close to the 1" label height as practical. The QR sits on the
# left side of the label; the rest of the label holds the text.
QR_SIZE_IN = 0.95
QR_SIZE_PT = QR_SIZE_IN * 72          # 68.4 pt
QR_LEFT_PAD_PT = 2.5                  # inside-label margin to the left edge
TEXT_GAP_PT = 6.0                     # gap between QR and text
LABEL_TEXT = "Cursor credits"
TEXT_FONT = "Helvetica-Bold"

# Logo overlay inside the QR, as a fraction of the QR image width. With error
# correction level H a QR can lose ~30% of modules; 30% width ? 9% area which
# is well inside the recoverable range and reads as a prominently sized logo.
LOGO_FRACTION = 0.30
# White halo around the logo so scanners see a clean area (fraction of QR px).
LOGO_HALO_FRACTION = 0.36


def read_urls(path: Path) -> list[str]:
    """Read a plain text / single-column CSV file; one URL per line."""
    urls: list[str] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for line in f:
            url = line.strip().strip(",")
            if url:
                urls.append(url)
    return urls


def rasterize_logo(svg_path: Path, target_px: int = 768) -> Image.Image:
    """Rasterize an SVG to an RGB PIL image sized to `target_px` on the long side.

    We render onto a solid white background (reportlab's renderPM ``bg`` is a
    24-bit RGB int, not RGBA - passing a value with a 4th byte silently yields
    the wrong color). A white background is fine because each logo is pasted
    onto the center of a white halo inside the QR code.
    """
    drawing = svg2rlg(str(svg_path))
    w, h = drawing.width, drawing.height
    scale = target_px / max(w, h)
    drawing.width = w * scale
    drawing.height = h * scale
    drawing.scale(scale, scale)
    png_bytes = renderPM.drawToString(drawing, fmt="PNG", bg=0xFFFFFF)
    return Image.open(io.BytesIO(png_bytes)).convert("RGB")


def make_qr_image(url: str, logo: Image.Image | None) -> ImageReader:
    """Render a URL to a high-res QR PNG (optionally with center logo) and
    return a reportlab ImageReader."""
    qr = qrcode.QRCode(
        version=None,                 # auto-size to fit the data
        error_correction=ERROR_CORRECT_H,
        box_size=20,                  # pixels per module (crisp at print size)
        border=2,                     # quiet-zone modules
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    if logo is not None:
        W, H = img.size
        # White halo behind the logo for a clean scan target.
        halo = int(W * LOGO_HALO_FRACTION)
        halo_xy = ((W - halo) // 2, (H - halo) // 2)
        halo_box = Image.new("RGB", (halo, halo), (255, 255, 255))
        img.paste(halo_box, halo_xy)

        logo_px = int(W * LOGO_FRACTION)
        resized = logo.resize((logo_px, logo_px), Image.LANCZOS)
        logo_xy = ((W - logo_px) // 2, (H - logo_px) // 2)
        img.paste(resized, logo_xy)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def fit_font_size(c: canvas.Canvas, text: str, font: str, max_w: float,
                  max_size: float = 11.0, min_size: float = 6.0) -> float:
    """Pick the largest font size (in pt) at which `text` fits within `max_w`."""
    size = max_size
    while size > min_size and c.stringWidth(text, font, size) > max_w:
        size -= 0.25
    return size


def draw_label(c: canvas.Canvas, url: str, label_left: float, label_top: float,
               logo: Image.Image | None, text_size: float) -> None:
    """Render a single sticker cell (QR image + label text)."""
    label_bottom = label_top - LABEL_H

    # --- QR code on the left ---
    qr_x = label_left + QR_LEFT_PAD_PT
    qr_y = label_bottom + (LABEL_H - QR_SIZE_PT) / 2
    img = make_qr_image(url, logo)
    c.drawImage(
        img, qr_x, qr_y, width=QR_SIZE_PT, height=QR_SIZE_PT,
        preserveAspectRatio=True, mask="auto",
    )

    # --- Text to the right of the QR ---
    text_x = qr_x + QR_SIZE_PT + TEXT_GAP_PT
    # Baseline so the text's cap-height sits vertically centered in the label.
    # Helvetica-Bold cap height ? 0.72 * font size; a simple centering works:
    text_y = label_bottom + LABEL_H / 2 - text_size * 0.32
    c.setFont(TEXT_FONT, text_size)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(text_x, text_y, LABEL_TEXT)


def draw_labels(c: canvas.Canvas, urls: list[str], logo: Image.Image | None) -> None:
    """Paint every URL onto the appropriate label cell, paginating as needed."""
    # Pick a single text size that fits in the available space, once.
    text_space = LABEL_W - QR_LEFT_PAD_PT - QR_SIZE_PT - TEXT_GAP_PT - 2.0
    text_size = fit_font_size(c, LABEL_TEXT, TEXT_FONT, text_space)

    for idx, url in enumerate(urls):
        page_idx, cell_idx = divmod(idx, LABELS_PER_PAGE)
        if cell_idx == 0 and page_idx > 0:
            c.showPage()

        row = cell_idx // len(COL_LEFTS)
        col = cell_idx % len(COL_LEFTS)

        draw_label(
            c, url,
            label_left=COL_LEFTS[col],
            label_top=ROW_TOPS[row],
            logo=logo,
            text_size=text_size,
        )

    c.showPage()


def draw_guides(c: canvas.Canvas) -> None:
    """Stroke each label cell for visual alignment QA against the sticker sheet."""
    c.setLineWidth(0.25)
    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    for row_top in ROW_TOPS:
        for col_left in COL_LEFTS:
            c.rect(col_left, row_top - LABEL_H, LABEL_W, LABEL_H, stroke=1, fill=0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", default="input.csv",
        help="Path to the list of URLs (one per line). Default: input.csv",
    )
    parser.add_argument(
        "--output-dir", default="output",
        help="Directory for generated PDFs. Default: output",
    )
    parser.add_argument(
        "--output-name", default="qr_labels.pdf",
        help="Filename for the main PDF. Default: qr_labels.pdf",
    )
    parser.add_argument(
        "--logo", default="logo.svg",
        help="Path to the logo SVG to embed at the center of each QR. "
             "Pass an empty string to disable.",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="How many URLs to render. 0 = all. Default: 0 (all).",
    )
    parser.add_argument(
        "--draw-guides", action="store_true",
        help="Also write a second PDF with thin gray rectangles on each label "
             "cell (for visual QA).",
    )
    args = parser.parse_args()

    in_path = Path(args.input)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / args.output_name

    urls = read_urls(in_path)
    if args.limit and args.limit > 0:
        urls = urls[: args.limit]
    if not urls:
        raise SystemExit(f"No URLs found in {in_path!s}.")

    logo = None
    if args.logo:
        logo_path = Path(args.logo)
        if logo_path.is_file():
            logo = rasterize_logo(logo_path)
        else:
            print(f"Warning: logo not found at {logo_path!s}; skipping center logo.")

    c = canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle(f"QR code labels ({len(urls)})")
    draw_labels(c, urls, logo)
    c.save()
    print(f"Wrote {out_path} with {len(urls)} QR code(s).")

    if args.draw_guides:
        guide_path = out_path.with_name(out_path.stem + "_guides" + out_path.suffix)
        c = canvas.Canvas(str(guide_path), pagesize=letter)
        c.setTitle(f"QR code labels with guides ({len(urls)})")
        # Draw guides on every page that will contain labels.
        pages = (len(urls) + LABELS_PER_PAGE - 1) // LABELS_PER_PAGE
        for page_idx in range(pages):
            draw_guides(c)
            page_urls = urls[
                page_idx * LABELS_PER_PAGE : (page_idx + 1) * LABELS_PER_PAGE
            ]
            text_space = LABEL_W - QR_LEFT_PAD_PT - QR_SIZE_PT - TEXT_GAP_PT - 2.0
            text_size = fit_font_size(c, LABEL_TEXT, TEXT_FONT, text_space)
            for cell_idx, url in enumerate(page_urls):
                row = cell_idx // len(COL_LEFTS)
                col = cell_idx % len(COL_LEFTS)
                draw_label(
                    c, url,
                    label_left=COL_LEFTS[col],
                    label_top=ROW_TOPS[row],
                    logo=logo,
                    text_size=text_size,
                )
            c.showPage()
        c.save()
        print(f"Wrote {guide_path} with alignment guides.")


if __name__ == "__main__":
    main()
