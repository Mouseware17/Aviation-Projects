"""Generate the retro PA28 IFR checklist HTML and render it to PDF.

Edit the SECTIONS data below, then run:  python3 build.py
Row kinds:
  ("i", item, value)  item left / value right
  ("s", text)         indented sub-item
  ("n", text)         note, indented further
  ("b", text)         bold indented sub-item
  ("h", text)         centered bold sub-heading
  ("c", text)         centered italic note
  ("cb", text)        centered bold italic
  ("r", text)         right-aligned italic
  ("rb", text)        right-aligned bold italic
  ("rp", text)        right-aligned plain
  ("si", text)        indented italic
Header color: "blue" (ground) or "red" (in flight), matching the original's two header shades.
"""
import html, pathlib

COLUMNS = [
  [
    ("Initial", "blue", [
      ("s","N.W.K.R.A.F.T"),("s","Brief Procedures"),("i","Flight Plan","File"),("s","A.R.O.W"),
      ("i","Fuel Selector","Cycle"),("i","Control Lock","Remove"),("i","Flaps","Extend"),
      ("i","Lights/Pitot Heat","On"),("i","Master","On"),("i","Fuel Gauges","Check"),
      ("s","Check Lights, Pitot Heat,"),("s","Stall Horn"),("i","Master","Off"),
      ("i","Pitot Static Drains","Check"),("i","Alternate Air","Check"),("i","Trim & Flight Controls","Check"),
    ]),
    ("Preflight", "blue", [
      ("h","Right Side"),
      ("i","Flap/Aileron","Check"),("i","Fuel Quantity","Measure"),("i","Fuel Quality","Sump"),
      ("i","Right Gear","Pressure/Pin"),("i","Right Brake","Pads/Leaks"),("i","Right Strut","~4.5 in"),
      ("h","Nose"),
      ("i","Oil","6-8 Qt"),("i","Prop/Spinner","Inspect"),("i","Alternator","Check Belt"),
      ("i","Intake(s)","Clear"),("i","Nose Strut","~3.5 in"),("i","Nose Sump","Drain"),
      ("h","Left Side"),
      ("i","Fuel Quality","Sump"),("i","Left Gear","Pressure/Pin"),("i","Left Brake","Pad/Leaks"),
      ("i","Left Strut","~4.5 in"),("i","Fuel Quantity","Measure"),("i","Stall Vane","Check"),
      ("i","Pitot Mast","Check"),("i","Aileron/Flap","Check"),
      ("h","Fueselage"),
      ("s","Antennas"),("s","Stabilator"),("s","Anti-Servo Tab"),("s","Rudder/Vertical Stabilizer"),
      ("h","Final Walk Around"),
      ("s","Surfaces & Controls"),("i","Chocks/Tiedowns","Clear"),("i","Baggage Door","Shut"),("i","Flaps","Up"),
      ("h","Before Start"),
      ("s","Hobbs/Tach"),("s","Check Squawks"),("i","Circuit Breakers","In"),("i","Switches","Off"),
    ]),
  ],
  [
    ("Startup", "blue", [
      ("c","——— S.A.F.E.T.Y. ———"),
      ("i","Seat","Locked"),("i","Brakes","Pump & Set"),("i","Fuel","Fullest Tank"),("i","Beacon","On"),
      ("i","Throttle","1/4-1/8"),("i","Mixture","Full Rich"),("i","Fuel Pump","On"),("i","Prime","As required"),
      ("i","BAT","On"),("i","Prop Area","Clear"),("i","Magnetos","Start"),
      ("n","-Oil Pressure Green-"),
      ("i","Fuel Pump","Off"),("i","ALT","On"),
      ("c","-Avionics On-"),
    ]),
    ("After Start", "blue", [
      ("i","Taxi Lights","Set"),("i","Mixture","Lean for Taxi"),("i","Brakes","Check x2"),
      ("h","Taxi to Runup Area"),
      ("i","GPS","Database/Fuel/CDI"),("i","ELT","Armed"),("i","Radios","Test/Set"),("i","AutoPilot","Test"),
      ("n","-ATIS"),("n","-Altimeter x2"),("n","-C.R.A.F.T"),("n","—Set FPL/NAV"),
      ("i","XPDR","Set + Alt"),("i","Altimeters","Within 75’"),("i","Instruments","Check"),
      ("i","G5","Check Battery"),("i","WAAS","Confirmed"),
    ]),
    ("Runup", "blue", [
      ("i","Brakes","Set"),("i","Fuel","Switch"),("i","Trim","Takeoff"),("i","Flight Controls","Check"),
      ("i","Mixture","Best Power"),("i","Primer","In/Locked"),
      ("s","2000 RPM"),
      ("i","Magnetos","L/R"),("i","Fuel Pump","Cycle"),
      ("n","-Oil Temp & Pressure-"),("n","-Fuel Pressure-"),
      ("i","Amps/Volts","Check"),("i","Carb Heat","Test"),("i","Throttle","Idle"),("i","Carb Heat","In"),
      ("s","1000 RPM"),("s","Lean for Taxi"),("s","Adjust Friction"),
      ("r","Obtain Taxi Clearance"),
    ]),
  ],
  [
    ("Pre-Takeoff", "blue", [
      ("i","C.R.A.F.T","Set/Confirmed"),("si","-Set Destination ATIS"),
      ("h","Takeoff Briefing"),
      ("s","-Runway"),("s","-Departure Instructions"),("s","-Failures & Fly/Fix"),
      ("i","Doors/Windows","Shut"),("i","Lights","On"),("i","Pitot Heat","As Required"),
      ("i","Mixture","Best Power"),("i","Fuel Pump","On"),
      ("rb","Clearance/Announce"),
    ]),
    ("Climb", "red", [
      ("i","Landing Light","Off"),("i","Engine Instruments","Check"),("i","Amps/Volts","Check"),
      ("i","Mixture","Lean >3000’"),
    ]),
    ("Cruise", "red", [
      ("i","Mixture","Set"),("i","Fuel Pump","Off"),
      ("b","ATIS"),("b","Altimeter"),("b","Approach Briefing"),("b","Avionics"),("b","Airplane"),
    ]),
    ("Pre-Landing", "red", [
      ("h","Before IAF"),
      ("i","Flight Plan","Confirmed"),("i","Frequencies","Set"),("i","Fuel Pump","On"),
      ("h","Before FAF"),
      ("s","G.U.M.P.S"),
      ("i","Precision","Check"),("i","Minimums","Bugged"),("i","Altimeter","Set"),("i","Airport Lighting","ON"),
      ("s","1800/10 deg/85 kts"),
    ]),
    ("After Landing", "blue", [
      ("i","Flaps","Up"),("i","Fuel Pump","Off"),("i","XPDR","VFR"),("i","Avionics","Off"),
      ("s","Lights off Except Beacon"),
      ("i","Pitot Heat/Switches","Off"),("i","Mixture","Full Lean"),("i","Magnetos","Off"),("i","Master","Off"),
      ("cb","CLOSE FLIGHT PLAN"),("rp","Hobbs/Tach"),
    ]),
  ],
]

e = html.escape

def row(r):
    k = r[0]
    if k == "i":
        return f'<div class="row"><span>{e(r[1])}</span><span class="v">{e(r[2])}</span></div>'
    return f'<div class="row {k}">{e(r[1])}</div>'

def section(title, color, rows):
    body = "".join(row(r) for r in rows)
    return f'<section class="box {color}"><h2>{e(title)}</h2>{body}</section>'

# quadrille ruling: 5 squares per inch (14.4pt), explicit vector lines
_xs = [6.6 + 14.4*k for k in range(28)]
_ys = [4.2 + 14.4*k for k in range(43)]
_d = "".join(f"M{x:.1f} 0V612" for x in _xs) + "".join(f"M0 {y:.1f}H396" for y in _ys)
grid = (f'<svg class="grid" viewBox="0 0 396 612" aria-hidden="true">'
        f'<path d="{_d}" fill="none" stroke="#138fae" stroke-width=".45" stroke-opacity=".33"/></svg>')

cols = "".join(f'<div class="col">{"".join(section(*s) for s in c)}</div>' for c in COLUMNS)

HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>PA28 IFR Checklist</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@900&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&family=Work+Sans:wght@300;600&display=block" rel="stylesheet">
<style>
@page {{ size: 5.5in 8.5in; margin: 0; }}
:root {{
  /* Retro Art Deco palette: B73824 E9E2E2 D3C073 138FAE 344989 */
  --paper: #e9e2e2;
  --navy: #344989;
  --teal: #138fae;
  --rust: #b73824;
  --gold: #d3c073;
  --ink: #26355f;          /* navy darkened for small text */
  --stripe: rgba(211, 192, 115, .34);
  --row: 8.26pt;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ background: var(--paper); }}
body {{
  width: 396pt; height: 612pt; position: relative; overflow: hidden;
  color: var(--ink);
  font: 400 6.15pt/1 "Space Mono", monospace;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}}

/* quadrille ruling: 5 squares per inch, drawn as vector lines */
.grid {{ position: absolute; inset: 0; width: 396pt; height: 612pt; }}

/* ---------- header label ---------- */
.label {{
  position: absolute; left: 13.4pt; right: 14.4pt; top: 11pt; height: 52pt;
  display: flex; color: var(--paper);
  box-shadow: 0 0 0 1.2pt var(--paper);
}}
.label .tab {{
  width: 72pt; background: var(--rust);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5pt;
}}
.label .tab svg {{ width: 46pt; height: 30pt; display: block; }}
.label .tab b {{ font: 600 5.4pt/1 "Work Sans", sans-serif; letter-spacing: 1.2pt; color: var(--gold); }}
.label .band {{
  flex: 1; padding: 6pt 10pt 0 11pt; position: relative;
  /* deco speed stripes along the bottom of the band */
  background:
    linear-gradient(to bottom, transparent 44.6pt, var(--gold) 44.6pt, var(--gold) 46pt,
      var(--navy) 46pt, var(--navy) 47pt, var(--teal) 47pt, var(--teal) 48.6pt,
      var(--navy) 48.6pt, var(--navy) 49.6pt, var(--rust) 49.6pt, var(--rust) 51pt, var(--navy) 51pt),
    var(--navy);
}}
.label .brand {{ font: 300 12.5pt/1 "Work Sans", sans-serif; letter-spacing: -.1pt; }}
.label .brand sup {{ font-size: 4.5pt; vertical-align: 6pt; margin-left: .5pt; }}
.label .title {{ font: 900 20.5pt/1 "Nunito", sans-serif; letter-spacing: -.3pt; margin-top: 2.5pt; color: var(--gold); }}
.label .spec {{
  position: absolute; right: 9pt; bottom: 11pt; text-align: right;
  font: 600 4.9pt/1.35 "Work Sans", sans-serif; letter-spacing: .1pt;
}}

/* ---------- checklist ---------- */
.cols {{
  position: absolute; z-index: 1; left: 13.4pt; top: 70.6pt; width: 368.6pt;
  display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 4.6pt;
}}
.col {{ display: flex; flex-direction: column; gap: 4.1pt; }}
.box {{ border: 1pt solid var(--navy); background: rgba(233,226,226,.74); position: relative; }}
.box.red {{ border-color: var(--teal); }}
.box h2 {{
  height: 13.4pt; display: flex; align-items: center; justify-content: center;
  background: var(--navy); color: var(--paper);
  font: 900 7.6pt/1 "Nunito", sans-serif; letter-spacing: .25pt;
  border-bottom: 1.4pt solid var(--gold);
}}
.box.red h2 {{ background: var(--teal); color: #fff; }}
.row {{
  height: var(--row); padding: 0 2.6pt; display: flex; align-items: center; justify-content: space-between;
  white-space: nowrap;
}}
.row:nth-of-type(even) {{ background: var(--stripe); }}
.row .v {{ text-align: right; }}
.row.s, .row.si, .row.b {{ padding-left: 11.5pt; }}
.row.n {{ padding-left: 14pt; }}
.row.si {{ font-style: italic; }}
.row.b {{ font-weight: 700; }}
.row.h {{ justify-content: center; font-weight: 700; color: var(--rust); letter-spacing: .15pt; }}

.row.c {{ justify-content: center; font-style: italic; }}
.row.cb {{ justify-content: center; font-style: italic; font-weight: 700; color: var(--rust); }}
.row.r, .row.rb, .row.rp {{ justify-content: flex-end; }}
.row.r {{ font-style: italic; }}
.row.rb {{ font-style: italic; font-weight: 700; }}

.foot {{
  position: absolute; left: 13.4pt; right: 14.4pt; bottom: 13.5pt;
  display: flex; justify-content: flex-end;
  font: 600 4.6pt/1 "Work Sans", sans-serif; letter-spacing: .5pt; color: var(--ink); opacity: .8;
}}
.foot > span {{ background: var(--paper); padding: 1.5pt 2pt; }}
</style></head>
<body>
{grid}
<header class="label">
  <div class="tab">
    <svg viewBox="0 0 68 44" aria-hidden="true">
      <g stroke="#d3c073" stroke-width="1.6" stroke-linecap="butt"><line x1="34" y1="42" x2="73.4" y2="35.1"/><line x1="34" y1="42" x2="70.0" y2="24.5"/><line x1="34" y1="42" x2="63.7" y2="15.2"/><line x1="34" y1="42" x2="55.2" y2="8.1"/><line x1="34" y1="42" x2="45.0" y2="3.5"/><line x1="34" y1="42" x2="34.0" y2="2.0"/><line x1="34" y1="42" x2="23.0" y2="3.5"/><line x1="34" y1="42" x2="12.8" y2="8.1"/><line x1="34" y1="42" x2="4.3" y2="15.2"/><line x1="34" y1="42" x2="-2.0" y2="24.5"/><line x1="34" y1="42" x2="-5.4" y2="35.1"/></g>
      <path d="M18 42 A16 16 0 0 1 50 42 Z" fill="#d3c073"/>
      <path d="M22 42 A12 12 0 0 1 46 42" fill="none" stroke="#b73824" stroke-width="1.4"/>
      <path d="M26 42 A8 8 0 0 1 42 42" fill="none" stroke="#b73824" stroke-width="1.4"/>
      <g fill="#e9e2e2" stroke="#b73824" stroke-width=".9" stroke-linejoin="round">
        <path d="M34 3.5 C35.6 3.5 36.2 6 36.2 9 L36.2 15 L56 16.4 L56 20.2 L36.2 21 L35.6 30.5 L42 31.6 L42 34.2 L34 34.6 L26 34.2 L26 31.6 L32.4 30.5 L31.8 21 L12 20.2 L12 16.4 L31.8 15 L31.8 9 C31.8 6 32.4 3.5 34 3.5 Z"/>
      </g>
      <rect x="29.5" y="2.6" width="9" height="1.2" rx=".6" fill="#26355f"/>
    </svg>
    <b>PA-28</b>
  </div>
  <div class="band">
    <div class="brand">Greenville Aviation</div>
    <div class="title">PA28 IFR Checklist</div>
    <div class="spec">Instrument<br>Flight Rules</div>
  </div>
</header>
<main class="cols">{cols}</main>
<footer class="foot">
  <span>GA-PA28-IFR &nbsp;·&nbsp; Greenville Aviation</span>
</footer>
</body></html>"""

here = pathlib.Path(__file__).parent
(here / "PA28_IFR_Checklist.html").write_text(HTML, encoding="utf-8")

# Render with the Node Playwright + Chromium (see render.js).
import subprocess
subprocess.run(["node", str(here / "render.js")], check=True)
print("wrote PA28_IFR_Checklist.html and .pdf")
