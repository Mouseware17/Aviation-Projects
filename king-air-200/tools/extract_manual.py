"""Extract the Super King Air 200/B200 Pilot Training Manual PDF into site data.

Usage: python3 extract_manual.py <manual.pdf> <site_dir>

Writes <site_dir>/data/manual.js (chapters, blocks, figures, tables, quizzes)
and renders every figure and table crop to <site_dir>/figures/*.webp.
"""
import html
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf
from PIL import Image

HEADER_Y, FOOTER_Y = 88, 735
TITLES = {1: "Aircraft General", 2: "Electrical Power Systems", 3: "Lighting", 4: "Master Warning System",
          5: "Fuel System", 6: "Auxiliary Power Unit", 7: "Powerplant", 8: "Fire Protection", 9: "Pneumatics",
          10: "Ice and Rain Protection", 11: "Air-Conditioning System", 12: "Pressurization",
          13: "Hydraulic Power Systems", 14: "Landing Gear and Brakes", 15: "Flight Controls", 16: "Avionics",
          17: "Miscellaneous Systems", 18: "Weight and Balance / Performance"}
SCALE = 2.4
CALLOUT_LABELS = {"NOTE", "CAUTION", "WARNING"}
CAPTION_RE = re.compile(r"^(Figure|Table)\s+([A-Z]*-?\d+-?\d*)\.\s*(.*)$")


def line_text(line):
    return "".join(s["text"] for s in line["spans"]).strip()


def span_html(spans):
    out = []
    for s in spans:
        t = html.escape(s["text"])
        if not t.strip():
            out.append(t)
            continue
        if "Italic" in s["font"]:
            t = f"<em>{t}</em>"
        elif s["font"].startswith("Times-Bold"):
            t = f"<strong>{t}</strong>"
        out.append(t)
    return re.sub(r"</em><em>|</strong><strong>", "", "".join(out)).strip()


def classify(line):
    s = line["spans"][0]
    font, size = s["font"], s["size"]
    text = line_text(line)
    y0, y1 = line["bbox"][1], line["bbox"][3]
    if y1 < HEADER_Y or y0 > FOOTER_Y:
        return "chrome"
    if line["dir"] != (1.0, 0.0):
        return "graphic"
    if font.startswith("Helvetica-Bold") and 10.5 <= size <= 11.4 and CAPTION_RE.match(text):
        return "caption"
    if text in CALLOUT_LABELS and font.startswith("Helvetica") and 11.8 <= size <= 13.2:
        return "label"
    if font == "Helvetica-Bold" and abs(size - 19) < 0.3:
        return "h2"
    if font == "Helvetica-Bold" and abs(size - 15) < 0.3:
        return "h3"
    if font.startswith("Helvetica-Bold") and size >= 24:
        return "chapter-title"
    if font.startswith("Times") and 10.4 <= size <= 13.8:
        return "body"
    return "graphic"


def rect_of(b):
    return pymupdf.Rect(b)


def center_in(r, region):
    c = pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
    return region.contains(c)


class Page:
    def __init__(self, page):
        if page.rotation:
            page.set_rotation(0)
        self.page = page
        self.num = page.number + 1
        self.lines = []
        self.label = ""
        d = page.get_text("dict")
        for b in d["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                t = line_text(l)
                if not t:
                    continue
                kind = classify(l)
                r = rect_of(l["bbox"])
                s = l["spans"][0]
                if kind == "chrome" and s["font"] == "Helvetica-Bold" and abs(s["size"] - 11.5) < 0.3 and r.y0 > FOOTER_Y:
                    self.label = t
                self.lines.append({"kind": kind, "rect": r, "text": t, "spans": l["spans"], "dir": l["dir"]})
        self.rotated = any(l["kind"] == "graphic" and CAPTION_RE.match(l["text"]) and l["dir"] != (1.0, 0.0)
                           for l in self.lines)
        if not self.label:
            for l in self.lines:
                if re.fullmatch(r"[A-Z]*-?\d+-[\divx]+|[A-Z]+-\d+", l["text"]) and l["spans"][0]["size"] > 10:
                    self.label = l["text"]
        lefts = Counter(round(l["rect"].x0) for l in self.lines if l["kind"] == "body")
        self.mid = 324 if lefts.get(84, 0) + lefts.get(85, 0) >= lefts.get(48, 0) + lefts.get(49, 0) else 288

    def graphics(self):
        els = []
        for d in self.page.get_drawings():
            r = d["rect"]
            if r.y1 < HEADER_Y + 2 or r.y0 > FOOTER_Y - 2 or r.is_empty and r.width == 0 and r.height == 0:
                continue
            if r.width > 500 and r.height > 600:
                continue
            els.append(r)
        for info in self.page.get_image_info():
            r = pymupdf.Rect(info["bbox"])
            if r.y1 > HEADER_Y and r.y0 < FOOTER_Y:
                els.append(r)
        for l in self.lines:
            if l["kind"] == "graphic":
                els.append(l["rect"])
        return els


def grow_region(seed_rects, els, blockers, limit_top, cap_rect):
    region = None
    for r in seed_rects:
        region = r if region is None else region | r
    if region is None:
        return None
    changed = True
    while changed:
        changed = False
        probe = pymupdf.Rect(region.x0 - 14, region.y0 - 14, region.x1 + 14, region.y1 + 14)
        for r in els:
            if r.y0 < limit_top or r.y0 > cap_rect.y0 - 4 or r.y1 > cap_rect.y1 + 60:
                continue
            if region.contains(r) or not probe.intersects(r):
                continue
            cand = region | r
            if any(cand.intersects(b) and not region.intersects(b) for b in blockers):
                continue
            region = cand
            changed = True
    return region


def figure_regions(pg):
    """Return [(caption_line, region_rect, kind)] for figures and tables on the page."""
    out = []
    caps = [l for l in pg.lines if l["kind"] == "caption"]
    els = pg.graphics()
    body = [l["rect"] for l in pg.lines if l["kind"] in ("body", "h2", "h3", "label")]
    tables = []
    if any(c["text"].startswith("Table") for c in caps):
        try:
            tables = [pymupdf.Rect(t.bbox) for t in pg.page.find_tables().tables]
        except Exception:
            tables = []
    for cap in caps:
        cr = cap["rect"]
        kind = cap["text"].split()[0].lower()
        if kind == "table":
            below = [t for t in tables if t.y0 >= cr.y0 - 4 and t.y0 - cr.y1 < 60]
            if below:
                region = below[0]
                for t in tables:
                    if t is not below[0] and t.y0 >= region.y1 - 2 and t.y0 - region.y1 < 30:
                        region = region | t
                foot = [l["rect"] for l in pg.lines if l["kind"] != "chrome" and l["rect"].y0 >= region.y1
                        and l["rect"].y0 - region.y1 < 16 and l["spans"][0]["size"] < 10.5]
                for f in foot:
                    region = region | f
                out.append((cap, region, "table"))
                continue
            # caption may sit above a borderless table drawn with graphics text
            seeds = [r for r in els if r.y0 >= cr.y1 - 2 and r.y0 - cr.y1 < 40]
            region = None
            if seeds:
                region = seeds[0]
                for r in seeds:
                    region |= r
                changed = True
                while changed:
                    changed = False
                    probe = pymupdf.Rect(region.x0 - 14, region.y0 - 14, region.x1 + 14, region.y1 + 14)
                    for r in els:
                        if r.y0 >= cr.y1 - 2 and probe.intersects(r) and not region.contains(r):
                            region |= r
                            changed = True
            out.append((cap, region, "table"))
            continue
        peers = [c["rect"] for c in caps if c is not cap and abs(c["rect"].y0 - cr.y0) < 40
                 and c["text"].startswith("Figure")
                 and abs((c["rect"].x0 + c["rect"].x1) / 2 - (cr.x0 + cr.x1) / 2) > 80]
        xmin, xmax = 0, 10_000
        cx = (cr.x0 + cr.x1) / 2
        for pr in peers:
            px = (pr.x0 + pr.x1) / 2
            if px < cx:
                xmin = max(xmin, (px + cx) / 2)
            else:
                xmax = min(xmax, (px + cx) / 2)
        els_here = [r for r in els if r.x0 >= xmin - 4 and r.x1 <= xmax + 4]
        imgs = [pymupdf.Rect(i["bbox"]) for i in pg.page.get_image_info()]
        above = [c["rect"] for c in caps if c is not cap and c["rect"].y1 <= cr.y0 and
                 min(c["rect"].x1, cr.x1) - max(c["rect"].x0, cr.x0) > 10]
        limit_top = max([r.y1 for r in above], default=HEADER_Y)
        blockers = [b for b in body if b.y1 <= cr.y0 + 2]
        seeds = [r for r in els_here if r.y0 < cr.y0 - 4 and r.y1 <= cr.y1 + 60 and cr.y0 - r.y1 < 48
                 and r.y0 >= limit_top - 2 and r.x1 > cr.x0 - 160 and r.x0 < cr.x1 + 160]
        seeds = [r for r in seeds if r in imgs or not any(r.intersects(b) for b in blockers)]
        region = grow_region(seeds, [r for r in els_here if not any(r.intersects(b) for b in blockers)],
                             blockers, limit_top, cr)
        if region is not None:
            region = avoid_text(region, body + [c["rect"] for c in caps])
        out.append((cap, region, "figure"))
    return out


def render(page, region, path, rotate=0, bottom=None):
    if page.rotation:
        page.set_rotation(0)
    clip = pymupdf.Rect(region.x0 - 6, region.y0 - 6, region.x1 + 6, region.y1 + 6) & page.rect
    if bottom is not None:
        clip.y1 = min(clip.y1, bottom)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=clip, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    if rotate:
        img = img.rotate(rotate, expand=True)
    img.save(path, "WEBP", quality=78, method=6)
    return img.size


def avoid_text(region, lines):
    """Shrink a figure region until no body text or heading line sits inside it."""
    for _ in range(40):
        hits = [l for l in lines if (region & l).get_area() > 0.25 * l.get_area()]
        if not hits:
            return region
        l = hits[0]
        options = []
        if l.x0 > region.x0 + 10:
            options.append(pymupdf.Rect(region.x0, region.y0, l.x0 - 2, region.y1))
        if l.x1 < region.x1 - 10:
            options.append(pymupdf.Rect(l.x1 + 2, region.y0, region.x1, region.y1))
        if l.y0 > region.y0 + 6:
            options.append(pymupdf.Rect(region.x0, region.y0, region.x1, l.y0 - 2))
        if l.y1 < region.y1 - 6:
            options.append(pymupdf.Rect(region.x0, l.y1 + 2, region.x1, region.y1))
        if not options:
            return region
        region = max(options, key=lambda r: r.get_area())
    return region


PLAIN = Counter()


def dehyphen_vocab(doc_pages):
    words = Counter()
    for pg in doc_pages:
        for l in pg.lines:
            if l["kind"] == "body":
                for w in re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)+", l["text"]):
                    words[w.lower()] += 1
                for w in re.findall(r"(?<![-A-Za-z])[A-Za-z]{4,}(?![-A-Za-z])", l["text"][:-1]):
                    PLAIN[w.lower()] += 1
    return words


def join_lines(parts, vocab):
    text = ""
    for p in parts:
        if not text:
            text = p
            continue
        m = re.search(r"([A-Za-z]+)-$", text)
        nxt = re.match(r"([A-Za-z]+)", re.sub(r"<[^>]+>", "", p))
        if m and nxt and not text.endswith("--"):
            hyph = f"{m.group(1)}-{nxt.group(1)}".lower()
            if vocab.get(hyph, 0) > 0 and nxt.group(1)[0].islower():
                text = text + p
            elif nxt.group(1)[0].isupper() and m.group(1).isupper() and \
                    PLAIN.get((m.group(1) + nxt.group(1)).lower(), 0) == 0:
                text = text + p
            else:
                text = text[:-1] + p
        elif re.search(r"\d-$", text) or text.endswith("—") or text.endswith("/"):
            text = text + (" " if text.endswith("-") and p[:1].isalpha() else "") + p
        else:
            text = text + " " + p
    return re.sub(r"\s+", " ", text).strip()


def merge_same_row(lines, mid):
    """Merge lines sitting on the same baseline within one column (bullets, list numbers)."""
    lines = sorted(lines, key=lambda l: (round(l["rect"].y0), l["rect"].x0))
    out = []
    for l in lines:
        if out and abs(out[-1]["rect"].y0 - l["rect"].y0) < 2.5 and l["rect"].x0 - out[-1]["rect"].x1 < 20 \
                and out[-1]["kind"] == l["kind"] == "body" and (out[-1]["rect"].x1 < mid) == (l["rect"].x1 < mid):
            prev = out[-1]
            prev["text"] = prev["text"] + " " + l["text"]
            prev["spans"] = prev["spans"] + [{"text": " ", "font": "Times-Roman"}] + l["spans"]
            prev["rect"] = prev["rect"] | l["rect"]
        else:
            out.append(dict(l))
    return out


def order_page(pg, items):
    """Order items (dicts with rect) in two-column reading order with full-width bands."""
    mid = pg.mid
    full = [i for i in items if i["rect"].x0 < mid - 12 and i["rect"].x1 > mid + 12]
    full.sort(key=lambda i: i["rect"].y0)
    bounds = [HEADER_Y] + [i["rect"].y0 for i in full] + [10_000]
    ordered = []
    rest = [i for i in items if i not in full]
    for bi in range(len(bounds) - 1):
        top, bottom = bounds[bi], bounds[bi + 1]
        band = [i for i in rest if top - 1 <= (i["rect"].y0 + i["rect"].y1) / 2 < bottom]
        left = sorted([i for i in band if (i["rect"].x0 + i["rect"].x1) / 2 < mid], key=lambda i: i["rect"].y0)
        right = sorted([i for i in band if (i["rect"].x0 + i["rect"].x1) / 2 >= mid], key=lambda i: i["rect"].y0)
        for i in left:
            i["col"] = (bi, 0)
        for i in right:
            i["col"] = (bi, 1)
        ordered += left + right
        if bi < len(full):
            full[bi]["col"] = (bi, 2)
            ordered.append(full[bi])
    return ordered


def main(pdf, site):
    site = Path(site)
    figdir = site / "figures"
    figdir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    pages = [Page(p) for p in doc]

    toc = doc.get_toc()
    starts = []
    for lvl, title, pno in toc:
        if lvl == 1 and pno >= 5:
            starts.append((title, pno))
    chapters = []
    for idx, (title, pno) in enumerate(starts):
        end = starts[idx + 1][1] - 1 if idx + 1 < len(starts) else len(pages)
        m = re.match(r"CHAPTER (\d+) (.*)", title)
        if m:
            num, name = int(m.group(1)), m.group(2).strip()
        else:
            num, name = None, title.strip()
        chapters.append({"num": num, "title": TITLES.get(num, name.title() if name.isupper() else name), "raw": name,
                         "start": pno, "end": end})

    vocab = dehyphen_vocab(pages)
    figures = {}
    all_chapters = []
    for ch in chapters:
        cid = f"ch{ch['num']}" if ch["num"] else re.sub(r"[^a-z]+", "-", ch["raw"].lower()).strip("-")
        blocks = []
        quiz_lines = []
        in_quiz = False
        first_page = None
        if cid == "walkaround":
            wa = extract_walkaround(pages, ch["start"] + 1, ch["end"], figdir, figures)
            all_chapters.append({"id": cid, "num": None, "title": "Walkaround", "page": "WA-1", "raw": [],
                                 "quiz_pages": [], "walkaround": wa})
            continue
        if cid == "annunciator-panels":
            spreads = extract_spreads(pdf, ch["start"], ch["end"], figdir, figures, cid)
            all_chapters.append({"id": cid, "num": None, "title": "Annunciator Panels", "page": "ANN-1", "raw": [],
                                 "quiz_pages": [], "spreads": spreads})
            continue
        if cid == "answers-to-questions":
            continue
        for pno in range(ch["start"], ch["end"] + 1):
            pg = pages[pno - 1]
            if re.search(r"-[ivx]+$", pg.label):
                continue  # chapter front matter (contents / illustration lists)
            if first_page is None:
                first_page = pg.label
            if any(l["kind"] == "h2" and l["text"] == "QUESTIONS" for l in pg.lines) or in_quiz:
                in_quiz = True
                quiz_lines.append(pg)
                continue
            items = []
            used = set()
            regions = figure_regions(pg)
            for cap, region, kind in regions:
                m = CAPTION_RE.match(cap["text"])
                fid = f"{m.group(1)[0].lower()}{m.group(2)}"
                title = m.group(3).strip()
                cont = "(Cont)" in title or "(cont" in title.lower()
                title = re.sub(r"\s*\((?:Cont|cont)\.?\)\s*$", "", title).strip()
                key = fid
                n = 1
                while key in figures:
                    n += 1
                    key = f"{fid}~{n}"
                if region is None or region.is_empty or region.width < 20 or region.height < 12:
                    continue
                for l in pg.lines:
                    if l["kind"] in ("body", "graphic", "label") and center_in(l["rect"], region):
                        used.add(id(l))
                fname = f"{key.replace('~', '_')}.webp"
                size = render(pg.page, region, figdir / fname,
                              bottom=cap["rect"].y0 - 1 if kind == "figure" and cap["rect"].y0 > region.y0 + 10 else None)
                region_text = " ".join(l["text"] for l in pg.lines if id(l) in used and center_in(l["rect"], region))
                figures[key] = {"id": key, "num": m.group(2), "kind": kind, "title": title, "cont": cont,
                                "file": f"figures/{fname}", "w": size[0], "h": size[1], "page": pg.label,
                                "chapter": cid, "text": re.sub(r"\s+", " ", region_text)[:1200]}
                anchor = pymupdf.Rect(region.x0, region.y0, region.x1, cap["rect"].y1 if kind == "figure" else region.y1)
                if kind == "table":
                    anchor = cap["rect"] | region
                items.append({"type": "figure", "id": key, "rect": anchor})
                used.add(id(cap))
            if pg.rotated:
                caps = [l for l in pg.lines if CAPTION_RE.match(l["text"]) and l["dir"] != (1.0, 0.0)]
                for cap in caps:
                    m = CAPTION_RE.match(cap["text"])
                    fid = f"{m.group(1)[0].lower()}{m.group(2)}"
                    key = fid
                    n = 1
                    while key in figures:
                        n += 1
                        key = f"{fid}~{n}"
                    region = pymupdf.Rect(40, 40, 572, 752)
                    # rotated pages: crop to graphics extent, excluding the running header band
                    els = [r for r in pg.graphics()]
                    gx = [r for r in pg.page.get_drawings()]
                    ext = None
                    for l in pg.lines:
                        if l is cap or l["text"] in ("FOR TRAINING PURPOSES ONLY",) or "PILOT TRAINING MANUAL" in l["text"] \
                                or "FlightSafety" in l["text"] or l["text"] == "international" or l["text"] == pg.label:
                            continue
                        ext = l["rect"] if ext is None else ext | l["rect"]
                    for r in els:
                        if r.width > 400 and r.height > 600:
                            continue
                        if ext is not None and (r.x1 > 560 or r.x0 < 30):
                            continue
                        ext = r if ext is None else ext | r
                    if ext is not None:
                        region = ext & pymupdf.Rect(30, 30, 582, 762)
                    # exclude the header band (vertical title strip) on the outer edge
                    hdr = [l["rect"] for l in pg.lines if "PILOT TRAINING MANUAL" in l["text"] or "FlightSafety" in l["text"]]
                    for h in hdr:
                        if h.x0 > 400 and region.x1 > h.x0 - 4:
                            region.x1 = h.x0 - 6
                        if h.x1 < 200 and region.x0 < h.x1 + 4:
                            region.x0 = h.x1 + 6
                    foot = [l["rect"] for l in pg.lines if l["text"] in ("FOR TRAINING PURPOSES ONLY", pg.label)]
                    for h in foot:
                        if h.x1 < 120 and region.x0 < h.x1 + 4:
                            region.x0 = h.x1 + 6
                        if h.x0 > 480 and region.x1 > h.x0 - 4:
                            region.x1 = h.x0 - 6
                    ccx = (cap["rect"].x0 + cap["rect"].x1) / 2
                    if ccx > (region.x0 + region.x1) / 2:
                        region.x1 = min(region.x1, cap["rect"].x0 - 2)
                    else:
                        region.x0 = max(region.x0, cap["rect"].x1 + 2)
                    rot = -90 if cap["dir"][1] < 0 else 90
                    fname = f"{key.replace('~', '_')}.webp"
                    size = render(pg.page, region, figdir / fname, rotate=rot)
                    title = re.sub(r"\s*\((?:Cont|cont)\.?\)\s*$", "", m.group(3).strip())
                    figures[key] = {"id": key, "num": m.group(2), "kind": "figure", "title": title,
                                    "cont": "(Cont" in m.group(3), "file": f"figures/{fname}", "w": size[0],
                                    "h": size[1], "page": pg.label, "chapter": cid,
                                    "text": re.sub(r"\s+", " ", " ".join(l["text"] for l in pg.lines if l["kind"] == "graphic"))[:1200]}
                    items.append({"type": "figure", "id": key, "rect": pymupdf.Rect(0, 100, 612, 700)})
                    used.add(id(cap))
                for l in pg.lines:
                    used.add(id(l))
            text_lines = [l for l in pg.lines if id(l) not in used and l["kind"] in ("body", "h2", "h3", "label")]
            text_lines = merge_same_row(text_lines, pg.mid)
            for l in text_lines:
                items.append({"type": l["kind"], "rect": l["rect"], "line": l})
            for it in order_page(pg, items):
                it["page"] = pg.label
                it["pno"] = pno
                blocks.append(it)
        all_chapters.append({"id": cid, "num": ch["num"], "title": ch["title"], "page": first_page,
                             "raw": blocks, "quiz_pages": quiz_lines})

    out_chapters = []
    for ch in all_chapters:
        built = build_blocks(ch, vocab, figures)
        if ch.get("walkaround"):
            built["walkaround"] = ch["walkaround"]
        if ch.get("spreads"):
            built["blocks"] = ch["spreads"]
        if not built["blocks"] and not ch.get("walkaround"):
            built["blocks"] = [{"t": "p", "text": "The information normally contained in this chapter is not "
                                "applicable to this airplane.", "page": ch["page"] or ""}]
            built["na"] = True
        out_chapters.append(built)
    answers = parse_answers(pages)
    for ch in out_chapters:
        ch["quiz"] = parse_quiz(ch.pop("quiz_pages"), answers.get(ch["num"], {}), vocab)
    data = {"chapters": out_chapters, "figures": figures}
    (site / "data").mkdir(exist_ok=True)
    js = "window.MANUAL = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (site / "data" / "manual.js").write_text(js, encoding="utf-8")
    print(f"chapters={len(out_chapters)} figures={len(figures)} bytes={len(js)}")


def extract_walkaround(pages, start, end, figdir, figures):
    """Photo walkaround: overview photos with numbered markers, close-ups with numbered captions."""
    overviews, items, notes, legend = [], [], [], []
    for pno in range(start, end + 1):
        pg = pages[pno - 1]
        imgs = [pymupdf.Rect(i["bbox"]) for i in pg.page.get_image_info()]
        imgs = [r for r in imgs if r.width > 60 and r.height > 40]
        if not imgs:
            continue
        small = [l for l in pg.lines if l["kind"] == "graphic" and l["spans"][0]["size"] < 9.5]
        caps = [l for l in small if re.match(r"^\d+\.\s", l["text"]) and l["spans"][0]["font"].startswith("Helvetica-Bold")]
        conts = [l for l in small if l not in caps and not re.fullmatch(r"[\d\s]+", l["text"])]
        for k, r in enumerate(sorted(imgs, key=lambda r: (round(r.y0), r.x0))):
            marks = [l for l in small if re.fullmatch(r"\d+(\s+\d+)*", l["text"]) and r.contains(l["rect"])]
            fname = f"wa-{pno}-{k}.webp"
            size = render(pg.page, r, figdir / fname)
            if len(marks) >= 4:
                ms = []
                for l in marks:
                    nums = l["text"].split()
                    w = l["rect"].width / max(1, len(nums))
                    for i, n in enumerate(nums):
                        cx = l["rect"].x0 + w * (i + 0.5)
                        cy = (l["rect"].y0 + l["rect"].y1) / 2
                        ms.append({"n": int(n), "x": round((cx - r.x0 + 6) / (r.width + 12), 4),
                                   "y": round((cy - r.y0 + 6) / (r.height + 12), 4)})
                overviews.append({"file": f"figures/{fname}", "w": size[0], "h": size[1], "markers": ms, "page": pg.label})
                continue
            below = [c for c in caps if 0 <= c["rect"].y0 - r.y1 < 40 and c["rect"].x0 >= r.x0 - 4 and c["rect"].x0 < r.x1]
            below.sort(key=lambda c: c["rect"].y0)
            for c in below:
                c["used"] = True
            entry = {"file": f"figures/{fname}", "w": size[0], "h": size[1], "page": pg.label, "items": [], "rect": r}
            for c in below:
                txt = c["text"]
                for cont in conts:
                    if 0 < cont["rect"].y0 - c["rect"].y0 < 10 and abs(cont["rect"].x0 - c["rect"].x0) < 40:
                        txt += " " + cont["text"]
                m = re.match(r"^(\d+)\.\s+(.*)$", txt)
                parts = re.split(r"\s*[—–]\s*", m.group(2), maxsplit=1)
                entry["items"].append({"n": int(m.group(1)), "item": parts[0].strip(),
                                       "action": parts[1].strip() if len(parts) > 1 else ""})
            items.append(entry)
        for c in caps:
            if c.get("used"):
                continue
            txt = c["text"]
            for cont in conts:
                if 0 < cont["rect"].y0 - c["rect"].y0 < 10 and abs(cont["rect"].x0 - c["rect"].x0) < 40:
                    txt += " " + cont["text"]
            m = re.match(r"^(\d+)\.\s+(.*)$", txt)
            parts = re.split(r"\s*[—–]\s*", m.group(2), maxsplit=1)
            legend.append({"n": int(m.group(1)), "item": parts[0].strip(),
                           "action": parts[1].strip() if len(parts) > 1 else "", "page": pg.label})
        heads = [l["text"] for l in pg.lines if l["kind"] in ("h2", "h3", "label") or
                 (l["kind"] == "graphic" and l["spans"][0]["size"] >= 11 and "Figure" not in l["text"])]
        notes += [h for h in heads if h not in ("WALKAROUND", "WALKAROUND INSPECTION")]
    # photos without their own caption belong to the captioned photo beside them
    groups = []
    for e in items:
        if e["items"] or not groups:
            groups.append({"photos": [e], "items": list(e["items"]), "page": e["page"]})
            continue
        same_row = [g for g in groups if g["page"] == e["page"] and abs(g["photos"][0]["rect"].y0 - e["rect"].y0) < 4]
        (same_row[-1] if same_row else groups[-1])["photos"].append(e)
    for g in groups:
        for ph in g["photos"]:
            ph.pop("rect", None)
            ph.pop("items", None)
    have = {i["n"] for g in groups for i in g["items"]}
    legend = sorted({i["n"]: i for i in legend if i["n"] not in have}.values(), key=lambda i: i["n"])
    return {"overviews": overviews, "stations": [g for g in groups if g["items"]], "legend": legend, "notes": notes}


def extract_spreads(pdf, start, end, figdir, figures, cid):
    doc = pymupdf.open(pdf)
    out = []
    for pno in range(start, end + 1):
        page = doc[pno - 1]
        caps = [l for b in page.get_text("dict")["blocks"] if b["type"] == 0 for l in b["lines"]
                if CAPTION_RE.match(line_text(l))]
        if not caps:
            continue
        m = CAPTION_RE.match(line_text(caps[0]))
        pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), alpha=False)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        w, h = img.size
        img = img.crop((int(w * 0.02), int(h * 0.115), int(w * 0.98), int(h * 0.9)))
        key = f"f{m.group(2)}"
        n = 1
        while key in figures:
            n += 1
            key = f"f{m.group(2)}~{n}"
        fname = f"{key.replace('~', '_')}.webp"
        img.save(figdir / fname, "WEBP", quality=80, method=6)
        figures[key] = {"id": key, "num": m.group(2), "kind": "figure", "title": m.group(3).strip(), "cont": False,
                        "file": f"figures/{fname}", "w": img.size[0], "h": img.size[1], "page": "",
                        "chapter": cid, "text": ""}
        out.append({"t": "fig", "id": key, "page": ""})
    return out


def build_blocks(ch, vocab, figures):
    out = []
    para = None  # {"lines": [...], "x0": float, "col": ...}
    callout = None
    pending = []

    def flush():
        nonlocal para, pending
        if para:
            text = join_lines(para["parts"], vocab)
            if para["kind"] == "li":
                out.append({"t": "li", "text": text, "marker": para["marker"], "lvl": para["lvl"], "page": para["page"]})
            else:
                out.append({"t": "p", "text": text, "page": para["page"]})
        para = None
        out.extend(pending)
        pending = []

    def flush_callout():
        nonlocal callout, pending
        if callout:
            flush_inner = join_lines(callout["parts"], vocab)
            out.append({"t": "callout", "kind": callout["kind"].lower(), "text": flush_inner, "page": callout["page"]})
        callout = None
        if not para:
            out.extend(pending)
            pending.clear()

    prev = None
    heading_buf = None
    for it in ch["raw"]:
        if it["type"] == "figure":
            fig = {"t": "fig", "id": it["id"], "page": it["page"]}
            if callout and callout["parts"] and not re.search(r"[.!?:]\)?$", re.sub(r"<[^>]+>", "", callout["parts"][-1])):
                pending.append(fig)
                prev = it
                continue
            flush_callout()
            if para:
                pending.append(fig)
            else:
                out.append(fig)
            prev = it
            continue
        l = it["line"]
        kind = it["type"]
        r = l["rect"]
        if kind in ("h2", "h3"):
            flush()
            flush_callout()
            if heading_buf and heading_buf["kind"] == kind and prev is not None and prev.get("type") == kind \
                    and r.y0 - prev["rect"].y1 < 6:
                heading_buf["text"] += " " + l["text"]
                prev = it
                continue
            if heading_buf:
                out.append({"t": heading_buf["kind"], "text": heading_buf["text"], "page": heading_buf["page"]})
            heading_buf = {"kind": kind, "text": l["text"], "page": it["page"]}
            prev = it
            continue
        if heading_buf:
            out.append({"t": heading_buf["kind"], "text": heading_buf["text"], "page": heading_buf["page"]})
            heading_buf = None
        if kind == "label":
            flush()
            flush_callout()
            callout = {"kind": l["text"], "parts": [], "page": it["page"], "x0": None, "label_rect": r, "col": it["col"]}
            prev = it
            continue
        text = span_html(l["spans"])
        if callout is not None:
            same_col = it["col"] == callout["col"]
            inside = same_col and r.y0 >= callout["label_rect"].y1 - 2 and (
                not callout["parts"] or r.y0 - callout["last"].y1 < 9)
            mid_sentence = callout["parts"] and not re.search(r"[.!?:]\)?$", re.sub(r"<[^>]+>", "", callout["parts"][-1])) \
                and l["text"][:1].islower()
            if mid_sentence or inside and (callout["x0"] is None or abs(r.x0 - callout["x0"]) < 30):
                callout["parts"].append(text)
                callout["x0"] = callout["x0"] if callout["x0"] is not None and not mid_sentence else r.x0
                callout["col"] = it["col"]
                callout["last"] = r
                prev = it
                continue
            flush_callout()
        plain = l["text"]
        m_num = re.match(r"^(\d{1,2})\.\s+(.*)$", plain)
        m_bul = re.match(r"^([•▪])\s*(.*)$", plain)
        m_let = re.match(r"^([a-h])\.\s+(.*)$", plain)
        new_par = True
        if para and prev is not None and prev.get("type") == "body":
            pr = prev["rect"]
            same_col = prev.get("col") == it.get("col") and prev.get("pno") == it.get("pno")
            if same_col:
                gap = r.y0 - pr.y1
                new_par = gap > 5.5
            else:
                last = re.sub(r"<[^>]+>", "", para["parts"][-1])
                new_par = bool(re.search(r"[.:!?]\)?[”\"]?$", last)) and not plain[:1].islower()
        elif para and prev is not None and prev.get("type") == "figure":
            last = re.sub(r"<[^>]+>", "", para["parts"][-1])
            new_par = bool(re.search(r"[.:!?]\)?$", last)) and not plain[:1].islower()
        if m_num or m_bul or m_let:
            new_par = True
        if para and para["kind"] == "li" and not (m_num or m_bul or m_let) and new_par is False:
            pass
        elif para and para["kind"] == "li" and not (m_num or m_bul or m_let) and prev is not None \
                and prev.get("col") == it.get("col") and r.x0 > para["x0"] + 6 and r.y0 - prev["rect"].y1 < 9:
            new_par = False
        if new_par:
            flush()
            if m_num or m_bul or m_let:
                marker = (m_num or m_bul or m_let).group(1)
                body = re.sub(r"^\s*(\d{1,2}\.|[•▪]|[a-h]\.)\s*", "", text, count=1)
                lvl = 2 if m_bul else (2 if m_let else 1)
                para = {"kind": "li", "parts": [body], "marker": marker, "lvl": lvl, "page": it["page"], "x0": r.x0}
            else:
                para = {"kind": "p", "parts": [text], "page": it["page"], "x0": r.x0}
        else:
            para["parts"].append(text)
        prev = it
    flush()
    flush_callout()
    if heading_buf:
        out.append({"t": heading_buf["kind"], "text": heading_buf["text"], "page": heading_buf["page"]})

    merged = []
    for b in out:
        if b["t"] in ("h2", "h3") and b["text"].startswith("(") and merged and merged[-1]["t"] in ("h2", "h3"):
            merged[-1]["text"] += " " + b["text"]
            continue
        merged.append(b)
    out = merged
    return {"id": ch["id"], "num": ch["num"], "title": ch["title"], "page": ch["page"], "blocks": out,
            "quiz_pages": ch["quiz_pages"]}


def parse_answers(pages):
    ans = {}
    pg = next((p for p in pages if any(l["text"] == "ANSWERS TO QUESTIONS" for l in p.lines)), None)
    if not pg:
        return ans
    cols = {}
    heads = [l for l in pg.lines if re.fullmatch(r"Chapter \d+( \(cont\.\))?", l["text"])]
    entries = [l for l in pg.lines if l["kind"] == "body" and not l["text"].startswith("Chapter")]
    # assign each entry to the closest chapter heading above it in the same column
    for e in sorted(entries, key=lambda l: (l["rect"].x0, l["rect"].y0)):
        cands = [h for h in heads if h["rect"].y0 < e["rect"].y0 + 1 and abs(h["rect"].x0 - e["rect"].x0) < 40]
        if not cands:
            continue
        h = max(cands, key=lambda h: h["rect"].y0)
        chn = int(re.search(r"\d+", h["text"]).group())
        m = re.match(r"^(\d+)\.\s+(.*)$", e["text"])
        if m:
            ans.setdefault(chn, {})[int(m.group(1))] = m.group(2).strip()
        elif ans.get(chn):
            last = max(ans[chn])
            ans[chn][last] += " " + e["text"].strip()
    return ans


def parse_quiz(pages, answers, vocab):
    lines = []
    for pg in pages:
        ls = [l for l in pg.lines if l["kind"] == "body"]
        ls = merge_same_row(ls, pg.mid)
        items = order_page(pg, [{"rect": l["rect"], "line": l} for l in ls])
        lines += [i["line"] for i in items]
    qs = []
    cur = None
    for l in lines:
        t = l["text"]
        m = re.match(r"^(\d{1,2})\.\s+(.*)$", t)
        o = re.match(r"^([A-F])\.\s+(.*)$", t)
        if m:
            cur = {"n": int(m.group(1)), "q": [m.group(2)], "opts": []}
            qs.append(cur)
        elif o and cur is not None:
            cur["opts"].append([o.group(1), [o.group(2)]])
        elif cur is not None:
            if cur["opts"]:
                cur["opts"][-1][1].append(t)
            else:
                cur["q"].append(t)
    out = []
    for q in qs:
        a = answers.get(q["n"], "")
        out.append({"n": q["n"], "q": join_lines(q["q"], vocab),
                    "opts": [[k, join_lines(v, vocab)] for k, v in q["opts"]],
                    "answer": a})
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
