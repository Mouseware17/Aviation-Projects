"""Extract the King Air B200 Pilot Checklist PDF into site data.

Usage: python3 extract_checklist.py <checklist.pdf> <site_dir>

Writes <site_dir>/data/checklist.js and renders graphs/tables to <site_dir>/figures/cl-*.webp.
"""
import io
import json
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image

TOP, BOTTOM = 62, 740
SCALE = 2.4
SECTIONS = {"N": "Normal Procedures", "E": "Emergency Procedures", "A": "Abnormal Procedures",
            "SI": "Supplemental Information"}
LABELS = {"NOTE", "CAUTION", "WARNING"}


def ltext(l):
    return "".join(s["text"] for s in l["spans"]).strip()


def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:60]


def page_label(page):
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            s = l["spans"][0]
            t = ltext(l)
            if s["font"] == "Helvetica" and abs(s["size"] - 11) < 0.3 and re.fullmatch(r"[A-Z]+-[\divx]+", t):
                return t
    return ""


def fill_behind(page_draws, rect):
    best = None
    for d in page_draws:
        if d.get("fill") and d["rect"].contains(pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)):
            if best is None or d["rect"].get_area() < best["rect"].get_area():
                best = d
    if not best:
        return None
    r, g, b = best["fill"][:3]
    if r > 0.7 and g < 0.4:
        return "red"
    if r > 0.7 and g > 0.5 and b < 0.4:
        return "amber"
    if g > 0.5 and r < 0.5:
        return "green"
    if b > 0.6 and r < 0.4:
        return "blue"
    if r < 0.3 and g < 0.3 and b < 0.3:
        return "dark"
    return None


def render(page, rect, path):
    clip = pymupdf.Rect(rect.x0 - 6, rect.y0 - 6, rect.x1 + 6, rect.y1 + 6) & page.rect
    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=clip, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    img.save(path, "WEBP", quality=80, method=6)
    return img.size


def classify(l):
    s = l["spans"][0]
    f, z = s["font"], s["size"]
    t = ltext(l)
    r = pymupdf.Rect(l["bbox"])
    if r.y1 < TOP or r.y0 > BOTTOM or r.x0 > 420:
        return "chrome"
    if l["dir"] != (1.0, 0.0):
        return "graphic"
    if t in ("Continued On Next Page.", "Continued on Next Page."):
        return "chrome"
    if f == "Helvetica-Bold" and abs(z - 16) < 0.3:
        return "section"
    if f == "Helvetica-Bold" and abs(z - 13) < 0.3:
        return "proc"
    if f == "Helvetica-Bold" and abs(z - 12) < 0.3 and t in LABELS:
        return "label"
    if f == "Helvetica-Bold" and abs(z - 11) < 0.3:
        return "h11"
    if f.startswith("Futura"):
        return "ann"
    if f.startswith("Helvetica") and abs(z - 10) < 0.5:
        return "bold" if f == "Helvetica-Bold" else "text"
    return "graphic"


def merge_rows(lines):
    lines = sorted(lines, key=lambda l: (round(l["r"].y0 / 2), l["r"].x0))
    out = []
    for l in lines:
        p = out[-1] if out else None
        if p and abs(p["r"].y0 - l["r"].y0) < 2.5 and p["k"] in ("text", "bold") and l["k"] in ("text", "bold") \
                and l["r"].x0 - p["r"].x1 < 30:
            p["t"] = p["t"] + " " + l["t"]
            p["r"] = p["r"] | l["r"]
            p["k"] = "bold" if p["k"] == "bold" and l["k"] == "bold" else p["k"]
            p["boldfirst"] = p.get("boldfirst") or l["k"] == "bold"
        else:
            out.append(dict(l))
    return out


def split_action(t):
    m = re.match(r"^(.*?)\s*\.{3,}\s*(.*)$", t)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return t.strip(), ""


def fold_callouts(steps):
    out = []
    for st in steps:
        if out and out[-1]["t"] in LABELS_LOWER and not out[-1]["text"] and st["t"] == "text":
            out[-1]["text"] = st["text"]
            continue
        out.append(st)
    return [st for st in out if not (st["t"] in LABELS_LOWER and not st["text"])]


LABELS_LOWER = {"note", "caution", "warning"}


def tableize(steps):
    """Turn runs of numeric text rows (with short header groups before them) into tables."""
    out = []
    i = 0
    row_re = re.compile(r"^[\d,.+\-]+(\s+[\d,.+\-]+)+$")
    while i < len(steps):
        j = i
        while j < len(steps) and steps[j]["t"] == "text" and row_re.match(steps[j]["text"]):
            j += 1
        if j - i >= 3:
            heads = []
            while out and out[-1]["t"] == "group" and len(heads) < 3 and len(out[-1]["text"]) < 50:
                heads.insert(0, out.pop()["text"])
            rows = [steps[k]["text"].split() for k in range(i, j)]
            try:
                firsts = [float(r[0].replace(",", "").replace("+", "")) for r in rows]
            except ValueError:
                firsts = []
            if firsts and firsts != sorted(firsts) and firsts[0::2] == sorted(firsts[0::2]) \
                    and firsts[1::2] == sorted(firsts[1::2]):
                rows = rows[0::2] + rows[1::2]
            if out and out[-1]["t"] == "text" and "Altimeter" in out[-1]["text"]:
                out.pop()
                heads = ["Closest altimeter setting", "Add to airport elevation"]
            ncol = len(steps[i]["text"].split())
            title = heads[0] if len(heads) > ncol else ""
            cols = heads[-ncol:] if len(heads) >= ncol else heads
            out.append({"t": "table", "title": title, "head": cols,
                        "rows": rows})
            i = j
            continue
        out.append(steps[i])
        i += 1
    return out


def main(pdf, site):
    site = Path(site)
    figdir = site / "figures"
    figdir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    sections = {k: {"id": k.lower(), "title": v, "groups": []} for k, v in SECTIONS.items()}
    cur_group = None
    cur_proc = None
    callout = None
    item = None
    nfig = 0

    def new_group(sec, title, page):
        nonlocal cur_group
        cur_group = {"title": title, "procs": [], "page": page}
        sections[sec]["groups"].append(cur_group)

    def new_proc(sec, title, page):
        nonlocal cur_proc, item, callout
        if cur_group is None:
            new_group(sec, SECTIONS[sec], page)
        cur_proc = {"id": f"{sec.lower()}-{slug(title)}", "title": title, "page": page, "steps": [], "anns": []}
        cur_group["procs"].append(cur_proc)
        item = None
        callout = None

    for page in doc:
        label = page_label(page)
        m = re.match(r"^([A-Z]+)-(\d+|[ivx]+)$", label)
        if not m or not m.group(2).isdigit() or m.group(1) not in SECTIONS:
            continue
        sec = m.group(1)
        if page.rotation:
            page.set_rotation(0)
        draws = page.get_drawings()
        raw = []
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                t = ltext(l)
                if not t:
                    continue
                raw.append({"k": classify(l), "t": t, "r": pymupdf.Rect(l["bbox"]), "dir": l["dir"],
                            "color": l["spans"][0]["color"]})
        rotated = sum(1 for l in raw if l["dir"] != (1.0, 0.0) and l["k"] != "chrome") > 5
        anns = [l for l in raw if l["k"] == "ann"]
        if sec == "SI" or rotated or len(anns) > 10:
            # full-page reference graphic
            region = None
            for l in raw:
                if l["k"] != "chrome" and l["t"] not in ("FlightSafety", "international"):
                    region = l["r"] if region is None else region | l["r"]
            for d in draws:
                r = d["rect"]
                if TOP < r.y0 and r.y1 < BOTTOM + 5:
                    region = r if region is None else region | r
            if region is None:
                continue
            nfig += 1
            fname = f"cl-{nfig:02d}.webp"
            pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=region + (-6, -6, 6, 6), alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            if rotated:
                vert = [l for l in raw if l["dir"] != (1.0, 0.0)]
                img = img.rotate(-90 if vert[0]["dir"][1] < 0 else 90, expand=True)
            img.save(figdir / fname, "WEBP", quality=80, method=6)
            title = next((l["t"] for l in raw if l["k"] in ("section", "proc")), None) or \
                next((l["t"] for l in raw if l["k"] == "graphic" and l["t"].isupper() and len(l["t"]) > 12), "Reference")
            sections[sec].setdefault("figures", []).append(
                {"file": f"figures/{fname}", "w": img.size[0], "h": img.size[1], "page": label, "title": title.title()})
            continue

        # graphic regions (tables, graphs) on procedure pages
        gl = [l for l in raw if l["k"] == "graphic"]
        regions = []
        for l in sorted(gl, key=lambda l: l["r"].y0):
            for i, rg in enumerate(regions):
                if (rg + (-20, -14, 20, 14)).intersects(l["r"]):
                    regions[i] = rg | l["r"]
                    break
            else:
                regions.append(pymupdf.Rect(l["r"]))
        grown = []
        for rg in regions:
            for d in draws:
                r = d["rect"]
                if (rg + (-14, -40, 14, 14)).contains(r) and r.width < 360:
                    rg = rg | r
            titles = [l for l in raw if l["k"] == "h11" and 0 <= rg.y0 - l["r"].y1 < 30]
            if titles:
                rg = rg | titles[-1]["r"]
            grown.append((rg, titles[-1]["t"] if titles else ""))
        merged = True
        while merged:
            merged = False
            for i in range(len(grown)):
                for j in range(i + 1, len(grown)):
                    a, b = grown[i][0], grown[j][0]
                    if (a + (-4, -30, 4, 30)).intersects(b) and min(a.x1, b.x1) - max(a.x0, b.x0) > 0:
                        grown[i] = (a | b, grown[i][1] or grown[j][1])
                        del grown[j]
                        merged = True
                        break
                if merged:
                    break
        figs = []
        for rg, title in grown:
            if rg.height < 25 or rg.width < 60 or rg.height > 400:
                continue
            nfig += 1
            fname = f"cl-{nfig:02d}.webp"
            size = render(page, rg, figdir / fname)
            figs.append({"r": rg, "k": "fig", "t": "", "file": f"figures/{fname}", "w": size[0], "h": size[1], "title": title})
        body = [l for l in raw if l["k"] not in ("chrome", "graphic")
                and not any(f["r"].contains(l["r"]) or (f["r"] & l["r"]).get_area() > 0.6 * l["r"].get_area()
                            for f in figs)]
        chips = [l for l in body if l["k"] == "ann"]
        body = [l for l in body if l["k"] != "ann"]
        body = merge_rows(body) + figs
        body.sort(key=lambda l: (l["r"].y0, l["r"].x0))

        # index lines: 11pt bold lines directly under a 16pt section title, before the first procedure
        seen_proc = False
        sec_y = None
        merged_titles = []
        for l in body:
            k = l["k"]
            if k == "section":
                if merged_titles and merged_titles[-1]["k"] == "section" and l["r"].y0 - merged_titles[-1]["r"].y1 < 14:
                    merged_titles[-1]["t"] += " " + l["t"]
                    continue
                seen_proc = False
                sec_y = l["r"].y0
            if k == "proc":
                if merged_titles and merged_titles[-1]["k"] == "proc" and l["r"].y0 - merged_titles[-1]["r"].y1 < 6:
                    merged_titles[-1]["t"] += " " + l["t"]
                    merged_titles[-1]["r"] = merged_titles[-1]["r"] | l["r"]
                    continue
                seen_proc = True
            if k == "h11" and sec_y is not None and not seen_proc:
                continue  # section index list
            merged_titles.append(l)
        body = merged_titles

        for l in body:
            k, t, r = l["k"], l["t"], l["r"]
            if k == "section":
                title = re.sub(r"\s*\(Cont(inued)?\)\s*$", "", t, flags=re.I)
                if cur_group is None or cur_group["title"].upper() != title.upper():
                    new_group(sec, title, label)
                cur_proc = None
                continue
            if k == "proc":
                title = re.sub(r"\s*\(Cont(inued)?\)\s*$", "", t, flags=re.I).strip().lstrip("*")
                if cur_proc is not None and cur_proc["title"].upper() == title.upper() and re.search(r"\(Cont", t, re.I):
                    item = None
                    callout = None
                    continue
                new_proc(sec, title, label)
                for c in chips:
                    if -20 < c["r"].y0 - r.y0 < 60:
                        fill = fill_behind(draws, c["r"])
                        txt = {16766239: "amber", 831819: "green", 16777215: "blue"}.get(c["color"])
                        color = fill if fill in ("red", "amber", "green", "blue") else txt or ("red" if sec == "E" else "amber")
                        cur_proc["anns"].append({"text": re.sub(r"\s+", " ", c["t"]), "color": color})
                continue
            if cur_proc is None:
                if k in ("text", "bold", "label", "h11") and cur_group is not None:
                    new_proc(sec, cur_group["title"], label)
                elif k == "fig":
                    if cur_group is None:
                        new_group(sec, SECTIONS[sec], label)
                    new_proc(sec, cur_group["title"], label)
                else:
                    continue
            steps = cur_proc["steps"]
            if k == "fig":
                steps.append({"t": "fig", "file": l["file"], "w": l["w"], "h": l["h"], "title": l["title"]})
                item = None
                callout = None
                continue
            if k in ("label", "h11", "bold") and t in LABELS:
                callout = {"t": t.lower(), "text": "", "x0": None, "y": r.y1}
                steps.append(callout)
                item = None
                continue
            if callout is not None:
                if k in ("text", "bold") and r.y0 - callout["y"] < 16 and (callout["x0"] is None or abs(r.x0 - callout["x0"]) < 25) \
                        and r.x0 > 95:
                    callout["text"] = (callout["text"] + " " + t).strip()
                    callout["x0"] = callout["x0"] or r.x0
                    callout["y"] = r.y1
                    continue
                callout.pop("x0", None)
                callout.pop("y", None)
                callout = None
            if k == "h11" and sec == "E" and not any(st["t"] in ("item", "callout") for st in steps) \
                    and not t.endswith(":") and (t.isupper() or t.startswith("(")):
                if t.startswith("(") and cur_proc.get("applies"):
                    cur_proc["applies"][-1] += " " + t
                else:
                    cur_proc.setdefault("applies", []).append(t)
                continue
            if k == "h11":
                steps.append({"t": "group", "text": t})
                item = None
                continue
            mi = re.match(r"^([+*]?)\s*(\d{1,2})\.\s+(.*)$", t)
            if mi:
                text, action = split_action(mi.group(3))
                item = {"t": "item", "n": int(mi.group(2)), "text": text, "action": action,
                        "mark": mi.group(1), "mem": l["k"] == "bold" or bool(l.get("boldfirst")) and sec == "E",
                        "x0": r.x0, "y": r.y1}
                if sec != "E":
                    item["mem"] = l["k"] == "bold"
                steps.append(item)
                continue
            ml = re.match(r"^([a-z])\.\s+(.*)$", t)
            parent = next((st for st in reversed(steps) if st["t"] == "item" and st["n"]), None)
            if ml and parent is not None:
                text, action = split_action(ml.group(2))
                parent.setdefault("sub", []).append({"text": text, "action": action, "letter": ml.group(1)})
                parent["y"] = r.y1
                item = parent
                continue
            if t == "OR":
                continue
            mb = re.match(r"^[•▪]\s*(.*)$", t)
            if mb and item is not None:
                text, action = split_action(mb.group(1))
                item.setdefault("sub", []).append({"text": text, "action": action})
                item["y"] = r.y1
                continue
            if item is not None and r.x0 > item["x0"] + 4 and r.y0 - item["y"] < 9:
                if item.get("sub"):
                    s = item["sub"][-1]
                    if s["action"]:
                        s["action"] += " " + t
                    else:
                        s["text"], s["action"] = split_action(s["text"] + " " + t)
                elif item["action"] and not re.search(r"\.{3,}", t):
                    item["action"] += " " + t
                else:
                    text, action = split_action(item["text"] + " " + t)
                    item["text"], item["action"] = text, action or item["action"]
                item["y"] = r.y1
                continue
            if (t.endswith(":") and len(t) < 80) or (k == "bold" and len(t) < 40 and not re.search(r"\.{3,}", t)):
                steps.append({"t": "group", "text": t})
                item = None
                continue
            last = steps[-1] if steps else None
            numeric = re.match(r"^[\d,.+\-]+(\s+[\d,.+\-]+)+$", t)
            if last and last["t"] == "text" and r.y0 - last["y"] < 9 and not numeric and not re.search(r"\.{3,}", t) \
                    and not re.match(r"^[\d,.+\-]+(\s+[\d,.+\-]+)+$", last["text"]):
                last["text"] += " " + t
                last["y"] = r.y1
            else:
                text, action = split_action(t)
                if action:
                    steps.append({"t": "item", "n": None, "text": text, "action": action, "mark": "",
                                  "mem": False, "x0": r.x0, "y": r.y1})
                    item = steps[-1]
                else:
                    steps.append({"t": "text", "text": t, "y": r.y1})
                    item = None

    for s in sections.values():
        for g in s["groups"]:
            for p in g["procs"]:
                for st in p["steps"]:
                    for key in ("x0", "y"):
                        st.pop(key, None)
                    for key in ("text", "action"):
                        if key in st:
                            st[key] = re.sub(r"([a-z])- ([a-z])", r"\1\2", re.sub(r"\s+", " ", st[key])).strip()
                    for sub in st.get("sub", []):
                        sub["text"] = re.sub(r"([a-z])- ([a-z])", r"\1\2", sub["text"])
                p["steps"] = tableize(fold_callouts(p["steps"]))
                last_n = 0
                for st in p["steps"]:
                    for key in ("text", "action"):
                        if key in st:
                            st[key] = st[key].replace("lnoperative", "Inoperative")
                    if st["t"] != "item":
                        continue
                    m = re.match(r"^(\d{1,2})\s+(.*)$", st["text"])
                    if st["n"] is None and m and int(m.group(1)) == last_n + 1:
                        st["n"], st["text"] = int(m.group(1)), m.group(2)
                    if st["n"]:
                        last_n = st["n"]
            g["procs"] = [p for p in g["procs"] if p["steps"]]
        s["groups"] = [g for g in s["groups"] if g["procs"]]
    ids = {}
    for s in sections.values():
        for g in s["groups"]:
            for p in g["procs"]:
                if p["id"] in ids:
                    ids[p["id"]] += 1
                    p["id"] = f"{p['id']}-{ids[p['id']]}"
                else:
                    ids[p["id"]] = 1
    data = {"sections": list(sections.values())}
    (site / "data").mkdir(exist_ok=True)
    js = "window.CHECKLIST = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (site / "data" / "checklist.js").write_text(js, encoding="utf-8")
    n = sum(len(g["procs"]) for s in sections.values() for g in s["groups"])
    print(f"procedures={n} figures={nfig} bytes={len(js)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
