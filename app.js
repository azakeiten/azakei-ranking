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
const BOARD_BG = makeTextures();
$("board").style.backgroundImage = BOARD_BG;

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
      setTimeout(() => celebrate(top, prevE ? prevE.name : ""), 250);
    }
    topByDay[day] = top.id;
  }
  render();
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
  let rank = 0, prev = null;
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

    const r = document.createElement("div"); r.className = "rank w"; r.textContent = rank;
    if (rank === 1) {
      const c = svgMark(pathFrom(circlePts(rnd, 50, 50, 40, 40)), "var(--chalk-yellow)", 3.4, "0 0 100 100"); r.appendChild(c); if (isNew) drawIn(c, 700, 900);
      r.appendChild(svgMark("M4 34 L10 8 L22 26 L32 2 L42 26 L54 8 L60 34 Z", "var(--chalk-yellow)", 2.6, "0 0 64 36", "crown"));
    } else if (rank <= 3) {
      const c = svgMark(pathFrom(circlePts(rnd, 50, 50, 40, 40)), rank === 2 ? "var(--chalk-pink)" : "var(--chalk-blue)", 3, "0 0 100 100"); r.appendChild(c); if (isNew) drawIn(c, 600, 900);
    }
    const nm = document.createElement("div"); nm.className = "name w";
    const nmT = document.createElement("span"); nmT.className = "nm"; nmT.textContent = e.name;
    nm.append(nmT);
    if (justNow) { const s = document.createElement("span"); s.className = "scrib now"; s.textContent = "いま来た！"; nm.appendChild(s); }
    if (e.chips > PRIZE) { const s = document.createElement("span"); s.className = "scrib prize"; s.textContent = "シャーペン！"; nm.appendChild(s); }
    if (filter === "all") { const s = document.createElement("span"); s.className = "scrib date"; s.textContent = fmtShort(e.date); nm.appendChild(s); }
    const lead = document.createElement("span"); lead.className = "leader"; nm.appendChild(lead);
    const ct = document.createElement("div"); ct.className = "count w";
    ct.append(String(e.chips)); const u = document.createElement("small"); u.textContent = "枚"; ct.appendChild(u);
    if (rank <= 3) { const m = document.createElement("span"); m.className = "mult"; m.textContent = "スタートの" + times(e.chips) + "倍"; ct.appendChild(m); }
    if (rank === 1) { const h = svgMark(pathFrom(hanamaruPts(rnd)), "var(--chalk-pink)", 2.6, "0 0 100 100", "hanamaru"); h.setAttribute("preserveAspectRatio", "xMidYMid meet"); ct.appendChild(h); if (isNew || !drewOnce) drawIn(h, 1600, isNew ? 1100 : 300); }
    if (isAdmin && pass) ct.appendChild(delButton(e));
    li.append(r, nm, ct);
    ol.appendChild(li);
  });
  $("restWrap").hidden = list.length <= TOP_N;
  $("restHead").textContent = "── " + (TOP_N + 1) + "位から下 ──";

  renderNews(list);
  renderChart(list);
  fresh = new Set(); // animate each arrival once
  if (list.length) drewOnce = true;
}

function renderNews(list) {
  const byTime = entries.filter(e => filter === "all" || e.date === filter).sort((a, b) => b.createdAt - a.createdAt);
  const paper = $("paper");
  paper.hidden = byTime.length === 0;
  if (!byTime.length) return;
  const n = byTime[0];
  $("paperBig").textContent = hhmm(n.createdAt) + "　" + n.name + " さん " + n.chips + "枚 → " + rankOf(list, n) + "位に！";
  const ul = $("paperList"); ul.textContent = "";
  byTime.slice(1, 3).forEach(e => { const li = document.createElement("li"); li.textContent = hhmm(e.createdAt) + "　" + e.name + "　" + e.chips + "枚（" + rankOf(list, e) + "位）"; ul.appendChild(li); });
  if (fresh.has(n.id) && !reduced()) { paper.classList.remove("pop"); void paper.offsetWidth; paper.classList.add("pop"); }
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
  const yMax = Math.max(10, Math.ceil(maxV * 1.15 / 10) * 10);
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

/* ---------- 1st-place moment ---------- */
function celebrate(e, prevName) {
  if (document.querySelector(".celebrate")) return;
  const ov = document.createElement("div"); ov.className = "celebrate"; ov.style.backgroundImage = BOARD_BG;
  ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "新しい1位");
  ov.innerHTML = '<canvas></canvas><div class="eraser-sweep"></div><div class="inner"><div class="kicker chalk"></div><div class="headline chalk">新・億万長者 誕生</div><div class="who chalk"></div><div class="sub chalk"></div></div>';
  ov.querySelector(".kicker").textContent = prevName ? prevName + " さんを抜いて…" : "1位が決まりました";
  const who = ov.querySelector(".who"); who.textContent = e.name + " さん " + e.chips + "枚";
  const c = svgMark(pathFrom(circlePts(seeded(e.id + "c"), 50, 50, 48, 46)), "var(--chalk-yellow)", 4, "0 0 100 100"); who.appendChild(c);
  ov.querySelector(".sub").textContent = "スタートの " + times(e.chips) + " 倍。おめでとう！";
  document.body.appendChild(ov);
  drawIn(c, 900, 3600);
  if (!reduced()) chalkDust(ov.querySelector("canvas"), 3700);
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }).onfinish = () => ov.remove(); };
  ov.onclick = close;
  setTimeout(close, isAdmin ? 5000 : 9000);
}
function chalkDust(cv, delay) {
  const ctx = cv.getContext("2d"); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; };
  resize();
  const colors = ["240,239,231", "242,220,109", "241,163,166", "159,203,232"];
  let parts = [];
  setTimeout(() => {
    const w = cv.width, h = cv.height;
    for (let i = 0; i < 220; i++) parts.push({ x: w / 2 + (Math.random() - .5) * w * .5, y: h * .55 + (Math.random() - .5) * h * .1, vx: (Math.random() - .5) * 7 * dpr, vy: (-Math.random() * 7 - 2) * dpr, r: (1 + Math.random() * 2.6) * dpr, c: colors[i % 4], a: 1 });
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      parts = parts.filter(p => p.a > 0.02);
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.16 * dpr; p.vx *= 0.985; p.a *= 0.985; ctx.fillStyle = "rgba(" + p.c + "," + p.a + ")"; ctx.fillRect(p.x, p.y, p.r, p.r); }
      if (parts.length && cv.isConnected) requestAnimationFrame(step);
    };
    step();
  }, delay);
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
  const base = Date.now() - 4 * 3600000;
  demoList = names.map((n, i) => ({ id: "s" + i, name: n, chips: chips[i], date: today(), createdAt: base + ((i * 7) % 13) * 17 * 60000 }));
  apply(demoList.slice());
  setTimeout(() => { demoList.push({ id: "s-new", name: "ゆいと", chips: 120, date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 6000);
} else {
  render(true);
  load().then(schedule);
}
})();
