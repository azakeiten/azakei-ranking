/* AZAKEI 証券取引所 — 本日の億万長者
   Visitors: the board reads the records from the Apps Script web app every few seconds.
   Admin (#admin): adds and removes records with the shared passcode. */
(() => {
"use strict";
const CFG = window.AZAKEI_RANKING || {};
const API = String(CFG.scriptUrl || "").trim();
const DEMO = /[?&]demo\b/.test(location.search);
const PAGE_URL = "https://azakeiten.github.io/azakei-ranking/";
const START = 5, PRIZE = 40, TOP_N = 10, MILESTONE = 50, POLL_MS = 7000;
const LAST_YEAR = Math.max(0, Number(CFG.lastYearBest) || 0);

const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const wd = (s) => { const [y, m, d] = s.split("-").map(Number); return "日月火水木金土"[new Date(y, m - 1, d).getDay()]; };
const fmtShort = (s) => { const [, m, d] = s.split("-").map(Number); return m + "/" + d + "(" + wd(s) + ")"; };
const hhmm = (t) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const num = (n) => Number(n).toLocaleString("ja-JP");
const pct = (c) => (c - START) / START * 100;
const fmtPct = (c) => { const p = pct(c); return (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; };
const dirClass = (v) => v > 0 ? "up" : v < 0 ? "down" : "flat";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clean = (e) => ({ id: String(e.id || ""), name: String(e.name || "").slice(0, 20), chips: Math.max(0, Math.floor(Number(e.chips) || 0)), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "", createdAt: Number(e.createdAt) || 0 });
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const codeOf = (e) => String(1000 + hash(e.id) % 9000);   // 銘柄コード, stable per record

/* ---------- state ---------- */
let entries = [];
let known = null;               // ids on the previous load
let fresh = new Set();          // ids that arrived since then
let moves = new Map();          // id -> rank change at the last update (+ = moved up)
let prevRanks = new Map();      // id -> rank on the previous update, for the shown day
let topByDay = {};
let filter = null, userPicked = false;
let isAdmin = location.hash === "#admin";
let pass = ls.get("azakei-pass") || "";
let busy = false, pendingDel = null, lastSig = "", failCount = 0, writeSeq = 0;
let findQ = "";
let show = null;                // 大引け in progress

/* ---------- ranking helpers ---------- */
const ranked = (date) => entries.filter(e => date === "all" || e.date === date).sort((a, b) => b.chips - a.chips || a.createdAt - b.createdAt);
const rankOf = (list, e) => list.filter(x => x.chips > e.chips).length + 1;
const latestDate = () => entries.reduce((m, e) => e.date > m ? e.date : m, "");
const liveDay = () => entries.some(e => e.date === today()) ? today() : (latestDate() || today());
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const matches = (e) => !!findQ && norm(e.name).includes(norm(findQ));

/* ---------- sound (off until switched on) ---------- */
const Sound = (() => {
  const quiet = { chime() {}, bell() {}, flap() {}, tick() {} };
  const AC = window.AudioContext || window.webkitAudioContext;
  const btn = $("soundBtn");
  if (!AC) return quiet;
  let ctx = null, on = ls.get("azakei-sound") === "1";
  btn.hidden = false;
  const label = () => { btn.textContent = on ? "音：あり" : "音：なし"; btn.setAttribute("aria-pressed", String(on)); };
  label();
  const ensure = () => { try { if (!ctx) ctx = new AC(); if (ctx.state === "suspended") ctx.resume(); } catch (e) {} return ctx; };
  const ready = () => on && ctx && ctx.state === "running";
  function tone(t, f, dur, gain, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function click(t, gain) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = "bandpass"; f.frequency.value = 2200 + Math.random() * 1200; f.Q.value = 1.2; g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t);
  }
  btn.onclick = (ev) => { ev.currentTarget.blur(); on = !on; ls.set("azakei-sound", on ? "1" : "0"); label(); if (on && ensure()) setTimeout(() => { if (ready()) tone(ctx.currentTime + .02, 880, .3, .12); }, 60); };
  document.addEventListener("pointerdown", () => { if (on) ensure(); }, { passive: true });
  document.addEventListener("keydown", () => { if (on) ensure(); });
  return {
    tick() { if (ready()) tone(ctx.currentTime, 1320, .08, .06, "square"); },
    chime() { if (!ready()) return; const t = ctx.currentTime; tone(t, 988, .5, .14); tone(t + .18, 784, .7, .14); },
    flap(ms) { if (!ready()) return; const t0 = ctx.currentTime; for (let t = 0; t < ms / 1000; t += 0.035 + Math.random() * 0.02) click(t0 + t, 0.18); },
    bell() {
      if (!ready()) return;
      const t0 = ctx.currentTime;
      for (let k = 0; k < 6; k++) { const t = t0 + k * 0.22; [523, 1046, 1568, 2093].forEach((f, i) => tone(t, f * (1 + Math.random() * .003), 1.4 - i * .25, .09 / (i + 1), "triangle")); }
    }
  };
})();

/* ---------- clock & session ---------- */
function tick() {
  const d = new Date();
  $("clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  $("dateLbl").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日（" + "日月火水木金土"[d.getDay()] + "）";
}
tick(); setInterval(tick, 1000);
function setSession(closed) { const s = $("mktState"); s.textContent = closed ? "大引け" : "取引中"; s.classList.toggle("closed", closed); }

/* ---------- QR ---------- */
try {
  if (window.qrcode) { const q = window.qrcode(0, "M"); q.addData(PAGE_URL); q.make(); $("qr").innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); $("qrPanel").hidden = false; }
} catch (e) {}

/* ---------- full screen ---------- */
$("fsBtn").onclick = async (ev) => { ev.currentTarget.blur(); try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (e) {} };
document.addEventListener("fullscreenchange", () => { const on = !!document.fullscreenElement; document.body.classList.toggle("fs", on); $("fsBtn").textContent = on ? "全画面をやめる" : "全画面"; });

/* ---------- data ---------- */
function apply(list) {
  const prevKnown = known;
  entries = list;
  fresh = prevKnown ? new Set(list.filter(e => !prevKnown.has(e.id)).map(e => e.id)) : new Set();
  known = new Set(list.map(e => e.id));
  if (!userPicked || (filter !== "all" && !list.some(e => e.date === filter))) filter = liveDay();

  // 前回比: how far each line moved since the last change on the board
  const now = ranked(filter);
  const ranksNow = new Map(); now.forEach(e => ranksNow.set(e.id, rankOf(now, e)));
  if (prevKnown && (fresh.size || list.length !== prevKnown.size)) {
    moves = new Map();
    ranksNow.forEach((r, id) => { if (prevRanks.has(id)) moves.set(id, prevRanks.get(id) - r); });
  }
  prevRanks = ranksNow;

  // breaking news
  let news = null;
  const day = liveDay(), top = ranked(day)[0];
  if (top) {
    const prevTopId = topByDay[day];
    if (prevKnown && prevTopId && prevTopId !== top.id && fresh.has(top.id)) {
      const p = entries.find(e => e.id === prevTopId);
      news = { tag: "首位交代", head: (p ? p.name + " → " : "") + top.name, sub: top.chips + "枚（スタートの" + Math.round(top.chips / START * 10) / 10 + "倍）が新しい1位" };
    }
    topByDay[day] = top.id;
  }
  if (prevKnown && fresh.size) {
    const fr = list.filter(e => fresh.has(e.id));
    const oldBest = list.filter(e => !fresh.has(e.id)).reduce((m, e) => Math.max(m, e.chips), 0);
    const breaker = LAST_YEAR ? fr.filter(e => e.chips > LAST_YEAR).sort((a, b) => b.chips - a.chips)[0] : null;
    const nToday = list.filter(e => e.date === today()).length, nBefore = nToday - fr.filter(e => e.date === today()).length;
    if (breaker && oldBest <= LAST_YEAR) news = { tag: "上場来高値更新", head: breaker.name + "　" + breaker.chips + "枚", sub: "去年の最高値 " + LAST_YEAR + "枚 を " + (breaker.chips - LAST_YEAR) + "枚上回る" };
    else if (!news && Math.floor(nToday / MILESTONE) > Math.floor(nBefore / MILESTONE)) {
      const n = Math.floor(nToday / MILESTONE) * MILESTONE, total = list.filter(e => e.date === today()).reduce((s, e) => s + e.chips, 0);
      news = { tag: "出来高", head: "挑戦者 " + n + "人 突破", sub: "配ったチップ " + num(nToday * START) + "枚 → いま合計 " + num(total) + "枚", amber: true };
    }
    if (fr.length) Sound.tick();
  }
  render();
  if (news && !show) setTimeout(() => { if (!show) banner(news); }, 600);
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
    if (seq !== writeSeq) return;
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
  if (show) return;
  const sig = JSON.stringify([entries, filter, isAdmin, !!pass, busy, pendingDel, findQ, [...moves], Math.floor(Date.now() / 60000)]);
  if (!force && sig === lastSig) return;
  lastSig = sig;

  const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
  if (!dates.length) dates.push(today());
  if (!filter || (filter !== "all" && !dates.includes(filter))) filter = dates[0];
  const list = ranked(filter);

  renderDays(dates);
  renderIndices(list);
  renderRows(list);
  renderTarget(list);
  renderBreadth(list);
  renderChart(list);
  renderVolume(list);
  renderFame();
  renderFinder(list);
  renderNews();
  renderTape();
  fresh = new Set();
}

/* TOP: headlines written from the day's records, the way a terminal's news wire reads ("*" = flash) */
function renderNews() {
  const panel = $("newsPanel");
  const day = filter === "all" ? liveDay() : filter;
  const es = entries.filter(e => e.date === day && e.createdAt).sort((a, b) => a.createdAt - b.createdAt);
  if (!es.length) { panel.hidden = true; return; }
  panel.hidden = false;
  let ath = Math.max(LAST_YEAR, ...entries.filter(e => e.date < day).map(e => e.chips), 0);
  const items = []; let top = null;
  es.forEach((e, i) => {
    const so = es.slice(0, i + 1), r = so.filter(x => x.chips > e.chips).length + 1;
    if (!top) items.push({ t: e.createdAt, h: "*" + e.name + "、本日最初の上場　" + e.chips + "枚", cls: "big" });
    else if (e.chips > top.chips) items.push({ t: e.createdAt, h: "*首位交代：" + top.name + " → " + e.name + "　" + e.chips + "枚", cls: "big" });
    else items.push({ t: e.createdAt, h: e.name + "、" + e.chips + "枚で上場（" + r + "位）", cls: "" });
    if (!top || e.chips > top.chips) top = e;
    if (e.chips > ath) { items.push({ t: e.createdAt, h: "*上場来高値を更新：" + e.name + " " + e.chips + "枚（これまで " + ath + "枚）", cls: "hot" }); ath = e.chips; }
    if ((i + 1) % MILESTONE === 0) items.push({ t: e.createdAt, h: "*出来高、" + (i + 1) + "人を突破", cls: "big" });
  });
  const ol = $("news"); ol.textContent = "";
  items.slice(-16).reverse().forEach(it => {
    const li = document.createElement("li"); if (it.cls) li.className = it.cls;
    const t = document.createElement("span"); t.className = "t"; t.textContent = hhmm(it.t);
    const h = document.createElement("span"); h.className = "h"; h.textContent = it.h;
    li.append(t, h); ol.appendChild(li);
  });
}

function renderDays(dates) {
  const days = $("days"); days.textContent = ""; days.hidden = dates.length < 2;
  if (dates.length < 2) return;
  [...dates, "all"].forEach((v, n) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "day"; b.dataset.n = n + 1;
    b.textContent = v === "all" ? "全日程" : (v === today() ? "本日 " : "") + fmtShort(v);
    b.setAttribute("aria-pressed", String(v === filter));
    b.onclick = () => { filter = v; userPicked = v !== liveDay(); moves = new Map(); render(true); };
    days.appendChild(b);
  });
}

function idx(k, v, unit, s) {
  const d = document.createElement("div"); d.className = "idx";
  const a = document.createElement("span"); a.className = "k"; a.textContent = k;
  const b = document.createElement("div"); b.className = "v"; b.textContent = v; if (unit) { const u = document.createElement("small"); u.textContent = unit; b.appendChild(u); }
  const c = document.createElement("span"); c.className = "s"; if (s instanceof Node) c.appendChild(s); else c.textContent = s || "";
  d.append(a, b, c); return d;
}
function renderIndices(list) {
  const box = $("indices"); box.textContent = "";
  const n = list.length, total = list.reduce((s, e) => s + e.chips, 0);
  const chips = list.map(e => e.chips).sort((a, b) => a - b);
  const med = !n ? 0 : n % 2 ? chips[(n - 1) / 2] : (chips[n / 2 - 1] + chips[n / 2]) / 2;
  const hi = list[0];
  const grow = document.createElement("span");
  if (n) { const x = total / (n * START); grow.append("配布 " + num(n * START) + "枚 → "); const q = document.createElement("span"); q.className = dirClass(x - 1); q.textContent = "×" + (Math.round(x * 10) / 10); grow.appendChild(q); }
  box.append(
    idx("時価総額（チップ合計）", num(total), "枚", grow),
    idx("出来高（挑戦者）", num(n), "人", n ? "最終更新 " + hhmm(Math.max(...list.map(e => e.createdAt || 0))) : "まだ取引はありません"),
    idx("本日の高値", hi ? num(hi.chips) : "—", hi ? "枚" : "", hi ? hi.name : ""),
    idx("中央値", n ? String(Math.round(med * 10) / 10) : "—", n ? "枚" : "", n ? "平均 " + Math.round(total / n * 10) / 10 + "枚" : ""),
    idx("上場来高値（去年）", LAST_YEAR ? num(LAST_YEAR) : "—", LAST_YEAR ? "枚" : "", hi && LAST_YEAR ? (hi.chips > LAST_YEAR ? "更新済み" : "あと " + (LAST_YEAR - hi.chips + 1) + "枚で更新") : "")
  );
}

function quoteRow(e, rank, list) {
  const row = document.createElement("div");
  row.className = "q" + (rank === 1 ? " top" : rank <= 3 ? " r" + rank : "") + (fresh.has(e.id) ? " flash" : "") + (matches(e) ? " found" : "");
  row.dataset.id = e.id; row.dataset.rank = rank;
  const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = rank;
  const code = document.createElement("span"); code.className = "code"; code.textContent = codeOf(e);
  const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = e.name;
  if (fresh.has(e.id) || (filter !== "all" && Date.now() - e.createdAt < 10 * 60000)) { const t = document.createElement("span"); t.className = "tagnew"; t.textContent = "NEW"; nm.appendChild(t); }
  if (e.chips > PRIZE) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "シャーペン"; nm.appendChild(b); }
  if (filter === "all") { const b = document.createElement("span"); b.className = "badge"; b.style.borderColor = "var(--line-2)"; b.style.color = "var(--dim)"; b.textContent = fmtShort(e.date); nm.appendChild(b); }
  const px = document.createElement("span"); px.className = "px"; px.textContent = num(e.chips); const u = document.createElement("small"); u.textContent = "枚"; px.appendChild(u);
  const pc = document.createElement("span"); pc.className = "pct c-pct " + dirClass(e.chips - START); pc.textContent = fmtPct(e.chips);
  const mv = document.createElement("span"); mv.className = "mv c-move";
  const m = moves.get(e.id);
  if (!moves.has(e.id) && fresh.has(e.id)) { mv.textContent = "新規"; mv.classList.add("up"); }
  else if (m > 0) { mv.textContent = "▲" + m; mv.classList.add("up"); }
  else if (m < 0) { mv.textContent = "▼" + (-m); mv.classList.add("down"); }
  else { mv.textContent = "─"; mv.classList.add("flat"); }
  if (isAdmin && pass) mv.appendChild(delButton(e));
  row.append(rk, code, nm, px, pc, mv);
  return row;
}

function renderRows(list) {
  const box = $("rows");
  // remember where each line was, so reordering can slide (FLIP)
  const before = new Map(); box.querySelectorAll(".q").forEach(el => before.set(el.dataset.id, el.getBoundingClientRect().top));
  box.textContent = "";
  $("empty").hidden = list.length > 0;
  list.slice(0, TOP_N).forEach(e => box.appendChild(quoteRow(e, rankOf(list, e), list)));
  if (!reduced()) box.querySelectorAll(".q").forEach(el => {
    const was = before.get(el.dataset.id); if (was == null) return;
    const dy = was - el.getBoundingClientRect().top; if (Math.abs(dy) < 2) return;
    el.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
  const rest = $("rest"); rest.textContent = "";
  $("restWrap").hidden = list.length <= TOP_N;
  $("restHead").textContent = (TOP_N + 1) + "位以下";
  list.slice(TOP_N).forEach(e => {
    const li = document.createElement("li"); if (matches(e)) li.className = "found";
    const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = rankOf(list, e);
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = e.name;
    const px = document.createElement("span"); px.className = "px"; px.textContent = num(e.chips) + "枚";
    li.append(rk, nm, px);
    if (isAdmin && pass) li.appendChild(delButton(e));
    rest.appendChild(li);
  });
}

function renderTarget(list) {
  const box = $("target");
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false; box.textContent = "";
  const h = document.createElement("h3"); const hc = document.createElement("span"); hc.className = "code"; hc.textContent = "TGT"; h.append(hc, "ランクインの目安"); box.appendChild(h);
  const rows = [["1位", list[0].chips]];
  if (list.length >= 3) rows.push(["3位", list[2].chips]);
  if (list.length >= TOP_N) rows.push([TOP_N + "位", list[TOP_N - 1].chips]);
  rows.push(["シャーペン", PRIZE + 1]);
  if (LAST_YEAR) rows.push(["上場来高値の更新", LAST_YEAR + 1, "ly"]);
  for (const [k, v, cls] of rows) {
    const r = document.createElement("div"); r.className = "row" + (cls ? " " + cls : "");
    const a = document.createElement("span"); a.textContent = k;
    const b = document.createElement("b"); b.textContent = num(v) + "枚〜";
    r.append(a, b); box.appendChild(r);
  }
}

function renderBreadth(list) {
  const panel = $("breadthPanel");
  if (filter === "all" || list.length < 3) { panel.hidden = true; return; }
  panel.hidden = false;
  const up = list.filter(e => e.chips > START).length, down = list.filter(e => e.chips < START).length, flat = list.length - up - down;
  const b = $("breadth"); b.textContent = "";
  [["値上がり", up, "up"], ["値下がり", down, "down"], ["変わらず", flat, "flat"]].forEach(([k, v, c]) => {
    const d = document.createElement("div"); const s = document.createElement("span"); s.textContent = k; const n = document.createElement("b"); n.className = c; n.textContent = v; d.append(s, n); b.appendChild(d);
  });
  const total = list.reduce((s, e) => s + e.chips, 0), k = Math.max(1, Math.round(list.length * .1));
  const share = list.slice(0, k).reduce((s, e) => s + e.chips, 0) / (total || 1);
  const memo = $("memo"); memo.textContent = "";
  [["値上がり率（増やせた人）", Math.round(up / list.length * 100) + "%"], ["上位1割（" + k + "人）の保有比率", Math.round(share * 100) + "%"], ["最大騰落率", fmtPct(list[0].chips)]].forEach(([a, v]) => {
    const dt = document.createElement("dt"); dt.textContent = a; const dd = document.createElement("dd"); dd.textContent = v; memo.append(dt, dd);
  });
}

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
function renderChart(list) {
  const fig = $("chart"), svg = $("chartSvg");
  const day = list.filter(e => e.createdAt).sort((a, b) => a.createdAt - b.createdAt);
  if (filter === "all" || day.length < 2) { fig.hidden = true; return; }
  fig.hidden = false; svg.textContent = "";
  const W = 320, H = 160, L = 34, R = 10, T = 12, B = 22;
  const t0 = day[0].createdAt, isToday = filter === today();
  const t1 = Math.max(day[day.length - 1].createdAt, isToday ? Date.now() : 0, t0 + 30 * 60000);
  const maxV = Math.max(...day.map(e => e.chips), LAST_YEAR);
  const yMax = Math.max(10, Math.ceil(maxV * 1.12 / 10) * 10);
  const X = (t) => L + (t - t0) / (t1 - t0) * (W - L - R), Y = (v) => H - B - v / yMax * (H - T - B);
  for (let i = 0; i <= 4; i++) { const y = T + (H - T - B) * i / 4; svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "#262626", "stroke-width": 1 })); }
  const label = (x, y, s, anchor, fill) => { const t = svgEl("text", { x, y, "text-anchor": anchor, fill, "font-size": 10 }); t.textContent = s; svg.appendChild(t); };
  label(L - 5, T + 4, String(yMax), "end", "#8e8e8e"); label(L - 5, H - B + 3, "0", "end", "#8e8e8e");
  label(L, H - 6, hhmm(t0), "start", "#8e8e8e"); label(W - R, H - 6, isToday ? "現在" : hhmm(t1), "end", "#8e8e8e");
  if (LAST_YEAR) { svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: Y(LAST_YEAR), y2: Y(LAST_YEAR), stroke: "#f5c518", "stroke-width": 1, "stroke-dasharray": "4 4" })); label(L + 4, Y(LAST_YEAR) - 4, "上場来高値 " + LAST_YEAR, "start", "#f5c518"); }
  let best = -1, d = "";
  for (const e of day) if (e.chips > best) { d += (best < 0 ? "M" : " L" + X(e.createdAt).toFixed(1) + " " + Y(best).toFixed(1) + " L") + X(e.createdAt).toFixed(1) + " " + Y(e.chips).toFixed(1); best = e.chips; }
  d += " L" + X(t1).toFixed(1) + " " + Y(best).toFixed(1);
  const area = svgEl("path", { d: d + " L" + X(t1).toFixed(1) + " " + (H - B) + " L" + X(t0).toFixed(1) + " " + (H - B) + " Z", fill: "rgba(251,139,30,.12)" });
  svg.appendChild(area);
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: "#fb8b1e", "stroke-width": 2, "stroke-linejoin": "round" }));
  svg.appendChild(svgEl("circle", { cx: X(t1), cy: Y(best), r: 3.5, fill: "#fb8b1e" }));
  label(Math.min(X(t1), W - R) - 6, Y(best) - 7, best + "枚", "end", "#fb8b1e");
}

function renderVolume(list) {
  const panel = $("volPanel");
  const day = filter === "all" ? [] : list.filter(e => e.createdAt);
  if (day.length < 3) { panel.hidden = true; return; }
  panel.hidden = false;
  const by = new Map(); for (const e of day) { const h = new Date(e.createdAt).getHours(); by.set(h, (by.get(h) || 0) + 1); }
  const hours = [...by.keys()].sort((a, b) => a - b), max = Math.max(...by.values());
  const box = $("vol"); box.textContent = "";
  for (const h of hours) {
    const n = by.get(h);
    const r = document.createElement("div"); r.className = "vr";
    const a = document.createElement("span"); a.textContent = pad(h) + "時";
    const bar = document.createElement("span"); bar.className = "bar" + (n === max ? " peak" : ""); bar.style.width = Math.max(4, n / max * 100) + "%";
    const c = document.createElement("span"); c.className = "n"; c.textContent = n;
    const wrap = document.createElement("span"); wrap.appendChild(bar);
    r.append(a, wrap, c); box.appendChild(r);
  }
}

function renderFame() {
  const dates = [...new Set(entries.map(e => e.date))].sort();
  const box = $("fame");
  if (dates.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const ol = $("fameList"); ol.textContent = "";
  const best = Math.max(...entries.map(e => e.chips));
  for (const d of dates) {
    const top = ranked(d)[0]; if (!top) continue;
    const li = document.createElement("li"); if (top.chips === best) li.className = "best";
    const a = document.createElement("span"); a.className = "d"; a.textContent = fmtShort(d);
    const b = document.createElement("span"); b.className = "n"; b.textContent = top.name;
    const c = document.createElement("span"); c.className = "c"; c.textContent = top.chips + "枚" + (d === today() ? "（暫定）" : "");
    li.append(a, b, c); ol.appendChild(li);
  }
}

function renderFinder(list) {
  const box = $("finder"), out = $("findResult");
  box.hidden = list.length < 4;
  if (!findQ) { out.textContent = ""; return; }
  const hit = list.filter(matches);
  if (!hit.length) { out.textContent = "該当なし"; return; }
  const e = hit[0];
  out.textContent = rankOf(list, e) + "位　" + e.name + "　" + e.chips + "枚" + (hit.length > 1 ? "（ほか" + (hit.length - 1) + "件）" : "");
}
$("findName").addEventListener("input", (ev) => {
  findQ = ev.target.value.trim(); render(true);
  const first = document.querySelector(".q.found, .rest li.found");
  if (first) first.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
});

let tapeSig = "";
function renderTape() {
  const latest = entries.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 24);
  const sig = latest.map(e => e.id).join(",");
  if (sig === tapeSig) return; tapeSig = sig;
  const move = $("tape"); move.textContent = "";
  if (!latest.length) { const s = document.createElement("span"); s.textContent = "本日の取引はまだありません"; move.appendChild(s); move.style.animation = "none"; return; }
  const make = () => latest.forEach(e => {
    const s = document.createElement("span");
    const a = document.createElement("span"); a.className = "tc"; a.textContent = codeOf(e);
    const b = document.createElement("span"); b.className = "tn"; b.textContent = e.name;
    const c = document.createElement("span"); c.className = "tp"; c.textContent = num(e.chips);
    const d = document.createElement("span"); d.className = dirClass(e.chips - START); d.textContent = (e.chips >= START ? "▲" : "▼") + fmtPct(e.chips);
    s.append(a, b, c, d); move.appendChild(s);
  });
  make(); make();                              // two copies → seamless loop
  move.style.animation = "";
  move.style.animationDuration = Math.max(20, latest.length * 4) + "s";
}

/* ---------- breaking banner ---------- */
let bannerTimer = null;
function banner(n) {
  const b = $("banner");
  b.textContent = "";
  const t = document.createElement("span"); t.className = "tag"; t.textContent = n.tag;
  const h = document.createElement("span"); h.className = "head"; h.textContent = "*" + n.head;
  const s = document.createElement("span"); s.className = "sub"; s.textContent = n.sub || "";
  b.append(t, h, s);
  b.className = "banner" + (n.amber ? " amber" : "");
  b.hidden = false;
  void b.offsetWidth; if (!reduced()) b.classList.add("blink");
  Sound.chime();
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, n.stay || 30000);
}
$("banner").addEventListener("click", () => { $("banner").hidden = true; });

function delButton(e) {
  const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.disabled = busy;
  const armed = pendingDel === e.id;
  del.textContent = armed ? "本当に取消" : "取消";
  if (armed) del.classList.add("confirm");
  del.onclick = async () => {
    if (pendingDel !== e.id) { pendingDel = e.id; render(true); setTimeout(() => { if (pendingDel === e.id) { pendingDel = null; render(true); } }, 4000); return; }
    pendingDel = null; busy = true; render(true);
    try { await post({ action: "delete", id: e.id }); entries = entries.filter(x => x.id !== e.id); if (known) known.delete(e.id); setMsg(e.name + " さんの記録を取り消しました"); }
    catch (err) { setMsg(errText(err.code), true); if (err.code === "wrong_pass") forget(); }
    busy = false; render(true);
  };
  return del;
}

/* ---------- 大引け: results typed into the terminal, 10th → 1st ---------- */
function flapTo(el, text, ms) {
  if (reduced()) { el.textContent = text; return; }
  const chars = [...text]; el.textContent = ""; el.classList.add("typing");
  const per = Math.max(40, ms / Math.max(1, chars.length));
  let i = 0;
  const step = () => {
    i++; el.textContent = chars.slice(0, i).join("");
    if (i < chars.length) setTimeout(step, per * (0.7 + Math.random() * 0.6));
    else el.classList.remove("typing");
  };
  setTimeout(step, per);
}
function startShow() {
  if (show || !ranked(filter).length) return;
  render(true);
  document.body.classList.add("closing"); setSession(true);
  const rows = [...document.querySelectorAll("#rows .q")];
  rows.forEach(r => {
    r.classList.add("hide"); r.classList.remove("flash", "found");
    r.querySelector(".nm").textContent = "－－－－";
    r.querySelector(".px").textContent = "---";
    r.querySelector(".pct").textContent = "--"; r.querySelector(".mv").textContent = "";
    r.querySelector(".code").textContent = "----";
  });
  $("banner").hidden = true; clearTimeout(bannerTimer);
  const ctl = document.createElement("div"); ctl.className = "show-ctl";
  ctl.innerHTML = '<span class="hint2">クリック・スペースキーで1つずつ発表</span><button type="button" data-a="next">発表する</button><button type="button" data-a="auto">自動で発表</button><button type="button" data-a="end">おわる</button>';
  $("rows").after(ctl);
  ctl.addEventListener("click", (ev) => { const a = ev.target.dataset && ev.target.dataset.a; if (ev.target.blur) ev.target.blur(); if (a === "next") revealNext(); else if (a === "auto") toggleAuto(); else if (a === "end") endShow(); });
  $("boardTitle").textContent = "本日の大引け　結果発表"; $("fnName").textContent = "CLOSE";
  show = { rows, list: ranked(filter), ctl, next: rows.length - 1, auto: false, busy: false, timer: null };
  $("showBtn").textContent = "発表をおわる";
}
function revealNext() {
  if (!show || show.busy) return;
  const i = show.next;
  if (i < 0) { endShow(); return; }
  show.next--;
  const row = show.rows[i], e = show.list[i];
  const ms = i === 0 ? 2600 : i <= 2 ? 1600 : 900;
  show.busy = true;
  const go = () => {
    row.classList.remove("hide");
    flapTo(row.querySelector(".code"), codeOf(e), ms * .6);
    flapTo(row.querySelector(".nm"), e.name, ms);
    flapTo(row.querySelector(".px"), num(e.chips), ms * .8);
    const pc = row.querySelector(".pct"); pc.className = "pct c-pct " + dirClass(e.chips - START); flapTo(pc, fmtPct(e.chips), ms * .9);
    Sound.flap(ms);
    setTimeout(() => {
      if (!show) return;
      const u = document.createElement("small"); u.textContent = "枚"; row.querySelector(".px").appendChild(u);
      row.classList.add("flash");
      show.busy = false;
      if (i === 0) {
        Sound.bell(); setSession(true);
        banner({ tag: "大引け", head: "本日の億万長者　" + e.name, sub: e.chips + "枚（スタートの" + Math.round(e.chips / START * 10) / 10 + "倍）" + (LAST_YEAR && e.chips > LAST_YEAR ? "・上場来高値も更新" : ""), stay: 120000 });
        show.ctl.querySelector('[data-a="next"]').textContent = "通常の表示にもどす";
      }
    }, ms + 60);
  };
  if (i === 0 && !reduced()) setTimeout(go, 900); else go();
}
function toggleAuto() {
  if (!show) return;
  show.auto = !show.auto;
  show.ctl.querySelector('[data-a="auto"]').textContent = show.auto ? "自動をとめる" : "自動で発表";
  const step = () => {
    if (!show || !show.auto || show.next < 0) return;
    if (show.busy) { show.timer = setTimeout(step, 200); return; }
    const before = show.next; revealNext();
    const wait = before - 1 === 0 ? 4000 : before - 1 <= 2 ? 3200 : 1500;
    if (show && show.next >= 0) show.timer = setTimeout(step, wait);
  };
  if (show.auto) step(); else clearTimeout(show.timer);
}
function endShow() {
  if (!show) return;
  clearTimeout(show.timer); show.ctl.remove(); show = null;
  document.body.classList.remove("closing"); setSession(false);
  $("boardTitle").textContent = "本日の億万長者"; $("fnName").textContent = "RANK";
  $("showBtn").textContent = "大引け（結果発表）";
  render(true);
}
$("showBtn").onclick = (ev) => { ev.currentTarget.blur(); if (show) endShow(); else startShow(); };
document.addEventListener("keydown", (ev) => {
  if (!show || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((ev.target && ev.target.tagName) || "")) return;
  if (ev.key === " " || ev.key === "Enter" || ev.key === "ArrowRight") { ev.preventDefault(); revealNext(); }
  else if (ev.key === "Escape") endShow();
  else if (ev.key === "a" || ev.key === "A") toggleAuto();
});

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
  busy = true; $("submit").disabled = true; setMsg("送信しています…");
  try {
    const j = await post({ action: "add", name, chips, date });
    const e = clean(j.entry);
    filter = e.date; userPicked = e.date !== liveDay();
    apply(entries.concat([e]));
    setMsg(e.name + " さん " + e.chips + "枚 → " + rankOf(ranked(e.date), e) + "位で上場しました");
    $("name").value = ""; $("chips").value = START; $("name").focus();
  } catch (err) {
    setMsg(errText(err.code), true);
    if (err.code === "wrong_pass") forget();
  }
  busy = false; $("submit").disabled = false; render(true);
});
window.addEventListener("hashchange", () => { isAdmin = location.hash === "#admin"; render(true); });

/* ---------- demo (?demo) ---------- */
let demoList = [];
function demoPost(body) {
  if (body.action === "check") return Promise.resolve({ ok: true });
  if (body.action === "add") { const e = { id: "d" + Date.now().toString(36), name: body.name, chips: body.chips, date: body.date, createdAt: Date.now() }; demoList.push(e); return Promise.resolve({ ok: true, entry: e }); }
  if (body.action === "delete") { demoList = demoList.filter(e => e.id !== body.id); return Promise.resolve({ ok: true }); }
  return Promise.resolve({ ok: false });
}
if (DEMO) {
  const names = ["たろう", "はなこ", "けんた", "ゆうき", "さくら", "そうま", "りん", "はると", "あおい", "みなと", "ひなた", "こはる", "いつき"];
  const chips = [96, 86, 64, 41, 33, 28, 22, 18, 15, 12, 9, 7, 3];
  const now0 = Date.now(), y = new Date(now0 - 86400000);
  const yesterday = y.getFullYear() + "-" + pad(y.getMonth() + 1) + "-" + pad(y.getDate());
  const offsets = [215, 190, 172, 150, 141, 133, 118, 104, 96, 88, 61, 40, 22];
  demoList = names.map((n, i) => ({ id: "s" + i, name: n, chips: chips[(i * 5) % 13], date: today(), createdAt: now0 - offsets[i] * 60000 }));
  [["そら", 88], ["れん", 54], ["ゆな", 31], ["かい", 12], ["めい", 6]].forEach(([n, c], i) => demoList.push({ id: "y" + i, name: n, chips: c, date: yesterday, createdAt: now0 - 86400000 - i * 1800000 }));
  apply(demoList.slice());
  setTimeout(() => { demoList.push({ id: "s-mid", name: "みお", chips: 52, date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 4000);
  setTimeout(() => { demoList.push({ id: "s-new", name: "ゆいと", chips: Math.max(LAST_YEAR + 12, 132), date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 9000);
} else {
  render(true);
  load().then(schedule);
}
})();
