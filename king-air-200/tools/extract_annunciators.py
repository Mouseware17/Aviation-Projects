"""Build annunciator panel data for B200 (BB-1439, 1444 and subsequent).

Usage: python3 extract_annunciators.py <manual.pdf> <checklist.pdf> <site_dir>

Lens layout and colors come from the checklist's annunciator page; illumination causes
come from the training manual's Tables 4-3 and 4-6.
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

COLORS = {16766239: "amber", 831819: "green"}


def norm(t):
    return re.sub(r"[^A-Z0-9]", "", t.upper().replace("*", "").replace("CND", "COND"))


def layout(checklist_pdf):
    doc = pymupdf.open(checklist_pdf)
    page = next(p for p in doc if "WARNING ANNUNCIATOR PANEL" in p.get_text() and "CAUTION-ADVISORY" in p.get_text())
    page.set_rotation(0)
    lenses = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            s = l["spans"][0]
            if not s["font"].startswith("Futura") or l["dir"] == (1.0, 0.0):
                continue
            t = "".join(x["text"] for x in l["spans"]).strip()
            x0, y0, x1, y1 = l["bbox"]
            cy = (y0 + y1) / 2
            if cy < 180 and x0 < 200:
                continue  # NO TRANSFER light shown beside the panel
            lenses.append({"text": t, "row": round(x0), "col": -cy, "color": COLORS.get(s["color"], "red")})
    panels = {}
    for lens in lenses:
        key = "warning" if lens["color"] == "red" else "caution"
        panels.setdefault(key, []).append(lens)
    out = {}
    for key, ls in panels.items():
        rows = []
        for r in sorted({l["row"] for l in ls}):
            if not rows or r - rows[-1] > 4:
                rows.append(r)
        grid = []
        for r in rows:
            row, seen = [], set()
            for l in sorted([l for l in ls if 0 <= l["row"] - r <= 4], key=lambda l: l["col"]):
                key2 = (l["text"], round(l["col"] / 6))
                if key2 not in seen:
                    seen.add(key2)
                    row.append(l)
            grid.append([{"text": l["text"].replace("*", ""), "optional": l["text"].startswith("*"),
                          "blank": set(l["text"]) <= set("—-"), "color": l["color"]} for l in row])
        out[key] = grid
    return out


def table_rows(manual_pdf, title_re):
    doc = pymupdf.open(manual_pdf)
    rows = []
    for page in doc:
        text = page.get_text()
        if not re.search(title_re, text):
            continue
        for t in page.find_tables().tables:
            for row in t.rows:
                cells = []
                for c in row.cells:
                    if c is None:
                        cells.append("")
                        continue
                    words = page.get_text("words", clip=pymupdf.Rect(c))
                    words.sort(key=lambda w: (round(w[1]), w[0]))
                    cells.append(" ".join(w[4] for w in words))
                if len(cells) >= 3 and cells[0] and cells[0].upper() != "NOMENCLATURE":
                    rows.append({"name": cells[0].strip(), "color": cells[1].strip(), "cause": cells[2].strip()})
        if rows:
            break
    return rows


def main(manual_pdf, checklist_pdf, site):
    panels = layout(checklist_pdf)
    causes = {}
    for pat in (r"Table 4-3\.", r"Table 4-6\."):
        for r in table_rows(manual_pdf, pat):
            causes[norm(r["name"])] = r
    missing = []
    for grid in panels.values():
        for row in grid:
            for lens in row:
                if lens["blank"]:
                    continue
                c = causes.get(norm(lens["text"]))
                if c:
                    lens["cause"] = c["cause"]
                else:
                    missing.append(lens["text"])
    data = {"serials": "B200 BB-1439, 1444 and subsequent", "panels": panels}
    Path(site, "data").mkdir(exist_ok=True)
    js = "window.ANNUNCIATORS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    Path(site, "data", "annunciators.js").write_text(js, encoding="utf-8")
    print("lenses:", {k: sum(len(r) for r in g) for k, g in panels.items()}, "missing causes:", missing)


if __name__ == "__main__":
    main(*sys.argv[1:4])
