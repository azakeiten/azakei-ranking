/* AZAKEI — 本日の億万長者 results board.
   Visitors: reads the records from the Apps Script web app every few seconds.
   Admin (#admin): adds and removes records with the shared passcode. */
(() => {
"use strict";
const CFG = window.AZAKEI_RANKING || {};
const API = String(CFG.scriptUrl || "").trim();
const DEMO = /[?&]demo\b/.test(location.search);
const PAGE_URL = "https://azakeiten.github.io/azakei-ranking/";
const START = 5, PRIZE = 40, TOP_N = 5, POLL_MS = 7000, REST_PER = 15;
const LAST_YEAR = Math.max(0, Number(CFG.lastYearBest) || 0);

const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const hhmm = (t) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const num = (n) => Number(n).toLocaleString("en-US");
const mult = (c) => "×" + (Math.round(c / START * 10) / 10).toFixed(1);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clean = (e) => ({ id: String(e.id || ""), name: String(e.name || "").slice(0, 20), chips: Math.max(0, Math.floor(Number(e.chips) || 0)), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "", createdAt: Number(e.createdAt) || 0 });
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/* ---------- state ---------- */
let entries = [], known = null, fresh = new Set(), topByDay = {};
let filter = null, userPicked = false;
let isAdmin = location.hash === "#admin";
let pass = ls.get("azakei-pass") || "";
let busy = false, pendingDel = null, lastSig = "", failCount = 0, writeSeq = 0;
let findQ = "", restPage = 0, show = null;

const ranked = (date) => entries.filter(e => date === "all" || e.date === date).sort((a, b) => b.chips - a.chips || a.createdAt - b.createdAt);
const rankOf = (list, e) => list.filter(x => x.chips > e.chips).length + 1;
const latestDate = () => entries.reduce((m, e) => e.date > m ? e.date : m, "");
const liveDay = () => entries.some(e => e.date === today()) ? today() : (latestDate() || today());
const matches = (e) => !!findQ && norm(e.name).includes(norm(findQ));
// Q: qualified for the prize. ER: exhibition record — beats the best mark set before it (last year's, then this year's)
function recordIds() {
  const ids = new Set(); let best = LAST_YEAR;
  entries.slice().sort((a, b) => a.createdAt - b.createdAt).forEach(e => { if (LAST_YEAR && e.chips > best) { ids.add(e.id); best = e.chips; } });
  return ids;
}

/* ---------- clock ---------- */
function tick() { const d = new Date(); $("clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
tick(); setInterval(tick, 1000);

/* ---------- QR ---------- */
try { if (window.qrcode) { const q = window.qrcode(0, "M"); q.addData(PAGE_URL); q.make(); $("qr").innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); $("qrPanel").hidden = false; } } catch (e) {}

/* ---------- full screen ---------- */
$("fsBtn").onclick = async (ev) => { ev.currentTarget.blur(); try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (e) {} };
document.addEventListener("fullscreenchange", () => { document.body.classList.toggle("fs", !!document.fullscreenElement); $("fsBtn").textContent = document.fullscreenElement ? "全画面を終える" : "全画面"; });

/* ---------- data ---------- */
function apply(list) {
  const prevKnown = known;
  entries = list;
  fresh = prevKnown ? new Set(list.filter(e => !prevKnown.has(e.id)).map(e => e.id)) : new Set();
  known = new Set(list.map(e => e.id));
  if (!userPicked || (filter !== "all" && !list.some(e => e.date === filter))) filter = liveDay();

  let band = null;
  const day = liveDay(), top = ranked(day)[0];
  if (top) {
    const prevTop = topByDay[day];
    if (prevKnown && prevTop && prevTop !== top.id && fresh.has(top.id)) band = { k: "首位交代", n: top.name, v: top.chips };
    topByDay[day] = top.id;
  }
  if (prevKnown && fresh.size) {
    const rec = recordIds();
    const hit = list.filter(e => fresh.has(e.id) && rec.has(e.id)).sort((a, b) => b.chips - a.chips)[0];
    if (hit) band = { k: "大会新記録", n: hit.name, v: hit.chips, gold: true };
  }
  render();
  if (band && !show) flash(band);
}

async function load() {
  if (DEMO) return;
  if (!API) { setStatus("記録の保存先が設定されていません（config.js）。"); return; }
  const seq = writeSeq;
  try {
    const r = await fetch(API + (API.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.entries)) throw new Error("bad");
    failCount = 0; setStatus("");
    if (seq !== writeSeq) return;
    apply(j.entries.map(clean).filter(e => e.id && e.date));
  } catch (e) { if (++failCount >= 2) setStatus("記録を読み込めません。通信を確認しています。"); }
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
  try { r = await fetch(API, { method: "POST", body: JSON.stringify(Object.assign({ pass }, body)) }); } catch (e) { throw { code: "network" }; }
  let j; try { j = await r.json(); } catch (e) { throw { code: "network" }; }
  if (!j.ok) throw { code: j.error || "unknown" };
  return j;
}
function errText(code) {
  return ({
    wrong_pass: "合言葉がちがいます。",
    no_pass_set: "保存先に合言葉が登録されていません（スクリプト プロパティの ADMIN_PASS）。",
    no_name: "名前を入れてください。",
    bad_chips: "枚数を0〜99999の数字で入れてください。",
    bad_date: "日付を選んでください。",
    busy: "ほかの入力を処理中です。もう一度押してください。",
    no_api: "記録の保存先が設定されていません（config.js）。",
    network: "通信できませんでした。電波を確認して、もう一度押してください。"
  })[code] || "保存できませんでした。もう一度押してください。";
}

/* ---------- render ---------- */
function render(force) {
  document.body.classList.toggle("admin-on", isAdmin);
  $("form").hidden = !isAdmin; $("adminBar").hidden = !isAdmin;
  $("passBox").hidden = !!pass; $("entryBox").hidden = !pass; $("forget").hidden = !pass;
  if (show) return;
  const sig = JSON.stringify([entries, filter, isAdmin, !!pass, busy, pendingDel, findQ]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  const dates = [...new Set(entries.map(e => e.date))].sort();
  if (!dates.length) dates.push(today());
  if (!filter || (filter !== "all" && !dates.includes(filter))) filter = dates[dates.length - 1];
  const list = ranked(filter);
  renderDays(dates);
  renderRows(list);
  renderStats(list);
  renderFind(list);
  fresh = new Set();
}

function renderDays(dates) {
  const nav = $("days"); nav.textContent = ""; nav.hidden = dates.length < 2;
  if (dates.length < 2) return;
  [...dates.map((d, i) => [d, (i + 1) + "日目"]), ["all", "通算"]].forEach(([v, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "day"; b.textContent = label;
    b.setAttribute("aria-pressed", String(v === filter));
    b.onclick = () => { filter = v; userPicked = v !== liveDay(); restPage = 0; render(true); };
    nav.appendChild(b);
  });
}

function marks(e, rec) {
  const box = document.createElement("span"); box.className = "fl";
  if (e.chips > PRIZE) { const m = document.createElement("span"); m.className = "mark"; m.textContent = "景品"; m.title = "41枚以上"; box.appendChild(m); }
  if (rec.has(e.id)) { const m = document.createElement("span"); m.className = "mark er"; m.textContent = "大会新"; m.title = "前回の最高記録を更新"; box.appendChild(m); }
  return box;
}
function cell(cls, text) { const s = document.createElement("span"); s.className = cls; s.textContent = text; return s; }

function renderRows(list) {
  const box = $("rows"), rec = recordIds();
  const before = new Map(); box.querySelectorAll(".row").forEach(el => before.set(el.dataset.id, el.getBoundingClientRect().top));
  box.textContent = "";
  $("empty").hidden = list.length > 0;
  list.slice(0, TOP_N).forEach(e => {
    const r = rankOf(list, e);
    const li = document.createElement("li");
    li.className = "row" + (r <= 3 ? " m" + r : "") + (fresh.has(e.id) ? " fresh" : "") + (matches(e) ? " found" : "");
    li.dataset.id = e.id;
    const tail = marks(e, rec);
    if (isAdmin && pass) tail.appendChild(delButton(e));
    if (r === 1) {
      // the leader band: label, huge name and result, details underneath
      const meta = document.createElement("span"); meta.className = "meta";
      meta.append(cell("", "時刻 " + (e.createdAt ? hhmm(e.createdAt) : "—")), cell("", "倍率 " + mult(e.chips)), tail);
      const rs = cell("rs", num(e.chips)); const u = document.createElement("small"); u.textContent = "枚"; rs.appendChild(u);
      li.append(cell("rk", r), cell("lab", show ? "優勝" : "トップ"), cell("nm", e.name), meta, rs);
    } else {
      li.append(cell("rk", r), cell("nm", e.name), cell("tm c-time", e.createdAt ? hhmm(e.createdAt) : ""), cell("mx c-mult", mult(e.chips)), cell("rs", num(e.chips)), tail);
    }
    box.appendChild(li);
  });
  if (!reduced()) box.querySelectorAll(".row").forEach(el => {
    const was = before.get(el.dataset.id); if (was == null) return;
    const dy = was - el.getBoundingClientRect().top; if (Math.abs(dy) < 2) return;
    el.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
  renderRest(list);
}

function renderRest(list) {
  // visitors see the top 5 only; the admin still needs the rest to correct mistakes
  if (!isAdmin) { $("more").hidden = true; return; }
  const rest = list.slice(TOP_N);
  $("more").hidden = !rest.length;
  if (!rest.length) return;
  const pages = Math.ceil(rest.length / REST_PER);
  const hitAt = findQ ? rest.findIndex(matches) : -1;
  if (hitAt >= 0) restPage = Math.floor(hitAt / REST_PER);
  if (restPage >= pages) restPage = 0;
  const from = restPage * REST_PER;
  $("moreHead").textContent = (TOP_N + 1 + from) + "〜" + (TOP_N + Math.min(from + REST_PER, rest.length)) + "位（管理者のみ表示）";
  const pg = $("pager"); pg.hidden = pages < 2; pg.textContent = (restPage + 1) + " / " + pages + "ページ ▸";
  const ol = $("rest"); ol.textContent = "";
  rest.slice(from, from + REST_PER).forEach(e => {
    const li = document.createElement("li"); if (matches(e)) li.className = "found";
    li.append(cell("rk", rankOf(list, e)), cell("nm", e.name), cell("rs", num(e.chips)));
    if (isAdmin && pass) li.appendChild(delButton(e)); else li.appendChild(document.createElement("span"));
    ol.appendChild(li);
  });
}
$("pager").addEventListener("click", (ev) => { ev.currentTarget.blur(); restPage++; renderRest(ranked(filter)); });
setInterval(() => { if (show || findQ || document.hidden) return; const l = ranked(filter); if (l.length > TOP_N + REST_PER) { restPage++; renderRest(l); } }, 9000);

function renderStats(list) {
  const dl = $("stats"); dl.textContent = "";
  const n = list.length, total = list.reduce((s, e) => s + e.chips, 0);
  const c = list.map(e => e.chips).sort((a, b) => a - b);
  const med = !n ? 0 : n % 2 ? c[(n - 1) / 2] : (c[n / 2 - 1] + c[n / 2]) / 2;
  const items = [["参加", num(n) + "人"], ["チップ合計", num(total) + "枚"], ["中央値", n ? (Math.round(med * 10) / 10) + "枚" : "—"], ["景品獲得", num(list.filter(e => e.chips > PRIZE).length) + "人"]];
  if (LAST_YEAR) items.push(["前回最高", num(LAST_YEAR) + "枚"]);
  items.forEach(([k, v]) => { const d = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; d.append(dt, dd); dl.appendChild(d); });
}

function renderFind(list) {
  const out = $("findResult");
  if (!findQ) { out.textContent = ""; return; }
  const hit = list.filter(matches);
  out.textContent = hit.length ? rankOf(list, hit[0]) + "位　" + hit[0].name + "　" + num(hit[0].chips) + "枚" : "見つかりません";
}
$("findName").addEventListener("input", (ev) => {
  findQ = ev.target.value.trim(); render(true);
  const first = document.querySelector(".row.found, .rest li.found");
  if (first) first.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
});

/* ---------- NEW LEADER / RECORD band ---------- */
let flashTimer = null;
function flash(b) {
  const el = $("flash"); el.textContent = "";
  el.append(cell("k", b.k), cell("n", b.n));
  const v = cell("v", num(b.v)); const s = document.createElement("small"); s.textContent = "枚"; v.appendChild(s); el.appendChild(v);
  el.classList.toggle("gold", !!b.gold);
  el.hidden = false; el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { el.hidden = true; }, b.stay || 15000);
}
$("flash").addEventListener("click", () => { $("flash").hidden = true; });

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

/* ---------- FINAL RESULTS: rows come in from 10th to 1st ---------- */
function startShow() {
  if (show || !ranked(filter).length) return;
  render(true);
  $("flash").hidden = true;
  document.body.classList.add("final");
  $("live").textContent = "確定"; $("live").classList.add("final");
  const rows = [...document.querySelectorAll("#rows .row")];
  rows.forEach(r => r.classList.add("wait"));
  const ctl = document.createElement("div"); ctl.className = "show-ctl";
  ctl.innerHTML = '<span>スペースキーかクリックで次へ</span><button class="btn" type="button" data-a="next">次へ</button><button class="btn" type="button" data-a="auto">自動</button><button class="btn" type="button" data-a="end">終了</button>';
  $("rows").after(ctl);
  ctl.addEventListener("click", (ev) => { const a = ev.target.dataset && ev.target.dataset.a; if (ev.target.blur) ev.target.blur(); if (a === "next") revealNext(); else if (a === "auto") toggleAuto(); else if (a === "end") endShow(); });
  show = { rows, list: ranked(filter), ctl, next: rows.length - 1, auto: false, timer: null, busy: false };
  $("showBtn").textContent = "発表を終える";
}
function revealNext() {
  if (!show || show.busy) return;
  const i = show.next;
  if (i < 0) { endShow(); return; }
  show.next--;
  const row = show.rows[i], e = show.list[i];
  const go = () => {
    if (i === 0) { const lab = row.querySelector(".lab"); if (lab) lab.textContent = "優勝"; }
    row.classList.remove("wait"); row.classList.add("enter");
    show.busy = false;
    if (i === 0) { flash({ k: "優勝", n: e.name, v: e.chips, stay: 600000 }); show.ctl.querySelector('[data-a="next"]').textContent = "速報に戻る"; }
  };
  if (i === 0 && !reduced()) { show.busy = true; setTimeout(go, 1200); } else go();
}
function toggleAuto() {
  if (!show) return;
  show.auto = !show.auto;
  show.ctl.querySelector('[data-a="auto"]').textContent = show.auto ? "止める" : "自動";
  const step = () => {
    if (!show || !show.auto || show.next < 0) return;
    const before = show.next; revealNext();
    const wait = before - 1 === 0 ? 3500 : before - 1 <= 2 ? 2800 : 1400;
    if (show && show.next >= 0) show.timer = setTimeout(step, wait);
  };
  if (show.auto) step(); else clearTimeout(show.timer);
}
function endShow() {
  if (!show) return;
  clearTimeout(show.timer); show.ctl.remove(); show = null;
  document.body.classList.remove("final");
  $("live").textContent = "速報"; $("live").classList.remove("final");
  $("flash").hidden = true;
  $("showBtn").textContent = "結果発表";
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
    setMsg(e.name + "　" + e.chips + "枚　" + rankOf(ranked(e.date), e) + "位で記録しました");
    $("name").value = ""; $("chips").value = START; $("name").focus();
  } catch (err) { setMsg(errText(err.code), true); if (err.code === "wrong_pass") forget(); }
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
  const now0 = Date.now(), y = new Date(now0 - 86400000);
  const yesterday = y.getFullYear() + "-" + pad(y.getMonth() + 1) + "-" + pad(y.getDate());
  const main = [["たろう", 96], ["はなこ", 86], ["けんた", 64], ["ゆうき", 41], ["さくら", 33], ["そうま", 28], ["りん", 22], ["はると", 18], ["あおい", 15], ["みなと", 12], ["ひなた", 9], ["こはる", 7], ["いつき", 3]];
  main.forEach(([n, c], i) => demoList.push({ id: "s" + i, name: n, chips: c, date: today(), createdAt: now0 - (215 - i * 13) * 60000 }));
  ["ゆず", "そうた", "ひかり", "だいち", "まな", "こうき", "あかり", "しょう", "ゆい", "たくみ", "のぞみ", "りく", "ここな", "はやと", "えま", "かずき", "みゆ", "けい"].forEach((n, i) => demoList.push({ id: "f" + i, name: n, chips: [14, 11, 10, 9, 8, 8, 7, 6, 6, 5, 5, 4, 4, 3, 2, 2, 1, 0][i], date: today(), createdAt: now0 - (200 - i * 9) * 60000 }));
  [["そら", 88], ["れん", 54], ["ゆな", 31], ["かい", 12], ["めい", 6]].forEach(([n, c], i) => demoList.push({ id: "y" + i, name: n, chips: c, date: yesterday, createdAt: now0 - 86400000 - i * 1800000 }));
  apply(demoList.slice());
  setTimeout(() => { demoList.push({ id: "s-mid", name: "みお", chips: 52, date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 4000);
  setTimeout(() => { demoList.push({ id: "s-new", name: "ゆいと", chips: Math.max(LAST_YEAR + 12, 132), date: today(), createdAt: Date.now() }); apply(demoList.slice()); }, 9000);
} else {
  render(true);
  load().then(schedule);
}
})();
