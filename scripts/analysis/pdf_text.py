"""Extract text from the timetable PDFs.

    python scripts/analysis/pdf_text.py data/jizdni_rady_2026.pdf
    python scripts/analysis/pdf_text.py data/jizdni_rady_2026.pdf --pages 1-3
    python scripts/analysis/pdf_text.py data/jr_260614/L745563_260614_423975.pdf --layout

Needs pypdf. `--layout` keeps horizontal spacing, which is what makes a timetable
column readable; the default flow is better for prose and headers.
"""

import argparse
import sys

from pypdf import PdfReader


def parse_pages(spec, total):
    if not spec:
        return range(total)
    first, _, last = spec.partition("-")
    start = int(first) - 1
    end = int(last) if last else int(first)
    return range(max(0, start), min(total, end))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--pages", help="1-based page or range, e.g. 3 or 2-5")
    parser.add_argument("--layout", action="store_true", help="preserve horizontal layout")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    reader = PdfReader(args.path)
    mode = "layout" if args.layout else "plain"

    for index in parse_pages(args.pages, len(reader.pages)):
        print(f"\n{'=' * 12} page {index + 1} of {len(reader.pages)}")
        print(reader.pages[index].extract_text(extraction_mode=mode))


if __name__ == "__main__":
    main()
