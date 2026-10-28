"""Write the artifact version of index.html (no document wrapper) to the given path."""
import re
import sys
from pathlib import Path

src = Path(__file__).resolve().parent.parent / "index.html"
html = src.read_text(encoding="utf-8")
html = re.sub(r"<!doctype html>\s*", "", html, flags=re.I)
html = re.sub(r"</?html[^>]*>\s*|</?head>\s*|</?body>\s*", "", html)
html = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", html)
Path(sys.argv[1]).write_text(html, encoding="utf-8")
