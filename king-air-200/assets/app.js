/* King Air 200 interactive manual: router, manual reader, checklist, walkaround, annunciators, search. */
(() => {
  "use strict";
  const M = window.MANUAL, C = window.CHECKLIST, A = window.ANNUNCIATORS, SIMS = window.KA_SIMS || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "");
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ka200:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ka200:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  const side = $("#side"), main = $("#main");
  const chapters = M.chapters;
  const chById = Object.fromEntries(chapters.map((c) => [c.id, c]));
  const figs = M.figures;

  /* ---------- Heading case: the manual sets headings in capitals; keep only true acronyms ---------- */
  const LOWER = new Set();
  for (const ch of chapters) for (const b of ch.blocks) {
    if (b.t !== "p" && b.t !== "li" && b.t !== "callout") continue;
    for (const w of strip(b.text).split(/[^A-Za-z]+/)) if (w && w === w.toLowerCase()) LOWER.add(w);
  }
  for (const w of ["preflight", "taxi", "climb", "cruise", "descent", "runup", "smoke", "fire", "fumes", "start", "glide", "deice", "anti", "ice", "crossfeed", "lbs", "psi", "items", "power", "takeoff", "landing", "shutdown", "securing", "detail", "damp", "trim", "cabin", "door", "seal"]) LOWER.add(w);
  const SMALL = new Set(["a", "an", "and", "or", "of", "the", "to", "in", "for", "with", "on", "at", "by", "vs", "from", "per", "into", "than", "below", "above"]);
  function tcase(s) {
    s = String(s ?? "");
    const letters = s.replace(/[^A-Za-z]/g, "");
    if (!letters || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.6) return s;
    let first = true;
    return s.replace(/[A-Za-z][A-Za-z0-9'’]*(?:-[A-Za-z0-9'’]+)*/g, (w) => {
      const wasFirst = first; first = false;
      if (w !== w.toUpperCase() || w.length === 1 || /\d/.test(w)) return w;
      const parts = w.toLowerCase().split("-");
      if (!parts.every((x) => LOWER.has(x) || x.length > 4)) return w;
      if (!wasFirst && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return parts.map((x) => x[0].toUpperCase() + x.slice(1)).join("-");
    });
  }

  /* ---------- Annunciator lookup ---------- */
  const LENS = {};
  for (const [panel, grid] of Object.entries(A.panels)) for (const row of grid) for (const l of row) {
    if (!l.blank) LENS[l.text.replace(/\s+/g, " ")] = { ...l, panel };
  }
  const lensColor = (t) => {
    const k = t.replace(/\s+/g, " ").replace(/^\*/, "").trim();
    if (LENS[k]) return LENS[k].color;
    const alt = Object.keys(LENS).find((x) => x.replace(/ /g, "") === k.replace(/ /g, ""));
    return alt ? LENS[alt].color : /FIRE|PRESS|WARN|INVERTER|FAIL|OVHT|UNLOCKED/.test(k) ? "red" : "amber";
  };
  const chip = (t, color) => `<span class="chip ${color || lensColor(t)}">${esc(t)}</span>`;
  const bracketChips = (s) => s.replace(/\[([A-Z0-9 &/\-]+)\]/g, (m, t) => chip(t.trim()));

  /* ---------- Router ---------- */
  let mode = "";
  const routes = [];
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    document.body.classList.remove("side-open");
    $("#menuBtn").setAttribute("aria-expanded", "false");
    if (!h || h === "manual") return showManualHome();
    let m;
    if ((m = h.match(/^(ch\d+|general-pilot-information|walkaround-photos|annunciator-panels)(?:-(b\d+|s\d+|quiz|sim-[a-z]+))?$/))) return showChapter(m[1], m[2]);
    if (h === "checklist") return showChecklistHome();
    if (h === "emergency") return showEmergency();
    if ((m = h.match(/^cl-(.+)$/))) return showProc(m[1]);
    if (h === "walkaround" || /^wa-\d+$/.test(h)) return showWalkaround(h);
    if (h === "annunciators" || /^ann-/.test(h)) return showAnnunciators(h);
    showManualHome();
  }
  function setMode(m) {
    mode = m;
    for (const t of $$(".tab")) t.setAttribute("aria-current", t.dataset.mode === m ? "page" : "false");
  }
  function scrollTop() { window.scrollTo({ top: 0 }); }
  function focusEl(el) {
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 52) - 18;
    window.scrollTo({ top: Math.max(0, y) });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  /* ---------- Manual: sidebar ---------- */
  function chapterLabel(c) { return c.num ? String(c.num) : c.id === "walkaround" ? "WA" : c.id === "annunciator-panels" ? "ANN" : "GEN"; }
  function manualSide(activeId) {
    const items = chapters.map((c) => {
      const href = c.id === "walkaround" ? "#walkaround" : "#" + c.id;
      const on = c.id === activeId;
      let sub = "";
      if (on) {
        const heads = [];
        c.blocks.forEach((b, i) => { if (b.t === "h2" || b.t === "h3") heads.push(`<li class="lv${b.t[1]}"><a href="#${c.id}-b${i}" data-sec="${c.id}-b${i}">${esc(tcase(b.text))}</a></li>`); });
        if (SIMS[c.id]) heads.unshift(`<li class="lv2"><a href="#${c.id}-sim-${SIMS[c.id].key}">Interactive: ${esc(SIMS[c.id].title)}</a></li>`);
        if (c.quiz && c.quiz.length) heads.push(`<li class="lv2"><a href="#${c.id}-quiz">Review questions (${c.quiz.length})</a></li>`);
        sub = `<ul class="sub">${heads.join("")}</ul>`;
      }
      return `<li><a href="${href}" aria-current="${on}"><span class="num">${chapterLabel(c)}</span><span>${esc(c.title)}</span>${c.na ? '<span class="meta">n/a</span>' : ""}</a>${sub}</li>`;
    }).join("");
    side.innerHTML = `<h2>Pilot training manual</h2><ul class="toc">${items}</ul>
      <div class="toc-sep"></div><h2>Interactive</h2><ul class="toc">
      ${Object.entries(SIMS).map(([cid, s]) => `<li><a href="#${cid}-sim-${s.key}"><span class="num">${chapterLabel(chById[cid])}</span><span>${esc(s.title)}</span></a></li>`).join("")}
      <li><a href="#annunciators"><span class="num">4</span><span>Annunciator panel trainer</span></a></li>
      <li><a href="#walkaround"><span class="num">WA</span><span>Preflight walkaround</span></a></li></ul>`;
  }

  /* ---------- Manual: home ---------- */
  function showManualHome() {
    setMode("manual");
    manualSide(null);
    const rows = chapters.map((c) => {
      const href = c.id === "walkaround" ? "#walkaround" : "#" + c.id;
      const nf = c.blocks.filter((b) => b.t === "fig").length;
      const meta = c.na ? "not applicable" : c.id === "walkaround" ? "116 items" : `${nf} figures${c.quiz && c.quiz.length ? `, ${c.quiz.length} questions` : ""}`;
      return `<a href="${href}" class="${c.na ? "na" : ""}"><span class="n">${chapterLabel(c)}</span><span class="t">${esc(c.title)}</span><span class="lead"></span><span class="pg">${meta}</span></a>`;
    }).join("");
    main.innerHTML = `<div class="contents-head"><h1>Super King Air 200 and B200</h1>
      <p>Systems descriptions, figures and review questions from the pilot training manual, with the B200 pilot checklist, a photo walkaround and a working annunciator panel.</p></div>
      <nav class="contents" aria-label="Chapters">${rows}</nav>
      <div class="quick">
        <a href="#checklist"><b>Normal procedures</b><span>Preflight through shutdown, tap each item as you go</span></a>
        <a href="#emergency"><b>Emergency procedures</b><span>Memory items marked, annunciators shown with each procedure</span></a>
        ${Object.entries(SIMS).map(([cid, s]) => `<a href="#${cid}-sim-${s.key}"><b>${esc(s.title)}</b><span>${esc(s.blurb)}</span></a>`).join("")}
        <a href="#annunciators"><b>Annunciator trainer</b><span>Press any lens for its cause and the procedure that goes with it</span></a>
      </div>
      <p class="foot-note">Source: FlightSafety Super King Air 200/B200 Pilot Training Manual (for training purposes only) and the Beechcraft B200/B200C Pilot Checklist, P/N 101-590010-309F, Revision 3. Use the approved POH/AFM for flight.</p>`;
    scrollTop();
  }

  /* ---------- Manual: chapter ---------- */
  function linkify(html, cid) {
    html = html.replace(/\b(Figures?|Tables?)\s+((?:[A-Z]+-)?\d+-\d+)((?:\s*(?:,|and|through|thru)\s*(?:[A-Z]+-)?\d+-\d+)*)/g, (m, kind, first, rest) => {
      const k = kind[0] === "F" ? "f" : "t";
      const mk = (n) => (figs[k + n] ? `<button class="figref" data-fig="${k + n}">${n}</button>` : n);
      return `${kind} ${mk(first)}${rest.replace(/(?:[A-Z]+-)?\d+-\d+/g, (n) => mk(n))}`;
    });
    html = html.replace(/\bChapter (\d+)\b/g, (m, n) => (chById["ch" + n] && "ch" + n !== cid ? `<a href="#ch${n}">Chapter ${n}</a>` : m));
    return bracketChips(html);
  }
  function figureHTML(id, cls = "") {
    const f = figs[id];
    if (!f) return "";
    const label = f.kind === "table" ? "Table" : "Figure";
    const num = f.num ? `${label} ${f.num}${f.cont ? " (cont)" : ""}` : "";
    const portrait = f.h > f.w * 1.15 ? " portrait" : "";
    const wide = f.w > f.h * 1.5 && f.w > 1000 ? " wide" : "";
    return `<figure class="fig${portrait}${wide} ${cls}" id="fig-${id.replace("~", "_")}">
      <button class="fig-btn" data-fig="${id}" aria-label="Enlarge ${esc(num)} ${esc(f.title)}">
        <img src="${f.file}" width="${f.w}" height="${f.h}" loading="lazy" alt="${esc(num + " " + f.title)}"><span class="zoom-hint">Enlarge</span>
      </button>
      <figcaption>${num ? `<b>${num}</b>` : ""}<span>${esc(tcase(f.title))}</span></figcaption></figure>`;
  }
  function chapterHTML(c) {
    const out = [];
    let list = null, lastPage = null;
    const closeList = () => { if (list) { out.push(list.lvl2 ? "</ul></li>" : ""); out.push(list.tag === "ol" ? "</ol>" : "</ul>"); list = null; } };
    const sim = SIMS[c.id];
    let simPlaced = !sim;
    let h2count = 0;
    c.blocks.forEach((b, i) => {
      const pgMark = b.page && b.page !== lastPage && (b.t === "p" || b.t === "li" || b.t === "h2" || b.t === "h3") ? `<span class="pg">${esc(b.page)}</span>` : "";
      if (pgMark) lastPage = b.page;
      if (b.t !== "li") closeList();
      if (b.t === "h2") {
        h2count++;
        if (!simPlaced && h2count === 2) { out.push(`<div id="${c.id}-sim-${sim.key}" data-sim="${c.id}"></div>`); simPlaced = true; }
        out.push(`<h2 id="${c.id}-b${i}">${pgMark}${esc(tcase(b.text))}</h2>`);
      } else if (b.t === "h3") out.push(`<h3 id="${c.id}-b${i}">${pgMark}${esc(tcase(b.text))}</h3>`);
      else if (b.t === "p") out.push(`<p id="${c.id}-b${i}">${pgMark}${linkify(b.text, c.id)}</p>`);
      else if (b.t === "callout") out.push(`<div class="callout ${b.kind}" id="${c.id}-b${i}"><span class="lab">${b.kind.toUpperCase()}</span><p>${linkify(b.text, c.id)}</p></div>`);
      else if (b.t === "fig") out.push(figureHTML(b.id));
      else if (b.t === "li") {
        const ordered = /^\d+$/.test(b.marker);
        if (b.lvl === 2 && list && list.tag === "ol") {
          if (!list.lvl2) { out.push("<ul>"); list.lvl2 = true; out[out.length - 2] = out[out.length - 2].replace(/<\/li>$/, ""); }
          out.push(`<li id="${c.id}-b${i}">${linkify(b.text, c.id)}</li>`);
          return;
        }
        if (list && list.lvl2) { out.push("</ul></li>"); list.lvl2 = false; }
        const tag = ordered ? "ol" : "ul";
        if (!list || list.tag !== tag) { closeList(); out.push(tag === "ol" ? `<ol start="${b.marker}">` : "<ul>"); list = { tag }; }
        out.push(`<li id="${c.id}-b${i}" value="${ordered ? b.marker : ""}">${pgMark}${linkify(b.text, c.id)}</li>`);
      }
    });
    closeList();
    if (!simPlaced) out.unshift(`<div id="${c.id}-sim-${sim.key}" data-sim="${c.id}"></div>`);
    return out.join("\n");
  }
  function quizHTML(c) {
    if (!c.quiz || !c.quiz.length) return "";
    const qs = c.quiz.map((q, qi) => {
      const opts = q.opts.length >= 2
        ? `<div class="opts">${q.opts.map(([k, t]) => `<button class="opt" data-q="${qi}" data-k="${k}" aria-pressed="false"><span class="k">${k}</span><span>${esc(t)}</span></button>`).join("")}</div>`
        : `<div class="opts">${q.opts.map(([k, t]) => `<div>${k}. ${esc(t)}</div>`).join("")}<button class="btn small reveal" data-q="${qi}">Show answer</button></div>`;
      return `<div class="q" id="q-${c.id}-${qi}"><div class="q-t"><b>${q.n}</b><span>${esc(q.q)}</span></div>${opts}<div class="q-res" aria-live="polite"></div></div>`;
    }).join("");
    return `<section class="quiz" id="${c.id}-quiz"><h2>Review questions</h2>
      <p class="sub">${c.quiz.length} questions from the end of the chapter. Pick an answer to check it against the manual's answer key.</p>${qs}
      <div class="quiz-score"><output id="score-${c.id}">0 of ${c.quiz.length} answered</output><button class="btn small" id="reset-${c.id}">Clear answers</button></div></section>`;
  }
  function bindQuiz(c) {
    const box = $(`#${c.id}-quiz`);
    if (!box) return;
    const saved = store.get("quiz:" + c.id, {});
    const answerSet = (a) => (a.match(/\b[A-F]\b/g) || []);
    const update = () => {
      const done = Object.keys(saved).length;
      const right = Object.entries(saved).filter(([qi, k]) => answerSet(c.quiz[qi].answer).includes(k)).length;
      $(`#score-${c.id}`).textContent = done ? `${right} of ${done} correct` + (done < c.quiz.length ? `, ${c.quiz.length - done} to go` : "") : `0 of ${c.quiz.length} answered`;
    };
    const mark = (qi, k) => {
      const q = c.quiz[qi], el = $(`#q-${c.id}-${qi}`), ok = answerSet(q.answer);
      el.classList.add("done");
      for (const o of $$(".opt", el)) {
        o.setAttribute("aria-pressed", String(o.dataset.k === k));
        o.classList.toggle("right", ok.includes(o.dataset.k));
        o.classList.toggle("wrong", o.dataset.k === k && !ok.includes(k));
      }
      const r = $(".q-res", el);
      const good = ok.includes(k);
      r.className = "q-res " + (good ? "ok" : "no");
      r.textContent = (good ? "Correct. " : "Not quite. ") + `Answer key: ${q.answer}`;
    };
    for (const [qi, k] of Object.entries(saved)) mark(+qi, k);
    update();
    box.addEventListener("click", (e) => {
      const o = e.target.closest(".opt");
      if (o) {
        const qi = +o.dataset.q;
        if (saved[qi] !== undefined) return;
        saved[qi] = o.dataset.k; store.set("quiz:" + c.id, saved); mark(qi, o.dataset.k); update();
        return;
      }
      const rv = e.target.closest(".reveal");
      if (rv) { const el = rv.closest(".q"); $(".q-res", el).className = "q-res ok"; $(".q-res", el).textContent = "Answer key: " + c.quiz[+rv.dataset.q].answer; }
    });
    $(`#reset-${c.id}`).addEventListener("click", () => { store.set("quiz:" + c.id, {}); showChapter(c.id, "quiz"); });
  }

  let currentChapter = null, chapterFigs = [];
  function showChapter(cid, sub) {
    const c = chById[cid];
    if (!c) return showManualHome();
    if (cid === "walkaround") return showWalkaround("walkaround");
    setMode("manual");
    if (currentChapter !== cid || !$(".prose", main)) {
      currentChapter = cid;
      manualSide(cid);
      const idx = chapters.indexOf(c);
      const prev = chapters[idx - 1], next = chapters[idx + 1];
      const nf = c.blocks.filter((b) => b.t === "fig").length;
      const navLink = (x, cls, lab) => x ? `<a class="${cls}" href="${x.id === "walkaround" ? "#walkaround" : "#" + x.id}"><small>${lab}</small><b>${esc(x.title)}</b></a>` : "<span></span>";
      const extra = c.id === "annunciator-panels" ? `<p class="callout"><span class="lab">INTERACTIVE</span> Open the <a href="#annunciators">annunciator trainer</a> to light any lens and see its cause and procedure.</p>` : "";
      main.innerHTML = `<header class="ch-head"><div class="ch-kicker">${c.num ? "Chapter " + c.num : "Pilot training manual"}</div>
        <h1>${esc(c.title)}</h1><div class="ch-meta">${c.page ? `<span>Begins on page ${esc(c.page)}</span>` : ""}${nf ? `<span>${nf} figures and tables</span>` : ""}
        ${SIMS[cid] ? `<a href="#${cid}-sim-${SIMS[cid].key}">Interactive ${esc(SIMS[cid].title.toLowerCase())}</a>` : ""}
        ${c.quiz && c.quiz.length ? `<a href="#${cid}-quiz">${c.quiz.length} review questions</a>` : ""}</div></header>
        <article class="read prose">${extra}${chapterHTML(c)}</article>${quizHTML(c)}
        <nav class="ch-nav" aria-label="Chapter navigation">${navLink(prev, "prev", "Previous")}${navLink(next, "next", "Next")}</nav>`;
      chapterFigs = c.blocks.filter((b) => b.t === "fig").map((b) => b.id);
      const host = $(`[data-sim="${cid}"]`, main);
      if (host && SIMS[cid]) SIMS[cid].mount(host, { chip, figureLink: (id) => openFig(id) });
      bindQuiz(c);
      watchSections(cid);
    }
    if (sub) {
      const el = sub === "quiz" ? $(`#${cid}-quiz`) : sub.startsWith("sim") ? $(`#${cid}-${sub}`) : $(`#${cid}-${sub}`);
      requestAnimationFrame(() => focusEl(el));
    } else scrollTop();
  }
  let secObserver = null;
  function watchSections(cid) {
    if (secObserver) secObserver.disconnect();
    if (!("IntersectionObserver" in window)) return;
    const links = Object.fromEntries($$(".toc .sub a[data-sec]", side).map((a) => [a.dataset.sec, a]));
    secObserver = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && links[e.target.id]) {
        for (const a of Object.values(links)) a.classList.remove("on");
        links[e.target.id].classList.add("on");
      }
    }, { rootMargin: "-80px 0px -70% 0px" });
    for (const h of $$(".prose h2, .prose h3", main)) secObserver.observe(h);
  }

  /* ---------- Lightbox ---------- */
  const lb = $("#lb"), lbImg = $("#lbImg"), stage = $("#lbStage");
  let lbList = [], lbIdx = 0, z = { s: 1, x: 0, y: 0, fit: 1 };
  function openFig(id, list) {
    lbList = list || (chapterFigs.includes(id) ? chapterFigs : [id]);
    lbIdx = Math.max(0, lbList.indexOf(id));
    showLb();
    if (!lb.open) { try { lb.showModal(); } catch { lb.setAttribute("open", ""); } }
  }
  function openImage(src, title, w, h) {
    lbList = [{ src, title, w, h }]; lbIdx = 0; showLb();
    if (!lb.open) { try { lb.showModal(); } catch { lb.setAttribute("open", ""); } }
  }
  function showLb() {
    const it = lbList[lbIdx];
    const f = typeof it === "string" ? figs[it] : { file: it.src, title: it.title, w: it.w, h: it.h, num: "", text: "" };
    const label = f.kind === "table" ? "Table" : "Figure";
    $("#lbTitle").innerHTML = `${f.num ? `<b>${label} ${esc(f.num)}</b>` : ""}${esc(tcase(f.title || ""))}${f.page ? ` <span style="color:#8a939b">page ${esc(f.page)}</span>` : ""}`;
    $("#lbText").textContent = lbList.length > 1 ? `${lbIdx + 1} of ${lbList.length} in this chapter. Scroll or pinch to zoom, drag to pan.` : "Scroll or pinch to zoom, drag to pan.";
    $("#lbPrev").hidden = $("#lbNext").hidden = lbList.length < 2;
    lbImg.onload = fit;
    lbImg.src = f.file;
    lbImg.alt = f.title || "";
    if (lbImg.complete) fit();
  }
  function apply() { lbImg.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; }
  function fit() {
    const W = stage.clientWidth, H = stage.clientHeight - 100, iw = lbImg.naturalWidth || 1, ih = lbImg.naturalHeight || 1;
    z.fit = Math.min(W / iw, H / ih) * 0.96; z.s = z.fit;
    z.x = -iw * z.s / 2; z.y = -ih * z.s / 2 + 10; apply();
  }
  function zoomAt(f, cx, cy) {
    const r = stage.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2, py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2;
    const ns = Math.min(Math.max(z.s * f, z.fit * 0.6), 6);
    const k = ns / z.s; z.x = px - (px - z.x) * k; z.y = py - (py - z.y) * k; z.s = ns; apply();
  }
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  const pts = new Map(); let pinch = null;
  stage.addEventListener("pointerdown", (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    if (pts.size === 1) { z.x += e.clientX - p.x; z.y += e.clientY - p.y; apply(); }
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a2, b2] = [...pts.values()];
      const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (pinch !== null && d0 > 0) zoomAt(d1 / d0, (a2.x + b2.x) / 2, (a2.y + b2.y) / 2);
      pinch = d1; return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  stage.addEventListener("dblclick", (e) => zoomAt(2, e.clientX, e.clientY));
  $("#lbIn").onclick = () => zoomAt(1.4); $("#lbOut").onclick = () => zoomAt(1 / 1.4); $("#lbFit").onclick = fit;
  $("#lbClose").onclick = () => lb.close();
  $("#lbPrev").onclick = () => { lbIdx = (lbIdx - 1 + lbList.length) % lbList.length; showLb(); };
  $("#lbNext").onclick = () => { lbIdx = (lbIdx + 1) % lbList.length; showLb(); };
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" && lbList.length > 1) $("#lbNext").click();
    else if (e.key === "ArrowLeft" && lbList.length > 1) $("#lbPrev").click();
    else if (e.key === "+" || e.key === "=") zoomAt(1.3);
    else if (e.key === "-") zoomAt(1 / 1.3);
  });
  window.addEventListener("resize", () => { if (lb.open) fit(); });

  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-fig]");
    if (f) { e.preventDefault(); openFig(f.dataset.fig); return; }
    const im = e.target.closest("[data-zoom]");
    if (im) { e.preventDefault(); openImage(im.dataset.zoom, im.dataset.title || "", +im.dataset.w, +im.dataset.h); }
  });

  /* ---------- Checklist ---------- */
  const procs = [];
  const procById = {};
  for (const s of C.sections) {
    if (s.id === "si") continue;
    for (const g of s.groups) for (const p of g.procs) {
      p.sec = s.id; p.group = g.title; procs.push(p); procById[p.id] = p;
    }
  }
  const SEC_NAME = { n: "Normal", e: "Emergency", a: "Abnormal" };
  const checks = store.get("checks", {});
  const saveChecks = () => store.set("checks", checks);
  function stepKeys(p) {
    const keys = [];
    p.steps.forEach((st, i) => {
      if (st.t !== "item") return;
      if (st.sub && st.sub.length) st.sub.forEach((s, j) => keys.push(`${i}.${j}`));
      else keys.push(String(i));
    });
    return keys;
  }
  function progress(p) {
    const keys = stepKeys(p), c = checks[p.id] || {};
    return [keys.filter((k) => c[k]).length, keys.length];
  }
  function procTitle(p) { return tcase(p.title); }
  function checklistSide(activeId) {
    const secs = C.sections.filter((s) => s.id !== "si").map((s) => {
      const groups = s.groups.map((g) => {
        const lis = g.procs.map((p) => {
          const [d, n] = progress(p);
          return `<li><a href="#cl-${p.id}" aria-current="${p.id === activeId}"><span>${esc(procTitle(p))}</span><span class="prog ${d === n && n ? "full" : ""}" data-prog="${p.id}">${n ? `${d}/${n}` : ""}</span></a></li>`;
        }).join("");
        const single = g.procs.length === 1 && slug(g.procs[0].title) === slug(g.title);
        return single ? `<ul class="cl-list">${lis}</ul>` : `<div class="grp"><button disabled>${esc(tcase(g.title))}</button><ul class="cl-list">${lis}</ul></div>`;
      }).join("");
      return `<div class="sec-h ${s.id}"><i></i>${esc(s.title)}</div>${groups}`;
    }).join("");
    side.innerHTML = `<div class="cl-side">${secs}<div class="toc-sep"></div>
      <ul class="toc"><li><button class="row" id="resetAll"><span class="num"></span><span>Clear all checkmarks</span></button></li></ul></div>`;
    $("#resetAll").onclick = () => { for (const k of Object.keys(checks)) delete checks[k]; saveChecks(); route(); };
    const cur = $('[aria-current="true"]', side);
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function expandedFor(text, page) {
    const cands = procs.filter((p) => p.page === page);
    if (!cands.length) return null;
    const words = slug(text).split("-").filter((w) => w.length > 2);
    let best = cands[0], bs = -1;
    for (const p of cands) { const pw = slug(p.title).split("-"); const s = words.filter((w) => pw.includes(w)).length; if (s > bs) { bs = s; best = p; } }
    return best;
  }
  function richText(s, ctx) {
    let h = esc(s);
    h = h.replace(/\(((?:N|E|A)-\d+)\)/g, (m, pg) => { const p = expandedFor(ctx || s, pg); return p && p.id !== (window.__procId || "") ? `(<a class="xref" href="#cl-${p.id}">${pg}</a>)` : m; });
    h = h.replace(/RETURN TO PAGE ((?:N|E|A)-\d+), ([^,]+), STEP (\d+)/g, (m, pg, title) => {
      const p = procs.find((x) => slug(x.title) === slug(title)) || procs.find((x) => x.page === pg);
      return p ? `<a class="xref" href="#cl-${p.id}">Return to ${esc(tcase(title))}</a>, step ${m.match(/STEP (\d+)/)[1]}` : m;
    });
    return bracketChips(h);
  }
  function stepRow(key, n, text, action, opts = {}) {
    const marks = [];
    if (opts.mem) marks.push('<span class="badge mem" title="Memory item">MEMORY</span>');
    if (opts.mark === "+") marks.push('<span class="badge plus" title="Check on every preflight">+</span>');
    if (opts.mark === "*") marks.push('<span class="badge star" title="May be omitted after the first flight of the day">*</span>');
    return `<button class="step ${opts.mem ? "mem" : ""}" role="checkbox" aria-checked="false" data-k="${key}">
      <span class="box">${CHECK}</span><span class="n">${n ?? ""}</span>
      <span class="cr"><span class="ch">${richText(text, text)} ${marks.join(" ")}</span>${action ? `<span class="lead"></span><span class="re">${richText(action, text)}</span>` : ""}</span></button>`;
  }
  function procHTML(p) {
    const legendBits = [];
    const has = (f) => p.steps.some((s) => s.t === "item" && f(s));
    if (has((s) => s.mem)) legendBits.push('<span><span class="badge mem">MEMORY</span> boldface memory item</span>');
    if (has((s) => s.mark === "+")) legendBits.push('<span><span class="badge plus">+</span> check on every preflight</span>');
    if (has((s) => s.mark === "*")) legendBits.push('<span><span class="badge star">*</span> may be omitted after the first flight of the day</span>');
    const steps = p.steps.map((st, i) => {
      if (st.t === "item") {
        if (st.sub && st.sub.length) {
          const subs = st.sub.map((s, j) => `<li>${stepRow(`${i}.${j}`, s.letter ? s.letter + "." : "", s.text, s.action)}</li>`).join("");
          return `<li><div class="step-parent">${stepRow(`p${i}`, st.n, st.text, st.action, st)}</div><ul class="subs">${subs}</ul></li>`;
        }
        return `<li>${stepRow(String(i), st.n, st.text, st.action, st)}</li>`;
      }
      if (st.t === "group") return `<li><div class="st-group">${richText(st.text)}</div></li>`;
      if (st.t === "text") return `<li><p class="st-text">${richText(st.text)}</p></li>`;
      if (["note", "caution", "warning"].includes(st.t)) return `<li><div class="callout ${st.t}"><span class="lab">${st.t.toUpperCase()}</span><p>${richText(st.text)}</p></div></li>`;
      if (st.t === "fig") return `<li><figure class="fig"><button class="fig-btn" data-zoom="${st.file}" data-title="${esc(tcase(st.title || p.title))}" data-w="${st.w}" data-h="${st.h}"><img src="${st.file}" width="${st.w}" height="${st.h}" loading="lazy" alt="${esc(st.title || "Chart")}"></button>${st.title ? `<figcaption><span>${esc(tcase(st.title))}</span></figcaption>` : ""}</figure></li>`;
      if (st.t === "table") return `<li><div class="tbl-scroll"><table class="mini">${st.title ? `<caption>${esc(tcase(st.title))}</caption>` : ""}${st.head.length ? `<thead><tr>${st.head.map((h) => `<th>${esc(tcase(h))}</th>`).join("")}</tr></thead>` : ""}<tbody>${st.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></li>`;
      return "";
    }).join("");
    return { steps, legend: legendBits.join("") };
  }
  function showChecklistHome() {
    const first = procs.find((p) => p.sec === "n" && /preflight/i.test(p.title)) || procs[0];
    const saved = store.get("lastProc", null);
    location.replace("#cl-" + (saved && procById[saved] && procById[saved].sec === "n" ? saved : first.id));
  }
  function showProc(id) {
    const p = procById[id];
    if (!p) return showChecklistHome();
    setMode(p.sec === "e" ? "checklist" : "checklist");
    if (p.sec === "n") store.set("lastProc", id);
    window.__procId = id;
    checklistSide(id);
    const { steps, legend } = procHTML(p);
    const list = procs.filter((x) => x.sec === p.sec);
    const i = list.indexOf(p);
    const next = list[i + 1], prev = list[i - 1];
    const secClass = p.sec;
    main.innerHTML = `<article class="card" aria-labelledby="procTitle">
      <div class="card-head"><div class="where"><span class="${secClass}">${SEC_NAME[p.sec]} procedures</span>${p.group && slug(p.group) !== slug(p.title) ? `<span>${esc(tcase(p.group))}</span>` : ""}<span>Checklist page ${esc(p.page)}</span></div>
      <h1 id="procTitle">${esc(procTitle(p))}</h1>
      ${p.applies ? `<ul class="applies">${p.applies.map((a) => `<li>${esc(tcase(a))}</li>`).join("")}</ul>` : ""}
      ${p.anns.length ? `<div class="anns">${p.anns.map((a) => chip(a.text, a.color)).join("")}</div>` : ""}</div>
      <div class="card-tools"><div class="meter"><i id="meter"></i></div><span class="count" id="count"></span>
        <button class="btn small" id="checkNext">Check next item</button><button class="btn small" id="resetProc">Reset</button></div>
      ${legend ? `<div class="legend">${legend}</div>` : ""}
      <ol class="steps" id="steps">${steps}</ol>
      <div class="card-foot">${prev ? `<a class="btn" href="#cl-${prev.id}">Previous: ${esc(procTitle(prev))}</a>` : "<span></span>"}
      ${next ? `<a class="btn primary" id="nextProc" href="#cl-${next.id}">Next: ${esc(procTitle(next))}</a>` : ""}</div></article>
      <p class="foot-note" style="max-width:760px">Tap an item to check it off; Space checks the next item. Checkmarks are saved on this device. Beechcraft B200/B200C Pilot Checklist, Revision 3 (BB-1439, BB-1444 thru BB-1842 except BB-1463 and BB-1834).</p>`;
    bindProc(p);
    scrollTop();
  }
  function bindProc(p) {
    const box = $("#steps");
    const keys = stepKeys(p);
    const state = checks[p.id] || (checks[p.id] = {});
    const paint = () => {
      for (const b of $$(".step", box)) {
        const k = b.dataset.k;
        if (k.startsWith("p")) {
          const i = k.slice(1), subs = keys.filter((x) => x.startsWith(i + "."));
          b.setAttribute("aria-checked", String(subs.every((x) => state[x])));
        } else b.setAttribute("aria-checked", String(!!state[k]));
        b.classList.remove("next");
      }
      const nextK = keys.find((k) => !state[k]);
      if (nextK) { const nb = $(`.step[data-k="${nextK}"]`, box); if (nb) nb.classList.add("next"); }
      const d = keys.filter((k) => state[k]).length;
      $("#meter").style.width = keys.length ? (100 * d / keys.length) + "%" : "0";
      $("#count").textContent = keys.length ? `${d} of ${keys.length}` : "";
      const pr = $(`[data-prog="${p.id}"]`, side);
      if (pr) { pr.textContent = keys.length ? `${d}/${keys.length}` : ""; pr.classList.toggle("full", d === keys.length && d > 0); }
      $("#checkNext").disabled = !nextK;
      $("#checkNext").textContent = nextK ? "Check next item" : "All items checked";
    };
    box.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const b = e.target.closest(".step");
      if (!b) return;
      const k = b.dataset.k;
      if (k.startsWith("p")) {
        const i = k.slice(1), subs = keys.filter((x) => x.startsWith(i + "."));
        const all = subs.every((x) => state[x]);
        for (const x of subs) state[x] = !all;
      } else state[k] = !state[k];
      saveChecks(); paint();
    });
    $("#checkNext").onclick = () => { const k = keys.find((x) => !state[x]); if (k) { state[k] = true; saveChecks(); paint(); const nb = $(".step.next", box); if (nb) nb.scrollIntoView({ block: "nearest" }); } };
    $("#resetProc").onclick = () => { for (const k of Object.keys(state)) delete state[k]; saveChecks(); paint(); };
    paint();
  }
  function showEmergency() {
    setMode("checklist");
    checklistSide(null);
    const groups = {};
    for (const p of procs.filter((x) => x.sec === "e" && x.steps.some((s) => s.t === "item"))) (groups[p.group] = groups[p.group] || []).push(p);
    main.innerHTML = `<div class="emer-grid"><h1>Emergency procedures</h1>
      <p>Boldface memory items are marked in each procedure. The annunciators that call for a procedure are shown on its card. Abnormal procedures are listed in the sidebar.</p>
      ${Object.entries(groups).map(([g, ps]) => `<section class="eg"><h2>${esc(tcase(g))}</h2><ul>${ps.map((p) => {
        const mem = p.steps.filter((s) => s.t === "item" && s.mem).length;
        return `<li><a href="#cl-${p.id}"><b>${esc(procTitle(p))}</b>${p.anns.length ? `<span class="anns" style="margin:0">${p.anns.map((a) => chip(a.text, a.color)).join(" ")}</span>` : ""}${mem ? `<span class="mem-n">${mem} memory item${mem > 1 ? "s" : ""}</span>` : ""}</a></li>`;
      }).join("")}</ul></section>`).join("")}</div>`;
    scrollTop();
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, dialog")) return;
    if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); openSearch(); return; }
    if (mode === "checklist" && e.key === " " && $("#checkNext") && !e.target.closest("button, a")) { e.preventDefault(); $("#checkNext").click(); }
  });

  /* ---------- Walkaround ---------- */
  const WA = chById.walkaround.walkaround;
  const waItems = {};
  WA.stations.forEach((s, si) => s.items.forEach((it) => { waItems[it.n] = { ...it, station: si }; }));
  WA.legend.forEach((it) => { if (!waItems[it.n]) waItems[it.n] = { ...it, station: null }; });
  const waChecks = store.get("wa", {});
  let waView = 0, waSel = null;
  function viewOf(n) { return WA.overviews.findIndex((o) => o.markers.some((m) => m.n === n)); }
  function rangeLabel(o) {
    const ns = [...new Set(o.markers.map((m) => m.n))].sort((a, b) => a - b);
    const parts = []; let s = ns[0], p = ns[0];
    for (const n of ns.slice(1).concat([Infinity])) { if (n !== p + 1) { parts.push(s === p ? `${s}` : `${s}–${p}`); s = n; } p = n; }
    return parts.join(", ");
  }
  function showWalkaround(h) {
    setMode("walkaround");
    manualSide("walkaround");
    const m = h.match(/^wa-(\d+)$/);
    if (m && waItems[+m[1]]) { waSel = +m[1]; const v = viewOf(waSel); if (v >= 0) waView = v; }
    if (waSel === null) waSel = 1;
    const total = Object.keys(waItems).length;
    const done = Object.keys(waItems).filter((n) => waChecks[n]).length;
    const o = WA.overviews[waView];
    main.innerHTML = `<div class="wrap"><div class="wa-head"><div><h1>Preflight walkaround</h1>
      <p>Every item in the exterior power-off preflight inspection, keyed to the photos. Pick a number on the airplane to see the close-up and check it off.</p></div>
      <div class="ch-meta"><span id="waCount">${done} of ${total} checked</span><button class="btn small" id="waReset">Clear</button></div></div>
      <div class="views" role="group" aria-label="Overview photo">${WA.overviews.map((ov, i) => `<button aria-pressed="${i === waView}" data-view="${i}">Items ${rangeLabel(ov)}</button>`).join("")}</div>
      <div class="wa-grid"><div><div class="overview" id="ov"><img src="${o.file}" width="${o.w}" height="${o.h}" alt="Overview photo, items ${rangeLabel(o)}">
        ${o.markers.map((mk) => `<button class="mk ${waChecks[mk.n] ? "done" : ""} ${mk.n === waSel ? "on" : ""}" style="left:${mk.x * 100}%;top:${mk.y * 100}%" data-n="${mk.n}" aria-label="Item ${mk.n}: ${esc(waItems[mk.n] ? waItems[mk.n].item : "")}">${mk.n}</button>`).join("")}</div>
        <p class="foot-note" style="margin:8px 0 0;max-width:none">Photo page ${esc(o.page)}. Numbers follow the walkaround sequence in the training manual.</p></div>
        <div id="station"></div></div>
      <section class="wa-all"><h2>All items</h2><ul class="wa-list wa-items" id="waList">${Object.values(waItems).sort((a, b) => a.n - b.n).map((it) => `<li>${stepRow("w" + it.n, it.n, tcase(it.item), it.action)}</li>`).join("")}</ul></section></div>`;
    paintStation();
    paintWaChecks();
    $(".views").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) { waView = +b.dataset.view; const ns = WA.overviews[waView].markers.map((x) => x.n); waSel = Math.min(...ns); showWalkaround("walkaround"); } };
    $("#ov").onclick = (e) => { const b = e.target.closest(".mk"); if (b) { waSel = +b.dataset.n; $$(".mk", main).forEach((x) => x.classList.toggle("on", +x.dataset.n === waSel)); paintStation(); } };
    $("#waList").onclick = (e) => { const b = e.target.closest(".step"); if (b) { const n = b.dataset.k.slice(1); waChecks[n] = !waChecks[n]; store.set("wa", waChecks); paintWaChecks(); paintStation(); } };
    $("#waReset").onclick = () => { for (const k of Object.keys(waChecks)) delete waChecks[k]; store.set("wa", waChecks); showWalkaround("walkaround"); };
    scrollTop();
  }
  function paintWaChecks() {
    for (const b of $$("#waList .step", main)) b.setAttribute("aria-checked", String(!!waChecks[b.dataset.k.slice(1)]));
    for (const b of $$(".mk", main)) b.classList.toggle("done", !!waChecks[b.dataset.n]);
    const total = Object.keys(waItems).length;
    $("#waCount").textContent = `${Object.keys(waItems).filter((n) => waChecks[n]).length} of ${total} checked`;
  }
  function paintStation() {
    const it = waItems[waSel];
    const host = $("#station");
    if (!it) { host.innerHTML = ""; return; }
    const st = it.station !== null ? WA.stations[it.station] : null;
    const items = st ? st.items : [it];
    const order = Object.keys(waItems).map(Number).sort((a, b) => a - b);
    const idx = order.indexOf(waSel);
    host.innerHTML = `<div class="station">${st ? `<div class="photos">${st.photos.map((p) => `<img src="${p.file}" width="${p.w}" height="${p.h}" data-zoom="${p.file}" data-title="Walkaround item ${items.map((x) => x.n).join(", ")}" data-w="${p.w}" data-h="${p.h}" alt="Close-up: ${esc(items.map((x) => tcase(x.item)).join(", "))}">`).join("")}</div>` : ""}
      <div class="body"><h2>${items.length > 1 ? "Items " + items.map((x) => x.n).join(", ") : "Item " + it.n}</h2>
      <p class="src">${st ? `Close-up photo${st.page ? ", page " + esc(st.page) : ""}` : "Shown on the overview photo; no separate close-up in the manual"}</p>
      <ul class="steps wa-items" style="padding:0">${items.map((x) => `<li style="padding:0">${stepRow("w" + x.n, x.n, tcase(x.item), x.action)}</li>`).join("")}</ul>
      <div class="nav"><button class="btn small" id="waPrev" ${idx <= 0 ? "disabled" : ""}>Previous item</button><button class="btn small primary" id="waNext" ${idx >= order.length - 1 ? "disabled" : ""}>Next item</button></div></div></div>`;
    for (const b of $$(".step", host)) b.setAttribute("aria-checked", String(!!waChecks[b.dataset.k.slice(1)]));
    host.onclick = (e) => {
      const b = e.target.closest(".step");
      if (b) { const n = b.dataset.k.slice(1); waChecks[n] = !waChecks[n]; store.set("wa", waChecks); paintWaChecks(); b.setAttribute("aria-checked", String(!!waChecks[n])); }
    };
    const go = (n) => { waSel = n; const v = viewOf(n); if (v >= 0 && v !== waView) { waView = v; showWalkaround("walkaround"); requestAnimationFrame(() => $("#station").scrollIntoView({ block: "nearest" })); } else { $$(".mk", main).forEach((x) => x.classList.toggle("on", +x.dataset.n === n)); paintStation(); } };
    $("#waPrev").onclick = () => go(order[idx - 1]);
    $("#waNext").onclick = () => { const n = waSel; if (!waChecks[n]) { for (const x of items) waChecks[x.n] = true; store.set("wa", waChecks); paintWaChecks(); } go(order[Math.min(order.length - 1, order.indexOf(Math.max(...items.map((x) => x.n))) + 1)]); };
  }

  /* ---------- Annunciators ---------- */
  const annProcs = (t) => procs.filter((p) => p.anns.some((a) => a.text.replace(/\s+/g, " ") === t) || p.steps.some((s) => (s.text + " " + (s.action || "")).includes("[" + t + "]")));
  const annChapters = (t) => {
    const re = new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "\\b");
    const hits = [];
    for (const c of chapters) {
      let n = 0, first = null;
      c.blocks.forEach((b, i) => { if ((b.t === "p" || b.t === "li" || b.t === "callout") && re.test(strip(b.text))) { n++; if (first === null) first = i; } });
      if (n) hits.push({ c, n, first });
    }
    return hits.sort((a, b) => b.n - a.n).slice(0, 4);
  };
  let annLit = new Set(), annSel = null, drill = null, mwFlash = false, mcFlash = false;
  function showAnnunciators(h) {
    setMode("annunciators");
    manualSide("ch4");
    const m = h.match(/^ann-(.+)$/);
    if (m) { const t = Object.keys(LENS).find((k) => slug(k) === m[1]); if (t) { annSel = t; annLit.add(t); } }
    const grid = (key, cols) => `<div class="lens-grid" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))">${A.panels[key].flat().map((l) => l.blank
      ? `<span class="lens blank ${l.color}" aria-hidden="true">&nbsp;</span>`
      : `<button class="lens ${l.color}" data-t="${esc(l.text)}" aria-pressed="false">${esc(l.text)}${l.optional ? '<span class="lens-opt">optional</span>' : ""}</button>`).join("")}</div>`;
    main.innerHTML = `<div class="ann-page"><h1>Annunciator panel trainer</h1>
      <p>${esc(A.serials)}. Press a lens to light it and read its cause, the checklist procedure that goes with it and where the manual covers it. Red lights trigger the MASTER WARNING flasher and amber lights the MASTER CAUTION; press the flasher to reset it.</p>
      <div class="housing"><div class="housing-row">
        <div class="masters"><button class="master" id="mw">MASTER<br>WARNING<small>PRESS TO RESET</small></button><button class="master caution" id="mc">MASTER<br>CAUTION<small>PRESS TO RESET</small></button></div>
        <div style="flex:1 1 380px;min-width:0">${grid("warning", 5)}<div class="panel-label">WARNING ANNUNCIATOR PANEL</div></div></div>
        <div style="margin-top:14px">${grid("caution", 6)}<div class="panel-label">CAUTION / ADVISORY ANNUNCIATOR PANEL</div></div></div>
      <div class="ann-tools"><button class="btn" id="annTest">Press to test</button><button class="btn" id="annClear">Extinguish all</button><button class="btn primary" id="annDrill">Drill: name the cause</button></div>
      <div class="ann-detail" id="annDetail"></div></div>`;
    $(".housing").onclick = (e) => {
      const l = e.target.closest(".lens[data-t]");
      if (l) {
        const t = l.dataset.t;
        if (drill) return;
        if (annSel === t && annLit.has(t)) { annLit.delete(t); annSel = null; }
        else { annLit.add(t); annSel = t; if (LENS[t].color === "red") mwFlash = true; if (LENS[t].color === "amber") mcFlash = true; }
        paintAnn();
        return;
      }
      if (e.target.closest("#mw")) { mwFlash = false; paintAnn(); }
      if (e.target.closest("#mc")) { mcFlash = false; paintAnn(); }
    };
    $("#annTest").onclick = () => {
      const all = Object.keys(LENS), prev = new Set(annLit);
      for (const t of all) annLit.add(t);
      mwFlash = mcFlash = true; paintAnn();
      setTimeout(() => { annLit = prev; mwFlash = mcFlash = false; paintAnn(); }, 2200);
    };
    $("#annClear").onclick = () => { annLit.clear(); annSel = null; drill = null; mwFlash = mcFlash = false; paintAnn(); };
    $("#annDrill").onclick = startDrill;
    paintAnn();
    scrollTop();
  }
  function paintAnn() {
    const anyRed = [...annLit].some((t) => LENS[t] && LENS[t].color === "red");
    const anyAmb = [...annLit].some((t) => LENS[t] && LENS[t].color === "amber");
    $("#mw").classList.toggle("lit", anyRed && mwFlash); $("#mw").classList.toggle("flash", anyRed && mwFlash);
    $("#mc").classList.toggle("lit", anyAmb && mcFlash); $("#mc").classList.toggle("flash", anyAmb && mcFlash);
    for (const l of $$(".lens[data-t]", main)) {
      const t = l.dataset.t;
      l.classList.toggle("lit", annLit.has(t)); l.classList.toggle("sel", t === annSel);
      l.setAttribute("aria-pressed", String(annLit.has(t)));
    }
    const box = $("#annDetail");
    if (drill) return paintDrill();
    if (!annSel) { box.innerHTML = `<div class="panel-box"><h2>Select a lens</h2><p>Each lens on the panels above is live. The detail for the lens you press appears here.</p></div>`; return; }
    const L = LENS[annSel];
    const ps = annProcs(annSel), hs = annChapters(annSel);
    const kind = L.color === "red" ? "Warning" : L.color === "amber" ? "Caution" : "Advisory";
    box.innerHTML = `<div class="panel-box"><h2>${chip(annSel, L.color)} ${kind}${L.optional ? " (optional equipment)" : ""}</h2>
      <p><b>Cause for illumination:</b> ${esc(L.cause || "Not listed")}</p>
      <p class="foot-note" style="margin:0">From Table ${L.panel === "warning" ? "4-3" : "4-6"}, Chapter 4, Master Warning System.</p></div>
      <div class="panel-box"><h2>Where to go next</h2><ul>
      ${ps.map((p) => `<li><a href="#cl-${p.id}">${esc(procTitle(p))}</a> <span style="color:var(--ink-3)">(${SEC_NAME[p.sec].toLowerCase()} procedure, page ${esc(p.page)})</span></li>`).join("") || "<li>No checklist procedure names this annunciator.</li>"}
      ${hs.map((h) => `<li><a href="#${h.c.id}-b${h.first}">${h.c.num ? "Chapter " + h.c.num + ", " : ""}${esc(h.c.title)}</a> <span style="color:var(--ink-3)">(${h.n} mention${h.n > 1 ? "s" : ""})</span></li>`).join("")}</ul></div>`;
  }
  function startDrill() {
    const pool = Object.keys(LENS).filter((t) => LENS[t].cause);
    const t = pool[Math.floor(Math.random() * pool.length)];
    const wrong = pool.filter((x) => x !== t && LENS[x].cause !== LENS[t].cause).sort(() => Math.random() - 0.5).slice(0, 3);
    drill = { t, opts: [t, ...wrong].sort(() => Math.random() - 0.5), answered: null, score: (drill && drill.score) || { r: 0, n: 0 } };
    annLit = new Set([t]); annSel = null;
    mwFlash = LENS[t].color === "red"; mcFlash = LENS[t].color === "amber";
    paintAnn();
  }
  function paintDrill() {
    const box = $("#annDetail"), d = drill;
    box.innerHTML = `<div class="panel-box" style="grid-column:1/-1"><h2>Drill: which cause lights this lens?</h2>
      <p>Score this session: ${d.score.r} of ${d.score.n}</p>
      <div class="drill-opts">${d.opts.map((t) => `<button class="opt" data-t="${esc(t)}" ${d.answered ? "disabled" : ""}><span>${esc(LENS[t].cause)}</span></button>`).join("")}</div>
      <div class="q-res" id="drillRes"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" id="drillNext">${d.answered ? "Next lens" : "Skip"}</button><button class="btn" id="drillStop">Stop drill</button></div></div>`;
    if (d.answered) {
      for (const b of $$(".opt", box)) { b.classList.toggle("right", b.dataset.t === d.t); b.classList.toggle("wrong", b.dataset.t === d.answered && d.answered !== d.t); }
      box.firstElementChild.classList.add("q", "done");
      const r = $("#drillRes"); r.className = "q-res " + (d.answered === d.t ? "ok" : "no");
      r.textContent = d.answered === d.t ? "Correct." : `That cause belongs to ${d.answered}.`;
    }
    $(".drill-opts", box).onclick = (e) => { const b = e.target.closest(".opt"); if (!b || d.answered) return; d.answered = b.dataset.t; d.score.n++; if (d.answered === d.t) d.score.r++; paintDrill(); };
    $("#drillNext").onclick = startDrill;
    $("#drillStop").onclick = () => { annSel = d.t; drill = null; paintAnn(); };
  }

  /* ---------- Search ---------- */
  let INDEX = null;
  function buildIndex() {
    INDEX = [];
    for (const c of chapters) {
      let head = c.title;
      c.blocks.forEach((b, i) => {
        if (b.t === "h2" || b.t === "h3") { head = tcase(b.text); INDEX.push({ g: "Manual sections", t: head, s: c.title, h: `#${c.id}-b${i}`, w: 3 }); }
        else if (b.t === "p" || b.t === "li" || b.t === "callout") INDEX.push({ g: "Manual text", t: `${c.title}: ${head}`, s: strip(b.text), h: `#${c.id}-b${i}`, w: 1 });
        else if (b.t === "fig") { const f = figs[b.id]; if (f && f.num) INDEX.push({ g: "Figures and tables", t: `${f.kind === "table" ? "Table" : "Figure"} ${f.num} ${tcase(f.title)}`, s: (f.text || "").slice(0, 300), h: `#${c.id}-b${i}`, fig: b.id, w: 2 }); }
      });
    }
    for (const p of procs) {
      INDEX.push({ g: "Checklist procedures", t: procTitle(p), s: `${SEC_NAME[p.sec]} procedure, page ${p.page}`, h: `#cl-${p.id}`, w: 4 });
      for (const s of p.steps) if (s.t === "item") INDEX.push({ g: "Checklist items", t: `${s.text} ${s.action ? "— " + s.action : ""}`, s: procTitle(p), h: `#cl-${p.id}`, w: 1.5 });
    }
    for (const [t, l] of Object.entries(LENS)) INDEX.push({ g: "Annunciators", t, s: l.cause || "", h: `#ann-${slug(t)}`, w: 4 });
    for (const it of Object.values(waItems)) INDEX.push({ g: "Walkaround", t: `${it.n}. ${tcase(it.item)}`, s: it.action, h: `#wa-${it.n}`, w: 1.5 });
    for (const x of INDEX) x.k = (x.t + " " + x.s).toLowerCase();
  }
  const pal = $("#pal"), palIn = $("#palInput"), palRes = $("#palRes");
  let palSel = 0;
  function openSearch() {
    if (!INDEX) buildIndex();
    try { pal.showModal(); } catch { pal.setAttribute("open", ""); }
    palIn.select(); runSearch();
  }
  function hi(s, terms) {
    let h = esc(s);
    for (const t of terms) if (t.length > 1) h = h.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    return h;
  }
  function snippet(s, terms) {
    const low = s.toLowerCase(); const i = Math.max(0, low.indexOf(terms[0] || ""));
    const start = Math.max(0, i - 60); return (start ? "…" : "") + s.slice(start, start + 220);
  }
  function runSearch() {
    const q = palIn.value.trim().toLowerCase();
    if (!q) { palRes.innerHTML = `<li class="pal-empty">Try “crossfeed”, “L DC GEN”, “propeller feather”, “pressurization” or “Figure 5-1”.</li>`; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const x of INDEX) {
      if (!terms.every((t) => x.k.includes(t))) continue;
      const inTitle = terms.filter((t) => x.t.toLowerCase().includes(t)).length;
      hits.push({ x, sc: x.w * (1 + inTitle * 2) + (x.t.toLowerCase().startsWith(terms[0]) ? 3 : 0) });
    }
    hits.sort((a, b) => b.sc - a.sc);
    const top = hits.slice(0, 60);
    if (!top.length) { palRes.innerHTML = `<li class="pal-empty">No matches for “${esc(q)}”. Check the spelling or try a shorter term.</li>`; return; }
    const groups = {};
    for (const h of top) (groups[h.x.g] = groups[h.x.g] || []).push(h.x);
    const order = ["Annunciators", "Checklist procedures", "Manual sections", "Figures and tables", "Checklist items", "Walkaround", "Manual text"];
    let n = 0;
    palRes.innerHTML = order.filter((g) => groups[g]).map((g) => `<li class="grp">${g}</li>` + groups[g].slice(0, g === "Manual text" ? 25 : 8).map((x) =>
      `<li><a href="${x.h}" data-i="${n++}" ${x.fig ? `data-openfig="${x.fig}"` : ""} role="option"><span class="tt">${hi(x.t, terms)}</span><span class="sn">${hi(snippet(x.s, terms), terms)}</span></a></li>`).join("")).join("");
    palSel = 0; paintSel();
  }
  function paintSel() { $$("a", palRes).forEach((a, i) => a.setAttribute("aria-selected", String(i === palSel))); const a = $(`a[data-i="${palSel}"]`, palRes); if (a) a.scrollIntoView({ block: "nearest" }); }
  palIn.addEventListener("input", runSearch);
  palIn.addEventListener("keydown", (e) => {
    const all = $$("a", palRes);
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(all.length - 1, palSel + 1); paintSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); paintSel(); }
    else if (e.key === "Enter") { e.preventDefault(); const a = all[palSel]; if (a) a.click(); }
  });
  palRes.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    pal.close();
    if (a.dataset.openfig) { e.preventDefault(); const h = a.getAttribute("href"); if (location.hash !== h) location.hash = h; else route(); setTimeout(() => openFig(a.dataset.openfig), 60); }
    else if (a.getAttribute("href") === location.hash) { e.preventDefault(); route(); }
  });
  $("#palClose").onclick = () => pal.close();
  $("#searchBtn").onclick = openSearch;

  /* ---------- Shell ---------- */
  $("#menuBtn").onclick = () => { const open = document.body.classList.toggle("side-open"); $("#menuBtn").setAttribute("aria-expanded", String(open)); };
  $("#scrim").onclick = () => { document.body.classList.remove("side-open"); $("#menuBtn").setAttribute("aria-expanded", "false"); };
  side.addEventListener("click", (e) => { if (e.target.closest("a") && window.innerWidth <= 960) document.body.classList.remove("side-open"); });
  window.addEventListener("hashchange", route);
  window.KA = { openFig, chip, tcase };
  route();
})();
