"""Generate QR-code stickers with extra tolerance for printer drift.

Same 30-up letter-size layout as ``generate_qr_labels.py``, but the QR is
sized down from 0.95" to 0.70" so there is ~3.8 mm of vertical slack on each
side and ~2 mm of extra horizontal slack on the left. This absorbs the
cumulative drift most consumer printers introduce over a full 11" sheet
(typically 1-2 mm by the bottom row).

The top two and bottom two rows are more vulnerable to feed/registration
errors, so those labels get two duplicate 0.70" QRs placed side by side: one
high and one low. That way, if the sheet shifts upward or downward, at least
one copy should stay inside the sticker.

The label text area grows accordingly; ``fit_font_size`` will pick a slightly
larger text size automatically.

Once this is confirmed to print well, fold the changes back into
``generate_qr_labels.py``.

Usage:
    python generate_qr_labels_small.py                 # all URLs -> output/qr_labels_small.pdf
    python generate_qr_labels_small.py --limit 30      # first 30 URLs
    python generate_qr_labels_small.py --draw-guides   # + alignment outlines
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


SCRIPT_DIR = Path(__file__).resolve().parent

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

# QR size reduced to 0.70" so the label has ~3.8 mm of vertical slack above
# and below the QR, giving a comfortable buffer against printer drift.
QR_SIZE_IN = 0.70
QR_SIZE_PT = QR_SIZE_IN * 72          # 50.4 pt
# Edge-row labels get two horizontally separated QR copies for print-feed drift.
EDGE_ROW_COUNT = 2
EDGE_QR_TOP_BOTTOM_PAD_PT = 3.0
DUPLICATE_QR_GAP_PT = 8.0
# Slightly larger left pad so the QR also has breathing room horizontally.
QR_LEFT_PAD_PT = 6.0                  # ~0.083" inside-label margin on the left
TEXT_GAP_PT = 6.0                     # gap between QR and text
LABEL_TEXT = "Cursor credits"
TEXT_FONT = "Helvetica-Bold"
INSTRUCTION_TITLE_FONT = "Helvetica-Bold"
INSTRUCTION_BODY_FONT = "Helvetica"
SERIAL_FONT = "Helvetica"
SERIAL_SIZE = 6.5

# Logo overlay inside the QR, as a fraction of the QR image width. With error
# correction level H a QR can lose ~30% of modules; 30% width ~= 9% area which
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
    """Rasterize an SVG to an RGB PIL image sized to `target_px` on the long side."""
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
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=20,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    if logo is not None:
        W, H = img.size
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


def draw_wrapped_text(c: canvas.Canvas, text: str, x: float, y: float,
                      max_w: float, line_h: float, font: str,
                      size: float) -> float:
    """Draw word-wrapped text and return the next y position."""
    c.setFont(font, size)
    words = text.split()
    line = ""
    for word in words:
        candidate = word if not line else f"{line} {word}"
        if c.stringWidth(candidate, font, size) <= max_w:
            line = candidate
            continue
        c.drawString(x, y, line)
        y -= line_h
        line = word
    if line:
        c.drawString(x, y, line)
        y -= line_h
    return y


def draw_instruction_page(c: canvas.Canvas) -> None:
    """Add a first page with print settings before the actual labels."""
    margin = 72.0
    y = PAGE_H - margin

    c.setFillColorRGB(0, 0, 0)
    c.setFont(INSTRUCTION_TITLE_FONT, 24)
    c.drawString(margin, y, "QR Label Printing Instructions")
    y -= 42

    instructions = [
        "Use US Letter paper and the matching 30-label-per-page sticker sheet.",
        "Print single-sided only.",
        "Set scale to 100% / Actual Size.",
        "Do not use Fit, Shrink oversized pages, Scale to fit, or borderless printing.",
        "Turn off automatic page rotation/centering options if your print dialog exposes them.",
        "Print page 2 first on plain paper and hold it against a label sheet to confirm alignment.",
        "After the test looks good, print pages 2 onward on the sticker sheets.",
        "Feed all label sheets in the same orientation. If your printer flips the stack, keep that orientation consistent between tests and final printing.",
    ]
    for item in instructions:
        c.setFont(INSTRUCTION_BODY_FONT, 13)
        c.drawString(margin, y, "-")
        y = draw_wrapped_text(
            c, item, margin + 18, y, PAGE_W - margin * 2 - 18,
            line_h=18, font=INSTRUCTION_BODY_FONT, size=13,
        )
        y -= 8

    y -= 10
    c.setFont(INSTRUCTION_TITLE_FONT, 13)
    c.drawString(margin, y, "Note:")
    y -= 20
    y = draw_wrapped_text(
        c,
        "The top two and bottom two rows intentionally include two copies of the QR code: one high and one low. This gives extra tolerance if the printer feeds the sheet slightly high or low.",
        margin, y, PAGE_W - margin * 2, line_h=18,
        font=INSTRUCTION_BODY_FONT, size=13,
    )
    y -= 16
    draw_wrapped_text(
        c,
        "Serial numbers like #1, #2, etc. are printed on each label for later audit/tracking.",
        margin, y, PAGE_W - margin * 2, line_h=18,
        font=INSTRUCTION_BODY_FONT, size=13,
    )

    c.showPage()


def is_edge_row(row: int) -> bool:
    """Return True for rows that benefit from duplicate QRs."""
    return row < EDGE_ROW_COUNT or row >= len(ROW_TOPS) - EDGE_ROW_COUNT


def draw_serial(c: canvas.Canvas, serial_number: int, label_left: float,
                label_bottom: float) -> None:
    """Print a small audit number inside the label."""
    text = f"#{serial_number}"
    c.setFont(SERIAL_FONT, SERIAL_SIZE)
    c.setFillColorRGB(0, 0, 0)
    text_w = c.stringWidth(text, SERIAL_FONT, SERIAL_SIZE)
    c.drawString(label_left + LABEL_W - text_w - 4.0, label_bottom + 4.0, text)


def draw_label(c: canvas.Canvas, url: str, serial_number: int, row: int,
               label_left: float, label_top: float, logo: Image.Image | None,
               text_size: float) -> None:
    """Render a single sticker cell (QR image + label text)."""
    label_bottom = label_top - LABEL_H

    qr_x = label_left + QR_LEFT_PAD_PT
    if is_edge_row(row):
        # Two full-size QRs: the left one rides high, the right one rides low.
        img = make_qr_image(url, logo)
        second_qr_x = qr_x + QR_SIZE_PT + DUPLICATE_QR_GAP_PT
        high_qr_y = label_top - EDGE_QR_TOP_BOTTOM_PAD_PT - QR_SIZE_PT
        low_qr_y = label_bottom + EDGE_QR_TOP_BOTTOM_PAD_PT
        for draw_x, draw_y in ((qr_x, high_qr_y), (second_qr_x, low_qr_y)):
            c.drawImage(
                img, draw_x, draw_y,
                width=QR_SIZE_PT, height=QR_SIZE_PT,
                preserveAspectRatio=True, mask="auto",
            )
        text_x = second_qr_x + QR_SIZE_PT + TEXT_GAP_PT
        text_size = fit_font_size(
            c, LABEL_TEXT, TEXT_FONT,
            LABEL_W - (text_x - label_left) - 2.0,
            max_size=text_size,
        )
    else:
        qr_y = label_bottom + (LABEL_H - QR_SIZE_PT) / 2
        img = make_qr_image(url, logo)
        c.drawImage(
            img, qr_x, qr_y, width=QR_SIZE_PT, height=QR_SIZE_PT,
            preserveAspectRatio=True, mask="auto",
        )
        text_x = qr_x + QR_SIZE_PT + TEXT_GAP_PT

    text_y = label_bottom + LABEL_H / 2 - text_size * 0.32
    c.setFont(TEXT_FONT, text_size)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(text_x, text_y, LABEL_TEXT)
    draw_serial(c, serial_number, label_left, label_bottom)


def draw_labels(c: canvas.Canvas, urls: list[str], logo: Image.Image | None) -> None:
    """Paint every URL onto the appropriate label cell, paginating as needed."""
    draw_instruction_page(c)
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
            serial_number=idx + 1,
            row=row,
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
        "--input", default=SCRIPT_DIR / "input.csv",
        help="Path to the list of URLs (one per line). Default: input.csv",
    )
    parser.add_argument(
        "--output-dir", default=SCRIPT_DIR / "output",
        help="Directory for generated PDFs. Default: output",
    )
    parser.add_argument(
        "--output-name", default="qr_labels_small.pdf",
        help="Filename for the main PDF. Default: qr_labels_small.pdf",
    )
    parser.add_argument(
        "--logo", default=SCRIPT_DIR / "logo.svg",
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
    c.setTitle(f"QR code labels - small ({len(urls)})")
    draw_labels(c, urls, logo)
    c.save()
    print(f"Wrote {out_path} with {len(urls)} QR code(s).")

    if args.draw_guides:
        guide_path = out_path.with_name(out_path.stem + "_guides" + out_path.suffix)
        c = canvas.Canvas(str(guide_path), pagesize=letter)
        c.setTitle(f"QR code labels - small with guides ({len(urls)})")
        draw_instruction_page(c)
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
                    serial_number=page_idx * LABELS_PER_PAGE + cell_idx + 1,
                    row=row,
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
