/* Interactive system simulators: fuel (Chapter 5) and DC/AC electrical (Chapter 2).
   Behaviour follows the training manual's system descriptions and the checklist's system tests. */
(() => {
  "use strict";
  const SIMS = (window.KA_SIMS = window.KA_SIMS || {});
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* A switch with labelled positions. positions: top-to-bottom labels. value: index. */
  function toggleHTML(id, placard, positions, value, opts = {}) {
    const horiz = opts.horiz;
    const posBtns = positions.map((p, i) => `<button type="button" class="pos ${i === value ? "on" : ""}" data-sw="${id}" data-set="${i}" style="background:none;border:0;padding:0;cursor:pointer">${esc(p)}</button>`);
    const pos = positions.length === 2 ? (value === 0 ? 0 : 2) : value;
    const sw = `<button type="button" class="toggle ${horiz ? "horiz" : ""} ${opts.guard ? "guard" : ""}" data-sw="${id}" data-pos="${pos}" aria-label="${esc(placard)}: ${esc(positions[value])}"></button>`;
    if (horiz) return `<div class="sw" data-swbox="${id}"><span class="plac">${placard}</span><div style="display:flex;gap:8px;align-items:center">${posBtns[0]}${sw}${posBtns[positions.length - 1]}</div>${positions.length === 3 ? posBtns[1] : ""}</div>`;
    if (positions.length === 3) return `<div class="sw" data-swbox="${id}"><span class="plac">${placard}</span>${posBtns[0]}<div class="sw3">${sw}${posBtns[1]}</div>${posBtns[2]}</div>`;
    return `<div class="sw" data-swbox="${id}"><span class="plac">${placard}</span>${posBtns[0]}${sw}${posBtns.slice(1).join("")}</div>`;
  }
  function setToggle(root, id, positions, value, placard) {
    const box = root.querySelector(`[data-swbox="${id}"]`);
    if (!box) return;
    const t = box.querySelector(".toggle");
    t.dataset.pos = positions.length === 2 ? (value === 0 ? 0 : 2) : value;
    t.setAttribute("aria-label", `${placard}: ${positions[value]}`);
    box.querySelectorAll(".pos").forEach((b) => b.classList.toggle("on", +b.dataset.set === value));
  }
  const lens = (id, text, color) => `<span class="mini-lens ${color}" id="${id}">${esc(text)}</span>`;

  function wireComponents(root, info, onPick) {
    const svg = root.querySelector("svg");
    svg.addEventListener("click", (e) => { const g = e.target.closest(".comp"); if (g) onPick(g.dataset.c); });
    svg.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest(".comp")) { e.preventDefault(); onPick(e.target.closest(".comp").dataset.c); } });
  }
  const comp = (key, label, inner) => `<g class="comp" data-c="${key}" tabindex="0" role="button" aria-label="${esc(label)}">${inner}</g>`;

  /* =====================================================================
     FUEL SYSTEM
     ===================================================================== */
  const FUEL_INFO = {
    main: ["Main fuel system", "Each wing's main system is the leading-edge tanks, the integral wet-wing tank and two box-section tanks, all feeding the nacelle tank by gravity. Usable fuel is 193 gallons per side including the nacelle tank (386 gallons in both main systems). The filler is near the wingtip and has an antisiphon valve.", "Chapter 5, pages 5-1 to 5-5"],
    nacelle: ["Nacelle tank", "The 57-gallon nacelle tank is part of the main system. It takes gravity flow from the wing tanks and transfer flow from the auxiliary tank, and holds the electric standby boost pump. The engine is always fed from here.", "Figure 5-3, page 5-5"],
    aux: ["Auxiliary tank", "A rubber bladder cell in the wing center section, 79 gallons usable per side, with its own filler and antisiphon valve. Although the main tanks are fueled first, auxiliary fuel is normally used first. Do not put fuel in the auxiliary tanks unless the main tanks are full.", "Pages 5-1, 5-5 and 5-16"],
    jet: ["Jet transfer pump", "Works on the venturi principle. Motive flow from the engine-driven or standby boost pump passes through the jet pump; the suction it creates draws fuel out of the auxiliary tank and into the nacelle tank. No pilot action is needed.", "Auxiliary Fuel Transfer System, page 5-5"],
    motive: ["Motive flow valve", "Normally closed. When fuel pressure is sensed and the auxiliary tank has fuel, the transfer circuit opens it after a 30 to 50 second delay. A float switch closes it when the tank is empty, after a 30 to 60 second delay. The receiving side's valve closes when crossfeed is selected. If it stays closed with auxiliary fuel remaining, the amber NO TRANSFER light comes on; AUX TRANSFER OVERRIDE energizes it open.", "Pages 5-5 and 5-6"],
    check: ["Gravity feed check valve", "A swing check valve in the gravity feed line keeps fuel from flowing back into the outboard tanks while auxiliary transfer is running. When the auxiliary tank runs dry, gravity flow from the outboard tanks to the nacelle tank resumes.", "Page 5-5"],
    standby: ["Standby boost pump", "Electric low-pressure pump in the bottom of the nacelle tank. It backs up a failed engine-driven boost pump, is required with aviation gasoline above 20,000 feet, and runs automatically on the delivery side during crossfeed. Powered from the No. 3 (left) and No. 4 (right) dual-fed buses. If one fails, crossfeed is possible only from the side with the working pump.", "Standby Boost Pump, page 5-8"],
    xfeed: ["Crossfeed valve", "Normally closed solenoid valve joining the two wing systems, for single-engine operation only. Selecting CROSSFEED FLOW LEFT or RIGHT lights the green FUEL CROSSFEED annunciator, opens the valve, runs the delivery side's standby pump and closes the receiving side's motive flow valve. The light shows the selection, not valve position; the preflight test proves the valve by watching both FUEL PRESS lights go out.", "Fuel Crossfeed System, pages 5-11 and 5-12"],
    fw: ["Firewall shutoff valve", "Motor-driven valve controlled by a red-guarded switch on the fuel panel. Powered by the No. 3 and No. 4 dual-fed buses and also the hot battery bus, so it works regardless of battery switch position. When closed, fuel to the engine is cut off.", "Firewall Shutoff Valve, page 5-7"],
    edp: ["Engine-driven boost pump", "Low-pressure pump on the engine accessory section: 1,250 pounds per hour at 25 to 30 psi. It keeps the high-pressure pump from cavitating and runs whenever the engine turns. If it fails, the red FUEL PRESS light comes on below 10 ±1 psi; turning on that side's standby pump restores pressure.", "Engine-Driven Boost Pump, page 5-7"],
    filter: ["Firewall fuel filter", "A 20-micron filter on the firewall with an internal bypass that opens if the filter ices or clogs, so fuel keeps reaching the engine. Screen strainers at each tank outlet protect the boost and transfer pumps.", "Page 5-9"],
    psw: ["Fuel pressure switch", "Mounted on the firewall filter. It closes below 10 ±1 psi to light the red L or R FUEL PRESS warning, and tells the auxiliary transfer circuit whether motive flow pressure is available. Engine operation with the FUEL PRESS light on is limited to 10 hours before overhaul of the engine's high-pressure fuel pump.", "Low Fuel Pressure Switch, page 5-9; Limitations, page 5-14"],
    heater: ["Fuel heater", "An oil-to-fuel heat exchanger warms fuel ahead of the fuel control unit, removing or preventing ice that could block the FCU.", "Fuel Heater, page 5-9"],
    hp: ["High-pressure engine fuel pump", "Engine-driven gear pump mounted with the fuel control unit. It supplies the pressure needed for a proper spray pattern in the combustion chamber. Failure of this pump causes an immediate flameout.", "Page 5-9"],
    fcu: ["Fuel control unit and manifold", "The FCU meters fuel to the nozzle manifolds. On BB-666 and after, P3 bleed air purges fuel left in the manifolds into the combustion chamber at shutdown.", "Fuel Purge System, page 5-10; Chapter 7"],
  };

  function fuelSim(host, api) {
    const S = {
      stby: { L: 0, R: 0 },          // 0 ON, 1 OFF  (index into ["ON","OFF"])
      aux: { L: 1, R: 1 },           // 0 OVERRIDE, 1 AUTO
      fw: { L: 0, R: 0 },            // 0 OPEN, 1 CLOSED
      xf: 1,                         // 0 LEFT, 1 OFF, 2 RIGHT
      eng: { L: true, R: true },
      auxFuel: { L: true, R: true },
      edpFail: { L: false, R: false },
      armed: { L: true, R: true },   // transfer delay complete
      flameout: { L: false, R: false },
      sel: "xfeed",
    };
    S.stby = { L: 1, R: 1 };
    const timers = { L: null, R: null };
    const X = (x, s) => (s === "L" ? x : 1200 - x);
    const P = (pts, s) => "M" + pts.map(([x, y]) => `${X(x, s)},${y}`).join(" L");

    function side(s) {
      const lbl = (x, y, t, cls = "lbl s", anchor) => `<text class="${cls}" x="${X(x, s)}" y="${y}" text-anchor="${anchor || "middle"}">${t}</text>`;
      const S_ = s;
      return `
      <path class="pipe" id="${s}-grav" d="${P([[250, 505], [272, 505], [272, 412]], s)}"/><path class="flow" id="${s}-grav-f" d="${P([[250, 505], [272, 505], [272, 412]], s)}"/>
      <path class="pipe" id="${s}-tr" d="${P([[410, 470], [410, 438], [330, 438], [330, 412]], s)}"/><path class="flow" id="${s}-tr-f" d="${P([[410, 470], [410, 438], [330, 438], [330, 412]], s)}"/>
      <path class="pipe" id="${s}-mot" style="stroke-width:4" d="${P([[290, 192], [368, 192], [368, 456], [404, 456]], s)}"/><path class="flow" id="${s}-mot-f" d="${P([[290, 192], [368, 192], [368, 456], [404, 456]], s)}"/>
      <path class="pipe" id="${s}-sb" d="${P([[290, 390], [290, 300]], s)}"/><path class="flow" id="${s}-sb-f" d="${P([[290, 390], [290, 300]], s)}"/>
      <path class="pipe" id="${s}-xl" d="${P([[290, 300], [600, 300]], s)}"/><path class="flow" id="${s}-xl-f" d="${P(s === "L" ? [[290, 300], [600, 300]] : [[290, 300], [600, 300]], s)}"/>
      <path class="pipe" id="${s}-fwl" d="${P([[290, 300], [290, 215]], s)}"/><path class="flow" id="${s}-fwl-f" d="${P([[290, 300], [290, 215]], s)}"/>
      <path class="pipe" id="${s}-lp" d="${P([[290, 215], [290, 135]], s)}"/><path class="flow" id="${s}-lp-f" d="${P([[290, 215], [290, 135]], s)}"/>
      <path class="pipe" id="${s}-hpl" d="${P([[290, 135], [290, 48]], s)}"/><path class="flow" id="${s}-hpl-f" d="${P([[290, 135], [290, 48]], s)}"/>
      <line x1="${X(195, s)}" x2="${X(385, s)}" y1="244" y2="244" stroke="var(--ink-3)" stroke-dasharray="6 5" stroke-width="1.5"/>
      ${lbl(s === "L" ? 200 : 200, 238, "FIREWALL", "note", s === "L" ? "start" : "end")}
      <rect x="${Math.min(X(212, s), X(368, s))}" y="22" width="156" height="128" rx="14" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/>
      ${lbl(s === "L" ? 222 : 222, 38, s === "L" ? "LEFT ENGINE" : "RIGHT ENGINE", "lbl", s === "L" ? "start" : "end")}
      ${comp("main", "Main wing tanks", `<path class="tank full" id="${s}-main" d="${P([[30, 565], [30, 478], [250, 452], [250, 565]], s)}Z"/>`)}
      ${lbl(140, 512, "MAIN WING TANKS", "lbl")}${lbl(140, 530, "136 gal", "note")}
      ${comp("nacelle", "Nacelle tank", `<rect class="tank full" id="${s}-nac" x="${Math.min(X(230, s), X(350, s))}" y="330" width="120" height="82" rx="6"/>`)}
      ${lbl(290, 348, "NACELLE 57 gal", "lbl s")}
      ${comp("aux", "Auxiliary tank", `<rect class="tank aux full" id="${s}-auxt" x="${Math.min(X(390, s), X(560, s))}" y="470" width="170" height="95" rx="6"/>`)}
      ${lbl(475, 506, "AUXILIARY", "lbl")}${lbl(475, 524, "79 gal", "note")}
      ${comp("check", "Gravity feed check valve", `<circle class="body" cx="${X(272, s)}" cy="460" r="9"/><path class="glyph" d="M${X(266, s)},464 L${X(272, s)},456 L${X(278, s)},464"/>`)}
      ${comp("jet", "Jet transfer pump", `<circle class="body" id="${s}-jet" cx="${X(410, s)}" cy="470" r="11"/><path class="glyph" d="M${X(404, s)},470 h12 M${X(412, s)},466 l4,4 -4,4"/>`)}
      ${comp("motive", "Motive flow valve", `<rect class="body" id="${s}-motv" x="${X(368, s) - 11}" y="320" width="22" height="22" rx="3"/><path class="glyph" id="${s}-motg" d="M${X(368, s) - 7},331 h14"/>`)}
      ${lbl(384, 336, "MOTIVE FLOW", "note", s === "L" ? "start" : "end")}
      ${comp("standby", "Standby boost pump", `<circle class="body" id="${s}-stbyp" cx="${X(290, s)}" cy="390" r="13"/><path class="glyph" d="M${X(283, s)},390 a7,7 0 1 1 14,0 M${X(290, s)},383 v14"/>`)}
      ${lbl(s === "L" ? 312 : 312, 398, "STBY", "note", s === "L" ? "start" : "end")}
      ${comp("fw", "Firewall shutoff valve", `<circle class="body" id="${s}-fwv" cx="${X(290, s)}" cy="265" r="12"/><path class="glyph" id="${s}-fwg" d="M${X(282, s)},265 h16"/>`)}
      ${lbl(272, 270, "FW SHUTOFF", "note", s === "L" ? "end" : "start")}
      ${comp("edp", "Engine-driven boost pump", `<circle class="body" id="${s}-edpp" cx="${X(290, s)}" cy="215" r="13"/><path class="glyph" d="M${X(283, s)},215 a7,7 0 1 1 14,0 M${X(290, s)},208 v14"/>`)}
      ${lbl(272, 220, "ENG BOOST", "note", s === "L" ? "end" : "start")}
      ${comp("filter", "Firewall fuel filter", `<rect class="body" x="${X(290, s) - 10}" y="155" width="20" height="20" rx="2"/><path class="glyph" d="M${X(290, s) - 6},159 l12,12 M${X(290, s) + 6},159 l-12,12"/>`)}
      ${comp("psw", "Fuel pressure switch", `<circle class="body" id="${s}-psw" cx="${X(250, s)}" cy="165" r="9"/><text class="busl" x="${X(250, s)}" y="169" text-anchor="middle" style="font-size:10px">P</text><path class="glyph" d="M${X(259, s)},165 H${X(280, s)}"/>`)}
      ${comp("heater", "Fuel heater", `<rect class="body" x="${X(290, s) - 11}" y="124" width="22" height="18" rx="2"/><path class="glyph" d="M${X(290, s) - 7},133 q3,-5 6,0 t6,0"/>`)}
      ${comp("hp", "High-pressure fuel pump", `<circle class="body" id="${s}-hpp" cx="${X(290, s)}" cy="100" r="11"/><path class="glyph" d="M${X(284, s)},100 h12"/>`)}
      ${comp("fcu", "Fuel control unit", `<rect class="body" id="${s}-fcu" x="${X(290, s) - 16}" y="56" width="32" height="20" rx="2"/><text class="busl" x="${X(290, s)}" y="70" text-anchor="middle" style="font-size:10px">FCU</text>`)}
      <text class="val" id="${s}-qty" x="${X(140, s)}" y="552" text-anchor="middle"></text>
      <text class="val" id="${s}-auxq" x="${X(475, s)}" y="548" text-anchor="middle"></text>
      <text class="val" id="${s}-psi" x="${X(232, s)}" y="190" text-anchor="${s === "L" ? "end" : "start"}"></text>`;
    }
    const svg = `<svg class="sx" viewBox="0 0 1200 585" role="group" aria-label="Fuel system schematic">
      ${side("L")}${side("R")}
      ${comp("xfeed", "Crossfeed valve", `<circle class="body" id="xfv" cx="600" cy="300" r="15"/><path class="glyph" id="xfg" d="M590,300 h20"/>`)}
      <text class="lbl" x="600" y="276" text-anchor="middle">CROSSFEED</text>
      <text class="note" x="600" y="335" text-anchor="middle" id="xfnote"></text>
      <g class="sx-legend" transform="translate(470,40)">
        <rect x="0" y="0" width="260" height="96" rx="6" fill="var(--surface)" stroke="var(--rule)"/>
        <line x1="14" x2="44" y1="22" y2="22" stroke="#e3c22a" stroke-width="7" stroke-linecap="round"/><text class="note" x="54" y="26">Fuel, gravity or suction</text>
        <line x1="14" x2="44" y1="46" y2="46" stroke="#e98a1c" stroke-width="7" stroke-linecap="round"/><text class="note" x="54" y="50">Boost pump pressure</text>
        <line x1="14" x2="44" y1="70" y2="70" stroke="#d8342c" stroke-width="7" stroke-linecap="round"/><text class="note" x="54" y="74">High-pressure fuel to the engine</text>
      </g>
    </svg>`;
    const sideCtrl = (s) => {
      const parts = [
        toggleHTML(`stby${s}`, "Standby pump", ["ON", "OFF"], S.stby[s]),
        toggleHTML(`aux${s}`, "Aux transfer", ["OVERRIDE", "AUTO"], S.aux[s]),
        `<div class="sw"><span class="plac">No transfer</span>${lens(`not${s}`, "NO XFR", "amber")}</div>`,
        toggleHTML(`fw${s}`, "Firewall shutoff", ["OPEN", "CLOSED"], S.fw[s], { guard: true }),
      ];
      return `<div class="panel-side ${s === "R" ? "right" : ""}"><span class="plac-h">${s === "L" ? "LEFT" : "RIGHT"}</span><div class="sw-group ${s === "R" ? "right" : ""}">${(s === "R" ? parts.reverse() : parts).join("")}</div></div>`;
    };
    host.innerHTML = `<section class="sim wide" aria-labelledby="fuelSimTitle">
      <div class="sim-head"><h2 id="fuelSimTitle">Interactive fuel system</h2><p>Work the fuel panel; the schematic, annunciators and notes follow. Select any component for its description.</p></div>
      <div class="sim-body"><div class="sim-svg">${svg}</div>
      <div class="sim-ctrl">
        <div class="fuel-panel">${sideCtrl("L")}
          <div class="sw-group mid">${toggleHTML("xf", "Crossfeed flow", ["LEFT", "OFF", "RIGHT"], S.xf, { horiz: true })}</div>
          ${sideCtrl("R")}</div>
        <div class="ann-strip" aria-label="Annunciators">${lens("aLFP", "L FUEL PRESS", "red")}${lens("aRFP", "R FUEL PRESS", "red")}${lens("aXF", "FUEL CROSSFEED", "green")}</div>
        <div class="sim-extra"><span class="lbl">Engines</span>
          <button class="pill" data-x="engL" aria-pressed="true">Left running</button><button class="pill" data-x="engR" aria-pressed="true">Right running</button>
          <span class="lbl">Aux fuel</span>
          <button class="pill" data-x="auxL" aria-pressed="true">Left aux full</button><button class="pill" data-x="auxR" aria-pressed="true">Right aux full</button>
          <span class="lbl">Failures</span>
          <button class="pill fail" data-x="edpL" aria-pressed="false">Left engine boost pump</button><button class="pill fail" data-x="edpR" aria-pressed="false">Right engine boost pump</button>
          <button class="pill" data-x="reset">Reset</button></div>
      </div>
      <div class="sim-info"><div id="fuelInfo"></div><div><h3>What's happening</h3><ul class="status-list" id="fuelStatus"></ul></div></div></div></section>`;

    const root = host;
    const $ = (id) => root.querySelector("#" + id);
    function startDelay(s) {
      if (timers[s]) return;
      S.armed[s] = false;
      timers[s] = setTimeout(() => { timers[s] = null; S.armed[s] = true; render(); }, reduceMotion() ? 600 : 3500);
    }
    function compute() {
      const o = { L: {}, R: {} };
      const recv = S.xf === 0 ? "L" : S.xf === 2 ? "R" : null;
      const deliv = recv ? (recv === "L" ? "R" : "L") : null;
      for (const s of ["L", "R"]) {
        if (S.fw[s] === 1 && S.eng[s]) { S.eng[s] = false; S.flameout[s] = true; }
        o[s].stbyRun = S.stby[s] === 0 || deliv === s;
        o[s].edp = S.eng[s] && !S.edpFail[s];
      }
      for (const s of ["L", "R"]) {
        const other = s === "L" ? "R" : "L";
        o[s].pUp = o[s].stbyRun || (recv !== null && o[other].stbyRun);
        o[s].pDn = S.fw[s] === 0 && (o[s].pUp || o[s].edp);
        o[s].motivePress = o[s].pDn;
      }
      for (const s of ["L", "R"]) {
        const want = S.auxFuel[s] && recv !== s && (S.aux[s] === 0 || o[s].motivePress);
        if (want && S.aux[s] === 1 && !S.armed[s]) startDelay(s);
        if (!want) { if (timers[s]) { clearTimeout(timers[s]); timers[s] = null; } if (S.aux[s] === 1) S.armed[s] = false; }
        o[s].motiveOpen = want && (S.aux[s] === 0 ? o[s].motivePress || S.aux[s] === 0 : S.armed[s]) && (o[s].motivePress);
        o[s].noXfr = S.auxFuel[s] && !o[s].motiveOpen;
        o[s].delay = want && S.aux[s] === 1 && !S.armed[s];
        o[s].feeding = S.eng[s];
        o[s].suction = S.eng[s] && !o[s].pDn;
      }
      o.recv = recv; o.deliv = deliv;
      return o;
    }
    function cls(id, map) { const e = $(id); if (!e) return; for (const [k, v] of Object.entries(map)) e.classList.toggle(k, !!v); }
    function flow(id, on, reverse) {
      const e = $(id); if (!e) return;
      e.style.display = on && !reduceMotion() ? "" : "none";
      e.style.animationDirection = reverse ? "reverse" : "normal";
    }
    function render() {
      const o = compute();
      for (const s of ["L", "R"]) {
        const d = o[s];
        const crossDeliver = o.deliv === s, crossRecv = o.recv === s;
        const engFromOwnNacelle = d.feeding && !(crossRecv && o[o.deliv].stbyRun);
        const nacOut = engFromOwnNacelle || crossDeliver && S.eng[o.recv];
        cls(`${s}-grav`, { fuel: true }); flow(`${s}-grav-f`, nacOut && !d.motiveOpen);
        cls(`${s}-tr`, { fuel: S.auxFuel[s] }); flow(`${s}-tr-f`, d.motiveOpen);
        cls(`${s}-mot`, { press: d.motiveOpen }); flow(`${s}-mot-f`, d.motiveOpen);
        cls(`${s}-sb`, { fuel: true, press: d.stbyRun }); flow(`${s}-sb-f`, nacOut);
        cls(`${s}-xl`, { fuel: o.recv !== null, press: o.recv !== null && (o.L.stbyRun || o.R.stbyRun) });
        flow(`${s}-xl-f`, o.recv !== null && S.eng[o.recv] && o[o.deliv].stbyRun, s === o.recv);
        cls(`${s}-fwl`, { fuel: S.fw[s] === 0, press: S.fw[s] === 0 && d.pUp }); flow(`${s}-fwl-f`, d.feeding);
        cls(`${s}-lp`, { fuel: S.fw[s] === 0, press: d.pDn }); flow(`${s}-lp-f`, d.feeding);
        cls(`${s}-hpl`, { hp: S.eng[s], fuel: !S.eng[s] && S.fw[s] === 0 }); flow(`${s}-hpl-f`, d.feeding);
        cls(`${s}-auxt`, { full: S.auxFuel[s] });
        cls(`${s}-stbyp`, { on: d.stbyRun, off: !d.stbyRun });
        cls(`${s}-edpp`, { on: d.edp, off: !S.eng[s] && !S.edpFail[s], fail: S.edpFail[s] });
        cls(`${s}-fwv`, { on: S.fw[s] === 0, fail: S.fw[s] === 1 });
        $(`${s}-fwg`).setAttribute("transform", S.fw[s] === 0 ? "" : `rotate(90 ${s === "L" ? 290 : 910} 265)`);
        cls(`${s}-motv`, { on: d.motiveOpen, off: !d.motiveOpen });
        $(`${s}-motg`).setAttribute("transform", d.motiveOpen ? "" : `rotate(90 ${s === "L" ? 368 : 832} 331)`);
        cls(`${s}-jet`, { on: d.motiveOpen });
        cls(`${s}-hpp`, { on: S.eng[s] }); cls(`${s}-fcu`, { on: S.eng[s] });
        cls(`${s}-psw`, { fail: !d.pDn });
        $(`${s}-qty`).textContent = "Main 1,293 lb";
        $(`${s}-auxq`).textContent = S.auxFuel[s] ? "Aux 529 lb" : "Aux empty";
        $(`${s}-psi`).textContent = d.pDn ? "25–30 psi" : S.fw[s] === 1 ? "valve closed" : "below 10 psi";
        cls(`a${s}FP`, { lit: !d.pDn });
        cls(`not${s}`, { lit: d.noXfr });
        setToggle(root, `stby${s}`, ["ON", "OFF"], S.stby[s], "Standby pump");
        setToggle(root, `aux${s}`, ["OVERRIDE", "AUTO"], S.aux[s], "Aux transfer");
        setToggle(root, `fw${s}`, ["OPEN", "CLOSED"], S.fw[s], "Firewall shutoff");
        const pe = root.querySelector(`[data-x="eng${s}"]`); pe.setAttribute("aria-pressed", String(S.eng[s])); pe.textContent = `${s === "L" ? "Left" : "Right"} ${S.eng[s] ? "running" : "shut down"}`;
        const pa = root.querySelector(`[data-x="aux${s}"]`); pa.setAttribute("aria-pressed", String(S.auxFuel[s])); pa.textContent = `${s === "L" ? "Left" : "Right"} aux ${S.auxFuel[s] ? "full" : "empty"}`;
        root.querySelector(`[data-x="edp${s}"]`).setAttribute("aria-pressed", String(S.edpFail[s]));
      }
      cls("xfv", { on: o.recv !== null, off: o.recv === null });
      $("xfg").setAttribute("transform", o.recv !== null ? "" : "rotate(90 600 300)");
      $("xfnote").textContent = o.recv ? `Flow to ${o.recv === "L" ? "left" : "right"} engine` : "Closed";
      cls("aXF", { lit: o.recv !== null });
      setToggle(root, "xf", ["LEFT", "OFF", "RIGHT"], S.xf, "Crossfeed flow");
      // status notes
      const st = [];
      const nm = (s) => (s === "L" ? "Left" : "Right");
      for (const s of ["L", "R"]) {
        const d = o[s];
        if (S.flameout[s] && !S.eng[s]) st.push(["bad", `${nm(s)} engine flamed out: its firewall shutoff valve was closed while running.`]);
        if (d.suction) st.push(["bad", `${nm(s)} engine is running on high-pressure pump suction with FUEL PRESS lit. Limit: 10 hours before HP pump overhaul. Turn on the ${nm(s).toLowerCase()} standby pump.`]);
        if (S.edpFail[s] && d.pDn && S.eng[s]) st.push(["ok", `${nm(s)} engine-driven boost pump failed; pressure restored by ${o.deliv && o.recv === s ? "crossfeed" : "the standby pump"}.`]);
        if (S.fw[s] === 1 && d.stbyRun) st.push(["warn", `${nm(s)} standby pump running against a closed firewall valve: pressure switch sees nothing, FUEL PRESS stays lit. This is the checklist's fuel system test.`]);
        if (d.delay) st.push(["warn", `${nm(s)} auxiliary transfer waiting out its 30–50 second delay (shortened here); NO TRANSFER lit until the motive flow valve opens.`]);
        if (d.motiveOpen) st.push(["ok", `${nm(s)} auxiliary fuel transferring to the nacelle tank; gravity flow from the wing is held off by the check valve.`]);
        if (o.recv === s && S.auxFuel[s]) st.push(["warn", `${nm(s)} is the receiving side: its motive flow valve closed, so NO TRANSFER lights with auxiliary fuel remaining.`]);
      }
      if (o.recv) {
        st.unshift(["ok", `Crossfeed ${o.recv === "L" ? "LEFT" : "RIGHT"}: ${o.deliv === "L" ? "left" : "right"} standby pump runs automatically and delivers to the ${o.recv === "L" ? "left" : "right"} engine.`]);
        if (S.eng.L && S.eng.R) st.push(["warn", "Crossfeed is for single-engine operation only."]);
        if (S.stby[o.recv] === 0 || S.stby[o.deliv] === 0) st.push(["warn", "Checklist: standby pumps OFF for crossfeed."]);
      }
      if (!st.length) st.push(["ok", S.eng.L || S.eng.R ? "Normal operation: engine-driven boost pumps supply pressure, and each engine feeds from its own nacelle tank." : "Engines shut down: no boost pressure, so both FUEL PRESS lights are on."]);
      $("fuelStatus").innerHTML = st.map(([k, t]) => `<li><span class="dot ${k}"></span><span>${esc(t)}</span></li>`).join("");
      // info
      const inf = FUEL_INFO[S.sel];
      $("fuelInfo").innerHTML = `<h3>${esc(inf[0])}</h3><p>${esc(inf[1])}</p><p class="src">Source: ${esc(inf[2])}</p>`;
      root.querySelectorAll(".comp").forEach((g) => g.classList.toggle("sel", g.dataset.c === S.sel));
    }
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sw]");
      if (b) {
        const id = b.dataset.sw;
        const pick = (cur, n) => (b.dataset.set !== undefined ? +b.dataset.set : (cur + 1) % n);
        if (id === "xf") {
          if (b.dataset.set !== undefined) S.xf = +b.dataset.set;
          else S.xf = S.xf === 1 ? 0 : S.xf === 0 ? 2 : 1;
        } else {
          const s = id.slice(-1), key = id.slice(0, -1);
          if (key === "stby") S.stby[s] = pick(S.stby[s], 2);
          if (key === "aux") S.aux[s] = pick(S.aux[s], 2);
          if (key === "fw") S.fw[s] = pick(S.fw[s], 2);
        }
        render(); return;
      }
      const x = e.target.closest("[data-x]");
      if (x) {
        const k = x.dataset.x;
        if (k === "reset") { Object.assign(S, { stby: { L: 1, R: 1 }, aux: { L: 1, R: 1 }, fw: { L: 0, R: 0 }, xf: 1, eng: { L: true, R: true }, auxFuel: { L: true, R: true }, edpFail: { L: false, R: false }, armed: { L: true, R: true }, flameout: { L: false, R: false } }); }
        else if (k.startsWith("eng")) { const s = k.slice(-1); if (!S.eng[s] && S.fw[s] === 1) { S.flameout[s] = false; } S.eng[s] = !S.eng[s]; if (S.eng[s]) { S.flameout[s] = false; if (S.fw[s] === 1) S.fw[s] = 0; } }
        else if (k.startsWith("aux")) { const s = k.slice(-1); S.auxFuel[s] = !S.auxFuel[s]; }
        else if (k.startsWith("edp")) { const s = k.slice(-1); S.edpFail[s] = !S.edpFail[s]; }
        render();
      }
    });
    wireComponents(root, FUEL_INFO, (c) => { S.sel = c; render(); });
    render();
  }

  SIMS.ch5 = { key: "fuel", title: "Fuel system", blurb: "Standby pumps, crossfeed, aux transfer and firewall valves, with live FUEL PRESS and NO TRANSFER logic", mount: fuelSim };

  /* =====================================================================
     ELECTRICAL SYSTEM
     ===================================================================== */
  const ELEC_INFO = {
    battery: ["Battery", "BB-1632 and after: one 24-volt, 42 ampere-hour sealed lead-acid gel-cell battery in the right wing center section, forward of the main spar. Earlier airplanes have a 24-volt, 34/36 ampere-hour nickel-cadmium battery that needs ram-air cooling. The battery ammeter (BB-1632 and after) reads −60 to +60 amps; the charge rate should be 0 to +10 amps for takeoff.", "Chapter 2, Battery, page 2-2"],
    hot: ["Hot battery bus", "Always connected to the battery. It powers the threshold lights, fire extinguishers, firewall shutoff valves, battery relay, ground communications, auxiliary DC bus (if installed), external power light (BB-88 and after), RNAV memory, stereo, and before BB-1098 (except BB-1096) the standby boost pumps. A diode also lets the main battery bus feed it.", "Distribution, page 2-10"],
    brelay: ["Battery relay", "Closed by the BAT switch under the MASTER SWITCH gang bar. It connects the battery to the main battery bus.", "Figure 2-3; page 2-2"],
    main: ["Main battery bus", "Fed by the battery relay (and by external power through the external power relay). It connects through the start relays to both starter-generators and feeds the isolation bus.", "Distribution, page 2-10; Figure 2-10"],
    iso: ["Isolation bus", "Joined to the left and right generator buses through two 325-ampere isolation limiters. With the battery, generators or GPU on line, the isolation bus and both generator buses act as one unit unless both limiters are open.", "Distribution, page 2-10"],
    genbus: ["Generator buses", "Each generator bus is fed by its own generator through the line contactor and is tied to the isolation bus through a 325-amp limiter. It feeds all four dual-fed buses through their feeders, an avionics bus, and an inverter.", "Figure 2-13; page 2-10"],
    lim: ["325-amp isolation limiter", "Current limiter between the isolation bus and a generator bus. If one opens, that generator bus is cut from the isolation bus but the dual-fed buses keep power from the other side.", "Figure 2-13"],
    gen: ["Starter-generator", "Two 30-volt starter-generators regulated to 28.25 ±0.25 volts, 250 amperes each (300 amperes optional); either can carry the whole load. As starters they draw about 1,100 amperes at first, dropping to about 300 amperes by 20% N1. Turn the generator on after the condition lever is at high idle: hold the switch at GEN RESET for at least one second, then release to ON.", "Generators, pages 2-3 to 2-5"],
    gcu: ["Generator control unit and line contactor", "The GCU holds voltage steady through changes in engine speed and load and closes the line contactor to put the generator on line (BB-88 and after). It drops the generator off line for underexcitation, overexcitation, overvoltage or undervoltage. Off line, the amber L or R DC GEN light comes on.", "Figure 2-8; page 2-5"],
    start: ["Start relay", "Connects the main battery bus to the starter-generator while the IGNITION AND ENGINE START switch is ON (or held at STARTER ONLY).", "Page 2-3"],
    df: ["Dual-fed buses No. 1 to No. 4", "Each sub-bus is fed from both generator buses through a 60-amp current limiter, a 70-amp reverse-current diode and a 50-amp feeder breaker the crew can reach (eight feeder breakers in all). Paired items are split: left on No. 1 or No. 3, right on No. 2 or No. 4. Select a feeder breaker to pull or reset it.", "Distribution, pages 2-10 and 2-11"],
    cb: ["50-amp feeder breaker", "One of eight crew-accessible feeder breakers. Nos. 1 and 2 are on the copilot's side panel; Nos. 3 and 4 are on the fuel panel circuit-breaker bus. A dual-fed bus stays powered as long as one of its two feeders is in.", "Page 2-10"],
    av: ["Avionics buses", "The avionics power relays are normally closed and need DC power to open. With the AVIONICS MASTER switch OFF and power on, the relays open and the avionics buses are dead; switching it ON lets the relays close.", "Avionics Master Switch, page 2-12"],
    inv: ["Inverters", "Two inverters in the wing center section outboard of each nacelle. Either one supplies 115-volt and 26-volt, 400-hertz power for avionics and engine instruments. The INVERTER select switch on the pilot's left subpanel picks one; only one runs at a time. If the selected inverter fails, the red INVERTER light comes on.", "AC Power, pages 2-12 and 2-13"],
    ac: ["AC power", "115-volt and 26-volt, 400-hertz output of the selected inverter, monitored on the VOLT-FREQ meter where installed.", "Page 2-13"],
    gpu: ["External power", "Receptacle under the right wing outboard of the nacelle. On BB-364 and after, the external power relay closes only with correct polarity, the BAT switch on and GPU voltage no higher than 32 volts. Use a source able to supply up to 1,000 amps for starting (300 amps continuous). Never connect external power unless the battery shows at least 20 volts. The amber EXT PWR light shows the plug is in.", "Ground Power, pages 2-6 to 2-8; Figure 2-10"],
  };

  function elecSim(host) {
    const S = {
      bat: 1, gen: { L: 2, R: 2 }, armed: { L: false, R: false }, avm: 1, inv: 1,
      eng: { L: "off", R: "off" }, gpu: false,
      fail: { genL: false, genR: false, limL: false, limR: false },
      cb: { "1L": true, "1R": true, "2L": true, "2R": true, "3L": true, "3R": true, "4L": true, "4R": true },
      sel: "iso", startT: { L: null, R: null }, resetT: { L: null, R: null },
    };
    const busRect = (id, key, x, y, w, h, label, cls = "") => comp(key, label, `<rect class="bus ${cls}" id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><text class="busl" x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${label}</text>`);
    const vbus = (id, key, x, y, w, h, label) => comp(key, label, `<rect class="bus" id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>${label.split("").map((ch, i) => `<text class="busl" x="${x + w / 2}" y="${y + 22 + i * 15}" text-anchor="middle" style="font-size:11px">${ch}</text>`).join("")}`);
    const W = (id, d, extra = "") => `<path class="wire" id="${id}" d="${d}" ${extra}/>`;
    let dfRows = "";
    [1, 2, 3, 4].forEach((n, i) => {
      const y = 430 + i * 50;
      dfRows += W(`wdf${n}L`, `M180,${y + 10} H330`) + W(`wdf${n}R`, `M870,${y + 10} H1020`);
      dfRows += comp("cb", "Feeder breaker", `<circle class="body" id="cb${n}L" data-cb="${n}L" cx="300" cy="${y + 10}" r="8"/>`) + comp("cb", "Feeder breaker", `<circle class="body" id="cb${n}R" data-cb="${n}R" cx="900" cy="${y + 10}" r="8"/>`);
      dfRows += `<path class="glyph" d="M225,${y + 4} v12 l10,-6 z" fill="var(--ink-2)"/><path class="glyph" d="M975,${y + 4} v12 l-10,-6 z" fill="var(--ink-2)"/>`;
      dfRows += busRect(`df${n}`, "df", 330, y, 540, 20, `DUAL-FED BUS NO. ${n}`);
    });
    const svg = `<svg class="sx" viewBox="0 0 1200 680" role="group" aria-label="Electrical system schematic">
      ${W("wBatHot", "M520,58 V104")}${W("wBatRel", "M545,120 H600 V150")}${W("wRelMain", "M600,190 V290")}
      ${W("wDiode", "M680,290 V58")}${W("wGpu", "M742,186 V290")}${W("wMainIso", "M600,314 V346")}
      ${W("wLimL", "M380,358 H180")}${W("wLimR", "M820,358 H1020")}
      ${W("wGenL", "M250,214 V250 H165 V330")}${W("wGenR", "M950,214 V250 H1035 V330")}
      ${W("wStL", "M420,290 V196 H284")}${W("wStR", "M800,290 V196 H916")}
      ${W("wAvL", "M150,400 H96")}${W("wAvR", "M1050,400 H1104")}
      ${W("wInvL", "M150,560 H96")}${W("wInvR", "M1050,560 H1104")}
      ${W("wAcL", "M60,590 V650 H520")}${W("wAcR", "M1140,590 V650 H680")}
      ${dfRows}
      ${busRect("hot", "hot", 470, 32, 260, 26, "HOT BATTERY BUS")}
      ${comp("battery", "Battery", `<rect class="body" id="batt" x="490" y="104" width="56" height="32" rx="3"/><path class="glyph" d="M505,112 v16 M513,116 v8 M521,112 v16 M529,116 v8"/>`)}
      <text class="lbl" x="518" y="152" text-anchor="middle">BATTERY</text>
      <text class="val" id="vBat" x="470" y="124" text-anchor="end"></text>
      ${comp("brelay", "Battery relay", `<rect class="body" id="brel" x="586" y="150" width="28" height="40" rx="3"/><path class="glyph" id="brelg" d="M592,176 l16,-10"/>`)}
      <text class="note" x="580" y="174" text-anchor="end">BAT RELAY</text>
      <path class="glyph" d="M672,170 h16 l-8,-12 z" fill="var(--ink-2)"/><text class="note" x="666" y="152" text-anchor="end">DIODE</text>
      ${comp("gpu", "External power", `<rect class="body" id="gpuBox" x="712" y="130" width="60" height="30" rx="3"/><text class="busl" x="742" y="150" text-anchor="middle" style="font-size:11px">EXT PWR</text><rect class="body" id="extRel" x="730" y="166" width="24" height="20" rx="3"/>`)}
      ${busRect("main", "main", 380, 290, 440, 24, "MAIN BATTERY BUS")}
      ${busRect("iso", "iso", 380, 346, 440, 24, "ISOLATION BUS")}
      ${comp("lim", "Isolation limiter", `<path class="body" id="limL" d="M270,350 l18,8 -18,8 z M306,350 l-18,8 18,8 z"/>`)}
      ${comp("lim", "Isolation limiter", `<path class="body" id="limR" d="M930,350 l-18,8 18,8 z M894,350 l18,8 -18,8 z"/>`)}
      <text class="note" x="288" y="388" text-anchor="middle">325 A</text><text class="note" x="912" y="388" text-anchor="middle">325 A</text>
      ${vbus("lgb", "genbus", 150, 330, 30, 300, "L GEN BUS")}${vbus("rgb", "genbus", 1020, 330, 30, 300, "R GEN BUS")}
      ${comp("gen", "Left starter-generator", `<circle class="body" id="genL" cx="250" cy="180" r="34"/><text class="busl" x="250" y="185" text-anchor="middle">G</text>`)}
      ${comp("gen", "Right starter-generator", `<circle class="body" id="genR" cx="950" cy="180" r="34"/><text class="busl" x="950" y="185" text-anchor="middle">G</text>`)}
      <text class="lbl" x="250" y="132" text-anchor="middle">L STARTER-GEN</text><text class="lbl" x="950" y="132" text-anchor="middle">R STARTER-GEN</text>
      ${comp("gcu", "Left GCU and line contactor", `<rect class="body" id="lcL" x="200" y="240" width="30" height="20" rx="3"/><rect class="body" x="90" y="168" width="54" height="26" rx="3"/><text class="busl" x="117" y="186" text-anchor="middle" style="font-size:11px">GCU</text>`)}
      ${comp("gcu", "Right GCU and line contactor", `<rect class="body" id="lcR" x="970" y="240" width="30" height="20" rx="3"/><rect class="body" x="1056" y="168" width="54" height="26" rx="3"/><text class="busl" x="1083" y="186" text-anchor="middle" style="font-size:11px">GCU</text>`)}
      <path class="glyph" d="M144,181 H216 M1056,181 H984" stroke-dasharray="3 3"/>
      ${comp("start", "Left start relay", `<rect class="body" id="srL" x="340" y="186" width="24" height="20" rx="3"/>`)}${comp("start", "Right start relay", `<rect class="body" id="srR" x="836" y="186" width="24" height="20" rx="3"/>`)}
      <text class="note" x="352" y="180" text-anchor="middle">START</text><text class="note" x="848" y="180" text-anchor="middle">START</text>
      <text class="val" id="vLoadL" x="250" y="100" text-anchor="middle"></text><text class="val" id="vLoadR" x="950" y="100" text-anchor="middle"></text>
      ${busRect("avL", "av", 20, 384, 76, 32, "AVIONICS")}${busRect("avR", "av", 1104, 384, 76, 32, "AVIONICS")}
      ${busRect("invL", "inv", 20, 544, 76, 46, "INV NO. 1")}${busRect("invR", "inv", 1104, 544, 76, 46, "INV NO. 2")}
      ${busRect("acb", "ac", 520, 636, 160, 30, "AC 115 / 26 V", "ac")}
      <text class="val" id="vBus" x="600" y="410" text-anchor="middle"></text>
    </svg>`;
    host.innerHTML = `<section class="sim wide" aria-labelledby="elecSimTitle">
      <div class="sim-head"><h2 id="elecSimTitle">Interactive electrical system</h2><p>Battery, generators, external power, buses and inverters. Select any part of the diagram for its description.</p></div>
      <div class="sim-body"><div class="sim-svg">${svg}</div>
      <div class="sim-ctrl">
        <div class="sim-row">
          <div class="sw-group">
            <div class="sw"><span class="plac">Master switch</span><button type="button" class="pill" data-x="gang">Push gang bar</button></div>
            ${toggleHTML("bat", "BAT", ["ON", "OFF"], S.bat)}
            ${toggleHTML("genL", "GEN 1", ["RESET", "ON", "OFF"], S.gen.L)}
            ${toggleHTML("genR", "GEN 2", ["RESET", "ON", "OFF"], S.gen.R)}
          </div>
          <div class="sw-group">
            ${toggleHTML("avm", "Avionics master", ["ON", "OFF"], S.avm)}
            ${toggleHTML("inv", "Inverter", ["NO. 1", "OFF", "NO. 2"], S.inv)}
          </div>
          <div class="sw-group">
            <div class="sw"><span class="plac">Left engine</span><button type="button" class="pill" data-x="startL">Start</button></div>
            <div class="sw"><span class="plac">Right engine</span><button type="button" class="pill" data-x="startR">Start</button></div>
            <div class="sw"><span class="plac">Ground power</span><button type="button" class="pill" data-x="gpu" aria-pressed="false">Plug in GPU</button></div>
          </div>
        </div>
        <div class="ann-strip" aria-label="Annunciators">${lens("aLGEN", "L DC GEN", "amber")}${lens("aRGEN", "R DC GEN", "amber")}${lens("aEXT", "EXT PWR", "amber")}${lens("aINV", "INVERTER", "red")}</div>
        <div class="sim-extra"><span class="lbl">Failures</span>
          <button class="pill fail" data-x="genLf" aria-pressed="false">Left generator</button><button class="pill fail" data-x="genRf" aria-pressed="false">Right generator</button>
          <button class="pill fail" data-x="limLf" aria-pressed="false">Left 325 A limiter</button><button class="pill fail" data-x="limRf" aria-pressed="false">Right 325 A limiter</button>
          <span class="lbl">Feeder breakers</span><span style="font-size:13px;color:var(--placard-dim)">select a breaker dot in the diagram</span>
          <button class="pill" data-x="reset">Reset</button></div>
      </div>
      <div class="sim-info"><div id="elecInfo"></div><div><h3>What's happening</h3><ul class="status-list" id="elecStatus"></ul></div></div></div></section>`;
    const root = host;
    const $ = (id) => root.querySelector("#" + id);
    const genOn = (s) => S.eng[s] === "run" && S.gen[s] === 1 && S.armed[s] && !S.fail["gen" + s];

    function compute() {
      const r = {};
      r.battRelay = S.bat === 0;
      r.extRelay = S.gpu && S.bat === 0;
      r.genL = genOn("L"); r.genR = genOn("R");
      // connectivity of main / iso / LG / RG
      const adj = { main: ["iso"], iso: ["main"], LG: [], RG: [] };
      if (!S.fail.limL) { adj.iso.push("LG"); adj.LG.push("iso"); }
      if (!S.fail.limR) { adj.iso.push("RG"); adj.RG.push("iso"); }
      const srcs = { main: [], iso: [], LG: [], RG: [] };
      if (r.battRelay) srcs.main.push("bat");
      if (r.extRelay) srcs.main.push("gpu");
      if (r.genL) srcs.LG.push("genL");
      if (r.genR) srcs.RG.push("genR");
      const comp_ = {}, seen = new Set();
      for (const n of Object.keys(adj)) {
        if (seen.has(n)) continue;
        const stack = [n], members = [];
        while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); members.push(x); stack.push(...adj[x]); }
        const s = members.flatMap((m) => srcs[m]);
        for (const m of members) comp_[m] = s;
      }
      const volts = (s) => (s.some((x) => x.startsWith("gen")) ? 28.2 : s.includes("gpu") ? 28.0 : s.includes("bat") ? 24.0 : 0);
      for (const n of ["main", "iso", "LG", "RG"]) { r[n] = comp_[n].length > 0; r["v" + n] = volts(comp_[n]); r["s" + n] = comp_[n]; }
      r.hot = true;
      for (const n of [1, 2, 3, 4]) {
        r["fL" + n] = r.LG && S.cb[n + "L"]; r["fR" + n] = r.RG && S.cb[n + "R"];
        r["df" + n] = r["fL" + n] || r["fR" + n];
      }
      r.avL = r.LG && S.avm === 0; r.avR = r.RG && S.avm === 0;
      r.invL = S.inv === 0 && r.LG; r.invR = S.inv === 2 && r.RG;
      r.ac = r.invL || r.invR;
      r.annPower = r.main || r.LG || r.RG;
      // load model (amps)
      let load = 0;
      for (const n of [1, 2, 3, 4]) if (r["df" + n]) load += 12;
      if (r.avL || r.avR) load += 18;
      if (r.ac) load += 22;
      const starting = ["L", "R"].filter((s) => S.eng[s] === "starting");
      r.starting = starting;
      const gens = ["L", "R"].filter((s) => r["gen" + s]);
      const charge = r.battRelay && gens.length && comp_.main.some((x) => x.startsWith("gen")) ? 10 : 0;
      r.batAmps = r.battRelay ? (gens.length && comp_.main.some((x) => x.startsWith("gen")) ? charge : r.extRelay ? 8 : -(load + starting.length * 300)) : 0;
      for (const s of ["L", "R"]) r["load" + s] = r["gen" + s] ? Math.round(((load + charge + starting.length * 300 * (gens.length ? 1 : 0)) / gens.length) / 250 * 100) : 0;
      return r;
    }
    function cls(id, map) { const e = $(id); if (!e) return; for (const [k, v] of Object.entries(map)) e.classList.toggle(k, !!v); }
    function render() {
      const r = compute();
      cls("hot", { live: true }); cls("wBatHot", { live: true });
      cls("brel", { on: r.battRelay, off: !r.battRelay }); $("brelg").setAttribute("d", r.battRelay ? "M592,170 h16" : "M592,176 l16,-10");
      cls("wBatRel", { live: true }); cls("wRelMain", { live: r.battRelay || r.main });
      cls("wDiode", { live: r.main });
      cls("main", { live: r.main }); cls("iso", { live: r.iso }); cls("wMainIso", { live: r.main });
      cls("lgb", { live: r.LG }); cls("rgb", { live: r.RG });
      cls("wLimL", { live: r.iso && r.LG && !S.fail.limL }); cls("wLimR", { live: r.iso && r.RG && !S.fail.limR });
      cls("limL", { on: !S.fail.limL, fail: S.fail.limL }); cls("limR", { on: !S.fail.limR, fail: S.fail.limR });
      cls("gpuBox", { on: S.gpu }); cls("extRel", { on: r.extRelay, off: !r.extRelay }); cls("wGpu", { live: r.extRelay });
      for (const s of ["L", "R"]) {
        const running = S.eng[s] === "run";
        cls("gen" + s, { on: r["gen" + s], fail: S.fail["gen" + s], off: !running && S.eng[s] !== "starting" });
        cls("lc" + s, { on: r["gen" + s], off: !r["gen" + s] });
        cls("wGen" + s, { live: r["gen" + s] });
        cls("sr" + s, { on: S.eng[s] === "starting" }); cls("wSt" + s, { live: S.eng[s] === "starting" });
        cls("av" + s, { live: r["av" + s] }); cls("wAv" + s, { live: r["av" + s] });
        cls("inv" + s, { live: r["inv" + s], ac: true }); cls("wInv" + s, { live: r["inv" + s] }); cls("wAc" + s, { ac: r["inv" + s] });
        $("vLoad" + s).textContent = r["gen" + s] ? `${r["load" + s]}% load` : S.eng[s] === "starting" ? "starting" : running ? "off line" : "";
        setToggle(root, "gen" + s, ["RESET", "ON", "OFF"], S.gen[s], s === "L" ? "GEN 1" : "GEN 2");
        const sb = root.querySelector(`[data-x="start${s}"]`);
        sb.textContent = S.eng[s] === "run" ? "Shut down" : S.eng[s] === "starting" ? "Starting" : "Start";
        sb.disabled = S.eng[s] === "starting";
        root.querySelector(`[data-x="gen${s}f"]`).setAttribute("aria-pressed", String(S.fail["gen" + s]));
        root.querySelector(`[data-x="lim${s}f"]`).setAttribute("aria-pressed", String(S.fail["lim" + s]));
      }
      for (const n of [1, 2, 3, 4]) {
        cls("df" + n, { live: r["df" + n] });
        for (const s of ["L", "R"]) { cls(`wdf${n}${s}`, { live: r[`f${s}${n}`] }); cls(`cb${n}${s}`, { on: S.cb[n + s], fail: !S.cb[n + s] }); }
      }
      cls("acb", { live: r.ac });
      $("vBat").textContent = r.batAmps ? `${r.batAmps > 0 ? "+" : ""}${Math.max(-60, Math.min(60, r.batAmps))} A` : "24 V";
      $("vBus").textContent = r.LG || r.RG || r.main ? `Bus ${Math.max(r.vmain, r.vLG, r.vRG).toFixed(1)} V` : "Buses dead";
      cls("aLGEN", { lit: r.annPower && !r.genL }); cls("aRGEN", { lit: r.annPower && !r.genR });
      cls("aEXT", { lit: S.gpu }); cls("aINV", { lit: r.annPower && !r.ac });
      setToggle(root, "bat", ["ON", "OFF"], S.bat, "BAT");
      setToggle(root, "avm", ["ON", "OFF"], S.avm, "Avionics master");
      setToggle(root, "inv", ["NO. 1", "OFF", "NO. 2"], S.inv, "Inverter");
      const g = root.querySelector('[data-x="gpu"]'); g.setAttribute("aria-pressed", String(S.gpu)); g.textContent = S.gpu ? "Unplug GPU" : "Plug in GPU";
      // status
      const st = [];
      if (!r.battRelay && !r.extRelay && !r.genL && !r.genR) st.push(["warn", "Battery switch OFF: only the hot battery bus has power."]);
      if (S.gpu && S.bat !== 0) st.push(["warn", "GPU plugged in but the BAT switch is OFF, so the external power relay stays open (BB-364 and after)."]);
      if (r.extRelay) st.push(["ok", "External power on the main battery bus. Leave the battery on during ground power operation."]);
      for (const s of ["L", "R"]) {
        const nm = s === "L" ? "Left" : "Right";
        if (S.eng[s] === "starting") st.push(["warn", `${nm} start: start relay closed, starter drawing about 1,100 A at first, dropping to about 300 A by 20% N1.`]);
        if (S.eng[s] === "run" && S.gen[s] === 1 && !S.armed[s] && !S.fail["gen" + s]) st.push(["warn", `${nm} generator switch is ON but was not reset: hold GEN RESET for one second, then release to ON.`]);
        if (S.eng[s] === "run" && S.gen[s] === 2) st.push(["warn", `${nm} engine running with its generator OFF: ${s === "L" ? "L" : "R"} DC GEN lit.`]);
        if (S.fail["gen" + s]) st.push(["bad", `${nm} generator failed: GCU opened the line contactor. Other generator carries the load (Single Generator Failure, checklist page A-8).`]);
        if (S.fail["lim" + s]) st.push(["bad", `${nm} 325 A limiter open: the ${nm.toLowerCase()} generator bus is isolated, but every dual-fed bus still has a feeder from the other side.`]);
      }
      if (r.genL && r.genR) st.push(["ok", `Both generators on line at ${Math.max(r.vLG, r.vRG).toFixed(1)} V, sharing the load; battery charging.`]);
      else if (r.genL || r.genR) st.push(["ok", `${r.genL ? "Left" : "Right"} generator on line and can carry the whole load.`]);
      if (!r.genL && !r.genR && r.battRelay && !r.extRelay && (S.eng.L === "run" || S.eng.R === "run")) st.push(["bad", "Both generators off line in flight: battery discharging. Dual Generator Failure procedure (E-10) sheds load for about 30 minutes of battery life."]);
      if (S.inv === 1 && r.annPower) st.push(["warn", "Inverter switch OFF: no AC power and the red INVERTER light is on. Select either inverter."]);
      if (S.avm === 1 && (r.LG || r.RG)) st.push(["warn", "Avionics master OFF: avionics power relays held open, avionics buses dead."]);
      const pulled = Object.entries(S.cb).filter(([k, v]) => !v).map(([k]) => k);
      if (pulled.length) st.push(["warn", `Feeder breaker${pulled.length > 1 ? "s" : ""} pulled: ${pulled.map((k) => `No. ${k[0]} ${k[1] === "L" ? "left" : "right"}`).join(", ")}. ${[1, 2, 3, 4].filter((n) => !r["df" + n]).length ? "A dual-fed bus has lost both feeders." : "Each dual-fed bus is still powered from its other feeder."}`]);
      $("elecStatus").innerHTML = st.map(([k, t]) => `<li><span class="dot ${k}"></span><span>${esc(t)}</span></li>`).join("") || `<li><span class="dot ok"></span><span>Normal.</span></li>`;
      const inf = ELEC_INFO[S.sel];
      $("elecInfo").innerHTML = `<h3>${esc(inf[0])}</h3><p>${esc(inf[1])}</p><p class="src">Source: ${esc(inf[2])}</p>`;
      root.querySelectorAll(".comp").forEach((gg) => gg.classList.toggle("sel", gg.dataset.c === S.sel));
    }
    function setGen(s, v) {
      if (v === 0) { // RESET is spring-loaded: arm, then return to ON
        S.gen[s] = 0;
        if (S.eng[s] === "run") S.armed[s] = true;
        clearTimeout(S.resetT[s]);
        S.resetT[s] = setTimeout(() => { S.gen[s] = 1; render(); }, 900);
      } else { S.gen[s] = v; if (v === 2) S.armed[s] = false; }
    }
    root.addEventListener("click", (e) => {
      const cb = e.target.closest("[data-cb]");
      if (cb) { S.cb[cb.dataset.cb] = !S.cb[cb.dataset.cb]; S.sel = "cb"; render(); return; }
      const b = e.target.closest("[data-sw]");
      if (b) {
        const id = b.dataset.sw, set = b.dataset.set !== undefined ? +b.dataset.set : null;
        if (id === "bat") S.bat = set ?? (S.bat ? 0 : 1);
        if (id === "avm") S.avm = set ?? (S.avm ? 0 : 1);
        if (id === "inv") S.inv = set ?? (S.inv === 1 ? 0 : S.inv === 0 ? 2 : 1);
        if (id === "genL" || id === "genR") { const s = id.slice(-1); setGen(s, set ?? (S.gen[s] === 2 ? 1 : S.gen[s] === 1 ? 0 : 2)); }
        render(); return;
      }
      const x = e.target.closest("[data-x]");
      if (!x) return;
      const k = x.dataset.x;
      if (k === "gang") { S.bat = 1; S.gen.L = 2; S.gen.R = 2; S.armed.L = S.armed.R = false; }
      else if (k === "gpu") S.gpu = !S.gpu;
      else if (k === "reset") { Object.assign(S, { bat: 1, gen: { L: 2, R: 2 }, armed: { L: false, R: false }, avm: 1, inv: 1, eng: { L: "off", R: "off" }, gpu: false, fail: { genL: false, genR: false, limL: false, limR: false }, cb: { "1L": true, "1R": true, "2L": true, "2R": true, "3L": true, "3R": true, "4L": true, "4R": true } }); }
      else if (k.startsWith("start")) {
        const s = k.slice(-1);
        if (S.eng[s] === "run") { S.eng[s] = "off"; S.armed[s] = false; }
        else if (S.eng[s] === "off") {
          const r = compute();
          if (!r.main) { root.querySelector("#elecStatus").insertAdjacentHTML("afterbegin", `<li><span class="dot bad"></span><span>No power on the main battery bus for the starter. Turn the BAT switch ON (or connect a GPU with BAT ON).</span></li>`); return; }
          S.eng[s] = "starting";
          clearTimeout(S.startT[s]);
          S.startT[s] = setTimeout(() => { S.eng[s] = "run"; render(); }, reduceMotion() ? 400 : 2600);
        }
      }
      else if (k.endsWith("f")) { const key = k.slice(0, -1); S.fail[key] = !S.fail[key]; }
      render();
    });
    wireComponents(root, ELEC_INFO, (c) => { S.sel = c; render(); });
    render();
  }
  SIMS.ch2 = { key: "electrical", title: "Electrical system", blurb: "Battery, generators, GPU, isolation limiters, dual-fed buses and inverters with live DC GEN, EXT PWR and INVERTER lights", mount: elecSim };
})();
