"""Inspect the proposed-network spreadsheet (data/navrh_2026_new2.xlsx).

Reads the workbook straight from its XML so it needs no third-party package.

    python scripts/analysis/inspect_proposal.py              # overview of every sheet
    python scripts/analysis/inspect_proposal.py --sheet 561  # one line's grid
    python scripts/analysis/inspect_proposal.py --json       # normalised, for the importer

The workbook holds one sheet per proposed line: stops down the rows, trips across the
columns. Times are Excel day-fractions (0.21875 -> 05:15), except for a handful of cells
typed as literal "HH:MM" text. A "~" means that trip does not serve that stop.
"""

import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

WORKBOOK = "data/navrh_2026_new2.xlsx"
SKIPPED = "~"


def column_sort_key(column):
    return (len(column), column)


def read_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{{{MAIN}}}t"))
        for item in root.findall(f"{{{MAIN}}}si")
    ]


def read_sheet_index(archive):
    """Sheet display names paired with their part paths, in workbook order."""
    relationships = {
        node.get("Id"): node.get("Target")
        for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")).findall(
            f"{{{PKG_REL}}}Relationship"
        )
    }
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    return [
        (node.get("name").strip(), relationships[node.get(f"{{{DOC_REL}}}id")])
        for node in workbook.iter(f"{{{MAIN}}}sheet")
    ]


def read_grid(archive, target, shared_strings):
    """Cells of one sheet as {(row, column_letters): text}."""
    path = "xl/" + target.lstrip("/").replace("xl/", "")
    grid = {}
    for cell in ET.fromstring(archive.read(path)).iter(f"{{{MAIN}}}c"):
        inline = cell.find(f"{{{MAIN}}}is")
        value = cell.find(f"{{{MAIN}}}v")
        if inline is not None:
            text = "".join(node.text or "" for node in inline.iter(f"{{{MAIN}}}t"))
        elif value is None:
            continue
        elif cell.get("t") == "s":
            text = shared_strings[int(value.text)]
        else:
            text = value.text
        row, column = re.match(r"([A-Z]+)(\d+)", cell.get("r")).groups()[::-1]
        grid[(int(row), column)] = text
    return grid


def to_minutes(cell):
    """Excel day-fraction or literal HH:MM to minutes after midnight, else None.

    Fractions are rounded to the nearest minute because the source rounds its own
    arithmetic: 0.21875 is exactly 05:15, but neighbouring cells carry long tails.
    """
    if cell is None or cell == SKIPPED:
        return None
    literal = re.fullmatch(r"(\d{1,2}):(\d{2})", cell.strip())
    if literal:
        return int(literal.group(1)) * 60 + int(literal.group(2))
    try:
        fraction = float(cell)
    except ValueError:
        return None
    return round(fraction * 1440)


def format_minutes(minutes):
    if minutes is None:
        return "  -  "
    return f"{minutes // 60 % 24:02d}:{minutes % 60:02d}"


def find_header_row(grid):
    """The row whose column A reads 'Tč' — trip numbers run along it."""
    for row in sorted({row for row, _ in grid}):
        if (grid.get((row, "A")) or "").strip() == "Tč":
            return row
    return None


def parse_line_sheet(grid):
    """One line sheet as {'line', 'stops', 'trips'}, trips holding per-stop minutes."""
    header_row = find_header_row(grid)
    if header_row is None:
        return None

    title = grid.get((1, "A")) or ""
    line = re.search(r"(\d{3})\s*$", title.strip())

    columns = sorted({column for _, column in grid}, key=column_sort_key)
    trip_columns = [
        column
        for column in columns
        if column_sort_key(column) > column_sort_key("C") and grid.get((header_row, column))
    ]

    stops = []
    for row in sorted({row for row, _ in grid}):
        if row <= header_row:
            continue
        name = grid.get((row, "B"))
        if not name:
            continue
        stops.append({"row": row, "name": name.strip(), "marker": (grid.get((row, "C")) or "").strip()})

    trips = []
    for column in trip_columns:
        times = [to_minutes(grid.get((stop["row"], column))) for stop in stops]
        if all(time is None for time in times):
            continue
        trips.append({"number": grid.get((header_row, column)), "times": times})

    return {
        "line": line.group(1) if line else title.strip(),
        "stops": [{"name": stop["name"], "marker": stop["marker"]} for stop in stops],
        "trips": trips,
    }


def overview(sheets, archive, shared_strings):
    for name, target in sheets:
        grid = read_grid(archive, target, shared_strings)
        parsed = parse_line_sheet(grid)
        if parsed is None:
            rows = sorted({row for row, _ in grid})
            print(f"{name!r}: summary sheet, {len(rows)} rows")
            for row in rows:
                cells = sorted(
                    ((column, grid[(row, column)]) for r, column in grid if r == row),
                    key=lambda pair: column_sort_key(pair[0]),
                )
                print("   " + " | ".join(f"{value[:22]}" for _, value in cells))
            continue
        served = sum(1 for trip in parsed["trips"] for time in trip["times"] if time is not None)
        print(
            f"line {parsed['line']}: {len(parsed['stops'])} stop rows, "
            f"{len(parsed['trips'])} trips, {served} served calls"
        )


def show_sheet(sheets, archive, shared_strings, wanted):
    for name, target in sheets:
        if name != wanted:
            continue
        parsed = parse_line_sheet(read_grid(archive, target, shared_strings))
        if parsed is None:
            print(f"{name!r} is not a line sheet", file=sys.stderr)
            return
        header = " ".join(f"{str(trip['number']):>5}" for trip in parsed["trips"])
        print(f"line {parsed['line']}\n{'stop':<28}{header}")
        for index, stop in enumerate(parsed["stops"]):
            label = f"{stop['name']} {stop['marker']}".strip()
            row = " ".join(f"{format_minutes(trip['times'][index]):>5}" for trip in parsed["trips"])
            print(f"{label[:27]:<28}{row}")
        return
    print(f"no sheet named {wanted!r}; try one of {[name for name, _ in sheets]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", default=WORKBOOK)
    parser.add_argument("--sheet", help="print one line sheet as a timetable grid")
    parser.add_argument("--json", action="store_true", help="dump every line sheet as JSON")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    archive = zipfile.ZipFile(args.workbook)
    shared_strings = read_shared_strings(archive)
    sheets = read_sheet_index(archive)

    if args.json:
        parsed = [parse_line_sheet(read_grid(archive, target, shared_strings)) for _, target in sheets]
        print(json.dumps([sheet for sheet in parsed if sheet], ensure_ascii=False, indent=1))
    elif args.sheet:
        show_sheet(sheets, archive, shared_strings, args.sheet)
    else:
        overview(sheets, archive, shared_strings)


if __name__ == "__main__":
    main()
