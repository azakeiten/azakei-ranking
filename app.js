/* AZAKEI 本日の億万長者 — ranking board
   Visitors: reads the records from the Apps Script web app every few seconds.
   Admin (#admin): writes records with the shared passcode. */
(() => {
"use strict";
const CFG = window.AZAKEI_RANKING || {};
const API = String(CFG.scriptUrl || "").trim();
const DEMO = /[?&]demo\b/.test(location.search);
const PAGE_URL = "https://azakeiten.github.io/azakei-ranking/";
const START = 5, PRIZE = 40, TOP_N = 10, NOW_MIN = 10;
const POLL_MS = 7000;
const LAST_YEAR = Math.max(0, Number(CFG.lastYearBest) || 0);   // 去年の1位の枚数
const MILESTONE = 50;                                           // 号外を出す人数の区切り

const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const wd = (s) => { const [y, m, d] = s.split("-").map(Number); return "日月火水木金土"[new Date(y, m - 1, d).getDay()]; };
const fmtShort = (s) => { const [, m, d] = s.split("-").map(Number); return m + "/" + d + "(" + wd(s) + ")"; };
const fmtLong = (s) => { const [, m, d] = s.split("-").map(Number); return m + "月" + d + "日（" + wd(s) + "）"; };
const hhmm = (t) => { const d = new Date(t); return d.getHours() + ":" + pad(d.getMinutes()); };
const times = (n) => Math.round(n / START * 10) / 10;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clean = (e) => ({ id: String(e.id || ""), name: String(e.name || "").slice(0, 20), chips: Math.max(0, Math.floor(Number(e.chips) || 0)), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "", createdAt: Number(e.createdAt) || 0 });

/* ---------- state ---------- */
let entries = [];
let known = null;            // ids seen on the previous load (null = first load)
let fresh = new Set();       // ids that arrived since the previous load
let topByDay = {};           // date -> id of 1st place on the previous load
let filter = null, userPicked = false;
let isAdmin = location.hash === "#admin";
let pass = ls.get("azakei-pass") || "";
let busy = false, pendingDel = null, lastSig = "", failCount = 0, drewOnce = false, writeSeq = 0;
let crown = null, lastCrown = null;   // 1st place just changed hands (crown: play it once; lastCrown: keep it on the 速報 paper)

/* ---------- chalk textures ---------- */
function makeTextures() {
  try {
    const m = document.createElement("canvas"); m.width = m.height = 160;
    const mc = m.getContext("2d"); const img = mc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i + 3] = Math.random() < .12 ? 70 : 200 + Math.random() * 55; }
    mc.putImageData(img, 0, 0);
    document.documentElement.style.setProperty("--chalk-mask", "url(" + m.toDataURL() + ")");
    const s = document.createElement("canvas"); s.width = 900; s.height = 520;
    const sc = s.getContext("2d"); sc.lineCap = "round";
    lessonGhost(sc);
    for (let i = 0; i < 26; i++) {
      sc.strokeStyle = "rgba(240,239,231," + (0.012 + Math.random() * 0.025) + ")"; sc.lineWidth = 40 + Math.random() * 70;
      const a = Math.random() * 6; sc.beginPath(); sc.arc(Math.random() * 900, Math.random() * 520, 120 + Math.random() * 260, a, a + 0.6 + Math.random() * 1.2); sc.stroke();
    }
    for (let i = 0; i < 70; i++) {
      sc.strokeStyle = "rgba(240,239,231," + (0.02 + Math.random() * 0.03) + ")"; sc.lineWidth = 1 + Math.random() * 2;
      const x = Math.random() * 900, y = Math.random() * 520; sc.beginPath(); sc.moveTo(x, y); sc.lineTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 20); sc.stroke();
    }
    const d = document.createElement("canvas"); d.width = d.height = 220;
    const dc = d.getContext("2d");
    for (let i = 0; i < 900; i++) { dc.fillStyle = "rgba(240,239,231," + (Math.random() * 0.05) + ")"; dc.fillRect(Math.random() * 220, Math.random() * 220, 1 + Math.random(), 1 + Math.random()); }
    return "url(" + s.toDataURL() + "), url(" + d.toDataURL() + ")";
  } catch (e) { return "none"; }
}
/* what is left of the morning's economics lesson: a supply-and-demand sketch, half erased */
function lessonGhost(c) {
  const ink = "rgba(240,239,231,.07)";
  c.save(); c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 3; c.lineJoin = "round";
  const ox = 590, oy = 470;
  const seg = (pts) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke(); };
  seg([ox, oy, ox, 236]); seg([ox - 6, 248, ox, 236, ox + 6, 248]);
  seg([ox, oy, 872, oy]); seg([860, oy - 6, 872, oy, 860, oy + 6]);
  c.beginPath(); c.moveTo(ox + 24, 270); c.quadraticCurveTo(ox + 120, 410, 846, 446); c.stroke();
  c.beginPath(); c.moveTo(ox + 24, 452); c.quadraticCurveTo(ox + 150, 400, 836, 268); c.stroke();
  c.setLineDash([6, 8]); c.lineWidth = 2;
  seg([ox, 372, 714, 372]); seg([714, 372, 714, oy]);
  c.setLineDash([]);
  c.font = "24px 'Klee One', 'Yu Gothic', sans-serif";
  c.fillText("価格", ox - 58, 252); c.fillText("数量", 836, oy + 32);
  c.fillText("需要", 812, 432); c.fillText("供給", 806, 262);
  c.font = "20px 'Klee One', 'Yu Gothic', sans-serif"; c.fillText("均衡点", 724, 360);
  c.font = "30px 'Klee One', 'Yu Gothic', sans-serif"; c.fillText("③ 需要と供給", 600, 210);
  c.font = "22px 'Klee One', 'Yu Gothic', sans-serif"; c.fillText("売上 ＝ 価格 × 数量", 40, 496);
  // the eraser went over it once, not carefully
  c.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 9; i++) {
    c.strokeStyle = "rgba(0,0,0," + (0.35 + Math.random() * 0.4) + ")"; c.lineWidth = 34 + Math.random() * 30;
    const y = 200 + i * 34 + Math.random() * 20; c.beginPath(); c.moveTo(560 + Math.random() * 40, y); c.bezierCurveTo(680, y - 20, 760, y + 24, 890, y - 6); c.stroke();
  }
  c.strokeStyle = "rgba(0,0,0,.5)"; c.lineWidth = 40; c.beginPath(); c.moveTo(20, 488); c.lineTo(330, 482); c.stroke();
  c.restore();
}
let BOARD_BG = makeTextures();
$("board").style.backgroundImage = BOARD_BG;
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { BOARD_BG = makeTextures(); $("board").style.backgroundImage = BOARD_BG; });

/* ---------- hand-drawn marks ---------- */
const NS = "http://www.w3.org/2000/svg";
function seeded(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }
const pathFrom = (pts) => "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
function circlePts(rnd, cx, cy, rx, ry) {
  const pts = [], start = rnd() * 6.28, turns = 1.12 + rnd() * 0.12, ph = rnd() * 6;
  for (let i = 0; i <= 90; i++) { const t = i / 90, a = start + t * turns * 6.283, w = 1 + 0.05 * Math.sin(3 * a + ph) + t * 0.06; pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]); }
  return pts;
}
function hanamaruPts(rnd) {
  const pts = [], A = 38, d = 9.5, k = 9;
  for (let i = 0; i <= 420; i++) { const a = -1.6 + (i / 420) * 6.4; pts.push([50 + A * Math.cos(a) - d * Math.cos(k * a) + (rnd() - .5) * .8, 50 + A * Math.sin(a) - d * Math.sin(k * a) + (rnd() - .5) * .8]); }
  for (let i = 0; i <= 160; i++) { const t = i / 160, a = 4.8 + t * 12.6, r = 26 * (1 - t) + 4; pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]); }
  return pts;
}
function wobbleLine(rnd, x1, y1, x2, y2) { const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([x1 + (x2 - x1) * t + (rnd() - .5) * 1.2, y1 + (y2 - y1) * t + (rnd() - .5) * 1.2]); } return pts; }
function svgMark(d, color, width, viewBox, cls) {
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", viewBox); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  for (const k of ["maskImage", "webkitMaskImage"]) svg.style[k] = "var(--chalk-mask)";
  for (const k of ["maskSize", "webkitMaskSize"]) svg.style[k] = "160px";
  svg.appendChild(pathEl(d, color, width));
  return svg;
}
function pathEl(d, color, width) {
  const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", color); p.setAttribute("stroke-width", width);
  p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); p.setAttribute("vector-effect", "non-scaling-stroke"); return p;
}
function drawIn(svg, ms, delay) {
  const p = svg.querySelector("path"); if (!p || reduced()) return;
  requestAnimationFrame(() => { let L = 0; try { L = p.getTotalLength(); } catch (e) {} if (!L) return;
    p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
    p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: ms, delay: delay || 0, easing: "ease-in-out", fill: "forwards" }); });
}
(() => { const r = seeded("title"); const pts = []; for (let i = 0; i <= 40; i++) pts.push([i * 2.5, 10 + Math.sin(i / 6) * 2.2 + (r() - .5) * 1.4]); const svg = svgMark(pathFrom(pts), "var(--chalk-yellow)", 4, "0 0 100 20", "under"); $("h1").appendChild(svg); drawIn(svg, 900, 200); })();

/* ---------- clock on the wall ---------- */
function tick() {
  const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
  $("hh").style.transform = "rotate(" + h * 30 + "deg)"; $("mm").style.transform = "rotate(" + m * 6 + "deg)"; $("sec").style.transform = "rotate(" + s * 6 + "deg)";
}
tick(); setInterval(tick, 1000);

/* ---------- QR print ---------- */
try {
  if (window.qrcode) { const q = window.qrcode(0, "M"); q.addData(PAGE_URL); q.make(); $("qr").innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); $("qrPaper").hidden = false; }
} catch (e) {}

/* ---------- full screen for the projector ---------- */
$("fsBtn").onclick = async () => {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (e) {}
};
document.addEventListener("fullscreenchange", () => { const on = !!document.fullscreenElement; document.body.classList.toggle("fs", on); $("fsBtn").textContent = on ? "全画面をやめる" : "全画面で映す"; });

/* ---------- ranking helpers ---------- */
const ranked = (date) => entries.filter(e => date === "all" || e.date === date).sort((a, b) => b.chips - a.chips || a.createdAt - b.createdAt);
const rankOf = (list, e) => list.filter(x => x.chips > e.chips).length + 1;
const latestDate = () => entries.reduce((m, e) => e.date > m ? e.date : m, "");
const liveDay = () => entries.some(e => e.date === today()) ? today() : (latestDate() || today());

/* ---------- data: load / apply ---------- */
function apply(list) {
  const prevKnown = known;
  entries = list;
  fresh = prevKnown ? new Set(list.filter(e => !prevKnown.has(e.id)).map(e => e.id)) : new Set();
  known = new Set(list.map(e => e.id));
  if (!userPicked || (filter !== "all" && !list.some(e => e.date === filter))) filter = liveDay();

  // 1st place changed while this page was open?
  const day = liveDay(), top = ranked(day)[0];
  if (top) {
    const prevTopId = topByDay[day];
    if (prevKnown && prevTopId !== top.id && fresh.has(top.id)) {
      const prevE = entries.find(e => e.id === prevTopId);
      crown = lastCrown = { id: top.id, prev: prevE ? { name: prevE.name, chips: prevE.chips } : null };
    }
    topByDay[day] = top.id;
  }

  // 号外: last year's record falls, or today reaches a round number of challengers
  let extra = null;
  if (prevKnown && fresh.size) {
    const fr = list.filter(e => fresh.has(e.id));
    const oldBest = list.filter(e => !fresh.has(e.id)).reduce((m, e) => Math.max(m, e.chips), 0);
    const breaker = LAST_YEAR ? fr.filter(e => e.chips > LAST_YEAR).sort((a, b) => b.chips - a.chips)[0] : null;
    const nToday = list.filter(e => e.date === today()).length, nBefore = nToday - fr.filter(e => e.date === today()).length;
    if (breaker && oldBest <= LAST_YEAR) extra = { kind: "record", e: breaker };
    else if (Math.floor(nToday / MILESTONE) > Math.floor(nBefore / MILESTONE)) {
      const n = Math.floor(nToday / MILESTONE) * MILESTONE;
      extra = { kind: "count", n, total: list.filter(e => e.date === today()).reduce((s, e) => s + e.chips, 0), given: nToday * START };
    }
  }
  const crowned = !!crown;
  render();
  if (extra) setTimeout(() => gogai(extra), crowned ? 5200 : 2200);
}

async function load() {
  if (DEMO) return;
  if (!API) { setStatus("記録の保存先がまだ設定されていません（config.js）。"); return; }
  const seq = writeSeq;
  try {
    const r = await fetch(API + (API.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.entries)) throw new Error("bad");
    failCount = 0; setStatus("");
    if (seq !== writeSeq) return; // a write happened while this was in flight; the next poll has it
    apply(j.entries.map(clean).filter(e => e.id && e.date));
  } catch (e) {
    failCount++;
    if (failCount >= 2) setStatus("記録を読み込めません。通信を確認しています…");
  }
}
let pollTimer = null;
function schedule() { clearTimeout(pollTimer); pollTimer = setTimeout(async () => { if (!document.hidden) await load(); schedule(); }, POLL_MS); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) { load(); schedule(); } });

function setStatus(t) { $("status").textContent = t; }
function setMsg(t, err) { const m = $("msg"); m.textContent = t; m.className = "msg" + (err ? " err" : ""); }

async function post(body) {
  if (body.action !== "check") writeSeq++;
  if (DEMO) return demoPost(body);
  if (!API) throw { code: "no_api" };
  let r;
  try { r = await fetch(API, { method: "POST", body: JSON.stringify(Object.assign({ pass }, body)) }); }
  catch (e) { throw { code: "network" }; }
  let j; try { j = await r.json(); } catch (e) { throw { code: "network" }; }
  if (!j.ok) throw { code: j.error || "unknown" };
  return j;
}
function errText(code) {
  return ({
    wrong_pass: "合言葉がちがいます。",
    no_pass_set: "保存先に合言葉が登録されていません（スクリプト プロパティの ADMIN_PASS）。",
    no_name: "プレイヤー名を入れてください。",
    bad_chips: "チップの枚数を0〜99999の数字で入れてください。",
    bad_date: "日付を選んでください。",
    busy: "ほかの入力を処理中です。もう一度押してください。",
    no_api: "記録の保存先がまだ設定されていません（config.js）。",
    network: "通信できませんでした。電波を確認して、もう一度押してください。"
  })[code] || "保存できませんでした。もう一度押してください。";
}

/* ---------- render ---------- */
function render(force) {
  document.body.classList.toggle("admin", isAdmin);
  $("form").hidden = !isAdmin; $("adminBar").hidden = !isAdmin;
  $("passBox").hidden = !!pass; $("entryBox").hidden = !pass; $("forget").hidden = !pass;

  const sig = JSON.stringify([entries, filter, isAdmin, !!pass, busy, pendingDel, Math.floor(Date.now() / 60000)]);
  if (!force && sig === lastSig) return;
  lastSig = sig;

  const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
  if (!dates.length) dates.push(today());
  if (!filter || (filter !== "all" && !dates.includes(filter))) filter = dates[0];

  // right edge: date and 日直
  const edge = $("edge"); edge.textContent = "";
  const dEl = document.createElement("span");
  if (filter === "all") dEl.textContent = "全日程の記録";
  else fmtLong(filter).split(/(\d+)/).forEach(p => { if (!p) return; if (/^\d+$/.test(p)) { const s = document.createElement("span"); s.className = "tcy"; s.textContent = p; dEl.appendChild(s); } else dEl.append(p); });
  const duty = document.createElement("span"); duty.className = "duty"; duty.append("日直　"); const db = document.createElement("b"); db.textContent = "AZAKEI"; duty.appendChild(db);
  edge.append(dEl, duty);

  // day switcher
  const days = $("days"); days.textContent = ""; days.hidden = dates.length < 2;
  if (dates.length > 1) for (const v of [...dates, "all"]) {
    const b = document.createElement("button"); b.type = "button"; b.className = "day";
    b.textContent = v === "all" ? "全日程の総合" : (v === today() ? "今日 " : "") + fmtShort(v);
    b.setAttribute("aria-pressed", String(v === filter));
    b.onclick = () => { filter = v; userPicked = v !== liveDay(); render(true); };
    days.appendChild(b);
  }

  const list = ranked(filter);
  const total = list.reduce((s, e) => s + e.chips, 0);
  const tally = $("tally"); tally.textContent = "";
  if (list.length) {
    const b1 = document.createElement("b"); b1.textContent = list.length;
    const b2 = document.createElement("b"); b2.textContent = total.toLocaleString("ja-JP");
    tally.append("挑戦者 ", b1, " 人 ／ 稼いだチップ 合計 ", b2, " 枚");
  }
  $("empty").hidden = list.length > 0;

  const ol = $("list"); ol.textContent = "";
  const rest = $("rest"); rest.textContent = "";
  const now = Date.now();
  let rank = 0, prev = null, chalkHeard = false;
  list.forEach((e, i) => {
    if (e.chips !== prev) { rank = i + 1; prev = e.chips; }
    const rnd = seeded(e.id);
    const isNew = fresh.has(e.id);
    const justNow = filter !== "all" && now - e.createdAt < NOW_MIN * 60000;
    if (i >= TOP_N) {
      const li = document.createElement("li"); if (isNew) li.className = "writein-row";
      const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = rank + "位";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = e.name;
      const ct = document.createElement("span"); ct.className = "ct"; ct.textContent = e.chips + "枚";
      li.append(rk, nm, ct);
      if (isAdmin && pass) li.appendChild(delButton(e));
      rest.appendChild(li);
      return;
    }
    const li = document.createElement("li");
    li.className = "row chalk" + (rank <= 3 ? " r" + rank : "") + (isNew ? " writein" : "");
    li.style.transform = "rotate(" + ((rnd() - .5) * 1.3).toFixed(2) + "deg) translateX(" + Math.round(rnd() * 10) + "px)";
    // the new 1st place waits while the eraser clears the old one
    const crowning = isNew && i === 0 && crown && crown.id === e.id && !reduced();
    const d0 = crowning ? 1100 : 0;
    li.style.setProperty("--d", d0 + "ms");
    if (isNew) {
      const tip = document.createElement("i"); tip.className = "tip"; tip.setAttribute("aria-hidden", "true"); li.appendChild(tip); trayTake("c1", d0 + 1800);
      if (!chalkHeard) { chalkHeard = true; Sound.chalk(d0, 1750); }
    }

    const r = document.createElement("div"); r.className = "rank w"; r.textContent = rank;
    if (rank === 1) {
      const c = svgMark(pathFrom(circlePts(rnd, 50, 50, 40, 40)), "var(--chalk-yellow)", 3.4, "0 0 100 100"); r.appendChild(c); if (isNew) drawIn(c, 700, d0 + 1800);
      r.appendChild(svgMark("M4 34 L10 8 L22 26 L32 2 L42 26 L54 8 L60 34 Z", "var(--chalk-yellow)", 2.6, "0 0 64 36", "crown"));
    } else if (rank <= 3) {
      const c = svgMark(pathFrom(circlePts(rnd, 50, 50, 40, 40)), rank === 2 ? "var(--chalk-pink)" : "var(--chalk-blue)", 3, "0 0 100 100"); r.appendChild(c); if (isNew) drawIn(c, 600, d0 + 1800);
    }
    const nm = document.createElement("div"); nm.className = "name w";
    const nmT = document.createElement("span"); nmT.className = "nm"; handText(nmT, e.name, rnd);
    nm.append(nmT);
    if (justNow) { const s = document.createElement("span"); s.className = "scrib now"; s.textContent = "いま来た！"; nm.appendChild(s); }
    else if (i === 0 && filter === today() && now - e.createdAt >= 60000) { const s = document.createElement("span"); s.className = "scrib keep"; s.textContent = "首位キープ " + duration(now - e.createdAt); nm.appendChild(s); }
    if (e.chips > PRIZE) { const s = document.createElement("span"); s.className = "scrib prize"; s.textContent = "シャーペン！"; nm.appendChild(s); }
    if (filter === "all") { const s = document.createElement("span"); s.className = "scrib date"; s.textContent = fmtShort(e.date); nm.appendChild(s); }
    const lead = document.createElement("span"); lead.className = "leader"; nm.appendChild(lead);
    const ct = document.createElement("div"); ct.className = "count w";
    const num = document.createElement("span"); handText(num, String(e.chips), rnd); ct.appendChild(num);
    const u = document.createElement("small"); u.textContent = "枚"; ct.appendChild(u);
    if (rank <= 3) { const m = document.createElement("span"); m.className = "mult"; m.textContent = "スタートの" + times(e.chips) + "倍"; ct.appendChild(m); }
    if (rank === 1) { const h = svgMark(pathFrom(hanamaruPts(rnd)), "var(--chalk-pink)", 2.6, "0 0 100 100", "hanamaru"); h.setAttribute("preserveAspectRatio", "xMidYMid meet"); ct.appendChild(h); if (isNew || !drewOnce) drawIn(h, 1600, isNew ? d0 + 1900 : 300); }
    if (isAdmin && pass) ct.appendChild(delButton(e));
    li.append(r, nm, ct);
    ol.appendChild(li);
    if (crowning) crownSequence(li, crown.prev);
  });
  crown = null;
  $("restWrap").hidden = list.length <= TOP_N;
  $("restHead").textContent = "── " + (TOP_N + 1) + "位から下 ──";

  renderNews(list);
  renderAim(list);
  renderChart(list);
  renderFame();
  renderHours(list);
  renderMemo(list);
  fresh = new Set(); // animate each arrival once
  if (list.length) drewOnce = true;
}

function renderNews(list) {
  const byTime = entries.filter(e => filter === "all" || e.date === filter).sort((a, b) => b.createdAt - a.createdAt);
  const paper = $("paper");
  paper.hidden = byTime.length === 0;
  if (!byTime.length) return;
  const n = byTime[0];
  $("paperNth").textContent = filter === "all" ? "" : (filter === today() ? "今日 " : "") + byTime.length + "人目";
  $("paperBig").textContent = (lastCrown && lastCrown.id === n.id && lastCrown.prev)
    ? hhmm(n.createdAt) + "　首位交代！ " + lastCrown.prev.name + " " + lastCrown.prev.chips + "枚 → " + n.name + " さん " + n.chips + "枚"
    : hhmm(n.createdAt) + "　" + n.name + " さん " + n.chips + "枚 → " + rankOf(list, n) + "位に！";
  const ul = $("paperList"); ul.textContent = "";
  byTime.slice(1, 3).forEach(e => { const li = document.createElement("li"); li.textContent = hhmm(e.createdAt) + "　" + e.name + "　" + e.chips + "枚（" + rankOf(list, e) + "位）"; ul.appendChild(li); });
  if (fresh.has(n.id) && !reduced()) { paper.classList.remove("pop"); void paper.offsetWidth; paper.classList.add("pop"); }
}

function duration(ms) {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? h + "時間" + (m % 60) + "分" : m + "分";
}

/* "ランクインするには？": the chips needed to tie each line right now */
function renderAim(list) {
  const box = $("aim"), dl = $("aimList");
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false; dl.textContent = "";
  const rows = [];
  rows.push(["1位", list[0].chips]);
  if (list.length >= 3) rows.push(["3位", list[2].chips]);
  if (list.length >= TOP_N) rows.push([TOP_N + "位", list[TOP_N - 1].chips]);
  rows.push(["シャーペン", PRIZE + 1, "pz"]);
  if (LAST_YEAR) rows.push(["去年の1位こえ", LAST_YEAR + 1, "ly"]);
  for (const [label, n, cls] of rows) {
    const wrap = document.createElement("div"); wrap.style.display = "contents"; if (cls) wrap.className = cls;
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.append(String(n)); const s = document.createElement("small"); s.textContent = "枚〜"; dd.appendChild(s);
    wrap.append(dt, dd); dl.appendChild(wrap);
  }
}

/* chalk chart: how the day's best score climbed, like a price chart drawn by a teacher */
function renderChart(list) {
  const fig = $("chart"), svg = $("chartSvg");
  const day = list.filter(e => e.createdAt).sort((a, b) => a.createdAt - b.createdAt);
  if (filter === "all" || day.length < 2) { fig.hidden = true; return; }
  fig.hidden = false; svg.textContent = "";
  const W = 320, H = 170, L = 34, R = 12, T = 14, B = 26;
  const t0 = day[0].createdAt, isToday = filter === today();
  const t1 = Math.max(day[day.length - 1].createdAt, isToday ? Date.now() : 0, t0 + 30 * 60000);
  const maxV = Math.max(...day.map(e => e.chips));
  const yMax = Math.max(10, Math.ceil(Math.max(maxV, LAST_YEAR) * 1.15 / 10) * 10);
  const X = (t) => L + (t - t0) / (t1 - t0) * (W - L - R);
  const Y = (v) => H - B - v / yMax * (H - T - B);
  const rnd = seeded("chart" + filter);

  const g = document.createElementNS(NS, "g");
  for (const k of ["maskImage", "webkitMaskImage"]) g.style[k] = "var(--chalk-mask)";
  svg.appendChild(g);
  g.appendChild(pathEl(pathFrom(wobbleLine(rnd, L, T - 4, L, H - B)), "var(--chalk-dim)", 1.6));
  g.appendChild(pathEl(pathFrom(wobbleLine(rnd, L, H - B, W - R + 4, H - B)), "var(--chalk-dim)", 1.6));
  const guide = pathEl(pathFrom(wobbleLine(rnd, L, Y(PRIZE), W - R, Y(PRIZE))), "var(--chalk-pink)", 1); guide.setAttribute("stroke-dasharray", "3 5"); if (PRIZE < yMax) g.appendChild(guide);

  const pts = [], recs = []; let best = -1;
  for (const e of day) {
    if (e.chips > best) {
      if (best >= 0) pts.push([X(e.createdAt), Y(best)]);
      best = e.chips; pts.push([X(e.createdAt), Y(best)]); recs.push(e);
    }
  }
  pts.push([X(t1), Y(best)]);
  const line = pathEl(pathFrom(pts), "var(--chalk-blue)", 2.6); g.appendChild(line);
  recs.forEach((e, i) => {
    const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", X(e.createdAt)); c.setAttribute("cy", Y(e.chips)); c.setAttribute("r", i === recs.length - 1 ? 4 : 2.6);
    c.setAttribute("fill", i === recs.length - 1 ? "var(--chalk-yellow)" : "var(--chalk)"); g.appendChild(c);
  });
  const text = (x, y, s, anchor, color, size) => { const t = document.createElementNS(NS, "text"); t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", anchor); t.setAttribute("fill", color); t.setAttribute("font-size", size || 11); t.textContent = s; g.appendChild(t); };
  const last = recs[recs.length - 1];
  text(Math.min(X(last.createdAt), W - R - 30), Y(last.chips) - 9, last.chips + "枚", "middle", "var(--chalk-yellow)", 13);
  text(L - 5, T + 4, String(yMax), "end", "var(--chalk-dim)");
  text(L - 5, H - B + 3, "0", "end", "var(--chalk-dim)");
  if (PRIZE < yMax) text(W - R, Y(PRIZE) - 4, "シャーペンライン", "end", "var(--chalk-pink)", 10);
  if (LAST_YEAR) {
    const ly = pathEl(pathFrom(wobbleLine(rnd, L, Y(LAST_YEAR), W - R, Y(LAST_YEAR))), "var(--chalk-yellow)", 1.2); ly.setAttribute("stroke-dasharray", "8 5"); g.appendChild(ly);
    text(L + 4, Y(LAST_YEAR) - 4, "去年の1位 " + LAST_YEAR, "start", "var(--chalk-yellow)", 10);
  }
  text(L, H - 8, hhmm(t0), "start", "var(--chalk-dim)");
  text(W - R, H - 8, isToday ? "いま" : hhmm(t1), "end", "var(--chalk-dim)");
  if (fresh.size) drawIn({ querySelector: () => line }, 1200, 200);
}

function delButton(e) {
  const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.disabled = busy;
  const armed = pendingDel === e.id;
  del.textContent = armed ? "本当に消す" : "消す";
  if (armed) del.classList.add("confirm");
  del.onclick = async () => {
    if (pendingDel !== e.id) { pendingDel = e.id; render(true); setTimeout(() => { if (pendingDel === e.id) { pendingDel = null; render(true); } }, 4000); return; }
    pendingDel = null; busy = true; render(true);
    try { await post({ action: "delete", id: e.id }); entries = entries.filter(x => x.id !== e.id); if (known) known.delete(e.id); setMsg(e.name + " さんの記録を消しました"); }
    catch (err) { setMsg(errText(err.code), true); if (err.code === "wrong_pass") forget(); }
    busy = false; render(true);
  };
  return del;
}

/* ---------- 歴代の億万長者: each day's 1st place, pinned as a paper ---------- */
function renderFame() {
  const dates = [...new Set(entries.map(e => e.date))].sort();
  const box = $("fame");
  if (dates.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const ol = $("fameList"); ol.textContent = "";
  const best = Math.max(...entries.map(e => e.chips));
  for (const d of dates) {
    const top = ranked(d)[0]; if (!top) continue;
    const li = document.createElement("li");
    const a = document.createElement("span"); a.className = "fd"; a.textContent = fmtShort(d);
    const b = document.createElement("span"); b.className = "fn"; b.textContent = top.name;
    const c = document.createElement("span"); c.className = "fc"; c.textContent = top.chips + "枚" + (d === today() ? "（暫定）" : "");
    li.append(a, b, c);
    if (top.chips === best) li.classList.add("best");
    ol.appendChild(li);
  }
}

/* ---------- 正の字: challengers per hour, counted the way it is done on any school board ---------- */
const SEI = ["", "一", "丅", "下", "止", "正"];
function renderHours(list) {
  const lower = $("lower");
  const day = filter === "all" ? [] : list.filter(e => e.createdAt);
  if (day.length < 3) { lower.hidden = true; return; }
  lower.hidden = false;
  const by = new Map();
  for (const e of day) { const h = new Date(e.createdAt).getHours(); by.set(h, (by.get(h) || 0) + 1); }
  const hours = [...by.keys()].sort((a, b) => a - b), max = Math.max(...by.values());
  const dl = $("hoursList"); dl.textContent = "";
  for (const h of hours) {
    const n = by.get(h), rnd = seeded("h" + h + filter);
    const dt = document.createElement("dt"); dt.textContent = h + "時台";
    const dd = document.createElement("dd");
    const marks = document.createElement("span"); marks.className = "sei";
    handText(marks, "正".repeat(Math.floor(n / 5)) + SEI[n % 5], rnd);
    marks.setAttribute("aria-label", n + "人");
    const num = document.createElement("small"); num.textContent = n + "人";
    dd.append(marks, num);
    if (n === max && hours.length > 1) { const s = document.createElement("span"); s.className = "scrib busy"; s.textContent = "← いちばん混んだ"; dd.appendChild(s); }
    dl.append(dt, dd);
  }
}

/* ---------- 経済メモ: what the day's numbers say, written up like a lesson ---------- */
function renderMemo(list) {
  const box = $("memo");
  if (filter === "all" || list.length < 5) { box.hidden = true; return; }
  box.hidden = false;
  const chips = list.map(e => e.chips).sort((a, b) => a - b), n = chips.length;
  const total = chips.reduce((s, v) => s + v, 0);
  const up = chips.filter(v => v > START).length;
  const mid = n % 2 ? chips[(n - 1) / 2] : (chips[n / 2 - 1] + chips[n / 2]) / 2;
  const mean = total / n;
  const k = Math.max(1, Math.round(n * 0.1));
  const topShare = chips.slice(-k).reduce((s, v) => s + v, 0) / (total || 1);
  const r1 = (v) => Math.round(v * 10) / 10;
  const lines = [
    ["スタートより増やせた人", Math.round(up / n * 100) + "%"],
    ["真ん中の人（中央値）", r1(mid) + "枚"],
    ["みんなの平均", r1(mean) + "枚"],
    ["上位1割（" + k + "人）の取り分", "全チップの " + Math.round(topShare * 100) + "%"],
    ["配ったチップ " + (n * START) + "枚 →", "いま " + total + "枚（×" + r1(total / (n * START)) + "）"]
  ];
  const ul = $("memoList"); ul.textContent = "";
  for (const [a, b] of lines) {
    const li = document.createElement("li");
    const s1 = document.createElement("span"); s1.className = "ml"; s1.textContent = a;
    const s2 = document.createElement("span"); s2.className = "mv"; s2.textContent = b;
    li.append(s1, s2); ul.appendChild(li);
  }
  if (mean > mid * 1.3) {
    const li = document.createElement("li"); li.className = "aside-note";
    li.textContent = "平均 ＞ 中央値 … 一部の人が大きく稼いでいる（格差）";
    ul.appendChild(li);
  }
}

/* ---------- 号外: a printed extra slapped onto the board with a magnet ---------- */
function vText(el, s) {
  s.split(/(\d+)/).forEach(p => { if (!p) return; if (/^\d{1,3}$/.test(p)) { const t = document.createElement("span"); t.className = "tcy"; t.textContent = p; el.appendChild(t); } else el.append(p); });
}
function gogai(g) {
  const board = $("board");
  const old = board.querySelector(".gogai"); if (old) old.remove();
  const p = document.createElement("div"); p.className = "gogai" + (g.kind === "count" ? " small" : ""); p.setAttribute("role", "status");
  p.innerHTML = '<span class="magnet c"></span><div class="gg-head"><b>号外</b><span class="gg-date"></span></div><div class="gg-cols"><div class="gg-title"></div><div class="gg-body"></div></div><div class="gg-foot">AZAKEI 麻布経済展</div>';
  p.querySelector(".gg-date").textContent = fmtLong(today()) + "　" + hhmm(Date.now()) + " 発行";
  const title = p.querySelector(".gg-title"), body = p.querySelector(".gg-body");
  if (g.kind === "record") {
    vText(title, "去年の記録、破れる");
    vText(body, g.e.name + "さん " + g.e.chips + "枚。去年の1位（" + LAST_YEAR + "枚）を" + (g.e.chips - LAST_YEAR) + "枚上回る");
  } else {
    vText(title, "挑戦者、" + g.n + "人に");
    vText(body, "配ったチップ" + g.given + "枚が、いま合計" + g.total + "枚に");
  }
  board.appendChild(p);
  const stay = g.kind === "record" ? 45000 : 16000;
  if (!reduced()) {
    p.animate([
      { transform: "translateY(-130%) rotate(-14deg)", opacity: 0 },
      { transform: "translateY(6%) rotate(1deg)", opacity: 1, offset: .75 },
      { transform: "translateY(0) rotate(-2.5deg)", opacity: 1 }
    ], { duration: 750, easing: "cubic-bezier(.3,.7,.4,1)", fill: "backwards" });
    p.querySelector(".magnet").animate([{ transform: "scale(1.7)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 160, delay: 720, easing: "ease-in", fill: "backwards" });
  }
  Sound.paper(0); Sound.pin(720);
  let gone = false;
  const away = () => {
    if (gone) return; gone = true;
    if (reduced()) { p.remove(); return; }
    p.animate([{ transform: "rotate(-2.5deg)", opacity: 1 }, { transform: "translateY(40%) rotate(6deg)", opacity: 0 }], { duration: 600, easing: "ease-in", fill: "forwards" }).onfinish = () => p.remove();
  };
  p.addEventListener("click", away);
  setTimeout(away, stay);
}

/* ---------- sound: chalk taps, an eraser stroke, a magnet hitting the board (off until switched on) ---------- */
const Sound = (() => {
  const quiet = { chalk() {}, eraser() {}, pin() {}, paper() {} };
  const AC = window.AudioContext || window.webkitAudioContext;
  const btn = $("soundBtn");
  if (!AC) return quiet;
  let ctx = null, buf = null, on = ls.get("azakei-sound") === "1";
  btn.hidden = false;
  const label = () => { btn.textContent = on ? "音：あり" : "音：なし"; btn.setAttribute("aria-pressed", String(on)); };
  label();
  const ensure = () => { try { if (!ctx) ctx = new AC(); if (ctx.state === "suspended") ctx.resume(); } catch (e) {} return ctx; };
  const ready = () => on && ctx && ctx.state === "running" && !reduced();
  const noise = () => {
    if (buf) return buf;
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.6), ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };
  function burst(t, dur, freq, q, gain, type) {
    const s = ctx.createBufferSource(); s.buffer = noise();
    const f = ctx.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(ctx.destination);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.03);
  }
  const tap = (t) => { burst(t, 0.03 + Math.random() * 0.03, 2400 + Math.random() * 2000, 1.4, 0.2); };
  btn.onclick = () => { on = !on; ls.set("azakei-sound", on ? "1" : "0"); label(); if (on && ensure()) setTimeout(() => { if (ready()) tap(ctx.currentTime + 0.02); }, 60); };
  document.addEventListener("pointerdown", () => { if (on) ensure(); }, { passive: true });
  document.addEventListener("keydown", () => { if (on) ensure(); });
  return {
    chalk(delayMs, ms) {
      if (!ready()) return;
      let t = ctx.currentTime + delayMs / 1000; const end = t + ms / 1000;
      while (t < end) { tap(t); if (Math.random() < 0.45) burst(t + 0.012, 0.08, 1500 + Math.random() * 900, 0.9, 0.045); t += 0.07 + Math.random() * 0.12; }
    },
    eraser(delayMs, ms) {
      if (!ready()) return;
      const t = ctx.currentTime + delayMs / 1000, T = ms / 1000;
      const s = ctx.createBufferSource(); s.buffer = noise();
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.7;
      f.frequency.setValueAtTime(650, t); f.frequency.linearRampToValueAtTime(1250, t + T * 0.45); f.frequency.linearRampToValueAtTime(800, t + T);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.12); g.gain.setValueAtTime(0.14, t + T - 0.2); g.gain.linearRampToValueAtTime(0, t + T);
      s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t); s.stop(t + T + 0.05);
    },
    paper(delayMs) { if (!ready()) return; const t = ctx.currentTime + delayMs / 1000; for (let i = 0; i < 5; i++) burst(t + i * 0.09 + Math.random() * 0.04, 0.12, 3200 + Math.random() * 2500, 0.6, 0.05, "highpass"); },
    pin(delayMs) {
      if (!ready()) return;
      const t = ctx.currentTime + delayMs / 1000;
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.16);
      burst(t, 0.03, 4200, 1, 0.12);
    }
  };
})();

/* ---------- handwriting: no two characters sit quite the same ---------- */
function handText(el, s, rnd) {
  el.setAttribute("aria-label", s);
  for (const ch of s) {
    const sp = document.createElement("span"); sp.className = "ch"; sp.setAttribute("aria-hidden", "true"); sp.textContent = ch;
    sp.style.transform = "rotate(" + ((rnd() - .5) * 6).toFixed(1) + "deg) translateY(" + ((rnd() - .5) * .09).toFixed(3) + "em)";
    el.appendChild(sp);
  }
}

/* a piece is picked up from the chalk tray while it is in use */
function trayTake(which, ms) {
  const el = document.querySelector(".tray ." + which); if (!el || reduced()) return;
  el.classList.add("out"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("out"), ms + 300);
}

/* ---------- 1st place changes hands: erased and rewritten on the board itself ---------- */
function crownSequence(li, prev) {
  const D = 1100, board = $("board");
  const b = board.getBoundingClientRect(), r = li.getBoundingClientRect();
  if (prev) {
    const ghost = document.createElement("div"); ghost.className = "ghost"; ghost.setAttribute("aria-hidden", "true");
    const gn = document.createElement("span"); gn.textContent = prev.name;
    const gc = document.createElement("span"); gc.textContent = prev.chips + "枚";
    ghost.append(gn, gc); li.appendChild(ghost);
    ghost.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], { duration: D - 150, delay: 120, easing: "ease-in-out", fill: "forwards" }).onfinish = () => ghost.remove();
  }
  const smear = document.createElement("div"); smear.className = "smear"; smear.setAttribute("aria-hidden", "true"); li.appendChild(smear);
  smear.animate([{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: .6, offset: .5 }, { opacity: 0 }], { duration: 9000, fill: "forwards" }).onfinish = () => smear.remove();

  const er = document.createElement("div"); er.className = "eraser-hand"; er.setAttribute("aria-hidden", "true");
  er.style.top = (r.top - b.top + r.height / 2 - 26) + "px";
  board.appendChild(er);
  const x0 = r.left - b.left - 150, x1 = r.right - b.left + 20;
  er.animate([
    { transform: "translateX(" + x0 + "px) rotate(-7deg)" },
    { transform: "translateX(" + (x0 + (x1 - x0) * .45) + "px) translateY(6px) rotate(2deg)", offset: .45 },
    { transform: "translateX(" + (x0 + (x1 - x0) * .7) + "px) translateY(-4px) rotate(-3deg)", offset: .7 },
    { transform: "translateX(" + x1 + "px) rotate(4deg)" }
  ], { duration: D, easing: "ease-in-out", fill: "forwards" }).onfinish = () => er.remove();
  trayTake("eraser", D);
  Sound.eraser(0, D);

  setTimeout(() => {
    const ct = li.querySelector(".count"); if (!ct || !li.isConnected) return;
    const s = document.createElement("span"); s.className = "shinkiroku";
    const t = document.createElement("span"); t.textContent = "新記録！";
    const arrow = svgMark("M2 6 C 16 8, 30 16, 44 30 M32 30 L44 30 L44 18", "var(--chalk-yellow)", 2.4, "0 0 48 34", "arrow");
    s.append(t, arrow); ct.appendChild(s);
    t.animate([{ clipPath: "inset(-40% 100% -40% -40%)" }, { clipPath: "inset(-40% -40% -40% -40%)" }], { duration: 650, easing: "steps(8, end)", fill: "backwards" });
    drawIn(arrow, 450, 650);
    Sound.chalk(0, 1000);
  }, D + 2600);
}

/* ---------- admin ---------- */
$("date").value = today();
document.querySelectorAll(".step").forEach(b => b.onclick = () => { const el = $("chips"); el.value = Math.max(0, (parseInt(el.value, 10) || 0) + Number(b.dataset.step)); });
function forget() { pass = ""; ls.del("azakei-pass"); render(true); }
$("forget").onclick = () => { forget(); setMsg("この端末から合言葉を消しました。"); };
$("passBtn").onclick = async () => {
  const p = $("pass").value.trim(); if (!p) return setMsg("合言葉を入れてください。", true);
  $("passBtn").disabled = true; const keep = pass; pass = p;
  try { await post({ action: "check" }); ls.set("azakei-pass", p); $("pass").value = ""; setMsg("入力できます。"); render(true); $("name").focus(); }
  catch (err) { pass = keep; setMsg(errText(err.code), true); }
  $("passBtn").disabled = false;
};
$("pass").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("passBtn").click(); } });

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (busy || !pass) return;
  const name = $("name").value.trim(), chips = parseInt($("chips").value, 10), date = $("date").value;
  if (!name) return setMsg(errText("no_name"), true);
  if (!Number.isFinite(chips) || chips < 0 || chips > 99999) return setMsg(errText("bad_chips"), true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setMsg(errText("bad_date"), true);
  busy = true; $("submit").disabled = true; setMsg("黒板に書いています…");
  try {
    const j = await post({ action: "add", name, chips, date });
    const e = clean(j.entry);
    filter = e.date; userPicked = e.date !== liveDay();
    apply(entries.concat([e]));
    setMsg(e.name + " さん " + e.chips + "枚 → " + rankOf(ranked(e.date), e) + "位で黒板に書きました");
    $("name").value = ""; $("chips").value = START; $("name").focus();
  } catch (err) {
    setMsg(errText(err.code), true);
    if (err.code === "wrong_pass") forget();
  }
  busy = false; $("submit").disabled = false; render(true);
});
window.addEventListener("hashchange", () => { isAdmin = location.hash === "#admin"; render(true); });

/* ---------- demo (?demo): sample records so the board can be checked without the spreadsheet ---------- */
let demoList = [];
function demoPost(body) {
  if (body.action === "check") return Promise.resolve({ ok: true });
  if (body.action === "add") { const e = { id: "d" + Date.now().toString(36), name: body.name, chips: body.chips, date: body.date, createdAt: Date.now() }; demoList.push(e); return Promise.resolve({ ok: true, entry: e }); }
  if (body.action === "delete") { demoList = demoList.filter(e => e.id !== body.id); return Promise.resolve({ ok: true }); }
  return Promise.resolve({ ok: false });
}
if (DEMO) {
  const names = ["たろう", "はなこ", "けんた", "ゆうき", "さくら", "そうま", "りん", "はると", "あおい", "みなと", "ひなた", "こはる", "いつき"];
  const chips = [96, 86, 64, 41, 33, 28, 22, 18, 15, 12, 9, 7, 5];
  const now0 = Date.now(), y = new Date(now0 - 86400000);
  const yesterday = y.getFullYear() + "-" + pad(y.getMonth() + 1) + "-" + pad(y.getDate());
  // today: spread over the last few hours, busiest in the middle
  const offsets = [215, 190, 172, 150, 141, 133, 118, 104, 96, 88, 61, 40, 22];
  demoList = names.map((n, i) => ({ id: "s" + i, name: n, chips: chips[(i * 5) % 13], date: today(), createdAt: now0 - offsets[i] * 60000 }));
  // yesterday's board, for 歴代の億万長者
  [["そら", 88], ["れん", 54], ["ゆな", 31], ["かい", 12], ["めい", 6]].forEach(([n, c], i) => demoList.push({ id: "y" + i, name: n, chips: c, date: yesterday, createdAt: now0 - 86400000 - i * 1800000 }));
  apply(demoList.slice());
  // a new leader who also beats last year's record → eraser, 新記録, then 号外
  setTimeout(() => { demoList.push({ id: "s-new", name: "ゆいと", chips: Math.max(LAST_YEAR + 12, 132), date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 6000);
} else {
  render(true);
  load().then(schedule);
}
})();
